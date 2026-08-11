import {
    IProtyle,
    IWebSocketData,
    Plugin,
    TProtyleAction,
    fetchSyncPost,
    getActiveEditor,
    getFrontend,
    openMobileFileById,
    openTab,
    showMessage,
} from "siyuan";
import {
    DocumentOutlineMode,
    WorkbenchPreferences,
} from "./workbench-preferences";

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const DOCUMENT_OUTLINE_DOCK_TYPE = "stillmark-document-outline";
const OUTLINE_REFRESH_DELAY_MS = 180;
const OPEN_HEADING_ACTIONS: TProtyleAction[] = [
    "cb-get-focus",
    "cb-get-context",
    "cb-get-scroll",
];

interface OutlineApiNode {
    blocks?: unknown;
    children?: unknown;
    content?: unknown;
    id?: unknown;
    name?: unknown;
    subType?: unknown;
}

interface OutlineHeading {
    children: OutlineHeading[];
    id: string;
    level: number;
    title: string;
}

export class DocumentOutlineFeature {
    private activeEditorHost?: HTMLElement;
    private activeHeadingId = "";
    private activeRootId = "";
    private boundEditorHost?: HTMLElement;
    private collapsedHeadingIds = new Set<string>();
    private disposed = false;
    private dockRoot?: HTMLElement;
    private dockVisibilityTimer?: number;
    private editorLocationLockUntil = 0;
    private editorScrollContainer?: HTMLElement;
    private editorScrollFrame?: number;
    private enabled = true;
    private floatingHost?: HTMLElement;
    private floatingRoot?: HTMLElement;
    private headings: OutlineHeading[] = [];
    private headingsRootId = "";
    private mode: DocumentOutlineMode = "dock";
    private mounted = false;
    private refreshGeneration = 0;
    private refreshTimer?: number;

    private readonly editorKeyHandler = () => {
        window.requestAnimationFrame(() => {
            const focusNode = window.getSelection()?.focusNode;
            const focusElement = focusNode instanceof Element ? focusNode : focusNode?.parentElement;
            const block = focusElement?.closest<HTMLElement>("[data-node-id]");
            if (block) {
                this.editorLocationLockUntil = Date.now() + 500;
                this.syncActiveHeadingFromBlock(block);
            }
        });
    };

    private readonly editorPointerHandler = (event: PointerEvent) => {
        const target = event.target instanceof Element ? event.target : undefined;
        if (target?.closest(".stillmark-document-outline")) {
            return;
        }
        const block = target?.closest<HTMLElement>("[data-node-id]");
        if (block) {
            this.editorLocationLockUntil = Date.now() + 500;
            this.syncActiveHeadingFromBlock(block);
        }
    };

    private readonly editorScrollHandler = () => {
        window.cancelAnimationFrame(this.editorScrollFrame);
        this.editorScrollFrame = window.requestAnimationFrame(() => {
            this.editorScrollFrame = undefined;
            this.syncActiveHeadingFromViewport();
        });
    };

    private readonly editorChangedHandler = ({detail}: CustomEvent<{protyle: IProtyle;}>) => {
        if (getActiveEditor()?.protyle.element !== detail.protyle.element) {
            return;
        }
        this.activeEditorHost = detail.protyle.element;
        this.bindEditorInteractions(detail.protyle.element);
        this.activeRootId = detail.protyle.block.rootID ?? "";
        this.activeHeadingId = "";
        this.syncFloatingPanel();
        this.scheduleRefresh(0);
    };

    private readonly destroyProtyleHandler = () => {
        this.syncFloatingPanel();
        this.scheduleRefresh(0);
    };

    private readonly webSocketHandler = ({detail}: CustomEvent<IWebSocketData>) => {
        if (detail?.cmd === "transactions") {
            this.scheduleRefresh();
        }
    };

    constructor(
        private readonly plugin: Plugin,
        private readonly preferences: WorkbenchPreferences,
    ) {}

