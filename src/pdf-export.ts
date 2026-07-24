import {
    Constants,
    Dialog,
    Plugin,
    ProtyleMethod,
    fetchSyncPost,
    getActiveEditor,
    getFrontend,
    showMessage,
} from "siyuan";
import {
    addPdfOutline,
    type PdfOutlineHeading,
} from "./pdf-outline";

const PDF_EXPORT_STORAGE = "pdf-export.json";
const PRINT_PAGE_STYLE_ID = "stillmark-pdf-page-style";
const PRINT_ROOT_CLASS = "stillmark-pdf-print-root";
const PRINTING_BODY_CLASS = "stillmark-pdf-printing";
const OUTLINE_HEADING_SELECTOR =
    '[data-type="NodeHeading"][data-subtype="h1"], [data-type="NodeHeading"][data-subtype="h2"], [data-type="NodeHeading"][data-subtype="h3"]';

type PdfPreset = "reader" | "minimal" | "report";
type PdfPageSize = "A4" | "A5" | "Letter";
type PdfMargin = "balanced" | "compact";

interface PdfExportSettings {
    preset: PdfPreset;
    pageSize: PdfPageSize;
    margin: PdfMargin;
    fontFamily: string;
    includeToc: boolean;
    mergeSubdocs: boolean;
    keepFold: boolean;
}

interface SystemFont {
    displayName: string;
    family: string;
}

interface CurrentEditorFont {
    css: string;
    displayName: string;
}

interface ExportPreviewData {
    attrs?: Record<string, string>;
    content: string;
    name: string;
    type?: string;
}

interface PdfExportSession {
    active: boolean;
    copyButton: HTMLButtonElement;
    currentFontCss: string;
    dialog: Dialog;
    documentId: string;
    exportButton: HTMLButtonElement;
    nameElement: HTMLElement;
    previewElement: HTMLElement;
    requestSequence: number;
    settings: PdfExportSettings;
    statusElement: HTMLElement;
}

interface SaveDialogResult {
    canceled: boolean;
    filePath?: string;
}

interface CopiedPdfFile {
    tempDirectory: string;
}

interface DesktopExportServices {
    copyPdfFile?: (
        filename: string,
        data: Uint8Array,
        verificationFailedMessage: string,
    ) => Promise<CopiedPdfFile>;
    defaultPath: (filename: string) => string;
    invoke: (channel: string, data: Record<string, unknown>) => Promise<unknown>;
    removeTempDirectory?: (path: string) => Promise<void>;
    writeFile: (path: string, data: Uint8Array) => Promise<void>;
}

const DEFAULT_SETTINGS: PdfExportSettings = {
    preset: "reader",
    pageSize: "A4",
    margin: "balanced",
    fontFamily: "",
    includeToc: true,
    mergeSubdocs: false,
    keepFold: false,
};

const PAGE_MARGINS: Record<PdfMargin, string> = {
    balanced: "18mm 18mm 20mm",
    compact: "12mm 13mm 14mm",
};

export class PdfExportFeature {
    private activeDialog?: Dialog;
    private copiedPdfTempDirectory?: string;
    private settings: PdfExportSettings = {...DEFAULT_SETTINGS};
    private settingsReady: Promise<void> = Promise.resolve();

    constructor(private readonly plugin: Plugin) {}

    onload() {
        this.plugin.addIcons(`<symbol id="iconStillmarkPDF" viewBox="0 0 32 32">
<path d="M8 4.5h11l5 5V27.5H8zM19 4.5v5h5M11.5 21v-7h2.3a2 2 0 0 1 0 4h-2.3M17.5 21v-7h1.7a3 3 0 0 1 0 6h-1.7M24 14h-3v7M21 17h2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
</symbol>`);
        this.settingsReady = this.loadSettings();
    }

    onLayoutReady() {
        const topBarElement = this.plugin.addTopBar({
            icon: "iconStillmarkPDF",
            title: this.plugin.i18n.pdfExportButtonTitle,
            position: "left",
            callback: () => {
                void this.open();
            },
        });
        topBarElement.classList.add("stillmark-topbar-icon", "stillmark-topbar-icon--pdf");
    }

    onunload() {
        this.activeDialog?.destroy();
        this.cleanupPrintRoot();
    }

