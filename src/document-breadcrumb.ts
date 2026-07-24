import {
    IProtyle,
    IWebSocketData,
    Plugin,
    fetchSyncPost,
    getAllEditor,
    getFrontend,
    openMobileFileById,
    openTab,
} from "siyuan";
import {WorkbenchPreferences} from "./workbench-preferences";

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const PATH_REFRESH_COMMANDS = new Set([
    "closeBox",
    "moveDoc",
    "openBox",
    "removeBox",
    "removeDoc",
    "rename",
]);
const PATH_REFRESH_DELAY_MS = 80;

interface DocumentPathData {
    notebook?: string;
    path?: string;
}

interface PathSegment {
    id?: string;
    label: string;
}

interface EditorState {
    breadcrumb: HTMLElement;
    protyle: IProtyle;
    refreshTimer?: number;
    requestGeneration: number;
    resizeObserver: ResizeObserver;
    rootId: string;
}

export class DocumentBreadcrumbFeature {
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
        if (!PATH_REFRESH_COMMANDS.has(detail?.cmd)) {
            return;
        }
        this.states.forEach((state) => {
            window.clearTimeout(state.refreshTimer);
            state.refreshTimer = window.setTimeout(() => {
                state.refreshTimer = undefined;
                this.syncEditor(state.protyle);
            }, PATH_REFRESH_DELAY_MS);
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
        return this.preferences.isDocumentBreadcrumbEnabled();
    }

    async setEnabled(enabled: boolean) {
        await this.preferences.setDocumentBreadcrumbEnabled(enabled);
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
        const rootId = protyle.block.rootID ?? "";
        const existing = this.states.get(protyle.element);
        if (!isDocumentEditor(protyle, rootId)) {
            if (existing) {
                this.destroyState(existing);
            }
            return;
        }

        if (existing && existing.rootId !== rootId) {
            this.destroyState(existing);
        }

        const state = this.states.get(protyle.element) ?? this.createState(protyle, rootId);
        state.protyle = protyle;
        this.mountBreadcrumb(state);
        this.syncBreadcrumbMargins(state);
        void this.refresh(state);
    }

    private createState(protyle: IProtyle, rootId: string) {
        const breadcrumb = document.createElement("nav");
        breadcrumb.className = "stillmark-document-breadcrumb";
        breadcrumb.setAttribute("aria-label", this.plugin.i18n.documentBreadcrumbAriaLabel);
        breadcrumb.setAttribute("contenteditable", "false");
        breadcrumb.hidden = true;

        const state: EditorState = {
            breadcrumb,
            protyle,
            requestGeneration: 0,
            resizeObserver: new ResizeObserver(() => this.syncBreadcrumbMargins(state)),
            rootId,
        };
        state.resizeObserver.observe(protyle.element);
        this.states.set(protyle.element, state);
        return state;
    }

    private mountBreadcrumb(state: EditorState) {
        const title = state.protyle.title?.element;
        if (title?.parentElement && state.breadcrumb.nextElementSibling !== title) {
            title.parentElement.insertBefore(state.breadcrumb, title);
        }
    }

    private syncBreadcrumbMargins(state: EditorState) {
        const title = state.protyle.title?.element;
        if (!title || !document.contains(title)) {
            return;
        }
        const style = getComputedStyle(title);
        state.breadcrumb.style.marginLeft = style.marginLeft;
        state.breadcrumb.style.marginRight = style.marginRight;
    }

    private async refresh(state: EditorState) {
        const generation = ++state.requestGeneration;
        try {
            const segments = await this.loadPath(state.rootId);
            if (!this.isCurrent(state, generation)) {
                return;
            }
            this.render(state, segments);
        } catch (error) {
            if (!this.isCurrent(state, generation)) {
                return;
            }
            state.breadcrumb.hidden = true;
            state.breadcrumb.replaceChildren();
            console.error("Stillmark document breadcrumb failed:", error);
        }
    }

    private async loadPath(rootId: string) {
        const [humanPathResponse, documentPathResponse] = await Promise.all([
            fetchSyncPost("/api/filetree/getHPathByID", {id: rootId}),
            fetchSyncPost("/api/filetree/getPathByID", {id: rootId}),
        ]);
        if (humanPathResponse.code !== 0) {
            throw new Error(humanPathResponse.msg || this.plugin.i18n.documentBreadcrumbLoadFailed);
        }
        if (documentPathResponse.code !== 0) {
            throw new Error(documentPathResponse.msg || this.plugin.i18n.documentBreadcrumbLoadFailed);
        }

        const humanPath = typeof humanPathResponse.data === "string" ? humanPathResponse.data : "";
        const documentPath = documentPathResponse.data as DocumentPathData | null;
        const documentIds = pathDocumentIds(documentPath?.path);
        const pathNames = humanPath.split("/").filter(Boolean);
        const documentSegments = alignDocumentSegments(documentIds, pathNames, rootId);
        const notebookName = window.siyuan.notebooks?.find((notebook) => (
            notebook.id === documentPath?.notebook
        ))?.name;

        return [
            ...(notebookName ? [{label: notebookName}] : []),
            ...documentSegments,
        ];
    }

    private render(state: EditorState, segments: PathSegment[]) {
        state.breadcrumb.replaceChildren();
        if (segments.length === 0) {
            state.breadcrumb.hidden = true;
            return;
        }

        const fullPath = segments.map((segment) => segment.label).join(" / ");
        state.breadcrumb.title = fullPath;
        segments.forEach((segment, index) => {
            const isCurrent = segment.id === state.rootId;
            const item = isCurrent || !segment.id ?
                document.createElement("span") :
                this.createDocumentButton(segment, fullPath);
            item.className = "stillmark-document-breadcrumb__item";
            item.textContent = segment.label;
            if (isCurrent) {
                item.classList.add("stillmark-document-breadcrumb__item--current");
                item.setAttribute("aria-current", "page");
            } else if (!segment.id) {
                item.classList.add("stillmark-document-breadcrumb__item--notebook");
            }
            state.breadcrumb.append(item);

            if (index < segments.length - 1) {
                const separator = document.createElement("span");
                separator.className = "stillmark-document-breadcrumb__separator";
                separator.setAttribute("aria-hidden", "true");
                separator.textContent = "/";
                state.breadcrumb.append(separator);
            }
        });
        state.breadcrumb.hidden = false;
        window.requestAnimationFrame(() => {
            state.breadcrumb.scrollLeft = state.breadcrumb.scrollWidth;
        });
    }

    private createDocumentButton(segment: PathSegment, fullPath: string) {
        const button = document.createElement("button");
        button.type = "button";
        button.title = fullPath;
        button.setAttribute(
            "aria-label",
            this.plugin.i18n.documentBreadcrumbOpen.replace("${name}", segment.label),
        );
        button.addEventListener("click", (event) => {
            if (segment.id) {
                void this.openDocument(segment.id, event.metaKey || event.ctrlKey);
            }
        });
        return button;
    }

    private async openDocument(id: string, openNewTab: boolean) {
        if (isMobile()) {
            openMobileFileById(this.plugin.app, id);
            return;
        }
        await openTab({
            app: this.plugin.app,
            doc: {id},
            openNewTab,
        });
    }

    private isCurrent(state: EditorState, generation: number) {
        return (
            this.states.get(state.protyle.element) === state &&
            state.requestGeneration === generation &&
            state.protyle.block.rootID === state.rootId
        );
    }

    private destroyState(state: EditorState) {
        window.clearTimeout(state.refreshTimer);
        ++state.requestGeneration;
        state.resizeObserver.disconnect();
        state.breadcrumb.remove();
        this.states.delete(state.protyle.element);
    }
}

function pathDocumentIds(path?: string) {
    if (!path) {
        return [];
    }
    return path
        .split("/")
        .map((part) => part.replace(/\.sy$/, ""))
        .filter((part) => BLOCK_ID_PATTERN.test(part));
}

function alignDocumentSegments(ids: string[], names: string[], rootId: string): PathSegment[] {
    const alignedIds = ids.at(-1) === rootId ? ids : [...ids, rootId];
    const visibleNames = names.slice(-alignedIds.length);
    const offset = alignedIds.length - visibleNames.length;
    return visibleNames.map((label, index) => ({
        id: alignedIds[index + offset],
        label,
    }));
}

function isDocumentEditor(protyle: IProtyle, rootId: string) {
    return (
        BLOCK_ID_PATTERN.test(rootId) &&
        !protyle.options.backlinkData &&
        Boolean(protyle.title?.element && protyle.contentElement)
    );
}

function isMobile() {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile";
}
