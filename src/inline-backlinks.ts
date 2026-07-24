import {
    IProtyle,
    IWebSocketData,
    Plugin,
    Protyle,
    TProtyleAction,
    fetchSyncPost,
    getAllEditor,
    getFrontend,
    openMobileFileById,
    openTab,
} from "siyuan";
import {WorkbenchPreferences} from "./workbench-preferences";

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const REFRESH_DELAY_MS = 450;
const OPEN_BLOCK_ACTIONS: TProtyleAction[] = [
    "cb-get-focus",
    "cb-get-context",
    "cb-get-scroll",
];
const GLOBAL_REFRESH_COMMANDS = new Set([
    "closeBox",
    "mount",
    "removeBox",
    "removeDoc",
    "rename",
    "reloaddoc",
    "setDefRefCount",
    "setRefDynamicText",
    "syncMergeResult",
]);

interface BacklinkSource {
    box?: string;
    count?: number;
    hPath?: string;
    id: string;
    name?: string;
    updated?: string;
}

interface BacklinkSummaryData {
    backlinks?: BacklinkSource[];
}

interface BacklinkPath {
    children?: unknown;
    id?: string;
    name?: string;
    subType?: string;
    type?: string;
}

interface BacklinkContext {
    blockPaths?: BacklinkPath[];
    dom?: string;
    expand?: boolean;
}

interface BacklinkContextData {
    backlinks?: BacklinkContext[];
}

interface SourceState {
    container: HTMLElement;
    context: HTMLElement;
    contextGeneration: number;
    embedded?: Protyle;
    source: BacklinkSource;
    toggle: HTMLButtonElement;
}

interface EditorState {
    body: HTMLElement;
    expandedSourceIds: Set<string>;
    hasRendered: boolean;
    headingToggle: HTMLButtonElement;
    protyle: IProtyle;
    refreshTimer?: number;
    requestGeneration: number;
    resizeObserver: ResizeObserver;
    rootId: string;
    section: HTMLElement;
    sectionCollapsed: boolean;
    sourceStates: Map<string, SourceState>;
}

export class InlineBacklinksFeature {
    private readonly states = new Map<HTMLElement, EditorState>();

    private readonly editorChangedHandler = ({detail}: CustomEvent<{protyle: IProtyle;}>) => {
        void this.syncEditorWhenEnabled(detail.protyle);
    };

    private readonly destroyProtyleHandler = ({detail}: CustomEvent<{protyle: IProtyle;}>) => {
        const state = this.states.get(detail.protyle.element);
        if (state) {
            this.destroyState(state);
        }
    };

    private readonly webSocketHandler = ({detail}: CustomEvent<IWebSocketData>) => {
        if (!detail?.cmd) {
            return;
        }
        if (GLOBAL_REFRESH_COMMANDS.has(detail.cmd)) {
            this.states.forEach((state) => this.scheduleRefresh(state));
            return;
        }
        if (detail.cmd !== "transactions") {
            return;
        }

        const affectedRootIds = transactionRootIds(detail);
        if (affectedRootIds.size === 0) {
            return;
        }
        this.states.forEach((state) => {
            if (
                affectedRootIds.has(state.rootId) ||
                [...state.sourceStates.keys()].some((sourceId) => affectedRootIds.has(sourceId))
            ) {
                this.scheduleRefresh(state);
            }
        });
    };

    constructor(
        private readonly plugin: Plugin,
        private readonly preferences: WorkbenchPreferences,
    ) {}

    onload() {
        this.plugin.eventBus.on("destroy-protyle", this.destroyProtyleHandler);
        this.plugin.eventBus.on("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle-mode", this.editorChangedHandler);
        this.plugin.eventBus.on("ws-main", this.webSocketHandler);
    }

    onLayoutReady() {
        void this.syncAllEditorsWhenEnabled();
    }

    onunload() {
        this.plugin.eventBus.off("destroy-protyle", this.destroyProtyleHandler);
        this.plugin.eventBus.off("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle-mode", this.editorChangedHandler);
        this.plugin.eventBus.off("ws-main", this.webSocketHandler);
        [...this.states.values()].forEach((state) => this.destroyState(state));
    }

    async isEnabled() {
        return this.preferences.isInlineBacklinksEnabled();
    }

