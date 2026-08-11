import {
    IEventBusMap,
    IProtyle,
    IWebSocketData,
    Plugin,
    fetchSyncPost,
    getActiveEditor,
    showMessage,
} from "siyuan";
import {
    MindMapTreeNode,
    layoutMindMap,
} from "./mind-map-layout";
import {WorkbenchPreferences} from "./workbench-preferences";

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const REFRESH_DELAY_MS = 180;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

interface OutlineApiNode {
    blocks?: unknown;
    content?: unknown;
    id?: unknown;
    name?: unknown;
    subType?: unknown;
}

interface TransformState {
    panX: number;
    panY: number;
    zoom: number;
}

export class MindMapFeature {
    private activeRootId = "";
    private collapsedNodeIds = new Set<string>();
    private contentHost?: HTMLElement;
    private disposed = false;
    private editorHost?: HTMLElement;
    private enabled = true;
    private fitFrame?: number;
    private mapMode = false;
    private mapRoot?: MindMapTreeNode;
    private mounted = false;
    private mountTimer?: number;
    private previousScrollTop = 0;
    private refreshGeneration = 0;
    private refreshTimer?: number;
    private resizeObserver?: ResizeObserver;
    private root?: HTMLElement;
    private selectedNodeId = "";
    private status?: HTMLElement;
    private topBarElement?: HTMLElement;
    private transform: TransformState = {panX: 0, panY: 0, zoom: 1};
    private viewport?: HTMLElement;
    private world?: HTMLElement;
    private worldHeight = 0;
    private worldWidth = 0;
    private zoomOutput?: HTMLElement;

    private readonly editorChangedHandler = ({detail}: CustomEvent<{protyle: IProtyle;}>) => {
        if (!this.mapMode || this.disposed) {
            return;
        }
        window.clearTimeout(this.mountTimer);
        this.mountTimer = window.setTimeout(() => {
            this.mountTimer = undefined;
            const editor = getActiveEditor();
            if (editor?.protyle.element !== detail.protyle.element) {
                return;
            }
            this.mountActiveEditor(true);
        }, 0);
    };

    private readonly destroyProtyleHandler = () => {
        if (!this.mapMode || this.disposed) {
            return;
        }
        window.clearTimeout(this.mountTimer);
        this.mountTimer = window.setTimeout(() => {
            this.mountTimer = undefined;
            this.mountActiveEditor(true);
        }, 0);
    };

    private readonly breadcrumbMoreMenuHandler = ({
        detail,
    }: CustomEvent<IEventBusMap["open-menu-breadcrumbmore"]>) => {
        if (!this.enabled) {
            return;
        }
        const isCurrentMap = this.mapMode && this.editorHost === detail.protyle.element;
        detail.menu.addItem({
            icon: "iconStillmarkMindMap",
            label: isCurrentMap ?
                this.plugin.i18n.mindMapReturnToDocument :
                this.plugin.i18n.mindMapOpen,
            click: () => {
                void this.toggle();
            },
        });
    };

    private readonly webSocketHandler = ({detail}: CustomEvent<IWebSocketData>) => {
        if (detail?.cmd === "transactions" && this.mapMode) {
            this.scheduleRefresh();
        }
    };

    constructor(
        private readonly plugin: Plugin,
        private readonly preferences: WorkbenchPreferences,
    ) {}

    onload() {
        this.enabled = this.preferences.isFeatureEnabledCached("mindMap");
        this.plugin.addIcons(
            `<symbol id="iconStillmarkMindMap" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
<rect x="2.5" y="9" width="6" height="6" rx="1.5"></rect><rect x="15.5" y="3" width="6" height="5" rx="1.5"></rect><rect x="15.5" y="16" width="6" height="5" rx="1.5"></rect><path d="M8.5 12h3a3 3 0 0 0 3-3V7.5M11.5 12h1a3 3 0 0 1 3 3v2.5"></path>
</symbol>`,
        );
        this.plugin.addCommand({
            langKey: "toggleMindMap",
            hotkey: "⌥⇧M",
            callback: () => {
                void this.toggle();
            },
        });
        this.mount();
    }

