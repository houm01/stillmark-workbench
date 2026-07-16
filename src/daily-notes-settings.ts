import {
    Plugin,
    Setting,
    fetchSyncPost,
    getActiveEditor,
    getFrontend,
    showMessage,
} from "siyuan";

const STORAGE_NAME = "daily-notes.json";
const DAILY_NOTE_PATH_SUFFIX = '/{{now | date "2006/01"}}/{{now | date "2006-01-02"}}';
const GENERATED_TEMPLATE_PREFIX = "stillmark-daily-note-";
const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;

interface DailyNotesPluginData {
    notebookId?: string;
    templateDocumentId?: string;
    templateDocumentTitle?: string;
    autoCreateOnStartup?: boolean;
    autoLocateInTreeOnOpen?: boolean;
    autoFocusOnOpen?: boolean;
}

export interface Notebook {
    id: string;
    name: string;
    closed: boolean;
}

interface NotebookConf extends Record<string, unknown> {
    dailyNoteSavePath?: string;
    dailyNoteTemplatePath?: string;
}

interface NotebookConfData {
    box: string;
    name: string;
    conf: NotebookConf;
}

interface DocumentRow {
    id: string;
    content: string;
}

interface TemplateDocument {
    id: string;
    title: string;
}

export type ConfiguredNotebookResult =
    | {status: "ready"; notebook: Notebook;}
    | {status: "not-configured";}
    | {status: "unavailable";};

export class DailyNotesSettings {
    private selectedNotebookId = "";
    private templateDocument: TemplateDocument | null = null;
    private draftTemplateDocument: TemplateDocument | null = null;
    private autoCreateOnStartup = false;
    private autoLocateInTreeOnOpen = false;
    private readyPromise: Promise<void> = Promise.resolve();
    private notebookRequestGeneration = 0;
    private notebookConfRequestGeneration = 0;
    private loadedSettingsNotebookId = "";
    private saveRequested = false;
    private returnToWorkbench?: () => void;
    private returnButton?: HTMLButtonElement;

    private readonly notebookSelect = document.createElement("select");
    private readonly rootInput = document.createElement("input");
    private readonly rootMessage = document.createElement("div");
    private readonly templateDocumentInput = document.createElement("input");
    private readonly templateInput = document.createElement("input");
    private readonly useCurrentPageButton = document.createElement("button");
    private readonly clearTemplatePageButton = document.createElement("button");
    private readonly autoCreateInput = document.createElement("input");
    private readonly autoLocateInTreeInput = document.createElement("input");

    private readonly notebookChangedHandler = () => {
        void this.refreshNotebookOptions();
    };

    constructor(private readonly plugin: Plugin) {
        this.notebookSelect.className = "b3-select fn__block stillmark-daily-setting__control";
        this.notebookSelect.addEventListener("change", () => {
            const notebookId = this.notebookSelect.value;
            if (notebookId) {
                void this.loadNotebookSettings(notebookId);
            } else {
                this.resetNotebookSettings();
            }
        });

        this.rootInput.className = "b3-text-field fn__block stillmark-daily-setting__control";
        this.rootInput.placeholder = this.plugin.i18n.dailyNotesRootPlaceholder;

        this.rootMessage.className = "b3-label__text stillmark-daily-setting__message";
        this.rootMessage.hidden = true;

        this.templateDocumentInput.className = "b3-text-field stillmark-daily-setting__template-name";
        this.templateDocumentInput.readOnly = true;
        this.templateDocumentInput.placeholder = this.plugin.i18n.dailyNotesNoTemplatePage;

        this.useCurrentPageButton.type = "button";
        this.useCurrentPageButton.className = "b3-button b3-button--cancel";
        this.useCurrentPageButton.textContent = this.plugin.i18n.dailyNotesUseCurrentPage;
        this.useCurrentPageButton.addEventListener("click", () => {
            void this.useCurrentPageAsTemplate();
        });

        this.clearTemplatePageButton.type = "button";
        this.clearTemplatePageButton.className = "b3-button b3-button--cancel";
        this.clearTemplatePageButton.textContent = this.plugin.i18n.dailyNotesClearTemplatePage;
        this.clearTemplatePageButton.addEventListener("click", () => {
            this.draftTemplateDocument = null;
            this.updateTemplateControls();
        });

        this.templateInput.className = "b3-text-field fn__block stillmark-daily-setting__control";
        this.templateInput.placeholder = this.plugin.i18n.dailyNotesTemplateFilePlaceholder;

        this.autoCreateInput.type = "checkbox";
        this.autoCreateInput.className = "b3-switch";
        this.autoCreateInput.setAttribute("aria-label", this.plugin.i18n.dailyNotesAutoCreate);

        this.autoLocateInTreeInput.type = "checkbox";
        this.autoLocateInTreeInput.className = "b3-switch";
        this.autoLocateInTreeInput.setAttribute("aria-label", this.plugin.i18n.documentTreeAutoFocus);

        this.setSettingInputsEnabled(false);
    }