    async setEnabled(enabled: boolean) {
        await this.preferences.setInlineBacklinksEnabled(enabled);
        if (enabled) {
            getAllEditor().forEach((editor) => this.syncEditor(editor.protyle));
            return;
        }
        [...this.states.values()].forEach((state) => this.destroyState(state));
    }

    private async syncAllEditorsWhenEnabled() {
        if (await this.isEnabled()) {
            getAllEditor().forEach((editor) => this.syncEditor(editor.protyle));
        }
    }

    private async syncEditorWhenEnabled(protyle: IProtyle) {
        if (await this.isEnabled()) {
            this.syncEditor(protyle);
        }
    }

    private syncEditor(protyle: IProtyle) {
        const existing = this.states.get(protyle.element);
        const rootId = protyle.block.rootID ?? "";
        if (!isDocumentEditor(protyle, rootId)) {
            existing?.section.remove();
            return;
        }

        if (existing && existing.rootId !== rootId) {
            this.destroyState(existing);
        }

        const state = this.states.get(protyle.element) ?? this.createState(protyle, rootId);
        state.protyle = protyle;
        this.syncSectionSpacing(state);
        if (state.hasRendered) {
            this.mountSection(state);
        }
        void this.refresh(state);
    }

    private createState(protyle: IProtyle, rootId: string) {
        const section = document.createElement("section");
        section.className = "stillmark-inline-backlinks";
        section.setAttribute("contenteditable", "false");
        section.setAttribute("aria-label", this.plugin.i18n.inlineBacklinksTitle);
        section.hidden = true;

        const headingToggle = document.createElement("button");
        headingToggle.type = "button";
        headingToggle.className = "stillmark-inline-backlinks__heading";
        headingToggle.append(
            createArrow(),
            createText(this.plugin.i18n.inlineBacklinksTitle),
        );

        const body = document.createElement("div");
        body.className = "stillmark-inline-backlinks__body";
        section.append(headingToggle, body);

        const state: EditorState = {
            body,
            expandedSourceIds: new Set(),
            hasRendered: false,
            headingToggle,
            protyle,
            requestGeneration: 0,
            resizeObserver: new ResizeObserver(() => this.syncSectionSpacing(state)),
            rootId,
            section,
            sectionCollapsed: false,
            sourceStates: new Map(),
        };
        headingToggle.addEventListener("click", () => this.toggleSection(state));
        this.syncSectionToggle(state);
        state.resizeObserver.observe(protyle.element);
        this.states.set(protyle.element, state);
        return state;
    }

    private async refresh(state: EditorState) {
        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = undefined;
        const generation = ++state.requestGeneration;

        try {
            const response = await fetchSyncPost("/api/ref/getBacklink2", backlinkSummaryRequest(state));
            if (!this.isCurrent(state, generation)) {
                return;
            }
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.inlineBacklinksLoadFailed);
            }