    onLayoutReady() {
        this.topBarElement = this.plugin.addTopBar({
            icon: "iconStillmarkMindMap",
            title: this.plugin.i18n.toggleMindMap,
            position: "left",
            callback: () => {
                void this.toggle();
            },
        });
        this.topBarElement.classList.add("stillmark-topbar-icon", "stillmark-topbar-icon--mind-map");
        this.syncTopBarState();
    }

    onunload() {
        this.disposed = true;
        this.mapMode = false;
        this.unmount();
        this.destroyView();
        window.clearTimeout(this.mountTimer);
        window.clearTimeout(this.refreshTimer);
        window.cancelAnimationFrame(this.fitFrame);
    }

    async isEnabled() {
        return this.preferences.isFeatureEnabled("mindMap");
    }

    async setEnabled(enabled: boolean) {
        await this.preferences.setFeatureEnabled("mindMap", enabled);
        this.enabled = enabled;
        if (enabled) {
            this.mount();
        } else {
            this.exit();
            this.unmount();
        }
        this.syncTopBarState();
    }

    isOpenForActiveDocument() {
        return this.mapMode && this.editorHost === getActiveEditor()?.protyle.element;
    }

    async toggle() {
        if (this.mapMode) {
            this.exit();
            return;
        }
        if (!this.enabled) {
            showMessage(this.plugin.i18n.mindMapDisabled, 4000, "error");
            return;
        }
        const editor = getActiveEditor();
        const rootId = editor?.protyle.block.rootID ?? "";
        if (!editor || !BLOCK_ID_PATTERN.test(rootId)) {
            showMessage(this.plugin.i18n.mindMapNoDocument, 4000, "error");
            return;
        }
        this.mapMode = true;
        this.syncTopBarState();
        this.mountActiveEditor(true);
    }

    exit() {
        this.mapMode = false;
        this.destroyView();
        this.syncTopBarState();
    }

    private syncTopBarState() {
        this.topBarElement?.classList.toggle("stillmark-feature-disabled", !this.enabled);
        this.topBarElement?.setAttribute("aria-pressed", String(this.mapMode));
    }