    async open() {
        await this.settingsReady;
        const editor = getActiveEditor();
        const documentId = editor?.protyle?.block?.rootID;
        if (!documentId) {
            showMessage(this.plugin.i18n.pdfExportNoDocument, 4000, "error");
            return;
        }

        const currentFont = getCurrentEditorFont(
            editor.protyle.wysiwyg?.element ?? editor.protyle.element,
            this.plugin.i18n.fontSwitcherDefault,
        );
        let systemFonts: SystemFont[] = [];
        try {
            systemFonts = await this.loadSystemFonts();
        } catch (error) {
            showMessage(`${this.plugin.i18n.pdfExportFontLoadFailed}: ${errorMessage(error)}`, 4000, "error");
        }

        this.activeDialog?.destroy();
        const isMobile = ["mobile", "browser-mobile"].includes(getFrontend());
        const sessionState: {value?: PdfExportSession;} = {};
        const dialog = new Dialog({
            title: this.plugin.i18n.pdfExportTitle,
            content: `<div class="b3-dialog__content stillmark-pdf-export"></div>
<div class="b3-dialog__action stillmark-pdf-export__actions"></div>`,
            width: isMobile ? "96vw" : "min(1080px, 94vw)",
            height: isMobile ? "88vh" : "min(820px, 88vh)",
            destroyCallback: () => {
                if (sessionState.value) {
                    sessionState.value.active = false;
                }
                if (this.activeDialog === dialog) {
                    this.activeDialog = undefined;
                }
            },
        });
        this.activeDialog = dialog;

        const root = dialog.element.querySelector<HTMLElement>(".stillmark-pdf-export");
        const actions = dialog.element.querySelector<HTMLElement>(".stillmark-pdf-export__actions");
        if (!root || !actions) {
            dialog.destroy();
            return;
        }

        sessionState.value = this.buildDialog(dialog, root, actions, documentId, currentFont, systemFonts);
        void this.refreshPreview(sessionState.value);
    }

    getStatusLabel() {
        return `${this.settings.pageSize} · ${this.presetLabel(this.settings.preset)}`;
    }