            const data = response.data as BacklinkSummaryData | null;
            const sources = Array.isArray(data?.backlinks) ?
                data.backlinks.filter(validBacklinkSource) :
                [];
            this.renderSources(state, sources);
        } catch {
            if (this.isCurrent(state, generation)) {
                this.renderSummaryError(state);
            }
        }
    }

    private renderSources(state: EditorState, sources: BacklinkSource[]) {
        const wasRendered = state.hasRendered;
        this.clearSources(state);
        state.hasRendered = sources.length > 0;

        if (sources.length === 0) {
            state.section.hidden = true;
            state.section.remove();
            state.expandedSourceIds.clear();
            return;
        }

        const sourceIds = new Set(sources.map((source) => source.id));
        state.expandedSourceIds.forEach((id) => {
            if (!sourceIds.has(id)) {
                state.expandedSourceIds.delete(id);
            }
        });
        if (!wasRendered) {
            state.expandedSourceIds.clear();
            const expandCount = Math.max(0, window.siyuan.config.editor.backlinkExpandCount ?? 0);
            sources.slice(0, expandCount).forEach((source) => state.expandedSourceIds.add(source.id));
        }

        sources.forEach((source) => {
            const sourceState = this.createSource(state, source);
            state.sourceStates.set(source.id, sourceState);
            state.body.append(sourceState.container);
        });

        this.mountSection(state);
        state.section.hidden = false;
        this.syncSectionToggle(state);
        if (!state.sectionCollapsed) {
            state.expandedSourceIds.forEach((id) => {
                const sourceState = state.sourceStates.get(id);
                if (sourceState) {
                    this.setSourceExpanded(state, sourceState, true);
                }
            });
        }
    }

    private createSource(state: EditorState, source: BacklinkSource) {
        const sourceName = backlinkSourceName(source, this.plugin.i18n.inlineBacklinksUntitled);
        const container = document.createElement("article");
        container.className = "stillmark-inline-backlinks__source";
        container.dataset.sourceId = source.id;

        const row = document.createElement("div");
        row.className = "stillmark-inline-backlinks__source-row";

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "stillmark-inline-backlinks__source-toggle";
        toggle.append(createArrow());

        const title = document.createElement("button");
        title.type = "button";
        title.className = "stillmark-inline-backlinks__source-title";
        title.title = source.hPath || sourceName;
        title.setAttribute(
            "aria-label",
            this.plugin.i18n.inlineBacklinksOpenSource.replace("${name}", sourceName),
        );
        title.append(createIcon("iconFile"), createText(sourceName));

        const context = document.createElement("div");
        context.className = "stillmark-inline-backlinks__context";
        context.hidden = true;

        const sourceState: SourceState = {
            container,
            context,
            contextGeneration: 0,
            source,
            toggle,
        };
        toggle.addEventListener("click", () => {
            this.setSourceExpanded(state, sourceState, !state.expandedSourceIds.has(source.id));
        });
        title.addEventListener("click", () => {
            void this.openBlock(source.id);
        });
        context.addEventListener("click", (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const block = target?.closest<HTMLElement>("[data-node-id]");
            if (!block || !context.contains(block) || !block.dataset.nodeId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            void this.openBlock(block.dataset.nodeId);
        });
        row.append(toggle, title);
        container.append(row, context);
        this.syncSourceToggle(sourceState, false);
        return sourceState;
    }

    private setSourceExpanded(state: EditorState, sourceState: SourceState, expanded: boolean) {
        if (expanded) {
            state.expandedSourceIds.add(sourceState.source.id);
            sourceState.context.hidden = false;
            this.syncSourceToggle(sourceState, true);
            if (!sourceState.embedded && sourceState.context.childElementCount === 0) {
                void this.loadSourceContext(state, sourceState);
            }
            return;
        }

        state.expandedSourceIds.delete(sourceState.source.id);
        sourceState.context.hidden = true;
        this.syncSourceToggle(sourceState, false);
        this.destroyEmbedded(sourceState);
        sourceState.context.replaceChildren();
    }

    private async loadSourceContext(state: EditorState, sourceState: SourceState) {
        const generation = ++sourceState.contextGeneration;
        sourceState.context.replaceChildren(this.createLoading());

        try {
            const response = await fetchSyncPost("/api/ref/getBacklinkDoc", {
                defID: state.rootId,
                highlight: true,
                keyword: "",
                refTreeID: sourceState.source.id,
            });
            if (!this.isSourceCurrent(state, sourceState, generation)) {
                return;
            }
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.inlineBacklinksLoadFailed);
            }

            const data = response.data as BacklinkContextData | null;
            const backlinkData = normalizeBacklinkContexts(data?.backlinks);
            if (backlinkData.length === 0) {
                sourceState.context.replaceChildren(this.createEmptyContext());
                return;
            }

            const host = document.createElement("div");
            host.className = "stillmark-inline-backlinks__protyle";
            host.dataset.defId = state.rootId;
            sourceState.context.replaceChildren(host);

            const embedded = new Protyle(this.plugin.app, host, {
                backlinkData,
                blockId: sourceState.source.id,
                click: {
                    preventInsetEmptyBlock: true,
                },
                render: {
                    background: false,
                    breadcrumb: false,
                    gutter: false,
                    scroll: false,
                    title: false,
                },
            });
            embedded.protyle.notebookId = sourceState.source.box || state.protyle.notebookId;
            embedded.disable();
            sourceState.embedded = embedded;
            window.setTimeout(() => {
                if (sourceState.embedded === embedded) {
                    embedded.disable();
                }
            }, 0);
        } catch {
            if (this.isSourceCurrent(state, sourceState, generation)) {
                sourceState.context.replaceChildren(this.createContextError(state, sourceState));
            }
        }
    }

    private renderSummaryError(state: EditorState) {
        this.clearSources(state);
        state.hasRendered = false;
        const error = document.createElement("div");
        error.className = "stillmark-inline-backlinks__message";
        error.dataset.state = "error";
        error.append(
            createText(this.plugin.i18n.inlineBacklinksLoadFailed),
            this.createRetryButton(() => void this.refresh(state)),
        );
        state.body.replaceChildren(error);
        this.mountSection(state);
        state.section.hidden = false;
        this.syncSectionToggle(state);
    }

    private createContextError(state: EditorState, sourceState: SourceState) {
        const error = document.createElement("div");
        error.className = "stillmark-inline-backlinks__message";
        error.dataset.state = "error";
        error.append(
            createText(this.plugin.i18n.inlineBacklinksLoadFailed),
            this.createRetryButton(() => void this.loadSourceContext(state, sourceState)),
        );
        return error;
    }

    private createRetryButton(callback: () => void) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "b3-button b3-button--cancel stillmark-inline-backlinks__retry";
        button.textContent = this.plugin.i18n.inlineBacklinksRetry;
        button.addEventListener("click", callback);
        return button;
    }

    private createLoading() {
        const loading = document.createElement("div");
        loading.className = "stillmark-inline-backlinks__message";
        loading.dataset.state = "loading";
        loading.textContent = this.plugin.i18n.inlineBacklinksLoading;
        return loading;
    }

    private createEmptyContext() {
        const empty = document.createElement("div");
        empty.className = "stillmark-inline-backlinks__message";
        empty.textContent = this.plugin.i18n.inlineBacklinksContextEmpty;
        return empty;
    }

    private toggleSection(state: EditorState) {
        state.sectionCollapsed = !state.sectionCollapsed;
        this.syncSectionToggle(state);
        if (state.sectionCollapsed) {
            state.sourceStates.forEach((sourceState) => {
                this.destroyEmbedded(sourceState);
                sourceState.context.replaceChildren();
            });
            return;
        }
        state.expandedSourceIds.forEach((id) => {
            const sourceState = state.sourceStates.get(id);
            if (sourceState) {
                this.setSourceExpanded(state, sourceState, true);
            }
        });
    }

    private syncSectionToggle(state: EditorState) {
        const expanded = !state.sectionCollapsed;
        state.headingToggle.classList.toggle("is-expanded", expanded);
        state.headingToggle.setAttribute("aria-expanded", String(expanded));
        state.headingToggle.setAttribute(
            "aria-label",
            expanded ?
                this.plugin.i18n.inlineBacklinksCollapseSection :
                this.plugin.i18n.inlineBacklinksExpandSection,
        );
        state.body.hidden = !expanded;
    }

    private syncSourceToggle(sourceState: SourceState, expanded: boolean) {
        const sourceName = backlinkSourceName(sourceState.source, this.plugin.i18n.inlineBacklinksUntitled);
        sourceState.toggle.classList.toggle("is-expanded", expanded);
        sourceState.toggle.setAttribute("aria-expanded", String(expanded));
        sourceState.toggle.setAttribute(
            "aria-label",
            (expanded ?
                this.plugin.i18n.inlineBacklinksCollapseSource :
                this.plugin.i18n.inlineBacklinksExpandSource).replace("${name}", sourceName),
        );
    }

    private scheduleRefresh(state: EditorState) {
        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = window.setTimeout(() => {
            state.refreshTimer = undefined;
            if (this.states.get(state.protyle.element) === state) {
                void this.refresh(state);
            }
        }, REFRESH_DELAY_MS);
    }

    private mountSection(state: EditorState) {
        const wysiwyg = state.protyle.wysiwyg?.element;
        if (!wysiwyg || !document.contains(wysiwyg)) {
            return;
        }
        if (state.section.previousElementSibling !== wysiwyg) {
            wysiwyg.after(state.section);
        }
        this.syncSectionSpacing(state);
    }

    private syncSectionSpacing(state: EditorState) {
        const wysiwyg = state.protyle.wysiwyg?.element;
        if (!wysiwyg) {
            return;
        }
        const style = getComputedStyle(wysiwyg);
        state.section.style.paddingLeft = style.paddingLeft;
        state.section.style.paddingRight = style.paddingRight;
    }

    private clearSources(state: EditorState) {
        state.sourceStates.forEach((sourceState) => this.destroySource(sourceState));
        state.sourceStates.clear();
        state.body.replaceChildren();
    }

    private destroySource(sourceState: SourceState) {
        ++sourceState.contextGeneration;
        this.destroyEmbedded(sourceState);
        sourceState.container.remove();
    }

    private destroyEmbedded(sourceState: SourceState) {
        sourceState.embedded?.destroy();
        sourceState.embedded = undefined;
    }

    private destroyState(state: EditorState) {
        ++state.requestGeneration;
        window.clearTimeout(state.refreshTimer);
        state.resizeObserver.disconnect();
        this.clearSources(state);
        state.section.remove();
        this.states.delete(state.protyle.element);
    }

    private isCurrent(state: EditorState, generation: number) {
        return (
            this.states.get(state.protyle.element) === state &&
            state.requestGeneration === generation &&
            state.protyle.block.rootID === state.rootId
        );
    }

    private isSourceCurrent(state: EditorState, sourceState: SourceState, generation: number) {
        return (
            this.states.get(state.protyle.element) === state &&
            state.sourceStates.get(sourceState.source.id) === sourceState &&
            sourceState.contextGeneration === generation &&
            state.expandedSourceIds.has(sourceState.source.id)
        );
    }

    private async openBlock(id: string) {
        if (isMobile()) {
            openMobileFileById(this.plugin.app, id, OPEN_BLOCK_ACTIONS);
            return;
        }
        await openTab({
            app: this.plugin.app,
            doc: {
                action: OPEN_BLOCK_ACTIONS,
                id,
            },
            openNewTab: false,
        });
    }
}