    onload() {
        this.enabled = this.preferences.isFeatureEnabledCached("documentOutline");
        this.mode = this.preferences.getDocumentOutlineModeCached();
        this.plugin.addDock({
            config: {
                icon: "iconStillmarkOutline",
                position: "RightTop",
                show: this.enabled && this.mode === "dock",
                size: {
                    height: null,
                    width: 280,
                },
                title: this.plugin.i18n.documentOutlineTitle,
            },
            data: {},
            init: (custom) => {
                if (!(custom.element instanceof HTMLElement)) {
                    return;
                }
                this.dockRoot = custom.element;
                this.mountPanel(custom.element, "dock");
                this.renderPanels();
            },
            type: DOCUMENT_OUTLINE_DOCK_TYPE,
        });
        this.mount();
    }

    onLayoutReady() {
        this.syncPresentation(this.enabled && this.mode === "dock");
        this.scheduleRefresh(0);
    }

    onunload() {
        this.disposed = true;
        this.unmount();
        this.destroyFloatingPanel();
        this.activeEditorHost = undefined;
        this.unbindEditorInteractions();
        window.clearTimeout(this.dockVisibilityTimer);
    }

    async isEnabled() {
        return this.preferences.isFeatureEnabled("documentOutline");
    }

    async setEnabled(enabled: boolean) {
        await this.preferences.setFeatureEnabled("documentOutline", enabled);
        this.enabled = enabled;
        if (enabled) {
            this.mount();
            this.syncPresentation(true);
            this.scheduleRefresh(0);
        } else {
            this.unmount();
            this.syncPresentation();
        }
    }

    getModeCached() {
        return this.mode;
    }

    async getMode() {
        return this.preferences.getDocumentOutlineMode();
    }

    async setMode(mode: DocumentOutlineMode) {
        await this.preferences.setDocumentOutlineMode(mode);
        this.mode = mode;
        this.activeHeadingId = "";
        this.syncPresentation(true);
        this.scheduleRefresh(0);
    }

    private mount() {
        if (!this.enabled || this.mounted || this.disposed) {
            return;
        }
        this.mounted = true;
        this.plugin.eventBus.on("destroy-protyle", this.destroyProtyleHandler);
        this.plugin.eventBus.on("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle-mode", this.editorChangedHandler);
        this.plugin.eventBus.on("ws-main", this.webSocketHandler);
        const editor = getActiveEditor();
        this.activeEditorHost = editor?.protyle.element;
        this.bindEditorInteractions(this.activeEditorHost);
        this.activeRootId = editor?.protyle.block.rootID ?? "";
    }

    private unmount() {
        this.mounted = false;
        this.plugin.eventBus.off("destroy-protyle", this.destroyProtyleHandler);
        this.plugin.eventBus.off("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle-mode", this.editorChangedHandler);
        this.plugin.eventBus.off("ws-main", this.webSocketHandler);
        this.unbindEditorInteractions();
        window.clearTimeout(this.refreshTimer);
        window.cancelAnimationFrame(this.editorScrollFrame);
        this.refreshGeneration += 1;
        this.headings = [];
        this.headingsRootId = "";
        this.activeHeadingId = "";
        this.destroyFloatingPanel();
        this.renderPanels();
    }

    private syncPresentation(openDock = false) {
        const showDock = this.enabled && this.mode === "dock";
        if (this.enabled && this.mode === "floating") {
            this.syncFloatingPanel();
        } else {
            this.destroyFloatingPanel();
        }
        this.syncDockVisibility(showDock, openDock && showDock);
    }