    private buildDialog(
        dialog: Dialog,
        root: HTMLElement,
        actions: HTMLElement,
        documentId: string,
        currentFont: CurrentEditorFont,
        systemFonts: SystemFont[],
    ): PdfExportSession {
        const settings = {...this.settings, fontFamily: ""};
        const controls = document.createElement("aside");
        controls.className = "stillmark-pdf-export__controls";

        const preset = this.createSelect(
            this.plugin.i18n.pdfExportPreset,
            [
                ["reader", this.plugin.i18n.pdfExportPresetReader],
                ["minimal", this.plugin.i18n.pdfExportPresetMinimal],
                ["report", this.plugin.i18n.pdfExportPresetReport],
            ],
            settings.preset,
        );
        const pageSize = this.createSelect(
            this.plugin.i18n.pdfExportPageSize,
            [["A4", "A4"], ["A5", "A5"], ["Letter", "Letter"]],
            settings.pageSize,
        );
        const fontOptions = [
            ["", `${this.plugin.i18n.pdfExportFontCurrent} · ${currentFont.displayName}`],
            ...systemFonts.map((font) => [font.family, font.displayName]),
        ];
        if (settings.fontFamily && !systemFonts.some((font) => font.family === settings.fontFamily)) {
            fontOptions.splice(1, 0, [settings.fontFamily, settings.fontFamily]);
        }
        const font = this.createSelect(
            this.plugin.i18n.pdfExportFont,
            fontOptions,
            settings.fontFamily,
        );
        const margin = this.createSelect(
            this.plugin.i18n.pdfExportMargin,
            [
                ["balanced", this.plugin.i18n.pdfExportMarginBalanced],
                ["compact", this.plugin.i18n.pdfExportMarginCompact],
            ],
            settings.margin,
        );
        const includeToc = this.createSwitch(this.plugin.i18n.pdfExportIncludeToc, settings.includeToc);
        const mergeSubdocs = this.createSwitch(
            this.plugin.i18n.pdfExportMergeSubdocs,
            settings.mergeSubdocs,
        );
        const keepFold = this.createSwitch(this.plugin.i18n.pdfExportKeepFold, settings.keepFold);

        const note = document.createElement("p");
        note.className = "stillmark-pdf-export__note";
        note.textContent = this.plugin.i18n.pdfExportPrintHint;
        controls.append(
            preset.label,
            pageSize.label,
            font.label,
            margin.label,
            includeToc.label,
            mergeSubdocs.label,
            keepFold.label,
            note,
        );

        const previewWrap = document.createElement("div");
        previewWrap.className = "stillmark-pdf-export__preview-wrap";
        const preview = document.createElement("div");
        preview.className = "stillmark-pdf-export__preview";
        preview.dataset.preset = settings.preset;
        preview.dataset.pageSize = settings.pageSize;
        preview.dataset.margin = settings.margin;
        this.applySelectedFont(preview, settings, currentFont.css);
        previewWrap.append(preview);
        root.append(controls, previewWrap);

        const name = document.createElement("span");
        name.className = "stillmark-pdf-export__document-name";
        const status = document.createElement("span");
        status.className = "stillmark-pdf-export__action-status";
        status.textContent = this.plugin.i18n.pdfExportLoading;
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "b3-button b3-button--cancel";
        closeButton.textContent = this.plugin.i18n.pdfExportClose;
        closeButton.addEventListener("click", () => dialog.destroy());
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "b3-button b3-button--cancel";
        copyButton.textContent = this.plugin.i18n.pdfExportCopyAction;
        copyButton.disabled = true;
        const exportButton = document.createElement("button");
        exportButton.type = "button";
        exportButton.className = "b3-button b3-button--text";
        exportButton.textContent = this.plugin.i18n.pdfExportAction;
        exportButton.disabled = true;
        actions.append(name, status, closeButton, copyButton, exportButton);

        const session: PdfExportSession = {
            active: true,
            copyButton,
            currentFontCss: currentFont.css,
            dialog,
            documentId,
            exportButton,
            nameElement: name,
            previewElement: preview,
            requestSequence: 0,
            settings,
            statusElement: status,
        };

        preset.select.addEventListener("change", () => {
            settings.preset = preset.select.value as PdfPreset;
            preview.dataset.preset = settings.preset;
            this.commitSettings(settings);
        });
        pageSize.select.addEventListener("change", () => {
            settings.pageSize = pageSize.select.value as PdfPageSize;
            preview.dataset.pageSize = settings.pageSize;
            this.commitSettings(settings);
        });
        font.select.addEventListener("change", () => {
            settings.fontFamily = font.select.value;
            this.applySelectedFont(preview, settings, currentFont.css);
            this.commitSettings(settings);
        });
        margin.select.addEventListener("change", () => {
            settings.margin = margin.select.value as PdfMargin;
            preview.dataset.margin = settings.margin;
            this.commitSettings(settings);
        });
        includeToc.input.addEventListener("change", () => {
            settings.includeToc = includeToc.input.checked;
            const documentElement = preview.querySelector<HTMLElement>(".stillmark-pdf-document");
            if (documentElement) {
                this.syncOutlineMarkers(documentElement, settings.includeToc);
            }
            this.commitSettings(settings);
        });
        mergeSubdocs.input.addEventListener("change", () => {
            settings.mergeSubdocs = mergeSubdocs.input.checked;
            this.commitSettings(settings);
            void this.refreshPreview(session);
        });
        keepFold.input.addEventListener("change", () => {
            settings.keepFold = keepFold.input.checked;
            this.commitSettings(settings);
            void this.refreshPreview(session);
        });
        exportButton.addEventListener("click", () => {
            void this.save(session);
        });
        copyButton.addEventListener("click", () => {
            void this.copy(session);
        });

        return session;
    }

    private async refreshPreview(session: PdfExportSession) {
        const sequence = ++session.requestSequence;
        this.setActionsDisabled(session, true);
        session.statusElement.textContent = this.plugin.i18n.pdfExportLoading;
        session.previewElement.replaceChildren(this.createLoading());

        try {
            const response = await fetchSyncPost("/api/export/exportPreviewHTML", {
                id: session.documentId,
                keepFold: session.settings.keepFold,
                merge: session.settings.mergeSubdocs,
            });
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.pdfExportLoadFailed);
            }
            if (!session.active || sequence !== session.requestSequence) {
                return;
            }