    private mount() {
        if (!this.enabled || this.mounted || this.disposed) {
            return;
        }
        this.mounted = true;
        this.plugin.eventBus.on("destroy-protyle", this.destroyProtyleHandler);
        this.plugin.eventBus.on("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.on("open-menu-breadcrumbmore", this.breadcrumbMoreMenuHandler);
        this.plugin.eventBus.on("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle-mode", this.editorChangedHandler);
        this.plugin.eventBus.on("ws-main", this.webSocketHandler);
    }

    private unmount() {
        if (!this.mounted) {
            return;
        }
        this.mounted = false;
        this.plugin.eventBus.off("destroy-protyle", this.destroyProtyleHandler);
        this.plugin.eventBus.off("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.off("open-menu-breadcrumbmore", this.breadcrumbMoreMenuHandler);
        this.plugin.eventBus.off("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle-mode", this.editorChangedHandler);
        this.plugin.eventBus.off("ws-main", this.webSocketHandler);
    }

    private mountActiveEditor(fitAfterRender: boolean) {
        if (!this.mapMode || this.disposed) {
            return;
        }
        const editor = getActiveEditor();
        const rootId = editor?.protyle.block.rootID ?? "";
        const content = editor?.protyle.element.querySelector<HTMLElement>(".protyle-content");
        if (!editor || !content || !BLOCK_ID_PATTERN.test(rootId)) {
            this.destroyView();
            return;
        }
        if (this.editorHost === editor.protyle.element && this.root?.isConnected) {
            this.scheduleRefresh(0, fitAfterRender);
            return;
        }

        this.destroyView();
        this.editorHost = editor.protyle.element;
        this.contentHost = content;
        this.activeRootId = rootId;
        this.previousScrollTop = content.scrollTop;
        this.collapsedNodeIds.clear();
        this.selectedNodeId = rootId;
        this.transform = {panX: 0, panY: 0, zoom: 1};
        this.createShell(content);
        this.editorHost.classList.add("stillmark-mind-map-mode");
        this.scheduleRefresh(0, fitAfterRender);
    }

    private destroyView() {
        this.refreshGeneration += 1;
        window.clearTimeout(this.refreshTimer);
        window.cancelAnimationFrame(this.fitFrame);
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        this.root?.remove();
        this.editorHost?.classList.remove("stillmark-mind-map-mode");
        if (this.contentHost?.isConnected) {
            this.contentHost.scrollTop = this.previousScrollTop;
        }
        this.activeRootId = "";
        this.contentHost = undefined;
        this.editorHost = undefined;
        this.mapRoot = undefined;
        this.root = undefined;
        this.status = undefined;
        this.viewport = undefined;
        this.world = undefined;
        this.zoomOutput = undefined;
        this.worldHeight = 0;
        this.worldWidth = 0;
    }

    private createShell(content: HTMLElement) {
        const root = document.createElement("section");
        root.className = "stillmark-mind-map";
        root.tabIndex = -1;
        root.setAttribute("aria-label", this.plugin.i18n.mindMapTitle);

        const header = document.createElement("header");
        header.className = "stillmark-mind-map__header";
        const modeSwitch = document.createElement("div");
        modeSwitch.className = "stillmark-mind-map__mode-switch";
        modeSwitch.setAttribute("role", "group");
        modeSwitch.setAttribute("aria-label", this.plugin.i18n.mindMapViewMode);
        const documentButton = this.createToolbarButton(this.plugin.i18n.mindMapDocumentMode, () => this.exit());
        documentButton.classList.add("stillmark-mind-map__mode-button");
        documentButton.setAttribute("aria-pressed", "false");
        const mapButton = this.createToolbarButton(this.plugin.i18n.mindMapMode, () => undefined);
        mapButton.classList.add("stillmark-mind-map__mode-button", "is-active");
        mapButton.setAttribute("aria-pressed", "true");
        modeSwitch.append(documentButton, mapButton);

        const identity = document.createElement("div");
        identity.className = "stillmark-mind-map__identity";
        const title = document.createElement("strong");
        title.dataset.role = "title";
        title.textContent = this.plugin.i18n.mindMapTitle;
        const count = document.createElement("span");
        count.dataset.role = "count";
        identity.append(title, count);

        const actions = document.createElement("div");
        actions.className = "stillmark-mind-map__actions";
        const collapseButton = this.createToolbarButton(this.plugin.i18n.mindMapCollapseAll, () => {
            this.collapseAll();
        });
        const expandButton = this.createToolbarButton(this.plugin.i18n.mindMapExpandAll, () => {
            this.collapsedNodeIds.clear();
            this.renderMap(true);
        });
        const fitButton = this.createToolbarButton(this.plugin.i18n.mindMapFit, () => this.fit());
        fitButton.classList.add("stillmark-mind-map__fit-button");
        const zoomOutButton = this.createToolbarButton("−", () => this.zoomBy(0.86));
        zoomOutButton.classList.add("stillmark-mind-map__zoom-button");
        zoomOutButton.setAttribute("aria-label", this.plugin.i18n.mindMapZoomOut);
        const zoomOutput = document.createElement("output");
        zoomOutput.className = "stillmark-mind-map__zoom-output";
        zoomOutput.textContent = "100%";
        const zoomInButton = this.createToolbarButton("+", () => this.zoomBy(1.16));
        zoomInButton.classList.add("stillmark-mind-map__zoom-button");
        zoomInButton.setAttribute("aria-label", this.plugin.i18n.mindMapZoomIn);
        actions.append(collapseButton, expandButton, fitButton, zoomOutButton, zoomOutput, zoomInButton);
        header.append(modeSwitch, identity, actions);

        const body = document.createElement("div");
        body.className = "stillmark-mind-map__body";
        const status = document.createElement("div");
        status.className = "stillmark-mind-map__status";
        status.dataset.state = "loading";
        status.textContent = this.plugin.i18n.mindMapLoading;
        const viewport = document.createElement("div");
        viewport.className = "stillmark-mind-map__viewport";
        viewport.hidden = true;
        const world = document.createElement("div");
        world.className = "stillmark-mind-map__world";
        viewport.append(world);
        const hint = document.createElement("div");
        hint.className = "stillmark-mind-map__hint";
        hint.textContent = this.plugin.i18n.mindMapHint;
        body.append(status, viewport, hint);
        root.append(header, body);
        content.append(root);

        this.root = root;
        this.status = status;
        this.viewport = viewport;
        this.world = world;
        this.zoomOutput = zoomOutput;
        this.bindViewportInteractions(viewport, root);
        this.resizeObserver = new ResizeObserver(() => {
            if (this.mapRoot && this.root?.isConnected) {
                this.fit();
            }
        });
        this.resizeObserver.observe(viewport);
    }

    private createToolbarButton(label: string, callback: () => void) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "stillmark-mind-map__toolbar-button";
        button.textContent = label;
        button.addEventListener("click", callback);
        return button;
    }

    private scheduleRefresh(delay = REFRESH_DELAY_MS, fitAfterRender = false) {
        if (!this.mapMode || this.disposed) {
            return;
        }
        window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refresh(fitAfterRender);
        }, delay);
    }

    private async refresh(fitAfterRender: boolean) {
        if (!this.mapMode || !this.root?.isConnected || this.disposed) {
            return;
        }
        const editor = getActiveEditor();
        const rootId = editor?.protyle.block.rootID ?? "";
        if (!editor || editor.protyle.element !== this.editorHost || rootId !== this.activeRootId) {
            this.mountActiveEditor(true);
            return;
        }
        const generation = ++this.refreshGeneration;
        this.showStatus(this.plugin.i18n.mindMapLoading, "loading");
        try {
            const response = await fetchSyncPost("/api/outline/getDocOutline", {id: rootId});
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.mindMapLoadFailed);
            }
            if (generation !== this.refreshGeneration || !this.mapMode) {
                return;
            }
            const editorElement = editor.protyle.wysiwyg?.element;
            let children = normalizeOutlineTree(
                Array.isArray(response.data) ? response.data : [],
                editorElement,
            );
            if (children.length === 0) {
                children = fallbackDocumentBlocks(editorElement);
            }
            const title = documentTitle(editor.protyle) || this.plugin.i18n.mindMapUntitled;
            this.mapRoot = {
                branch: -1,
                children,
                depth: 0,
                id: rootId,
                level: 0,
                title,
            };
            const currentIds = collectNodeIds(this.mapRoot);
            [...this.collapsedNodeIds].forEach((id) => {
                if (!currentIds.has(id)) {
                    this.collapsedNodeIds.delete(id);
                }
            });
            if (!currentIds.has(this.selectedNodeId)) {
                this.selectedNodeId = rootId;
            }
            this.hideStatus();
            this.renderMap(fitAfterRender);
        } catch (error) {
            if (generation !== this.refreshGeneration) {
                return;
            }
            this.mapRoot = undefined;
            this.showStatus(
                `${this.plugin.i18n.mindMapLoadFailed}: ${errorMessage(error)}`,
                "error",
            );
        }
    }

    private showStatus(message: string, state: "error" | "loading") {
        if (!this.status || !this.viewport) {
            return;
        }
        this.status.hidden = false;
        this.status.dataset.state = state;
        this.status.textContent = message;
        this.viewport.hidden = true;
    }

    private hideStatus() {
        if (!this.status || !this.viewport) {
            return;
        }
        this.status.hidden = true;
        this.viewport.hidden = false;
    }

    private renderMap(fitAfterRender: boolean) {
        const root = this.mapRoot;
        const world = this.world;
        if (!root || !world) {
            return;
        }
        const title = this.root?.querySelector<HTMLElement>('[data-role="title"]');
        const count = this.root?.querySelector<HTMLElement>('[data-role="count"]');
        if (title) {
            title.textContent = root.title;
            title.title = root.title;
        }
        if (count) {
            count.textContent = this.plugin.i18n.mindMapTopicCount.replace(
                "${count}",
                String(Math.max(0, collectNodeIds(root).size - 1)),
            );
        }

        const visibleNodes = flattenVisible(root, this.collapsedNodeIds);
        const nodeLayer = document.createElement("div");
        nodeLayer.className = "stillmark-mind-map__nodes";
        const nodeElements = new Map<string, HTMLElement>();
        visibleNodes.forEach((node) => {
            const element = this.createNodeElement(node);
            nodeElements.set(node.id, element);
            nodeLayer.append(element);
        });
        world.style.transform = "none";
        world.replaceChildren(nodeLayer);

        const nodeSizes = new Map([...nodeElements].map(([id, element]) => [
            id,
            {height: element.offsetHeight, width: element.offsetWidth},
        ]));
        const layout = layoutMindMap(root, nodeSizes, this.collapsedNodeIds);
        const connections = document.createElementNS(SVG_NAMESPACE, "svg");
        connections.classList.add("stillmark-mind-map__connections");
        connections.setAttribute("aria-hidden", "true");
        connections.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
        connections.setAttribute("width", String(layout.width));
        connections.setAttribute("height", String(layout.height));
        layout.edges.forEach((edge) => {
            const path = document.createElementNS(SVG_NAMESPACE, "path");
            const sourceX = edge.source.x + edge.source.width;
            const sourceY = edge.source.y + edge.source.height / 2;
            const targetX = edge.target.x;
            const targetY = edge.target.y + edge.target.height / 2;
            const bend = Math.max(42, (targetX - sourceX) * 0.48);
            path.setAttribute(
                "d",
                `M ${sourceX} ${sourceY} C ${sourceX + bend} ${sourceY}, ${
                    targetX - bend
                } ${targetY}, ${targetX} ${targetY}`,
            );
            path.dataset.branch = String(edge.target.node.branch % 8);
            connections.append(path);
        });
        layout.nodes.forEach((positioned) => {
            const element = nodeElements.get(positioned.node.id);
            if (element) {
                element.style.transform = `translate(${positioned.x}px, ${positioned.y}px)`;
            }
        });
        world.prepend(connections);
        world.style.width = `${layout.width}px`;
        world.style.height = `${layout.height}px`;
        this.worldWidth = layout.width;
        this.worldHeight = layout.height;
        this.applyTransform();
        if (fitAfterRender) {
            window.cancelAnimationFrame(this.fitFrame);
            this.fitFrame = window.requestAnimationFrame(() => {
                this.fitFrame = undefined;
                this.fit();
            });
        }
    }

    private createNodeElement(node: MindMapTreeNode) {
        const container = document.createElement("div");
        container.className = "stillmark-mind-map__node";
        container.classList.toggle("is-root", node.depth === 0);
        container.classList.toggle("is-selected", node.id === this.selectedNodeId);
        container.dataset.branch = String(Math.max(0, node.branch % 8));
        container.dataset.depth = String(node.depth);
        container.dataset.nodeId = node.id;

        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "stillmark-mind-map__node-open";
        openButton.title = this.plugin.i18n.mindMapOpenNode.replace("${title}", node.title);
        const title = document.createElement("span");
        title.className = "stillmark-mind-map__node-title";
        title.textContent = node.title;
        const meta = document.createElement("span");
        meta.className = "stillmark-mind-map__node-meta";
        meta.textContent = node.depth === 0 ?
            this.plugin.i18n.mindMapRootNode :
            node.level > 0 ?
            `H${node.level}` :
            this.plugin.i18n.mindMapContentNode;
        openButton.append(title, meta);
        openButton.addEventListener("click", () => {
            this.selectedNodeId = node.id;
            this.updateSelectedNode();
        });
        openButton.addEventListener("dblclick", () => this.openNodeInDocument(node));
        openButton.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                this.openNodeInDocument(node);
            }
        });
        container.append(openButton);

        if (node.children.length > 0) {
            const collapsed = this.collapsedNodeIds.has(node.id);
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "stillmark-mind-map__node-toggle";
            toggle.textContent = collapsed ? "+" : "−";
            toggle.setAttribute("aria-expanded", String(!collapsed));
            toggle.setAttribute(
                "aria-label",
                (collapsed ? this.plugin.i18n.mindMapExpandNode : this.plugin.i18n.mindMapCollapseNode)
                    .replace("${title}", node.title),
            );
            toggle.addEventListener("click", () => {
                if (collapsed) {
                    this.collapsedNodeIds.delete(node.id);
                } else {
                    this.collapsedNodeIds.add(node.id);
                }
                this.renderMap(false);
            });
            container.append(toggle);
        }
        return container;
    }

    private updateSelectedNode() {
        this.root?.querySelectorAll<HTMLElement>(".stillmark-mind-map__node").forEach((node) => {
            node.classList.toggle("is-selected", node.dataset.nodeId === this.selectedNodeId);
        });
    }

    private collapseAll() {
        const root = this.mapRoot;
        if (!root) {
            return;
        }
        this.collapsedNodeIds.clear();
        const visit = (node: MindMapTreeNode) => {
            if (node.depth > 0 && node.children.length > 0) {
                this.collapsedNodeIds.add(node.id);
            }
            node.children.forEach(visit);
        };
        visit(root);
        this.renderMap(true);
    }

    private openNodeInDocument(node: MindMapTreeNode) {
        const host = this.editorHost;
        const content = this.contentHost;
        this.exit();
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (!host?.isConnected || !content?.isConnected) {
                    return;
                }
                if (node.depth === 0) {
                    content.scrollTo({behavior: "smooth", top: 0});
                    return;
                }
                host.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`)?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                    inline: "nearest",
                });
            });
        });
    }

    private bindViewportInteractions(viewport: HTMLElement, root: HTMLElement) {
        let pointerId: number | undefined;
        let pointerX = 0;
        let pointerY = 0;
        viewport.addEventListener("pointerdown", (event) => {
            const target = event.target instanceof Element ? event.target : undefined;
            if (event.button !== 0 || target?.closest(".stillmark-mind-map__node")) {
                return;
            }
            pointerId = event.pointerId;
            pointerX = event.clientX;
            pointerY = event.clientY;
            viewport.setPointerCapture(event.pointerId);
            viewport.classList.add("is-panning");
        });
        viewport.addEventListener("pointermove", (event) => {
            if (pointerId !== event.pointerId) {
                return;
            }
            this.transform.panX += event.clientX - pointerX;
            this.transform.panY += event.clientY - pointerY;
            pointerX = event.clientX;
            pointerY = event.clientY;
            this.applyTransform();
        });
        const endPan = (event: PointerEvent) => {
            if (pointerId !== event.pointerId) {
                return;
            }
            pointerId = undefined;
            viewport.classList.remove("is-panning");
            if (viewport.hasPointerCapture(event.pointerId)) {
                viewport.releasePointerCapture(event.pointerId);
            }
        };
        viewport.addEventListener("pointerup", endPan);
        viewport.addEventListener("pointercancel", endPan);
        viewport.addEventListener("dblclick", (event) => {
            const target = event.target instanceof Element ? event.target : undefined;
            if (!target?.closest(".stillmark-mind-map__node")) {
                this.fit();
            }
        });
        viewport.addEventListener("wheel", (event) => {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
                const bounds = viewport.getBoundingClientRect();
                this.zoomAt(
                    Math.exp(-event.deltaY * 0.0015),
                    event.clientX - bounds.left,
                    event.clientY - bounds.top,
                );
                return;
            }
            if (event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY)) {
                this.transform.panX -= event.deltaY;
            } else {
                this.transform.panX -= event.deltaX;
                this.transform.panY -= event.deltaY;
            }
            this.applyTransform();
        }, {passive: false});
        root.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                this.exit();
            } else if (event.key === "0") {
                event.preventDefault();
                this.fit();
            } else if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                this.zoomBy(1.16);
            } else if (event.key === "-") {
                event.preventDefault();
                this.zoomBy(0.86);
            }
        });
    }

    private fit() {
        const viewport = this.viewport;
        if (!viewport || this.worldWidth <= 0 || this.worldHeight <= 0) {
            return;
        }
        const availableWidth = Math.max(1, viewport.clientWidth - 56);
        const availableHeight = Math.max(1, viewport.clientHeight - 56);
        const zoom = clamp(
            Math.min(availableWidth / this.worldWidth, availableHeight / this.worldHeight, 1.12),
            MIN_ZOOM,
            MAX_ZOOM,
        );
        const scaledWidth = this.worldWidth * zoom;
        this.transform = {
            panX: scaledWidth <= viewport.clientWidth ? (viewport.clientWidth - scaledWidth) / 2 : 12,
            panY: (viewport.clientHeight - this.worldHeight * zoom) / 2,
            zoom,
        };
        this.applyTransform();
    }

    private zoomBy(factor: number) {
        const viewport = this.viewport;
        if (!viewport) {
            return;
        }
        this.zoomAt(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
    }

    private zoomAt(factor: number, viewportX: number, viewportY: number) {
        const nextZoom = clamp(this.transform.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const worldX = (viewportX - this.transform.panX) / this.transform.zoom;
        const worldY = (viewportY - this.transform.panY) / this.transform.zoom;
        this.transform = {
            panX: viewportX - worldX * nextZoom,
            panY: viewportY - worldY * nextZoom,
            zoom: nextZoom,
        };
        this.applyTransform();
    }

    private applyTransform() {
        if (this.world) {
            this.world.style.transform =
                `translate(${this.transform.panX}px, ${this.transform.panY}px) scale(${this.transform.zoom})`;
        }
        if (this.zoomOutput) {
            this.zoomOutput.textContent = `${Math.round(this.transform.zoom * 100)}%`;
        }
    }
}

function normalizeOutlineTree(nodes: unknown, editor?: HTMLElement): MindMapTreeNode[] {
    if (!Array.isArray(nodes)) {
        return [];
    }
    return nodes.flatMap((value, index) => normalizeOutlineNode(value, editor, 1, index));
}

function normalizeOutlineNode(
    value: unknown,
    editor: HTMLElement | undefined,
    depth: number,
    branch: number,
): MindMapTreeNode[] {
    const node = value && typeof value === "object" ? value as OutlineApiNode : {};
    const id = typeof node.id === "string" ? node.id : "";
    const level = typeof node.subType === "string" ? Number(node.subType.slice(1)) : 0;
    const children = Array.isArray(node.blocks) ?
        node.blocks.flatMap((child) => normalizeOutlineNode(child, editor, depth + 1, branch)) :
        [];
    if (!BLOCK_ID_PATTERN.test(id) || !Number.isInteger(level) || level < 1 || level > 6) {
        return children;
    }
    const renderedTitle = editor?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.textContent;
    const title = normalizeText(renderedTitle) || normalizeText(node.name) || normalizeText(node.content);
    if (!title) {
        return children;
    }
    return [{branch: branch % 8, children, depth, id, level, title}];
}

function fallbackDocumentBlocks(editor?: HTMLElement): MindMapTreeNode[] {
    if (!editor) {
        return [];
    }
    return [...editor.querySelectorAll<HTMLElement>(":scope > [data-node-id]")].flatMap((element, index) => {
        const id = element.dataset.nodeId ?? "";
        const title = truncateText(normalizeText(element.textContent), 140);
        if (!BLOCK_ID_PATTERN.test(id) || !title) {
            return [];
        }
        return [{branch: index % 8, children: [], depth: 1, id, level: 0, title}];
    });
}

function documentTitle(protyle: IProtyle) {
    const titleElement = protyle.title?.editElement ??
        protyle.title?.element.querySelector<HTMLElement>(".protyle-title__input") ??
        protyle.element.querySelector<HTMLElement>(".protyle-title__input") ??
        document.querySelector<HTMLElement>("#toolbarName.toolbar__title");
    const value = titleElement instanceof HTMLInputElement || titleElement instanceof HTMLTextAreaElement ?
        titleElement.value :
        titleElement?.textContent;
    return normalizeText(value);
}

function flattenVisible(root: MindMapTreeNode, collapsedNodeIds: ReadonlySet<string>): MindMapTreeNode[] {
    const nodes = [root];
    if (!collapsedNodeIds.has(root.id)) {
        root.children.forEach((child) => nodes.push(...flattenVisible(child, collapsedNodeIds)));
    }
    return nodes;
}

function collectNodeIds(root: MindMapTreeNode) {
    const ids = new Set([root.id]);
    root.children.forEach((child) => collectNodeIds(child).forEach((id) => ids.add(id)));
    return ids;
}

function normalizeText(value: unknown) {
    return typeof value === "string" ?
        value.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim() :
        "";
}

function truncateText(value: string, maximumLength: number) {
    return value.length > maximumLength ? `${value.slice(0, maximumLength - 1).trimEnd()}…` : value;
}

function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