    private syncDockVisibility(visible: boolean, open: boolean) {
        window.clearTimeout(this.dockVisibilityTimer);
        this.dockVisibilityTimer = window.setTimeout(() => {
            this.dockVisibilityTimer = undefined;
            const type = `${this.plugin.name}${DOCUMENT_OUTLINE_DOCK_TYPE}`;
            const selector = `[data-type="${CSS.escape(type)}"]`;
            const items = [...document.querySelectorAll<HTMLElement>(selector)];
            items.forEach((element) => {
                if (!visible && element.classList.contains("dock__item--active")) {
                    element.click();
                }
                element.classList.toggle("stillmark-feature-disabled", !visible);
            });
            document.querySelectorAll<HTMLElement>(`.sy__${CSS.escape(type)}`).forEach((element) => {
                element.classList.toggle("stillmark-feature-disabled", !visible);
            });
            if (!visible || !open) {
                return;
            }
            const item = items.find((element) => element.offsetParent !== null) ?? items[0];
            if (item && !item.classList.contains("dock__item--active")) {
                item.click();
            }
        }, 0);
    }

    private syncFloatingPanel() {
        if (!this.enabled || this.mode !== "floating") {
            this.destroyFloatingPanel();
            return;
        }
        const editor = getActiveEditor();
        const host = editor?.protyle.element ??
            (this.activeEditorHost?.isConnected ? this.activeEditorHost : undefined);
        const rootId = editor?.protyle.block.rootID ?? this.activeRootId;
        if (!host || !BLOCK_ID_PATTERN.test(rootId)) {
            this.destroyFloatingPanel();
            return;
        }
        this.activeEditorHost = host;
        if (this.floatingRoot?.isConnected && this.floatingHost === host) {
            return;
        }

        this.destroyFloatingPanel();
        const root = document.createElement("aside");
        root.className = "stillmark-document-outline stillmark-document-outline--floating";
        this.mountPanel(root, "floating");
        if (getComputedStyle(host).position === "static") {
            host.classList.add("stillmark-document-outline-host");
        }
        host.append(root);
        this.floatingHost = host;
        this.floatingRoot = root;
        this.renderPanels();
    }

    private destroyFloatingPanel() {
        this.floatingRoot?.remove();
        if (this.floatingHost && !this.floatingHost.querySelector(":scope > .stillmark-document-outline--floating")) {
            this.floatingHost.classList.remove("stillmark-document-outline-host");
        }
        this.floatingHost = undefined;
        this.floatingRoot = undefined;
    }

    private mountPanel(root: HTMLElement, presentation: DocumentOutlineMode) {
        root.classList.add("stillmark-document-outline");
        root.dataset.presentation = presentation;
        root.setAttribute("aria-label", this.plugin.i18n.documentOutlineTitle);

        const header = document.createElement("div");
        header.className = "stillmark-document-outline__header";
        const title = document.createElement("strong");
        title.textContent = this.plugin.i18n.documentOutlineTitle;
        const count = document.createElement("span");
        count.className = "stillmark-document-outline__count";
        count.dataset.role = "count";
        count.textContent = "0";
        header.append(title, count);

        const list = document.createElement("nav");
        list.className = "stillmark-document-outline__list";
        list.dataset.role = "list";
        list.setAttribute("aria-label", this.plugin.i18n.documentOutlineNavigation);
        const empty = document.createElement("div");
        empty.className = "stillmark-document-outline__empty";
        empty.dataset.role = "empty";
        empty.textContent = this.plugin.i18n.documentOutlineNoDocument;
        root.replaceChildren(header, list, empty);
    }