    onload() {
        this.configureSettings();
        this.plugin.eventBus.on("opened-notebook", this.notebookChangedHandler);
        this.plugin.eventBus.on("closed-notebook", this.notebookChangedHandler);
        this.readyPromise = this.initialize();
    }

    onunload() {
        this.plugin.eventBus.off("opened-notebook", this.notebookChangedHandler);
        this.plugin.eventBus.off("closed-notebook", this.notebookChangedHandler);
    }

    open(returnToWorkbench?: () => void) {
        this.returnButton?.remove();
        this.returnButton = undefined;
        this.returnToWorkbench = returnToWorkbench;
        this.resetDraftFromPersisted();
        void this.refreshNotebookOptions();
        this.plugin.openSetting();
        if (returnToWorkbench) {
            this.mountReturnButton(returnToWorkbench);
        }
    }

    openDailyNotesSettings(returnToWorkbench?: () => void) {
        this.openAndFocus(this.notebookSelect, returnToWorkbench);
    }

    openDocumentTreeFocusSettings(returnToWorkbench?: () => void) {
        this.openAndFocus(this.autoLocateInTreeInput, returnToWorkbench);
    }

    private openAndFocus(element: HTMLElement, returnToWorkbench?: () => void) {
        this.open(returnToWorkbench);
        window.setTimeout(() => {
            element.scrollIntoView({block: "center"});
            element.focus({preventScroll: true});
        }, 100);
    }

    private mountReturnButton(returnToWorkbench: () => void, attempt = 0) {
        window.setTimeout(() => {
            if (this.returnToWorkbench !== returnToWorkbench) {
                return;
            }

            const dialog = window.siyuan.dialogs.find((item) => item.element.contains(this.notebookSelect));
            const action = dialog?.element.querySelector<HTMLElement>(".b3-dialog__action");
            if (!dialog || !action) {
                if (attempt < 4) {
                    this.mountReturnButton(returnToWorkbench, attempt + 1);
                }
                return;
            }

            const button = document.createElement("button");
            button.type = "button";
            button.className = "b3-button b3-button--cancel stillmark-setting-return";
            button.textContent = this.plugin.i18n.returnToWorkbench;
            button.addEventListener("click", () => {
                this.returnToWorkbench = undefined;
                dialog.destroy();
                window.setTimeout(returnToWorkbench);
            });
            action.prepend(button);
            this.returnButton = button;
        }, attempt === 0 ? 0 : 50);
    }

    async resolveNotebook(): Promise<ConfiguredNotebookResult> {
        await this.readyPromise;
        if (!this.selectedNotebookId) {
            return {status: "not-configured"};
        }

        const notebooks = await this.fetchOpenNotebooks();
        const notebook = notebooks.find((item) => item.id === this.selectedNotebookId);
        return notebook ? {status: "ready", notebook} : {status: "unavailable"};
    }

    async shouldAutoCreateOnStartup() {
        await this.readyPromise;
        return this.autoCreateOnStartup;
    }

    async shouldAutoLocateInTreeOnOpen() {
        await this.readyPromise;
        return this.autoLocateInTreeOnOpen;
    }

