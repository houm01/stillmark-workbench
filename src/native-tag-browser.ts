import {
    IWebSocketData,
    Plugin,
    TProtyleAction,
    fetchSyncPost,
    getFrontend,
    openMobileFileById,
    openTab,
    showMessage,
} from "siyuan";

const PANEL_SELECTOR = ".sy__tag";
const PANEL_REFRESH_DELAY_MS = 180;
const OPEN_DOCUMENT_ACTIONS: TProtyleAction[] = ["cb-get-focus"];
const OPEN_DOCUMENT_COMMANDS = new Set([
    "closeBox",
    "mount",
    "moveDoc",
    "openBox",
    "removeBox",
    "removeDoc",
    "rename",
    "syncMergeResult",
    "transactions",
]);

interface NativeTagNode {
    children?: NativeTagNode[];
    count?: number;
    label?: string;
    name?: string;
}

interface TagDocumentRow {
    box?: string;
    hpath?: string;
    id?: string;
    title?: string;
    updated?: string;
}

interface TagDocument {
    id: string;
    parentPath: string;
    title: string;
}

interface TagPanelState {
    destroyed: boolean;
    documentErrors: Set<string>;
    documentRequests: Map<string, number>;
    documents: Map<string, TagDocument[]>;
    expandedTags: Set<string>;
    filter: HTMLInputElement;
    nativeHost: HTMLElement;
    nativeObserver: MutationObserver;
    panel: HTMLElement;
    panelClickHandler: (event: MouseEvent) => void;
    refreshGeneration: number;
    refreshTimer?: number;
    requestSequence: number;
    root: HTMLElement;
    tags: NativeTagNode[];
    tree: HTMLElement;
}

export class NativeTagBrowserFeature {
    private readonly panels = new Map<HTMLElement, TagPanelState>();
    private bodyObserver?: MutationObserver;

    private readonly webSocketHandler = ({detail}: CustomEvent<IWebSocketData>) => {
        if (!OPEN_DOCUMENT_COMMANDS.has(detail?.cmd)) {
            return;
        }
        this.panels.forEach((state) => this.scheduleRefresh(state, true));
    };

    constructor(private readonly plugin: Plugin) {}

    onload() {
        this.plugin.eventBus.on("ws-main", this.webSocketHandler);
    }

    onLayoutReady() {
        this.ensurePanels();
        this.bodyObserver = new MutationObserver((records) => {
            if (records.some((record) => this.layoutMutationAffectsPanels(record))) {
                this.ensurePanels();
            }
        });
        this.bodyObserver.observe(document.body, {childList: true, subtree: true});
    }

    onunload() {
        this.plugin.eventBus.off("ws-main", this.webSocketHandler);
        this.bodyObserver?.disconnect();
        this.bodyObserver = undefined;
        [...this.panels.values()].forEach((state) => this.unmountPanel(state));
    }

    private ensurePanels() {
        [...this.panels.values()].forEach((state) => {
            if (!document.contains(state.panel) || !state.panel.contains(state.nativeHost)) {
                this.unmountPanel(state);
            }
        });

        document.querySelectorAll<HTMLElement>(PANEL_SELECTOR).forEach((panel) => {
            if (this.panels.has(panel)) {
                return;
            }
            const nativeHost = [...panel.children].find((child) =>
                child instanceof HTMLElement && child.classList.contains("fn__flex-1")
            );
            if (nativeHost instanceof HTMLElement) {
                this.mountPanel(panel, nativeHost);
            }
        });
    }

    private layoutMutationAffectsPanels(record: MutationRecord) {
        if (record.target instanceof Element) {
            const targetPanel = record.target.closest<HTMLElement>(PANEL_SELECTOR);
            if (targetPanel && !this.panels.has(targetPanel)) {
                return true;
            }
        }

        return [...record.addedNodes, ...record.removedNodes].some((node) => {
            if (!(node instanceof Element)) {
                return false;
            }
            if (node.matches(PANEL_SELECTOR) || node.querySelector(PANEL_SELECTOR)) {
                return true;
            }
            return [...this.panels.values()].some((state) =>
                node === state.nativeHost || node.contains(state.nativeHost)
            );
        });
    }

