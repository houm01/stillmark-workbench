import {
    IProtyle,
    Plugin,
    getAllEditor,
} from "siyuan";

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const DATABASE_CARD_SELECTOR = ".protyle-db-attr";
const DATABASE_CARD_CLASS = "stillmark-database-card";
const DATABASE_CARD_COLLAPSED_CLASS = "protyle-db-attr--collapsed";
const DATABASE_CARD_APPLIED_ATTRIBUTE = "data-stillmark-database-collapse-applied";
const RENDER_WATCH_MS = 1600;

interface EditorState {
    observer: MutationObserver;
    protyle: IProtyle;
    renderFrame?: number;
    renderWatchTimer?: number;
    rootId: string;
}

export class DatabasePageFeature {
    private readonly states = new Map<HTMLElement, EditorState>();

    private readonly editorChangedHandler = ({detail}: CustomEvent<{protyle: IProtyle;}>) => {
        this.syncEditor(detail.protyle);
    };

    private readonly destroyProtyleHandler = ({detail}: CustomEvent<{protyle: IProtyle;}>) => {
        const state = this.states.get(detail.protyle.element);
        if (state) {
            this.destroyState(state);
        }
    };

    constructor(private readonly plugin: Plugin) {}

    onload() {
        this.plugin.eventBus.on("destroy-protyle", this.destroyProtyleHandler);
        this.plugin.eventBus.on("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle-mode", this.editorChangedHandler);
    }

    onLayoutReady() {
        getAllEditor().forEach((editor) => this.syncEditor(editor.protyle));
    }

    onunload() {
        this.plugin.eventBus.off("destroy-protyle", this.destroyProtyleHandler);
        this.plugin.eventBus.off("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle-mode", this.editorChangedHandler);
        [...this.states.values()].forEach((state) => this.destroyState(state));
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
        this.watchRender(state);
        this.applyDatabaseCards(state);
    }

    private createState(protyle: IProtyle, rootId: string) {
        const state: EditorState = {
            observer: new MutationObserver(() => this.scheduleApply(state)),
            protyle,
            rootId,
        };
        this.states.set(protyle.element, state);
        return state;
    }

    private watchRender(state: EditorState) {
        state.observer.disconnect();
        window.clearTimeout(state.renderWatchTimer);
        state.observer.observe(state.protyle.element, {
            childList: true,
            subtree: true,
        });
        state.renderWatchTimer = window.setTimeout(() => {
            state.renderWatchTimer = undefined;
            state.observer.disconnect();
        }, RENDER_WATCH_MS);
    }

    private scheduleApply(state: EditorState) {
        if (state.renderFrame !== undefined) {
            return;
        }
        state.renderFrame = window.requestAnimationFrame(() => {
            state.renderFrame = undefined;
            this.applyDatabaseCards(state);
        });
    }

    private applyDatabaseCards(state: EditorState) {
        if (
            this.states.get(state.protyle.element) !== state ||
            state.protyle.block.rootID !== state.rootId
        ) {
            return;
        }

        state.protyle.element.querySelectorAll<HTMLElement>(DATABASE_CARD_SELECTOR).forEach((card) => {
            const header = card.querySelector<HTMLButtonElement>(
                ":scope > .protyle-db-attr__header[data-type='toggle']",
            );
            if (!header) {
                return;
            }

            card.classList.add(DATABASE_CARD_CLASS);
            if (card.hasAttribute(DATABASE_CARD_APPLIED_ATTRIBUTE)) {
                return;
            }

            card.setAttribute(DATABASE_CARD_APPLIED_ATTRIBUTE, "true");
            const isExpanded = header.getAttribute("aria-expanded") !== "false" &&
                !card.classList.contains(DATABASE_CARD_COLLAPSED_CLASS);
            if (isExpanded) {
                header.click();
            }
        });
    }

    private destroyState(state: EditorState) {
        state.observer.disconnect();
        window.clearTimeout(state.renderWatchTimer);
        if (state.renderFrame !== undefined) {
            window.cancelAnimationFrame(state.renderFrame);
        }
        state.protyle.element.querySelectorAll<HTMLElement>(DATABASE_CARD_SELECTOR).forEach((card) => {
            card.classList.remove(DATABASE_CARD_CLASS);
            card.removeAttribute(DATABASE_CARD_APPLIED_ATTRIBUTE);
        });
        this.states.delete(state.protyle.element);
    }
}

function isDocumentEditor(protyle: IProtyle, rootId: string) {
    return (
        BLOCK_ID_PATTERN.test(rootId) &&
        !protyle.options.backlinkData &&
        Boolean(protyle.title?.element && protyle.contentElement)
    );
}