            const data = parsePreviewData(response.data);
            const documentElement = this.createDocument(data, session.settings.includeToc);
            session.previewElement.replaceChildren(documentElement);
            session.nameElement.textContent = data.name;
            this.renderRichContent(documentElement);
            session.statusElement.textContent = this.plugin.i18n.pdfExportReady;
            this.setActionsDisabled(session, false);
        } catch (error) {
            if (!session.active || sequence !== session.requestSequence) {
                return;
            }
            const message = errorMessage(error);
            const errorElement = document.createElement("div");
            errorElement.className = "stillmark-pdf-export__error";
            errorElement.textContent = `${this.plugin.i18n.pdfExportLoadFailed}: ${message}`;
            session.previewElement.replaceChildren(errorElement);
            session.statusElement.textContent = this.plugin.i18n.pdfExportUnavailable;
            showMessage(`${this.plugin.i18n.pdfExportLoadFailed}: ${message}`, 5000, "error");
        }
    }

    private createDocument(data: ExportPreviewData, includeToc: boolean) {
        const article = document.createElement("article");
        article.className = "stillmark-pdf-document";

        const header = document.createElement("header");
        header.className = "stillmark-pdf-document__header";
        const title = document.createElement("h1");
        title.textContent = data.name;
        const rule = document.createElement("span");
        rule.setAttribute("aria-hidden", "true");
        header.append(title, rule);

        const content = document.createElement("div");
        content.className = "protyle-wysiwyg stillmark-pdf-document__content";
        content.dataset.docType = data.type || "NodeDocument";
        Object.entries(data.attrs ?? {}).forEach(([name, value]) => content.setAttribute(name, value));
        content.innerHTML = data.content;
        this.removeDuplicateTitle(content, data.name);

        article.append(header, content);
        this.syncOutlineMarkers(article, includeToc);
        return article;
    }

    private syncOutlineMarkers(article: HTMLElement, includeOutline: boolean) {
        const content = article.querySelector<HTMLElement>(".stillmark-pdf-document__content");
        if (!content) {
            return;
        }
        const headings = [...content.querySelectorAll<HTMLElement>(OUTLINE_HEADING_SELECTOR)]
            .filter((heading) => normalizeText(heading.textContent));

        headings.forEach((heading, index) => {
            const headingId = heading.id || heading.dataset.nodeId || `stillmark-pdf-heading-${index + 1}`;
            heading.id = headingId;
            heading.querySelector(':scope a[data-stillmark-pdf-outline="true"]')?.remove();
            if (!includeOutline) {
                return;
            }
            const marker = document.createElement("a");
            marker.dataset.stillmarkPdfOutline = "true";
            marker.href = `pdf-outline://${headingId}`;
            marker.target = "_blank";
            marker.textContent = " ";
            marker.setAttribute("aria-hidden", "true");
            const headingContent = heading.querySelector<HTMLElement>(":scope > [contenteditable]") ?? heading;
            headingContent.prepend(marker);
        });
    }

    private removeDuplicateTitle(content: HTMLElement, documentName: string) {
        const firstBlock = content.querySelector<HTMLElement>(':scope > [data-type="NodeHeading"]');
        if (firstBlock?.dataset.subtype !== "h1") {
            return;
        }
        if (normalizeText(firstBlock.textContent) === normalizeText(documentName)) {
            firstBlock.remove();
        }
    }

    private renderRichContent(root: HTMLElement) {
        const content = root.querySelector<HTMLElement>(".stillmark-pdf-document__content");
        if (!content) {
            return;
        }
        const renderers = [
            () => ProtyleMethod.mermaidRender(content),
            () => ProtyleMethod.flowchartRender(content),
            () => ProtyleMethod.graphvizRender(content),
            () => ProtyleMethod.chartRender(content),
            () => ProtyleMethod.mindmapRender(content),
            () => ProtyleMethod.abcRender(content),
            () => ProtyleMethod.htmlRender(content),
            () => ProtyleMethod.plantumlRender(content),
            () => ProtyleMethod.highlightRender(content, undefined, 1),
            () => ProtyleMethod.mathRender(content, undefined, true),
        ];
        renderers.forEach((render) => {
            try {
                render();
            } catch (error) {
                console.warn("Stillmark PDF renderer skipped a block", error);
            }
        });
    }

    private async save(session: PdfExportSession) {
        if (!this.canStartAction(session)) {
            return;
        }
        this.setActionsDisabled(session, true);
        session.statusElement.textContent = this.plugin.i18n.pdfExportChoosingLocation;

        try {
            const desktop = getDesktopExportServices();
            if (!desktop) {
                throw new Error(this.plugin.i18n.pdfExportDirectUnavailable);
            }
            const filename = `${sanitizePdfFilename(session.nameElement.textContent)}.pdf`;
            const saveResult = await desktop.invoke(Constants.SIYUAN_GET, {
                cmd: "showSaveDialog",
                title: this.plugin.i18n.pdfExportSaveDialogTitle,
                defaultPath: desktop.defaultPath(filename),
                buttonLabel: this.plugin.i18n.pdfExportSave,
                filters: [{name: "PDF", extensions: ["pdf"]}],
                properties: ["showOverwriteConfirmation", "createDirectory"],
            }) as SaveDialogResult;
            if (saveResult.canceled) {
                session.statusElement.textContent = this.plugin.i18n.pdfExportReady;
                return;
            }
            if (!saveResult.filePath) {
                throw new Error(this.plugin.i18n.pdfExportUnavailable);
            }
            const filePath = ensurePdfExtension(saveResult.filePath);
            const pdfData = await this.generatePdf(session, desktop);
            if (!pdfData) {
                return;
            }
            await desktop.writeFile(filePath, pdfData);
            session.statusElement.textContent = this.plugin.i18n.pdfExportSaved;
            showMessage(this.plugin.i18n.pdfExportSavedPath.replace("${path}", filePath), 5000);
        } catch (error) {
            const message = errorMessage(error);
            if (session.active) {
                showMessage(`${this.plugin.i18n.pdfExportFailed}: ${message}`, 5000, "error");
                session.statusElement.textContent = this.plugin.i18n.pdfExportReady;
            }
        } finally {
            if (session.active) {
                this.setActionsDisabled(session, false);
            }
        }
    }

    private async copy(session: PdfExportSession) {
        if (!this.canStartAction(session)) {
            return;
        }
        this.setActionsDisabled(session, true);

        try {
            const desktop = getDesktopExportServices();
            if (!desktop?.copyPdfFile) {
                throw new Error(this.plugin.i18n.pdfExportCopyUnavailable);
            }
            const pdfData = await this.generatePdf(session, desktop);
            if (!pdfData) {
                return;
            }
            const filename = `${sanitizePdfFilename(session.nameElement.textContent)}.pdf`;
            const copiedFile = await desktop.copyPdfFile(
                filename,
                pdfData,
                this.plugin.i18n.pdfExportCopyVerificationFailed,
            );
            const previousTempDirectory = this.copiedPdfTempDirectory;
            this.copiedPdfTempDirectory = copiedFile.tempDirectory;
            if (previousTempDirectory && desktop.removeTempDirectory) {
                void desktop.removeTempDirectory(previousTempDirectory).catch((error) => {
                    console.warn("Failed to remove the previous Stillmark copied PDF", error);
                });
            }
            session.statusElement.textContent = this.plugin.i18n.pdfExportCopied;
            showMessage(this.plugin.i18n.pdfExportCopied, 4000);
        } catch (error) {
            const message = errorMessage(error);
            if (session.active) {
                showMessage(`${this.plugin.i18n.pdfExportCopyFailed}: ${message}`, 5000, "error");
                session.statusElement.textContent = this.plugin.i18n.pdfExportReady;
            }
        } finally {
            if (session.active) {
                this.setActionsDisabled(session, false);
            }
        }
    }

    private async generatePdf(
        session: PdfExportSession,
        desktop: DesktopExportServices,
    ): Promise<Uint8Array | undefined> {
        session.statusElement.textContent = this.plugin.i18n.pdfExportPreparing;
        await waitForContent(session.previewElement);
        if (!session.active) {
            return undefined;
        }

        this.cleanupPrintRoot();
        try {
            const printRoot = document.createElement("div");
            printRoot.className = PRINT_ROOT_CLASS;
            printRoot.dataset.preset = session.settings.preset;
            printRoot.dataset.pageSize = session.settings.pageSize;
            printRoot.dataset.margin = session.settings.margin;
            this.applySelectedFont(printRoot, session.settings, session.currentFontCss);
            const documentElement = session.previewElement.querySelector<HTMLElement>(".stillmark-pdf-document");
            if (!documentElement) {
                throw new Error(this.plugin.i18n.pdfExportUnavailable);
            }
            const clonedDocument = documentElement.cloneNode(true) as HTMLElement;
            copyCanvasContent(documentElement, clonedDocument);
            const outlineHeadings = collectPdfOutlineHeadings(clonedDocument);
            printRoot.append(clonedDocument);

            const pageStyle = document.createElement("style");
            pageStyle.id = PRINT_PAGE_STYLE_ID;
            pageStyle.textContent = `@page { size: ${session.settings.pageSize} portrait; margin: ${
                PAGE_MARGINS[session.settings.margin]
            }; }`;
            document.head.append(pageStyle);
            document.body.classList.add(PRINTING_BODY_CLASS);
            document.body.append(printRoot);
            await waitForContent(printRoot);
            if (!session.active) {
                return undefined;
            }

            const webContentsId = await desktop.invoke(Constants.SIYUAN_GET, {cmd: "getContentsId"});
            if (typeof webContentsId !== "number" || !Number.isInteger(webContentsId)) {
                throw new Error(this.plugin.i18n.pdfExportUnavailable);
            }
            const rawPdfData = await desktop.invoke(Constants.SIYUAN_GET, {
                cmd: "printToPDF",
                webContentsId,
                pdfOptions: {
                    displayHeaderFooter: false,
                    landscape: false,
                    margins: {top: 0, bottom: 0, left: 0, right: 0},
                    pageSize: session.settings.pageSize,
                    preferCSSPageSize: true,
                    printBackground: true,
                    scale: 1,
                },
            });
            if (!(rawPdfData instanceof Uint8Array) || rawPdfData.byteLength === 0) {
                throw new Error(this.plugin.i18n.pdfExportUnavailable);
            }
            if (!session.settings.includeToc) {
                return rawPdfData;
            }

            session.statusElement.textContent = this.plugin.i18n.pdfExportProcessingOutline;
            try {
                return await addPdfOutline(rawPdfData, outlineHeadings);
            } catch (error) {
                throw new Error(`${this.plugin.i18n.pdfExportOutlineFailed}: ${errorMessage(error)}`, {
                    cause: error,
                });
            }
        } finally {
            this.cleanupPrintRoot();
        }
    }

    private canStartAction(session: PdfExportSession) {
        return session.active && !session.copyButton.disabled && !session.exportButton.disabled;
    }

    private setActionsDisabled(session: PdfExportSession, disabled: boolean) {
        session.copyButton.disabled = disabled;
        session.exportButton.disabled = disabled;
    }

    private createSelect(labelText: string, options: string[][], value: string) {
        const label = document.createElement("label");
        label.className = "stillmark-pdf-export__field";
        const text = document.createElement("span");
        text.textContent = labelText;
        const select = document.createElement("select");
        select.className = "b3-select";
        options.forEach(([optionValue, optionLabel]) => {
            const option = document.createElement("option");
            option.value = optionValue;
            option.textContent = optionLabel;
            option.selected = optionValue === value;
            select.append(option);
        });
        label.append(text, select);
        return {label, select};
    }

    private createSwitch(labelText: string, checked: boolean) {
        const label = document.createElement("label");
        label.className = "stillmark-pdf-export__switch";
        const text = document.createElement("span");
        text.textContent = labelText;
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "b3-switch";
        input.checked = checked;
        label.append(text, input);
        return {label, input};
    }

    private createLoading() {
        const loading = document.createElement("div");
        loading.className = "stillmark-pdf-export__loading";
        loading.textContent = this.plugin.i18n.pdfExportLoading;
        return loading;
    }

    private async loadSystemFonts() {
        const response = await fetchSyncPost("/api/system/getSysFonts", {});
        if (response.code !== 0) {
            throw new Error(response.msg || this.plugin.i18n.pdfExportFontLoadFailed);
        }
        if (!Array.isArray(response.data)) {
            throw new Error(this.plugin.i18n.pdfExportFontLoadFailed);
        }
        const fonts = new Map<string, SystemFont>();
        response.data.forEach((font) => {
            if (!font || typeof font.family !== "string" || !font.family) {
                return;
            }
            fonts.set(font.family, {
                family: font.family,
                displayName: typeof font.displayName === "string" && font.displayName ? font.displayName : font.family,
            });
        });
        return [...fonts.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
    }

    private applySelectedFont(element: HTMLElement, settings: PdfExportSettings, currentFontCss: string) {
        const fontCss = settings.fontFamily ?
            `"${escapeCssString(settings.fontFamily)}", sans-serif` :
            currentFontCss;
        element.style.setProperty("--stillmark-pdf-selected-font", fontCss);
    }

    private presetLabel(preset: PdfPreset) {
        if (preset === "minimal") {
            return this.plugin.i18n.pdfExportPresetMinimal;
        }
        if (preset === "report") {
            return this.plugin.i18n.pdfExportPresetReport;
        }
        return this.plugin.i18n.pdfExportPresetReader;
    }

    private async loadSettings() {
        try {
            const saved = await this.plugin.loadData(PDF_EXPORT_STORAGE);
            this.settings = parseSettings(saved);
        } catch (error) {
            console.warn("Failed to load Stillmark PDF settings", error);
        }
    }

    private commitSettings(settings: PdfExportSettings) {
        this.settings = {...settings, fontFamily: ""};
        void this.plugin.saveData(PDF_EXPORT_STORAGE, this.settings).catch((error) => {
            showMessage(`${this.plugin.i18n.pdfExportSettingsSaveFailed}: ${errorMessage(error)}`, 5000, "error");
        });
    }

    private cleanupPrintRoot() {
        document.body.classList.remove(PRINTING_BODY_CLASS);
        document.querySelector(`body > .${PRINT_ROOT_CLASS}`)?.remove();
        document.getElementById(PRINT_PAGE_STYLE_ID)?.remove();
    }
}