    private mountPanel(panel: HTMLElement, nativeHost: HTMLElement) {
        const root = document.createElement("section");
        root.className = "stillmark-native-tags";
        root.hidden = true;

        const search = document.createElement("label");
        search.className = "stillmark-native-tags__search";
        search.append(createIcon("iconSearch"));

        const filter = document.createElement("input");
        filter.type = "search";
        filter.className = "b3-text-field stillmark-native-tags__search-input";
        filter.placeholder = this.plugin.i18n.nativeTagSearchPlaceholder;
        filter.setAttribute("aria-label", this.plugin.i18n.nativeTagSearchPlaceholder);
        search.append(filter);

        const tree = document.createElement("div");
        tree.className = "stillmark-native-tags__tree";
        tree.setAttribute("role", "tree");
        root.append(search, tree);
        panel.append(root);

        const state: TagPanelState = {
            destroyed: false,
            documentErrors: new Set(),
            documentRequests: new Map(),
            documents: new Map(),
            expandedTags: new Set(),
            filter,
            nativeHost,
            nativeObserver: new MutationObserver(() => this.scheduleRefresh(state, false)),
            panel,
            panelClickHandler: (event) => this.handlePanelHeaderClick(state, event),
            refreshGeneration: 0,
            requestSequence: 0,
            root,
            tags: [],
            tree,
        };

        filter.addEventListener("input", () => this.renderPanel(state));
        tree.addEventListener("click", (event) => this.handleTreeClick(state, event));
        tree.addEventListener("contextmenu", (event) => this.handleTreeContextMenu(state, event));
        panel.addEventListener("click", state.panelClickHandler);
        state.nativeObserver.observe(nativeHost, {childList: true, subtree: true});
        this.panels.set(panel, state);
        void this.refreshPanel(state, false);
    }

    private unmountPanel(state: TagPanelState) {
        state.destroyed = true;
        ++state.refreshGeneration;
        window.clearTimeout(state.refreshTimer);
        state.nativeObserver.disconnect();
        state.panel.removeEventListener("click", state.panelClickHandler);
        state.nativeHost.classList.remove("stillmark-native-tags__native-host");
        state.root.remove();
        this.panels.delete(state.panel);
    }

    private scheduleRefresh(state: TagPanelState, clearDocuments: boolean) {
        if (state.destroyed) {
            return;
        }
        if (clearDocuments) {
            state.documents.clear();
            state.documentErrors.clear();
            state.documentRequests.clear();
        }
        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = window.setTimeout(() => {
            state.refreshTimer = undefined;
            void this.refreshPanel(state, false);
        }, PANEL_REFRESH_DELAY_MS);
    }

    private async refreshPanel(state: TagPanelState, clearDocuments: boolean) {
        if (clearDocuments) {
            state.documents.clear();
            state.documentErrors.clear();
            state.documentRequests.clear();
        }
        const generation = ++state.refreshGeneration;

        try {
            const response = await fetchSyncPost("/api/tag/getTag", {
                sort: window.siyuan.config.tag.sort,
            });
            if (!this.isCurrent(state, generation)) {
                return;
            }
            if (response.code !== 0 || !Array.isArray(response.data)) {
                throw new Error(response.msg || this.plugin.i18n.nativeTagLoadFailed);
            }

            state.tags = response.data.filter(validTagNode);
            state.nativeHost.classList.add("stillmark-native-tags__native-host");
            state.root.hidden = false;
            this.renderPanel(state);
        } catch {
            if (!this.isCurrent(state, generation)) {
                return;
            }
            state.root.hidden = true;
            state.nativeHost.classList.remove("stillmark-native-tags__native-host");
        }
    }