    async setAutoLocateInTreeOnOpen(enabled: boolean) {
        await this.readyPromise;
        const stored = await this.plugin.loadData(STORAGE_NAME) as DailyNotesPluginData | undefined;
        const nextPluginData: DailyNotesPluginData = {
            ...(stored ?? {}),
            autoLocateInTreeOnOpen: enabled,
        };
        delete nextPluginData.autoFocusOnOpen;

        const response = await this.plugin.saveData(STORAGE_NAME, nextPluginData);
        if (response.code !== 0) {
            throw new Error(response.msg || this.plugin.i18n.documentTreeAutoFocusSaveFailed);
        }

        const readback = await this.plugin.loadData(STORAGE_NAME) as DailyNotesPluginData | undefined;
        if (readback?.autoLocateInTreeOnOpen !== enabled) {
            throw new Error(this.plugin.i18n.documentTreeAutoFocusVerificationFailed);
        }

        this.autoLocateInTreeOnOpen = enabled;
        this.autoLocateInTreeInput.checked = enabled;
    }

    async refreshPageTemplate(notebookId: string) {
        await this.readyPromise;
        if (!this.templateDocument) {
            return;
        }
        if (!BLOCK_ID_PATTERN.test(notebookId)) {
            throw new Error(this.plugin.i18n.dailyNotesNotebookUnavailable);
        }

        const config = await this.getNotebookConf(notebookId);
        if (config.conf.dailyNoteTemplatePath !== generatedTemplatePath(notebookId)) {
            throw new Error(this.plugin.i18n.dailyNotesTemplateConfigChanged);
        }

        const templateDocument = await this.findDocument(this.templateDocument.id);
        if (!templateDocument) {
            throw new Error(this.plugin.i18n.dailyNotesTemplatePageUnavailable);
        }

        await this.saveDocumentAsTemplate(templateDocument.id, notebookId);
        this.templateDocument = templateDocument;
    }

    private configureSettings() {
        this.plugin.setting = new Setting({
            width: this.isMobile() ? "92vw" : "560px",
            height: this.isMobile() ? "min(560px, 78vh)" : "540px",
            destroyCallback: () => {
                if (!this.saveRequested) {
                    this.resetDraftFromPersisted();
                }
                this.saveRequested = false;
                this.returnButton?.remove();
                this.returnButton = undefined;
                this.returnToWorkbench = undefined;
            },
            confirmCallback: () => {
                const returnToWorkbench = this.returnToWorkbench;
                this.returnToWorkbench = undefined;
                this.saveRequested = true;
                void this.saveSettings().then((saved) => {
                    if (saved && returnToWorkbench) {
                        window.setTimeout(returnToWorkbench);
                    }
                });
            },
        });

        this.plugin.setting.addItem({
            title: this.plugin.i18n.documentTreeFocusSettings,
            description: this.plugin.i18n.documentTreeAutoFocusDescription,
            direction: "column",
            actionElement: this.autoLocateInTreeInput,
        });

        this.plugin.setting.addItem({
            title: this.plugin.i18n.dailyNotesNotebook,
            description: this.plugin.i18n.dailyNotesNotebookDescription,
            direction: "row",
            actionElement: this.notebookSelect,
        });

        const rootContainer = document.createElement("div");
        rootContainer.className = "stillmark-daily-setting";
        rootContainer.append(this.rootInput, this.rootMessage);
        this.plugin.setting.addItem({
            title: this.plugin.i18n.dailyNotesRoot,
            description: this.plugin.i18n.dailyNotesRootDescription,
            direction: "row",
            actionElement: rootContainer,
        });

        const templateContainer = document.createElement("div");
        templateContainer.className = "stillmark-daily-setting stillmark-daily-setting__template";

        const templatePageRow = document.createElement("div");
        templatePageRow.className = "stillmark-daily-setting__template-row";
        templatePageRow.append(
            this.templateDocumentInput,
            this.useCurrentPageButton,
            this.clearTemplatePageButton,
        );

        const templateFileLabel = document.createElement("div");
        templateFileLabel.className = "b3-label__text stillmark-daily-setting__template-file-label";
        templateFileLabel.textContent = this.plugin.i18n.dailyNotesTemplateFile;
        templateContainer.append(templatePageRow, templateFileLabel, this.templateInput);

        this.plugin.setting.addItem({
            title: this.plugin.i18n.dailyNotesTemplate,
            description: this.plugin.i18n.dailyNotesTemplateDescription,
            direction: "row",
            actionElement: templateContainer,
        });

        this.plugin.setting.addItem({
            title: this.plugin.i18n.dailyNotesAutoCreate,
            description: this.plugin.i18n.dailyNotesAutoCreateDescription,
            direction: "column",
            actionElement: this.autoCreateInput,
        });
    }