function parsePreviewData(value: unknown): ExportPreviewData {
    if (!value || typeof value !== "object") {
        throw new Error("Invalid export preview response");
    }
    const data = value as Record<string, unknown>;
    if (typeof data.content !== "string" || typeof data.name !== "string") {
        throw new Error("Invalid export preview response");
    }
    const attrs = data.attrs && typeof data.attrs === "object" ? data.attrs as Record<string, string> : undefined;
    return {
        attrs,
        content: data.content,
        name: data.name,
        type: typeof data.type === "string" ? data.type : undefined,
    };
}

function parseSettings(value: unknown): PdfExportSettings {
    if (!value || typeof value !== "object") {
        return {...DEFAULT_SETTINGS};
    }
    const saved = value as Record<string, unknown>;
    return {
        preset: ["reader", "minimal", "report"].includes(String(saved.preset)) ? saved.preset as PdfPreset : "reader",
        pageSize: ["A4", "A5", "Letter"].includes(String(saved.pageSize)) ? saved.pageSize as PdfPageSize : "A4",
        margin: ["balanced", "compact"].includes(String(saved.margin)) ? saved.margin as PdfMargin : "balanced",
        fontFamily: typeof saved.fontFamily === "string" ? saved.fontFamily : "",
        includeToc: saved.includeToc !== false,
        mergeSubdocs: saved.mergeSubdocs === true,
        keepFold: saved.keepFold === true,
    };
}