    private renderPanel(state: TagPanelState) {
        if (state.destroyed) {
            return;
        }
        state.tree.replaceChildren();
        const query = state.filter.value.trim().toLocaleLowerCase();
        const visibleTags = state.tags.filter((node) => tagNodeMatches(node, query));
        if (visibleTags.length === 0) {
            state.tree.append(createStatus(this.plugin.i18n.nativeTagNoMatches));
            return;
        }
        visibleTags.forEach((node) => state.tree.append(this.renderTagNode(state, node, 0, query)));
    }

    private renderTagNode(state: TagPanelState, node: NativeTagNode, depth: number, query: string) {
        const label = tagLabel(node);
        const children = (node.children ?? []).filter((child) => tagNodeMatches(child, query));
        const expanded = state.expandedTags.has(label);
        const showChildren = expanded || query.length > 0;
        const group = document.createElement("section");
        group.className = "stillmark-native-tags__group";
        group.dataset.tag = label;

        const row = document.createElement("div");
        row.className = "stillmark-native-tags__tag-row";
        row.dataset.tag = label;
        row.style.setProperty("--stillmark-native-tag-depth", String(depth));
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-expanded", String(expanded));

        const tagButton = document.createElement("button");
        tagButton.type = "button";
        tagButton.className = "stillmark-native-tags__tag-button";
        tagButton.dataset.action = "toggle";
        tagButton.dataset.tag = label;
        tagButton.title = label;

        const arrow = createIcon("iconRight");
        arrow.classList.add("stillmark-native-tags__arrow");
        if (showChildren) {
            arrow.classList.add("stillmark-native-tags__arrow--expanded");
        }
        tagButton.append(arrow, createIcon("iconTags"));

        const name = document.createElement("span");
        name.className = "stillmark-native-tags__tag-name";
        name.textContent = tagName(node);
        tagButton.append(name);

        const count = document.createElement("span");
        count.className = "stillmark-native-tags__count";
        count.textContent = String(state.documents.get(label)?.length ?? Math.max(0, node.count ?? 0));
        tagButton.append(count);

        const searchButton = document.createElement("button");
        searchButton.type = "button";
        searchButton.className = "b3-tooltips b3-tooltips__w stillmark-native-tags__search-button";
        searchButton.dataset.action = "search";
        searchButton.dataset.tag = label;
        searchButton.setAttribute("aria-label", this.plugin.i18n.nativeTagOpenSearch.replace("${tag}", label));
        searchButton.append(createIcon("iconSearch"));
        row.append(tagButton, searchButton);
        group.append(row);

        if (expanded) {
            const documents = document.createElement("div");
            documents.className = "stillmark-native-tags__documents";
            documents.style.setProperty("--stillmark-native-tag-depth", String(depth));
            const loadedDocuments = state.documents.get(label);
            if (loadedDocuments) {
                if (loadedDocuments.length === 0) {
                    documents.append(createStatus(this.plugin.i18n.nativeTagDocumentsEmpty));
                } else {
                    loadedDocuments.forEach((documentRow) => documents.append(this.createDocumentRow(documentRow)));
                }
            } else if (state.documentErrors.has(label)) {
                documents.append(createStatus(this.plugin.i18n.nativeTagDocumentsLoadFailed, true));
            } else {
                documents.append(createStatus(this.plugin.i18n.nativeTagDocumentsLoading));
                void this.loadDocuments(state, label);
            }
            group.append(documents);
        }

        if (showChildren && children.length > 0) {
            const childTree = document.createElement("div");
            childTree.className = "stillmark-native-tags__children";
            childTree.setAttribute("role", "group");
            children.forEach((child) => childTree.append(this.renderTagNode(state, child, depth + 1, query)));
            group.append(childTree);
        }
        return group;
    }