    private async initialize() {
        try {
            const stored = await this.plugin.loadData(STORAGE_NAME) as DailyNotesPluginData | undefined;
            this.selectedNotebookId = typeof stored?.notebookId === "string" ? stored.notebookId : "";
            this.templateDocument = storedTemplateDocument(stored);
            this.autoCreateOnStartup = stored?.autoCreateOnStartup === true;
            this.autoLocateInTreeOnOpen = stored?.autoLocateInTreeOnOpen === true || stored?.autoFocusOnOpen === true;
        } catch {
            this.selectedNotebookId = "";
            this.templateDocument = null;
            this.autoCreateOnStartup = false;
            this.autoLocateInTreeOnOpen = false;
        }

        this.resetDraftFromPersisted();
        await this.refreshNotebookOptions(this.selectedNotebookId);
    }

    private async refreshNotebookOptions(preferredNotebookId?: string) {
        const generation = ++this.notebookRequestGeneration;
        const draftNotebookId = preferredNotebookId ?? (this.notebookSelect.value || this.selectedNotebookId);

        this.notebookSelect.disabled = true;
        try {
            const notebooks = await this.fetchOpenNotebooks();
            if (generation !== this.notebookRequestGeneration) {
                return;
            }

            this.replaceNotebookOptions(notebooks, draftNotebookId);
            this.notebookSelect.disabled = false;
            if (this.notebookSelect.value) {
                await this.loadNotebookSettings(this.notebookSelect.value);
            } else {
                this.resetNotebookSettings();
            }
        } catch {
            if (generation !== this.notebookRequestGeneration) {
                return;
            }
            this.replaceNotebookOptions([], "", this.plugin.i18n.dailyNotesNotebookLoadFailed);
            this.resetNotebookSettings();
        }
    }

    private replaceNotebookOptions(notebooks: Notebook[], selectedId: string, placeholder?: string) {
        this.notebookSelect.replaceChildren();

        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = placeholder ?? this.plugin.i18n.dailyNotesSelectNotebook;
        this.notebookSelect.append(emptyOption);

        for (const notebook of notebooks) {
            const option = document.createElement("option");
            option.value = notebook.id;
            option.textContent = notebook.name;
            this.notebookSelect.append(option);
        }

        this.notebookSelect.value = notebooks.some((notebook) => notebook.id === selectedId) ? selectedId : "";
    }

    private async loadNotebookSettings(notebookId: string) {
        const generation = ++this.notebookConfRequestGeneration;
        this.loadedSettingsNotebookId = "";
        this.setSettingInputsEnabled(false);
        this.hideRootMessage();

        try {
            const data = await this.getNotebookConf(notebookId);
            if (generation !== this.notebookConfRequestGeneration || this.notebookSelect.value !== notebookId) {
                return;
            }

            const savePath = typeof data.conf.dailyNoteSavePath === "string" ? data.conf.dailyNoteSavePath : "";
            const templatePath = typeof data.conf.dailyNoteTemplatePath === "string" ?
                templatePathForDisplay(data.conf.dailyNoteTemplatePath) :
                "";
            const root = extractRootDirectory(savePath);

            this.rootInput.value = root ?? "";
            this.templateInput.value = this.draftTemplateDocument &&
                    data.conf.dailyNoteTemplatePath === generatedTemplatePath(notebookId) ?
                "" :
                templatePath;
            if (root === null) {
                this.rootMessage.textContent = formatMessage(
                    this.plugin.i18n.dailyNotesCurrentPathUnsupported,
                    {path: savePath},
                );
                this.rootMessage.dataset.type = "info";
                this.rootMessage.hidden = false;
            }
            this.loadedSettingsNotebookId = notebookId;
            this.setSettingInputsEnabled(true);
        } catch (error) {
            if (generation !== this.notebookConfRequestGeneration || this.notebookSelect.value !== notebookId) {
                return;
            }
            this.rootMessage.textContent = `${this.plugin.i18n.dailyNotesSettingsLoadFailed}: ${errorMessage(error)}`;
            this.rootMessage.dataset.type = "error";
            this.rootMessage.hidden = false;
            this.setSettingInputsEnabled(false);
        }
    }

