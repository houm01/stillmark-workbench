import {
    IProtyle,
    Menu,
    Plugin,
    expandDocTree,
    getActiveEditor,
    getAllEditor,
    getFrontend,
    showMessage,
} from "siyuan";

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const CONTEXT_MENU_VERTICAL_GAP = 20;

export interface DocumentTreeFocusPreferences {
    shouldAutoLocateInTreeOnOpen(): Promise<boolean>;
    setAutoLocateInTreeOnOpen(enabled: boolean): Promise<void>;
    openDocumentTreeFocusSettings(): void;
}

export class DocumentTreeFocusFeature {
    private locateRequestGeneration = 0;
    private topBarElement?: HTMLElement;

    private readonly editorChangedHandler = ({detail}: CustomEvent<{protyle: IProtyle;}>) => {
        const generation = ++this.locateRequestGeneration;
        void this.locateDocumentIfEnabled(detail.protyle, generation);
    };

    private readonly contextMenuHandler = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        void this.showSettingsMenu(event.clientX, event.clientY);
    };

    constructor(
        private readonly plugin: Plugin,
        private readonly preferences: DocumentTreeFocusPreferences,
    ) {}

    onload() {
        this.plugin.eventBus.on("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle", this.editorChangedHandler);
    }

    onLayoutReady() {
        this.topBarElement = this.plugin.addTopBar({
            icon: "iconFocus",
            title: this.plugin.i18n.documentTreeFocusButtonTitle,
            position: "left",
            callback: () => this.locateCurrentDocument(),
        });
        this.topBarElement.classList.add("stillmark-topbar-icon", "stillmark-topbar-icon--focus");

        if (!isMobile()) {
            this.topBarElement.addEventListener("contextmenu", this.contextMenuHandler);
        }
    }

    onunload() {
        ++this.locateRequestGeneration;
        this.plugin.eventBus.off("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle", this.editorChangedHandler);
        this.topBarElement?.removeEventListener("contextmenu", this.contextMenuHandler);
    }

    private async locateDocumentIfEnabled(protyle: IProtyle, generation: number) {
        if (!await this.preferences.shouldAutoLocateInTreeOnOpen()) {
            return;
        }
        if (generation !== this.locateRequestGeneration || currentProtyle()?.element !== protyle.element) {
            return;
        }
        this.locateProtyle(protyle);
    }

    private async showSettingsMenu(x: number, y: number) {
        const enabled = await this.preferences.shouldAutoLocateInTreeOnOpen();
        const menu = new Menu(`${this.plugin.name}-document-tree-focus`);

        menu.addItem({
            checked: enabled,
            label: this.plugin.i18n.documentTreeAutoFocus,
            click: () => {
                void this.updateAutoLocatePreference(!enabled);
            },
        });
        menu.addSeparator();
        menu.addItem({
            icon: "iconSettings",
            label: this.plugin.i18n.documentTreeFocusSettings,
            click: () => this.preferences.openDocumentTreeFocusSettings(),
        });
        const rect = this.topBarElement?.getBoundingClientRect();
        menu.open({
            x: rect?.left ?? x,
            y: (rect?.bottom ?? y) + CONTEXT_MENU_VERTICAL_GAP,
        });
    }

    private async updateAutoLocatePreference(enabled: boolean) {
        try {
            await this.preferences.setAutoLocateInTreeOnOpen(enabled);
            showMessage(
                enabled ?
                    this.plugin.i18n.documentTreeAutoFocusEnabled :
                    this.plugin.i18n.documentTreeAutoFocusDisabled,
                3000,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showMessage(`${this.plugin.i18n.documentTreeAutoFocusSaveFailed}: ${message}`, 5000, "error");
        }
    }

    private locateCurrentDocument() {
        const protyle = currentProtyle();
        if (!protyle || !this.locateProtyle(protyle)) {
            showMessage(this.plugin.i18n.documentTreeFocusUnavailable, 4000, "error");
        }
    }

    private locateProtyle(protyle: IProtyle) {
        const documentId = protyle.block.rootID;
        if (!documentId || !BLOCK_ID_PATTERN.test(documentId)) {
            return false;
        }
        expandDocTree({id: documentId, isSetCurrent: true});
        return true;
    }
}

function currentProtyle() {
    const editors = getAllEditor();
    const activeWindowEditor = editors.find((editor) => (
        editor.protyle.element.closest(".layout__wnd--active") && isVisible(editor.protyle)
    ));
    if (activeWindowEditor) {
        return activeWindowEditor.protyle;
    }

    const selectedEditor = getActiveEditor(false);
    return selectedEditor && isVisible(selectedEditor.protyle) ?
        selectedEditor.protyle :
        editors.find((editor) => isVisible(editor.protyle))?.protyle;
}

function isVisible(protyle: IProtyle) {
    return document.contains(protyle.element) && protyle.element.getClientRects().length > 0;
}

function isMobile() {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile";
}