    private createDocumentRow(documentRow: TagDocument) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "stillmark-native-tags__document";
        button.dataset.action = "open-document";
        button.dataset.documentId = documentRow.id;
        button.title = documentRow.parentPath ? `${documentRow.title}\n${documentRow.parentPath}` : documentRow.title;
        button.append(createIcon("iconFile"));

        const copy = document.createElement("span");
        copy.className = "stillmark-native-tags__document-copy";
        const title = document.createElement("span");
        title.className = "stillmark-native-tags__document-title";
        title.textContent = documentRow.title;
        copy.append(title);
        if (documentRow.parentPath) {
            const path = document.createElement("span");
            path.className = "stillmark-native-tags__document-path";
            path.textContent = documentRow.parentPath;
            copy.append(path);
        }
        button.append(copy);
        return button;
    }

    private async loadDocuments(state: TagPanelState, label: string) {
        if (state.documents.has(label) || state.documentRequests.has(label)) {
            return;
        }
        const request = ++state.requestSequence;
        state.documentRequests.set(label, request);

        try {
            const exactTag = escapeSqlLiteral(`#${label}#`);
            const descendantTag = escapeSqlLiteral(`#${label}/`);
            const response = await fetchSyncPost("/api/query/sql", {
                stmt: `SELECT b.root_id AS id, d.content AS title, d.hpath, d.box, d.updated
FROM blocks b JOIN blocks d ON d.id = b.root_id
WHERE instr(b.tag, '${exactTag}') > 0 OR instr(b.tag, '${descendantTag}') > 0
GROUP BY b.root_id
ORDER BY d.updated DESC`,
            });
            if (!this.isDocumentRequestCurrent(state, label, request)) {
                return;
            }
            if (response.code !== 0 || !Array.isArray(response.data)) {
                throw new Error(response.msg || this.plugin.i18n.nativeTagDocumentsLoadFailed);
            }

            state.documents.set(label, response.data.filter(validDocumentRow).map(normalizeDocument));
            state.documentErrors.delete(label);
        } catch {
            if (this.isDocumentRequestCurrent(state, label, request)) {
                state.documentErrors.add(label);
            }
        } finally {
            if (this.isDocumentRequestCurrent(state, label, request)) {
                state.documentRequests.delete(label);
                this.renderPanel(state);
            }
        }
    }

    private handleTreeClick(state: TagPanelState, event: MouseEvent) {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]") : null;
        if (!target || !state.tree.contains(target)) {
            return;
        }
        const action = target.dataset.action;
        if (action === "toggle" && target.dataset.tag) {
            event.preventDefault();
            event.stopPropagation();
            const label = target.dataset.tag;
            if (state.expandedTags.has(label)) {
                state.expandedTags.delete(label);
            } else {
                state.expandedTags.add(label);
            }
            this.renderPanel(state);
            return;
        }
        if (action === "search" && target.dataset.tag) {
            event.stopPropagation();
            this.dispatchNativeTagEvent(state, target.dataset.tag, "click", event);
            return;
        }
        if (action === "open-document" && target.dataset.documentId) {
            event.preventDefault();
            event.stopPropagation();
            void this.openDocument(target.dataset.documentId, event.metaKey || event.ctrlKey);
        }
    }

    private handleTreeContextMenu(state: TagPanelState, event: MouseEvent) {
        const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tag]") : null;
        if (!row?.dataset.tag || !state.tree.contains(row)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.dispatchNativeTagEvent(state, row.dataset.tag, "contextmenu", event);
    }

    private dispatchNativeTagEvent(
        state: TagPanelState,
        label: string,
        type: "click" | "contextmenu",
        source: MouseEvent,
    ) {
        const nativeRow = state.nativeHost.querySelector<HTMLElement>(`[data-label="${CSS.escape(label)}"]`);
        nativeRow?.dispatchEvent(
            new MouseEvent(type, {
                bubbles: true,
                button: type === "contextmenu" ? 2 : 0,
                clientX: source.clientX,
                clientY: source.clientY,
                composed: true,
            }),
        );
    }

    private handlePanelHeaderClick(state: TagPanelState, event: MouseEvent) {
        const button = event.target instanceof Element ? event.target.closest<HTMLElement>(".block__icon") : null;
        if (!button || !state.panel.contains(button) || state.root.contains(button)) {
            return;
        }
        const href = button.querySelector("use")?.getAttribute("href") ?? "";
        if (href.includes("iconExpand")) {
            flattenTagLabels(state.tags).forEach((label) => state.expandedTags.add(label));
            this.renderPanel(state);
        } else if (href.includes("iconContract")) {
            state.expandedTags.clear();
            this.renderPanel(state);
        } else if (href.includes("iconRefresh") || href.includes("iconSort")) {
            this.scheduleRefresh(state, true);
        }
    }

    private async openDocument(id: string, openNewTab: boolean) {
        try {
            if (["mobile", "browser-mobile"].includes(getFrontend())) {
                openMobileFileById(this.plugin.app, id, OPEN_DOCUMENT_ACTIONS);
                return;
            }
            const tab = await openTab({
                app: this.plugin.app,
                doc: {
                    action: OPEN_DOCUMENT_ACTIONS,
                    id,
                },
                keepCursor: openNewTab,
                openNewTab,
            });
            if (!openNewTab) {
                tab.parent.switchTab(tab.headElement);
                tab.parent.showHeading();
            }
        } catch {
            showMessage(this.plugin.i18n.nativeTagOpenDocumentFailed, 5000, "error");
        }
    }

    private isCurrent(state: TagPanelState, generation: number) {
        return !state.destroyed && this.panels.get(state.panel) === state && state.refreshGeneration === generation;
    }

    private isDocumentRequestCurrent(state: TagPanelState, label: string, request: number) {
        return !state.destroyed && this.panels.get(state.panel) === state &&
            state.documentRequests.get(label) === request;
    }
}