    private resetNotebookSettings() {
        ++this.notebookConfRequestGeneration;
        this.loadedSettingsNotebookId = "";
        this.rootInput.value = "";
        this.templateInput.value = "";
        this.hideRootMessage();
        this.setSettingInputsEnabled(false);
    }

    private async saveSettings() {
        let nativeSettingsUpdated = false;
        let templateSnapshotUpdated = false;
        let documentTreeOnly = false;
        try {
            const notebookId = this.notebookSelect.value;
            if (!BLOCK_ID_PATTERN.test(notebookId)) {
                documentTreeOnly = true;
                const enabled = this.autoLocateInTreeInput.checked;
                await this.setAutoLocateInTreeOnOpen(enabled);
                showMessage(
                    enabled ?
                        this.plugin.i18n.documentTreeAutoFocusEnabled :
                        this.plugin.i18n.documentTreeAutoFocusDisabled,
                    3000,
                );
                return true;
            }
            if (this.loadedSettingsNotebookId !== notebookId) {
                throw new Error(this.plugin.i18n.dailyNotesSettingsStillLoading);
            }

            const openNotebooks = await this.fetchOpenNotebooks();
            if (!openNotebooks.some((notebook) => notebook.id === notebookId)) {
                throw new Error(this.plugin.i18n.dailyNotesNotebookUnavailable);
            }

            const root = normalizeRootDirectory(this.rootInput.value, this.plugin.i18n);
            const dailyNoteSavePath = `${root}${DAILY_NOTE_PATH_SUFFIX}`;
            let savedTemplateDocument: TemplateDocument | null = null;
            let dailyNoteTemplatePath = "";

            if (this.draftTemplateDocument) {
                savedTemplateDocument = await this.findDocument(this.draftTemplateDocument.id);
                if (!savedTemplateDocument) {
                    throw new Error(this.plugin.i18n.dailyNotesTemplatePageUnavailable);
                }
                await this.saveDocumentAsTemplate(savedTemplateDocument.id, notebookId);
                templateSnapshotUpdated = true;
                dailyNoteTemplatePath = generatedTemplatePath(notebookId);
            } else {
                const templatePath = normalizeTemplatePath(this.templateInput.value, this.plugin.i18n);
                dailyNoteTemplatePath = templatePath ? `/${templatePath}` : "";
            }

            const current = await this.getNotebookConf(notebookId);
            const nextConf: NotebookConf = {
                ...current.conf,
                dailyNoteSavePath,
                dailyNoteTemplatePath,
            };

            await this.post("/api/notebook/setNotebookConf", {
                notebook: notebookId,
                conf: nextConf,
            }, this.plugin.i18n.dailyNotesSettingsSaveFailed);
            nativeSettingsUpdated = true;

            const readback = await this.getNotebookConf(notebookId);
            if (
                readback.conf.dailyNoteSavePath !== dailyNoteSavePath ||
                readback.conf.dailyNoteTemplatePath !== dailyNoteTemplatePath
            ) {
                throw new Error(this.plugin.i18n.dailyNotesSettingsVerificationFailed);
            }

            const nextPluginData: DailyNotesPluginData = {
                notebookId,
                templateDocumentId: savedTemplateDocument?.id,
                templateDocumentTitle: savedTemplateDocument?.title,
                autoCreateOnStartup: this.autoCreateInput.checked,
                autoLocateInTreeOnOpen: this.autoLocateInTreeInput.checked,
            };
            const storageResponse = await this.plugin.saveData(STORAGE_NAME, nextPluginData);
            if (storageResponse.code !== 0) {
                throw new Error(storageResponse.msg || this.plugin.i18n.dailyNotesSettingsSaveFailed);
            }

            this.selectedNotebookId = notebookId;
            this.templateDocument = savedTemplateDocument;
            this.autoCreateOnStartup = this.autoCreateInput.checked;
            this.autoLocateInTreeOnOpen = this.autoLocateInTreeInput.checked;
            this.rootInput.value = root;
            this.templateInput.value = savedTemplateDocument ? "" : templatePathForDisplay(dailyNoteTemplatePath);
            this.hideRootMessage();
            this.resetDraftFromPersisted();
            showMessage(this.plugin.i18n.dailyNotesSettingsSaved, 3000);
            return true;
        } catch (error) {
            this.resetDraftFromPersisted();
            const prefix = documentTreeOnly ?
                this.plugin.i18n.documentTreeAutoFocusSaveFailed :
                nativeSettingsUpdated || templateSnapshotUpdated ?
                this.plugin.i18n.dailyNotesSettingsPartialFailure :
                this.plugin.i18n.dailyNotesSettingsSaveFailed;
            showMessage(`${prefix}: ${errorMessage(error)}`, 6000, "error");
            return false;
        }
    }