    private scheduleRefresh(delay = OUTLINE_REFRESH_DELAY_MS) {
        if (!this.enabled || this.disposed) {
            return;
        }
        window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
            void this.refresh();
        }, delay);
    }

    private async refresh() {
        if (!this.enabled || this.disposed) {
            return;
        }
        this.syncFloatingPanel();
        const editor = getActiveEditor();
        if (editor) {
            this.activeEditorHost = editor.protyle.element;
            this.bindEditorInteractions(editor.protyle.element);
        }
        const rootId = editor?.protyle.block.rootID ?? this.activeRootId;
        this.activeRootId = rootId;
        const generation = ++this.refreshGeneration;
        if (!BLOCK_ID_PATTERN.test(rootId)) {
            const needsRender = Boolean(this.headingsRootId || this.headings.length || this.activeHeadingId);
            this.headings = [];
            this.headingsRootId = "";
            this.activeHeadingId = "";
            if (needsRender) {
                this.renderPanels();
            }
            return;
        }

        const hasCurrentOutline = this.headingsRootId === rootId;
        if (!hasCurrentOutline) {
            this.setPanelState(this.plugin.i18n.documentOutlineLoading, "loading");
        }
        try {
            const response = await fetchSyncPost("/api/outline/getDocOutline", {id: rootId});
            if (response.code !== 0 || !Array.isArray(response.data)) {
                throw new Error(response.msg || this.plugin.i18n.documentOutlineLoadFailed);
            }
            const currentRootId = getActiveEditor()?.protyle.block.rootID ?? this.activeRootId;
            if (generation !== this.refreshGeneration || rootId !== currentRootId) {
                return;
            }
            const editorElement = editor?.protyle.wysiwyg?.element ??
                this.activeEditorHost?.querySelector<HTMLElement>(".protyle-wysiwyg");
            const headings = normalizeHeadingTree(response.data, editorElement);
            const sameStructure = hasCurrentOutline && headingStructuresEqual(this.headings, headings);
            const sameContent = hasCurrentOutline && headingTreesEqual(this.headings, headings);
            this.headings = headings;
            this.headingsRootId = rootId;
            [...this.collapsedHeadingIds].forEach((id) => {
                if (!hasHeading(this.headings, id)) {
                    this.collapsedHeadingIds.delete(id);
                }
            });
            if (!hasHeading(this.headings, this.activeHeadingId)) {
                this.activeHeadingId = "";
            }
            if (!sameContent) {
                if (sameStructure) {
                    this.updatePanelHeadingContent();
                } else {
                    this.renderPanels();
                }
            }
            this.syncActiveHeadingFromViewport();
        } catch {
            if (generation !== this.refreshGeneration) {
                return;
            }
            if (!hasCurrentOutline) {
                this.headings = [];
                this.headingsRootId = rootId;
                this.activeHeadingId = "";
                this.setPanelState(this.plugin.i18n.documentOutlineLoadFailed, "error");
            }
        }
    }

    private renderPanels() {
        [this.dockRoot, this.floatingRoot].forEach((root) => {
            if (root) {
                this.renderPanel(root);
            }
        });
    }

    private renderPanel(root: HTMLElement) {
        const count = root.querySelector<HTMLElement>('[data-role="count"]');
        const list = root.querySelector<HTMLElement>('[data-role="list"]');
        const empty = root.querySelector<HTMLElement>('[data-role="empty"]');
        if (!count || !list || !empty) {
            return;
        }
        const headingCount = countHeadings(this.headings);
        count.textContent = String(headingCount);
        list.replaceChildren(...this.headings.map((heading) => this.createHeadingBranch(heading)));
        list.hidden = headingCount === 0;
        empty.hidden = headingCount > 0;
        empty.dataset.state = "";
        empty.textContent = BLOCK_ID_PATTERN.test(this.activeRootId) ?
            this.plugin.i18n.documentOutlineEmpty :
            this.plugin.i18n.documentOutlineNoDocument;
    }

    private updatePanelHeadingContent() {
        const headings = flattenHeadings(this.headings);
        [this.dockRoot, this.floatingRoot].forEach((root) => {
            if (!root) {
                return;
            }
            for (const heading of headings) {
                const item = root.querySelector<HTMLElement>(
                    `.stillmark-document-outline__item[data-node-id="${CSS.escape(heading.id)}"]`,
                );
                const marker = item?.querySelector<HTMLElement>(".stillmark-document-outline__marker");
                const title = item?.querySelector<HTMLElement>(".stillmark-document-outline__title");
                if (!item || !marker || !title) {
                    this.renderPanel(root);
                    return;
                }
                item.title = heading.title;
                item.setAttribute("aria-label", `${heading.title} · H${heading.level}`);
                marker.textContent = formatHeadingLevel(heading.level);
                title.textContent = heading.title;

                const toggle = item.parentElement?.querySelector<HTMLElement>(
                    ":scope > .stillmark-document-outline__toggle",
                );
                if (toggle) {
                    toggle.setAttribute(
                        "aria-label",
                        (this.collapsedHeadingIds.has(heading.id) ?
                            this.plugin.i18n.documentOutlineExpandHeading :
                            this.plugin.i18n.documentOutlineCollapseHeading).replace("${title}", heading.title),
                    );
                }
            }
        });
    }

    private createHeadingBranch(heading: OutlineHeading) {
        const branch = document.createElement("div");
        branch.className = "stillmark-document-outline__branch";
        const row = document.createElement("div");
        row.className = "stillmark-document-outline__row";
        row.classList.toggle("is-active", heading.id === this.activeHeadingId);

        if (heading.children.length > 0) {
            const collapsed = this.collapsedHeadingIds.has(heading.id);
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "stillmark-document-outline__toggle";
            toggle.dataset.collapsed = String(collapsed);
            toggle.setAttribute(
                "aria-label",
                (collapsed ?
                    this.plugin.i18n.documentOutlineExpandHeading :
                    this.plugin.i18n.documentOutlineCollapseHeading).replace("${title}", heading.title),
            );
            toggle.setAttribute("aria-expanded", String(!collapsed));
            toggle.addEventListener("click", () => {
                if (this.collapsedHeadingIds.has(heading.id)) {
                    this.collapsedHeadingIds.delete(heading.id);
                } else {
                    this.collapsedHeadingIds.add(heading.id);
                }
                this.renderPanels();
                this.scrollActiveHeadingIntoView();
            });
            row.append(toggle);
        }
        row.append(this.createHeadingButton(heading));
        branch.append(row);

        const children = document.createElement("div");
        children.className = "stillmark-document-outline__children";
        children.setAttribute("role", "group");
        children.hidden = this.collapsedHeadingIds.has(heading.id);
        children.append(...heading.children.map((child) => this.createHeadingBranch(child)));
        if (heading.children.length > 0) {
            branch.append(children);
        }
        return branch;
    }

    private createHeadingButton(heading: OutlineHeading) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "stillmark-document-outline__item";
        button.classList.toggle("is-active", heading.id === this.activeHeadingId);
        button.dataset.nodeId = heading.id;
        button.title = heading.title;
        button.setAttribute("aria-label", `${heading.title} · H${heading.level}`);
        button.setAttribute("aria-current", heading.id === this.activeHeadingId ? "location" : "false");

        const marker = document.createElement("span");
        marker.className = "stillmark-document-outline__marker";
        marker.textContent = formatHeadingLevel(heading.level);
        marker.setAttribute("aria-hidden", "true");
        const title = document.createElement("span");
        title.className = "stillmark-document-outline__title";
        title.textContent = heading.title;
        button.append(marker, title);
        button.addEventListener("click", () => {
            this.setActiveHeading(heading.id);
            void this.openHeading(heading.id).catch((error) => {
                showMessage(`${this.plugin.i18n.documentOutlineOpenFailed}: ${errorMessage(error)}`, 5000, "error");
            });
        });
        return button;
    }

    private bindEditorInteractions(host?: HTMLElement) {
        if (!host || this.boundEditorHost === host) {
            return;
        }
        this.unbindEditorInteractions();
        this.boundEditorHost = host;
        this.editorScrollContainer = host.querySelector<HTMLElement>(".protyle-content") ?? undefined;
        host.addEventListener("pointerup", this.editorPointerHandler);
        host.addEventListener("keyup", this.editorKeyHandler);
        this.editorScrollContainer?.addEventListener("scroll", this.editorScrollHandler, {passive: true});
    }

    private unbindEditorInteractions() {
        this.boundEditorHost?.removeEventListener("pointerup", this.editorPointerHandler);
        this.boundEditorHost?.removeEventListener("keyup", this.editorKeyHandler);
        this.editorScrollContainer?.removeEventListener("scroll", this.editorScrollHandler);
        this.boundEditorHost = undefined;
        this.editorScrollContainer = undefined;
    }

    private syncActiveHeadingFromBlock(block: HTMLElement) {
        const editor = this.boundEditorHost?.querySelector<HTMLElement>(".protyle-wysiwyg");
        if (!editor?.contains(block)) {
            return;
        }
        let activeId = "";
        for (const heading of renderedHeadingElements(editor)) {
            if (heading === block || heading.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING) {
                activeId = heading.dataset.nodeId ?? "";
            } else if (activeId) {
                break;
            }
        }
        this.setActiveHeading(activeId);
    }

    private syncActiveHeadingFromViewport() {
        if (Date.now() < this.editorLocationLockUntil) {
            return;
        }
        const editor = this.boundEditorHost?.querySelector<HTMLElement>(".protyle-wysiwyg");
        const scrollContainer = this.editorScrollContainer;
        if (!editor || !scrollContainer) {
            return;
        }
        const viewport = scrollContainer.getBoundingClientRect();
        const referenceTop = viewport.top + Math.min(96, viewport.height * 0.22);
        let activeId = "";
        for (const heading of renderedHeadingElements(editor)) {
            if (heading.getBoundingClientRect().top <= referenceTop) {
                activeId = heading.dataset.nodeId ?? "";
            } else {
                break;
            }
        }
        if (activeId) {
            this.setActiveHeading(activeId);
        }
    }

    private setActiveHeading(id: string) {
        if (id && !hasHeading(this.headings, id)) {
            return;
        }
        let expandedPath = false;
        const path = findHeadingPath(this.headings, id);
        path?.slice(0, -1).forEach((heading) => {
            if (this.collapsedHeadingIds.delete(heading.id)) {
                expandedPath = true;
            }
        });
        this.activeHeadingId = id;
        if (expandedPath) {
            this.renderPanels();
        } else {
            this.updateActiveHeadingState();
        }
        this.scrollActiveHeadingIntoView();
    }

    private updateActiveHeadingState() {
        [this.dockRoot, this.floatingRoot].forEach((root) => {
            root?.querySelectorAll<HTMLElement>(".stillmark-document-outline__item").forEach((item) => {
                const active = item.dataset.nodeId === this.activeHeadingId;
                item.classList.toggle("is-active", active);
                item.parentElement?.classList.toggle("is-active", active);
                item.setAttribute("aria-current", active ? "location" : "false");
            });
        });
    }

    private scrollActiveHeadingIntoView() {
        if (!this.activeHeadingId) {
            return;
        }
        window.requestAnimationFrame(() => {
            [this.dockRoot, this.floatingRoot].forEach((root) => {
                if (!root || root.offsetParent === null) {
                    return;
                }
                const list = root.querySelector<HTMLElement>('[data-role="list"]');
                const item = root.querySelector<HTMLElement>(
                    `[data-node-id="${CSS.escape(this.activeHeadingId)}"]`,
                );
                if (!list || !item || item.offsetParent === null) {
                    return;
                }
                const listRect = list.getBoundingClientRect();
                const itemRect = item.getBoundingClientRect();
                if (itemRect.top < listRect.top + 4) {
                    list.scrollTop -= listRect.top + 4 - itemRect.top;
                } else if (itemRect.bottom > listRect.bottom - 4) {
                    list.scrollTop += itemRect.bottom - (listRect.bottom - 4);
                }
            });
        });
    }

    private setPanelState(message: string, state: "error" | "loading") {
        [this.dockRoot, this.floatingRoot].forEach((root) => {
            const list = root?.querySelector<HTMLElement>('[data-role="list"]');
            const empty = root?.querySelector<HTMLElement>('[data-role="empty"]');
            if (!list || !empty) {
                return;
            }
            list.hidden = true;
            empty.hidden = false;
            empty.dataset.state = state;
            empty.textContent = message;
        });
    }

    private async openHeading(id: string) {
        const editor = getActiveEditor();
        const visibleHeading = editor?.protyle.wysiwyg?.element.querySelector<HTMLElement>(
            `[data-node-id="${CSS.escape(id)}"]`,
        );
        if (visibleHeading) {
            visibleHeading.scrollIntoView({behavior: "smooth", block: "start", inline: "nearest"});
            return;
        }
        if (isMobile()) {
            openMobileFileById(this.plugin.app, id, OPEN_HEADING_ACTIONS);
            return;
        }
        await openTab({
            app: this.plugin.app,
            doc: {
                action: OPEN_HEADING_ACTIONS,
                id,
            },
            openNewTab: false,
        });
    }
}