function backlinkSummaryRequest(state: EditorState) {
    const editorConfig = window.siyuan.config.editor;
    return {
        id: state.rootId,
        k: "",
        mSort: String(editorConfig.backmentionSort ?? 3),
        mk: "",
        notebook: state.protyle.notebookId,
        sort: String(editorConfig.backlinkSort ?? 3),
    };
}

function validBacklinkSource(source: BacklinkSource) {
    return Boolean(source && BLOCK_ID_PATTERN.test(source.id));
}

function backlinkSourceName(source: BacklinkSource, fallback: string) {
    if (source.name?.trim()) {
        return source.name.trim();
    }
    const pathName = source.hPath?.split("/").filter(Boolean).at(-1);
    return pathName || fallback;
}

function normalizeBacklinkContexts(contexts?: BacklinkContext[]) {
    if (!Array.isArray(contexts)) {
        return [];
    }
    return contexts.filter((context) => typeof context?.dom === "string").map((context) => ({
        blockPaths: Array.isArray(context.blockPaths) ?
            context.blockPaths.map((path) => ({
                children: [] as [],
                id: path.id ?? "",
                name: path.name ?? "",
                subType: path.subType ?? "",
                type: path.type ?? "",
            })) :
            [],
        dom: context.dom ?? "",
        expand: context.expand !== false,
    }));
}