    private async useCurrentPageAsTemplate() {
        try {
            const rootId = getActiveEditor()?.protyle.block.rootID;
            if (!rootId || !BLOCK_ID_PATTERN.test(rootId)) {
                throw new Error(this.plugin.i18n.dailyNotesCurrentPageUnavailable);
            }

            const templateDocument = await this.findDocument(rootId);
            if (!templateDocument) {
                throw new Error(this.plugin.i18n.dailyNotesCurrentPageUnavailable);
            }

            this.draftTemplateDocument = templateDocument;
            this.templateInput.value = "";
            this.updateTemplateControls();
        } catch (error) {
            showMessage(`${this.plugin.i18n.dailyNotesTemplateSelectFailed}: ${errorMessage(error)}`, 5000, "error");
        }
    }

    private async findDocument(id: string) {
        if (!BLOCK_ID_PATTERN.test(id)) {
            return null;
        }
        const rows = await this.post<DocumentRow[]>(
            "/api/query/sql",
            {stmt: `SELECT id, content FROM blocks WHERE id = '${id}' AND type = 'd' LIMIT 1`},
            this.plugin.i18n.dailyNotesTemplateSelectFailed,
        );
        const row = Array.isArray(rows) ? rows[0] : undefined;
        if (!row || row.id !== id || typeof row.content !== "string") {
            return null;
        }
        return {id: row.id, title: row.content || row.id};
    }

    private async saveDocumentAsTemplate(documentId: string, notebookId: string) {
        await this.post(
            "/api/template/docSaveAsTemplate",
            {
                id: documentId,
                name: generatedTemplateName(notebookId),
                overwrite: true,
            },
            this.plugin.i18n.dailyNotesTemplateSnapshotFailed,
        );
    }

    private async fetchOpenNotebooks() {
        const data = await this.post<{notebooks?: Notebook[];}>(
            "/api/notebook/lsNotebooks",
            {},
            this.plugin.i18n.dailyNotesNotebookLoadFailed,
        );
        const notebooks = Array.isArray(data?.notebooks) ? data.notebooks : [];
        return notebooks.filter((notebook) => (
            typeof notebook?.id === "string" &&
            typeof notebook?.name === "string" &&
            notebook.closed === false
        ));
    }

    private async getNotebookConf(notebookId: string) {
        const data = await this.post<NotebookConfData>(
            "/api/notebook/getNotebookConf",
            {notebook: notebookId},
            this.plugin.i18n.dailyNotesSettingsLoadFailed,
        );
        if (!data || typeof data.conf !== "object" || data.conf === null) {
            throw new Error(this.plugin.i18n.dailyNotesInvalidResponse);
        }
        return data;
    }

    private async post<T>(url: string, body: unknown, fallbackMessage: string): Promise<T> {
        const response = await fetchSyncPost(url, body);
        if (response.code !== 0) {
            throw new Error(response.msg || fallbackMessage);
        }
        return response.data as T;
    }