async function waitForContent(root: HTMLElement) {
    const images = [...root.querySelectorAll<HTMLImageElement>("img")];
    await Promise.all(images.map((image) => {
        if (image.complete) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            const done = () => resolve();
            image.addEventListener("load", done, {once: true});
            image.addEventListener("error", done, {once: true});
            window.setTimeout(done, 8000);
        });
    }));
    await document.fonts?.ready;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
}

function copyCanvasContent(sourceRoot: HTMLElement, targetRoot: HTMLElement) {
    const sourceCanvases = sourceRoot.querySelectorAll<HTMLCanvasElement>("canvas");
    const targetCanvases = targetRoot.querySelectorAll<HTMLCanvasElement>("canvas");
    sourceCanvases.forEach((canvas, index) => {
        const target = targetCanvases[index];
        if (!target) {
            return;
        }
        target.width = canvas.width;
        target.height = canvas.height;
        target.getContext("2d")?.drawImage(canvas, 0, 0);
    });
}

function collectPdfOutlineHeadings(root: HTMLElement): PdfOutlineHeading[] {
    return [...root.querySelectorAll<HTMLElement>(OUTLINE_HEADING_SELECTOR)]
        .map((heading, index) => ({
            id: heading.id || heading.dataset.nodeId || `stillmark-pdf-heading-${index + 1}`,
            level: Number(heading.dataset.subtype?.slice(1)) || 1,
            title: normalizeText(heading.textContent),
        }))
        .filter((heading) => heading.title);
}

