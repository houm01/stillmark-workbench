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
const DATABASE_CARD_UNAPPLIED_SELECTOR = `${DATABASE_CARD_SELECTOR}:not([${DATABASE_CARD_APPLIED_ATTRIBUTE}])`;
const DATABASE_TOGGLE_SELECTOR = [
    ":scope > .protyle-db-attr__header[data-type='toggle']",
    ":scope > .protyle-db-attr__header > .protyle-db-attr__toggle[data-type='toggle']",
].join(", ");

interface EditorState {
    observer: MutationObserver;
    protyle: IProtyle;
    renderFrame?: number;
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
        this.observeEditor(state);
        this.applyDatabaseCards(state);
    }

    private createState(protyle: IProtyle, rootId: string) {
        const state: EditorState = {
            observer: new MutationObserver((mutations) => {
                if (mutations.some(hasUnappliedDatabaseCard)) {
                    this.scheduleApply(state);
                }
            }),
            protyle,
            rootId,
        };
        this.states.set(protyle.element, state);
        return state;
    }

    private observeEditor(state: EditorState) {
        state.observer.disconnect();
        state.observer.observe(state.protyle.element, {
            childList: true,
            subtree: true,
        });
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
            const toggle = card.querySelector<HTMLElement>(DATABASE_TOGGLE_SELECTOR);
            if (!toggle) {
                return;
            }

            card.classList.add(DATABASE_CARD_CLASS);
            if (card.hasAttribute(DATABASE_CARD_APPLIED_ATTRIBUTE)) {
                return;
            }

            card.setAttribute(DATABASE_CARD_APPLIED_ATTRIBUTE, "true");
            const isExpanded = toggle.getAttribute("aria-expanded") !== "false" &&
                !card.classList.contains(DATABASE_CARD_COLLAPSED_CLASS);
            if (isExpanded) {
                toggle.click();
            }
        });
    }

    private destroyState(state: EditorState) {
        state.observer.disconnect();
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

function hasUnappliedDatabaseCard(mutation: MutationRecord) {
    if (
        mutation.target instanceof Element &&
        mutation.target.closest(DATABASE_CARD_UNAPPLIED_SELECTOR)
    ) {
        return true;
    }
    return [...mutation.addedNodes].some((node) => (
        node instanceof Element && (
            node.matches(DATABASE_CARD_UNAPPLIED_SELECTOR) ||
            node.querySelector(DATABASE_CARD_UNAPPLIED_SELECTOR)
        )
    ));
}