function isDocumentEditor(protyle: IProtyle, rootId: string) {
    if (
        !BLOCK_ID_PATTERN.test(rootId) ||
        !protyle.wysiwyg?.element ||
        !protyle.contentElement ||
        protyle.options.backlinkData ||
        protyle.options.history
    ) {
        return false;
    }
    return !protyle.preview?.element || protyle.preview.element.classList.contains("fn__none");
}

function transactionRootIds(message: IWebSocketData) {
    const rootIds = new Set<string>();
    const contextRootIds = message.context?.rootIDs;
    if (Array.isArray(contextRootIds)) {
        contextRootIds.forEach((id) => {
            if (typeof id === "string") {
                rootIds.add(id);
            }
        });
    }
    const transactions = Array.isArray(message.data) ? message.data : [];
    transactions.forEach((transaction) => {
        const operations = Array.isArray(transaction?.doOperations) ? transaction.doOperations : [];
        operations.forEach((operation: {retData?: {rootID?: string;};}) => {
            if (typeof operation.retData?.rootID === "string") {
                rootIds.add(operation.retData.rootID);
            }
        });
    });
    return rootIds;
}

function createArrow() {
    const arrow = createIcon("iconRight");
    arrow.classList.add("stillmark-inline-backlinks__arrow");
    return arrow;
}

function createIcon(icon: string) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${icon}`);
    svg.append(use);
    return svg;
}

function createText(text: string) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
}

function isMobile() {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile";
}