function normalizeHeadingTree(nodes: unknown, editor?: HTMLElement): OutlineHeading[] {
    if (!Array.isArray(nodes)) {
        return [];
    }
    return nodes.flatMap((value: unknown) => {
        const node = value && typeof value === "object" ? value as OutlineApiNode : {};
        const nestedNodes = Array.isArray(node.blocks) && node.blocks.length > 0 ? node.blocks : node.children;
        const children = normalizeHeadingTree(nestedNodes, editor);
        const id = typeof node.id === "string" ? node.id : "";
        const level = typeof node.subType === "string" ? Number(node.subType.slice(1)) : 0;
        if (!BLOCK_ID_PATTERN.test(id) || !Number.isInteger(level) || level < 1 || level > 6) {
            return children;
        }
        const renderedTitle = editor?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.textContent;
        const title = normalizeText(renderedTitle) || normalizeText(node.name) || normalizeText(node.content);
        if (!title) {
            return children;
        }
        return [{children, id, level, title}];
    });
}

function normalizeText(value: unknown) {
    return typeof value === "string" ? value.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim() : "";
}

function countHeadings(headings: OutlineHeading[]): number {
    return headings.reduce((count, heading) => count + 1 + countHeadings(heading.children), 0);
}

function flattenHeadings(headings: OutlineHeading[]): OutlineHeading[] {
    return headings.flatMap((heading) => [heading, ...flattenHeadings(heading.children)]);
}