function normalizeText(value: string | null) {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

function sanitizePdfFilename(value: string | null) {
    const filename = normalizeText(value)
        .replace(/[\\/:*?"<>|]/g, "-")
        .split("")
        .map((character) => character.charCodeAt(0) < 32 ? "-" : character)
        .join("")
        .replace(/[.\s]+$/g, "")
        .slice(0, 120);
    return filename || "document";
}

function ensurePdfExtension(path: string) {
    return path.toLowerCase().endsWith(".pdf") ? path : `${path}.pdf`;
}

function getDesktopExportServices(): DesktopExportServices | undefined {
    if (!["desktop", "desktop-window"].includes(getFrontend())) {
        return undefined;
    }
    try {
        const {ipcRenderer} = require("electron") as {
            ipcRenderer?: {invoke: DesktopExportServices["invoke"];};
        };
        const {mkdtemp, realpath, rm, writeFile} = require("node:fs/promises") as {
            mkdtemp?: (prefix: string) => Promise<string>;
            realpath?: (path: string) => Promise<string>;
            rm?: (path: string, options: {force: boolean; recursive: boolean;}) => Promise<void>;
            writeFile?: DesktopExportServices["writeFile"];
        };
        const {homedir, tmpdir} = require("node:os") as {
            homedir?: () => string;
            tmpdir?: () => string;
        };
        const {join} = require("node:path") as {join?: (...paths: string[]) => string;};
        if (!ipcRenderer?.invoke || !writeFile || !homedir || !join) {
            return undefined;
        }
        const copyPdfFile = process.platform === "darwin" && mkdtemp && realpath && rm && tmpdir ?
            createMacPdfFileCopier({join, mkdtemp, realpath, rm, tmpdir, writeFile}) :
            undefined;
        return {
            copyPdfFile,
            defaultPath: (filename) => join(homedir(), "Downloads", filename),
            invoke: ipcRenderer.invoke.bind(ipcRenderer),
            removeTempDirectory: rm ?
                (path) => rm(path, {force: true, recursive: true}) :
                undefined,
            writeFile,
        };
    } catch (error) {
        console.warn("Stillmark direct PDF export is unavailable", error);
        return undefined;
    }
}

interface MacPdfFileCopierDependencies {
    join: (...paths: string[]) => string;
    mkdtemp: (prefix: string) => Promise<string>;
    realpath: (path: string) => Promise<string>;
    rm: (path: string, options: {force: boolean; recursive: boolean;}) => Promise<void>;
    tmpdir: () => string;
    writeFile: DesktopExportServices["writeFile"];
}

type ExecFile = (
    file: string,
    args: string[],
    options: {encoding: "utf8"; timeout: number;},
    callback: (error: Error | null, stdout: string) => void,
) => unknown;

function createMacPdfFileCopier(dependencies: MacPdfFileCopierDependencies) {
    return async (
        filename: string,
        data: Uint8Array,
        verificationFailedMessage: string,
    ): Promise<CopiedPdfFile> => {
        const tempDirectory = await dependencies.mkdtemp(
            dependencies.join(dependencies.tmpdir(), "stillmark-workbench-pdf-"),
        );
        const filePath = dependencies.join(tempDirectory, filename);
        try {
            await dependencies.writeFile(filePath, data);
            const canonicalFilePath = await dependencies.realpath(filePath);
            const copiedPath = await copyMacFileToClipboard(canonicalFilePath);
            const canonicalCopiedPath = await dependencies.realpath(copiedPath);
            if (canonicalCopiedPath !== canonicalFilePath) {
                throw new Error(verificationFailedMessage);
            }
            return {
                tempDirectory,
            };
        } catch (error) {
            await dependencies.rm(tempDirectory, {force: true, recursive: true});
            throw error;
        }
    };
}

async function copyMacFileToClipboard(filePath: string) {
    const {execFile} = require("node:child_process") as {execFile?: ExecFile;};
    if (!execFile) {
        throw new Error("macOS file clipboard is unavailable");
    }
    const script = `on run argv
set sourceFile to POSIX file (item 1 of argv)
set the clipboard to sourceFile
set copiedFile to the clipboard as alias
return POSIX path of copiedFile
end run`;
    const copiedPath = await executeFile(execFile, "/usr/bin/osascript", ["-e", script, filePath]);
    return copiedPath.trim();
}

function executeFile(execFile: ExecFile, file: string, args: string[]) {
    return new Promise<string>((resolve, reject) => {
        execFile(file, args, {encoding: "utf8", timeout: 10000}, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

function getCurrentEditorFont(element: HTMLElement, defaultLabel: string): CurrentEditorFont {
    const configuredFamily = window.siyuan.config.editor.fontFamily;
    const computedFamily = getComputedStyle(element).fontFamily.trim();
    const css = computedFamily || (configuredFamily ?
        `"${escapeCssString(configuredFamily)}", var(--b3-font-family)` :
        "var(--b3-font-family)");
    return {
        css,
        displayName: window.siyuan.config.editor.fontFamilyDisplay || configuredFamily || defaultLabel,
    };
}

function escapeCssString(value: string) {
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"')
        .replace(/[\n\r\f]/g, " ");
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