    private resetDraftFromPersisted() {
        this.draftTemplateDocument = this.templateDocument ? {...this.templateDocument} : null;
        this.autoCreateInput.checked = this.autoCreateOnStartup;
        this.autoLocateInTreeInput.checked = this.autoLocateInTreeOnOpen;
        this.updateTemplateControls();
    }

    private setSettingInputsEnabled(enabled: boolean) {
        this.rootInput.disabled = !enabled;
        this.useCurrentPageButton.disabled = !enabled;
        this.updateTemplateControls(enabled);
    }

    private updateTemplateControls(settingsEnabled = !this.rootInput.disabled) {
        const hasTemplateDocument = this.draftTemplateDocument !== null;
        this.templateDocumentInput.value = this.draftTemplateDocument?.title ?? "";
        this.templateDocumentInput.title = this.draftTemplateDocument?.title ?? "";
        this.templateDocumentInput.disabled = !settingsEnabled;
        this.useCurrentPageButton.disabled = !settingsEnabled;
        this.clearTemplatePageButton.disabled = !settingsEnabled || !hasTemplateDocument;
        this.templateInput.disabled = !settingsEnabled || hasTemplateDocument;
    }

    private hideRootMessage() {
        this.rootMessage.hidden = true;
        this.rootMessage.textContent = "";
        delete this.rootMessage.dataset.type;
    }

    private isMobile() {
        const frontend = getFrontend();
        return frontend === "mobile" || frontend === "browser-mobile";
    }
}

function storedTemplateDocument(stored?: DailyNotesPluginData): TemplateDocument | null {
    if (
        !stored ||
        typeof stored.templateDocumentId !== "string" ||
        !BLOCK_ID_PATTERN.test(stored.templateDocumentId)
    ) {
        return null;
    }
    return {
        id: stored.templateDocumentId,
        title: typeof stored.templateDocumentTitle === "string" && stored.templateDocumentTitle ?
            stored.templateDocumentTitle :
            stored.templateDocumentId,
    };
}

function generatedTemplateName(notebookId: string) {
    return `${GENERATED_TEMPLATE_PREFIX}${notebookId}`;
}

function generatedTemplatePath(notebookId: string) {
    return `/${generatedTemplateName(notebookId)}.md`;
}

function extractRootDirectory(savePath: string) {
    if (!savePath) {
        return "";
    }
    if (!savePath.endsWith(DAILY_NOTE_PATH_SUFFIX)) {
        return null;
    }

    const root = savePath.slice(0, -DAILY_NOTE_PATH_SUFFIX.length);
    return root && root !== "/" ? root : null;
}

function normalizeRootDirectory(value: string, i18n: Record<string, string>) {
    let normalized = value.trim();
    while (normalized.length > 1 && normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
    }

    if (!normalized || normalized === "/") {
        throw new Error(i18n.dailyNotesRootRequired);
    }
    if (!normalized.startsWith("/")) {
        throw new Error(i18n.dailyNotesRootMustStartSlash);
    }
    if (normalized.includes("{{") || normalized.includes("}}")) {
        throw new Error(i18n.dailyNotesRootTemplateForbidden);
    }

    const segments = normalized.split("/").slice(1);
    if (segments.some((segment) => !segment || segment === "..")) {
        throw new Error(i18n.dailyNotesRootInvalid);
    }
    return normalized;
}

function normalizeTemplatePath(value: string, i18n: Record<string, string>) {
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }

    if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(trimmed)) {
        throw new Error(i18n.dailyNotesTemplateMustBeRelative);
    }
    const normalized = trimmed.replace(/\\/g, "/");
    const segments = normalized.split(/[\\/]/);
    if (segments.some((segment) => !segment || segment === "..")) {
        throw new Error(i18n.dailyNotesTemplateInvalid);
    }
    return normalized.endsWith(".md") ? normalized : `${normalized}.md`;
}

function templatePathForDisplay(value: string) {
    return value.replace(/^[\\/]+/, "").replace(/\\/g, "/");
}

function formatMessage(template: string, values: Record<string, string>) {
    let message = template;
    for (const key of Object.keys(values)) {
        message = message.replace(`\${${key}}`, values[key]);
    }
    return message;
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