function headingStructuresEqual(current: OutlineHeading[], next: OutlineHeading[]): boolean {
    return current.length === next.length && current.every((heading, index) => {
        const nextHeading = next[index];
        return heading.id === nextHeading.id && headingStructuresEqual(heading.children, nextHeading.children);
    });
}

function headingTreesEqual(current: OutlineHeading[], next: OutlineHeading[]): boolean {
    return current.length === next.length && current.every((heading, index) => {
        const nextHeading = next[index];
        return heading.id === nextHeading.id && heading.level === nextHeading.level &&
            heading.title === nextHeading.title &&
            headingTreesEqual(heading.children, nextHeading.children);
    });
}

function hasHeading(headings: OutlineHeading[], id: string): boolean {
    return Boolean(id) && headings.some((heading) => heading.id === id || hasHeading(heading.children, id));
}

function findHeadingPath(headings: OutlineHeading[], id: string): OutlineHeading[] | undefined {
    if (!id) {
        return undefined;
    }
    for (const heading of headings) {
        if (heading.id === id) {
            return [heading];
        }
        const childPath = findHeadingPath(heading.children, id);
        if (childPath) {
            return [heading, ...childPath];
        }
    }
    return undefined;
}

function renderedHeadingElements(editor: HTMLElement) {
    return [...editor.querySelectorAll<HTMLElement>('[data-type="NodeHeading"][data-node-id]')];
}

function formatHeadingLevel(level: number) {
    return `H${["", "₁", "₂", "₃", "₄", "₅", "₆"][level] ?? level}`;
}

function isMobile() {
    return ["mobile", "browser-mobile"].includes(getFrontend());
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