function validTagNode(value: unknown): value is NativeTagNode {
    if (!value || typeof value !== "object") {
        return false;
    }
    const node = value as NativeTagNode;
    return Boolean(tagLabel(node));
}

function tagLabel(node: NativeTagNode) {
    return String(node.label ?? node.name ?? "").trim();
}

function tagName(node: NativeTagNode) {
    const label = tagLabel(node);
    return String(node.name ?? label.split("/").at(-1) ?? label).trim();
}

function tagNodeMatches(node: NativeTagNode, query: string): boolean {
    if (!query) {
        return true;
    }
    if (`${tagLabel(node)} ${tagName(node)}`.toLocaleLowerCase().includes(query)) {
        return true;
    }
    return (node.children ?? []).some((child) => tagNodeMatches(child, query));
}

function flattenTagLabels(nodes: NativeTagNode[]): string[] {
    return nodes.flatMap((node) => [tagLabel(node), ...flattenTagLabels(node.children ?? [])]);
}

function validDocumentRow(value: unknown): value is TagDocumentRow & {id: string;} {
    if (!value || typeof value !== "object") {
        return false;
    }
    return typeof (value as TagDocumentRow).id === "string" && Boolean((value as TagDocumentRow).id);
}

function normalizeDocument(row: TagDocumentRow & {id: string;}): TagDocument {
    const pathSegments = String(row.hpath ?? "").split("/").filter(Boolean);
    const pathTitle = pathSegments.pop() ?? "";
    return {
        id: row.id,
        parentPath: pathSegments.join(" / "),
        title: String(row.title ?? "").trim() || pathTitle || row.id,
    };
}

function escapeSqlLiteral(value: string) {
    return value.replaceAll("'", "''");
}

function createIcon(name: string) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("b3-list-item__graphic");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${name}`);
    svg.append(use);
    return svg;
}

function createStatus(text: string, error = false) {
    const status = document.createElement("div");
    status.className = "stillmark-native-tags__status";
    if (error) {
        status.dataset.state = "error";
    }
    status.textContent = text;
    return status;
}
