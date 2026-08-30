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
import {isDatabaseDocument} from "./database-page";
import {WorkbenchPreferences} from "./workbench-preferences";

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const CONTEXT_MENU_VERTICAL_GAP = 20;

export interface DocumentTreeFocusPreferences {
    shouldAutoLocateInTreeOnOpen(): Promise<boolean>;
    shouldSkipDatabasePagesWhenAutoLocating(): Promise<boolean>;
    setAutoLocateInTreeOnOpen(enabled: boolean): Promise<void>;
    setSkipDatabasePagesWhenAutoLocating(enabled: boolean): Promise<void>;
    openDocumentTreeFocusSettings(): void;
}

export class DocumentTreeFocusFeature {
    private enabled = true;
    private locateFrame?: number;
    private locateRequestGeneration = 0;
    private mounted = false;
    private topBarElement?: HTMLElement;

    private readonly editorChangedHandler = () => {
        this.scheduleAutoLocate();
    };

    private readonly contextMenuHandler = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        void this.showSettingsMenu(event.clientX, event.clientY);
    };

    constructor(
        private readonly plugin: Plugin,
        private readonly preferences: DocumentTreeFocusPreferences,
        private readonly workbenchPreferences: WorkbenchPreferences,
    ) {}

    onload() {
        this.enabled = this.workbenchPreferences.isFeatureEnabledCached("documentTreeFocus");
        this.mount();
    }

    onLayoutReady() {
        this.topBarElement = this.plugin.addTopBar({
            icon: "iconFocus",
            title: this.plugin.i18n.documentTreeFocusButtonTitle,
            position: "left",
            callback: () => this.locateCurrentDocument(),
        });
        this.topBarElement.classList.add("stillmark-topbar-icon", "stillmark-topbar-icon--focus");
        this.syncTopBarVisibility();

        if (!isMobile()) {
            this.topBarElement.addEventListener("contextmenu", this.contextMenuHandler);
        }
    }

    onunload() {
        this.unmount();
        this.topBarElement?.removeEventListener("contextmenu", this.contextMenuHandler);
    }

    async isEnabled() {
        return this.workbenchPreferences.isFeatureEnabled("documentTreeFocus");
    }

    async setEnabled(enabled: boolean) {
        await this.workbenchPreferences.setFeatureEnabled("documentTreeFocus", enabled);
        this.enabled = enabled;
        if (enabled) {
            this.mount();
        } else {
            this.unmount();
        }
        this.syncTopBarVisibility();
    }

    private async locateDocumentIfEnabled(protyle: IProtyle, generation: number) {
        if (!this.enabled || !await this.preferences.shouldAutoLocateInTreeOnOpen()) {
            return;
        }
        const documentId = protyle.block.rootID ?? "";
        if (
            generation !== this.locateRequestGeneration ||
            !isCurrentDocument(protyle, documentId)
        ) {
            return;
        }
        if (
            await this.preferences.shouldSkipDatabasePagesWhenAutoLocating() &&
            await isDatabaseDocument(protyle.element, documentId)
        ) {
            return;
        }
        if (
            generation !== this.locateRequestGeneration ||
            !isCurrentDocument(protyle, documentId)
        ) {
            return;
        }
        if (isDocumentFocusedInTree(documentId)) {
            return;
        }
        this.locateDocument(documentId);
    }

    private scheduleAutoLocate() {
        const generation = ++this.locateRequestGeneration;
        if (this.locateFrame !== undefined) {
            window.cancelAnimationFrame(this.locateFrame);
        }
        this.locateFrame = window.requestAnimationFrame(() => {
            this.locateFrame = undefined;
            const protyle = currentProtyle();
            if (protyle) {
                void this.locateDocumentIfEnabled(protyle, generation);
            }
        });
    }

    private async showSettingsMenu(x: number, y: number) {
        const [enabled, skipDatabasePages] = await Promise.all([
            this.preferences.shouldAutoLocateInTreeOnOpen(),
            this.preferences.shouldSkipDatabasePagesWhenAutoLocating(),
        ]);
        const menu = new Menu(`${this.plugin.name}-document-tree-focus`);

        menu.addItem({
            checked: enabled,
            label: this.plugin.i18n.documentTreeAutoFocus,
            click: () => {
                void this.updateAutoLocatePreference(!enabled);
            },
        });
        menu.addItem({
            checked: skipDatabasePages,
            label: this.plugin.i18n.documentTreeSkipDatabasePages,
            click: () => {
                void this.updateSkipDatabasePagesPreference(!skipDatabasePages);
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

    private async updateSkipDatabasePagesPreference(enabled: boolean) {
        try {
            await this.preferences.setSkipDatabasePagesWhenAutoLocating(enabled);
            showMessage(
                enabled ?
                    this.plugin.i18n.documentTreeSkipDatabasePagesEnabled :
                    this.plugin.i18n.documentTreeSkipDatabasePagesDisabled,
                3000,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showMessage(`${this.plugin.i18n.documentTreeSkipDatabasePagesSaveFailed}: ${message}`, 5000, "error");
        }
    }

    private locateCurrentDocument() {
        void this.locateCurrentDocumentIfAllowed();
    }

    private async locateCurrentDocumentIfAllowed() {
        if (!this.enabled) {
            return;
        }
        const protyle = currentProtyle();
        if (!protyle) {
            showMessage(this.plugin.i18n.documentTreeFocusUnavailable, 4000, "error");
            return;
        }
        const documentId = protyle.block.rootID ?? "";

        if (
            await this.preferences.shouldSkipDatabasePagesWhenAutoLocating() &&
            await isDatabaseDocument(protyle.element, documentId)
        ) {
            if (isCurrentDocument(protyle, documentId)) {
                showMessage(this.plugin.i18n.documentTreeDatabasePageSkipped, 4000);
            }
            return;
        }

        if (!this.enabled || !isCurrentDocument(protyle, documentId)) {
            return;
        }
        if (!this.locateDocument(documentId)) {
            showMessage(this.plugin.i18n.documentTreeFocusUnavailable, 4000, "error");
        }
    }

    private locateDocument(documentId: string) {
        if (!BLOCK_ID_PATTERN.test(documentId)) {
            return false;
        }
        expandDocTree({id: documentId, isSetCurrent: true});
        return true;
    }

    private mount() {
        if (!this.enabled || this.mounted) {
            return;
        }
        this.mounted = true;
        this.plugin.eventBus.on("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle", this.editorChangedHandler);
    }

    private unmount() {
        if (!this.mounted) {
            return;
        }
        this.mounted = false;
        ++this.locateRequestGeneration;
        if (this.locateFrame !== undefined) {
            window.cancelAnimationFrame(this.locateFrame);
            this.locateFrame = undefined;
        }
        this.plugin.eventBus.off("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle", this.editorChangedHandler);
    }

    private syncTopBarVisibility() {
        this.topBarElement?.classList.toggle("stillmark-feature-disabled", !this.enabled);
    }
}

function currentProtyle() {
    const editors = getAllEditor();
    const activeWindowEditors = editors.filter((editor) => (
        editor.protyle.element.closest(".layout__wnd--active") && isVisible(editor.protyle)
    ));
    const selectedEditor = getActiveEditor(false);
    if (
        selectedEditor &&
        isVisible(selectedEditor.protyle) &&
        (
            activeWindowEditors.length === 0 ||
            activeWindowEditors.some((editor) => editor.protyle.element === selectedEditor.protyle.element)
        )
    ) {
        return selectedEditor.protyle;
    }
    return activeWindowEditors[0]?.protyle ?? editors.find((editor) => isVisible(editor.protyle))?.protyle;
}

function isVisible(protyle: IProtyle) {
    return document.contains(protyle.element) && protyle.element.getClientRects().length > 0;
}

function isCurrentDocument(protyle: IProtyle, documentId: string) {
    const current = currentProtyle();
    return (
        current?.element === protyle.element &&
        current.block.rootID === documentId
    );
}

function isDocumentFocusedInTree(documentId?: string) {
    if (!documentId || !BLOCK_ID_PATTERN.test(documentId)) {
        return false;
    }
    return Boolean(document.querySelector(
        `.file-tree .b3-list-item--focus[data-node-id="${CSS.escape(documentId)}"]`,
    ));
}

function isMobile() {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile";
}
