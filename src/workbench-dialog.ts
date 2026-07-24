import {
    Dialog,
    Plugin,
    getFrontend,
    showMessage,
} from "siyuan";
import {DailyNotesFeature} from "./daily-notes";
import {DocumentBreadcrumbFeature} from "./document-breadcrumb";
import {FontSwitcherFeature} from "./font-switcher";
import {InlineBacklinksFeature} from "./inline-backlinks";
import {PdfExportFeature} from "./pdf-export";

type StatusState = "primary" | "neutral" | "warning";

interface ToolOptions {
    title: string;
    description: string;
    status: string;
    statusState: StatusState;
    statusElement?: HTMLElement;
    controls?: HTMLElement[];
    details?: HTMLElement;
}

interface ToggleOptions {
    ariaLabel: string;
    disabledMessage: string;
    enabled: boolean;
    enabledMessage: string;
    label: string;
    saveFailedMessage: string;
    setEnabled: (enabled: boolean) => Promise<void>;
    status: HTMLElement;
}

const ROLE_DEFINITIONS = [
    {value: "note", labelKey: "roleNote"},
    {value: "tip", labelKey: "roleTip"},
    {value: "warning", labelKey: "roleWarning"},
    {value: "important", labelKey: "roleImportant"},
    {value: "muted", labelKey: "roleMuted"},
];

export class WorkbenchDialogFeature {
    constructor(
        private readonly plugin: Plugin,
        private readonly dailyNotes: DailyNotesFeature,
        private readonly documentBreadcrumb: DocumentBreadcrumbFeature,
        private readonly inlineBacklinks: InlineBacklinksFeature,
        private readonly fontSwitcher: FontSwitcherFeature,
        private readonly pdfExport: PdfExportFeature,
    ) {}

    async open() {
        const [
            dailyNotesStatus,
            autoLocateInTree,
            documentBreadcrumbEnabled,
            inlineBacklinksEnabled,
        ] = await Promise.all([
            this.dailyNotes.getConfigurationStatus().catch(() => "unavailable" as const),
            this.dailyNotes.shouldAutoLocateInTreeOnOpen().catch(() => false),
            this.documentBreadcrumb.isEnabled(),
            this.inlineBacklinks.isEnabled(),
        ]);
        const isMobile = ["mobile", "browser-mobile"].includes(getFrontend());
        const dialog = new Dialog({
            title: this.plugin.i18n.workbenchTitle,
            content: '<div class="b3-dialog__content stillmark-workbench"></div>',
            width: isMobile ? "92vw" : "600px",
        });
        const root = dialog.element.querySelector<HTMLElement>(".stillmark-workbench");
        if (!root) {
            return;
        }

        const dailyNotesButton = this.createButton(this.plugin.i18n.configure, () => {
            dialog.destroy();
            this.dailyNotes.openDailyNotesSettings(() => {
                void this.open();
            });
        });
        const dailyNotesStatusPresentation = this.dailyNotesStatusPresentation(dailyNotesStatus);
        root.append(this.createTool({
            title: this.plugin.i18n.dailyNotesTool,
            description: this.plugin.i18n.dailyNotesToolDescription,
            status: dailyNotesStatusPresentation.label,
            statusState: dailyNotesStatusPresentation.state,
            controls: [dailyNotesButton],
        }));

        const autoLocateStatus = this.createStatus(
            autoLocateInTree ? this.plugin.i18n.settingEnabled : this.plugin.i18n.settingDisabled,
            autoLocateInTree ? "primary" : "neutral",
        );
        const autoLocateControl = this.createToggleControl({
            ariaLabel: this.plugin.i18n.documentTreeAutoFocus,
            disabledMessage: this.plugin.i18n.documentTreeAutoFocusDisabled,
            enabled: autoLocateInTree,
            enabledMessage: this.plugin.i18n.documentTreeAutoFocusEnabled,
            label: this.plugin.i18n.autoLocate,
            saveFailedMessage: this.plugin.i18n.documentTreeAutoFocusSaveFailed,
            setEnabled: (enabled) => this.dailyNotes.setAutoLocateInTreeOnOpen(enabled),
            status: autoLocateStatus,
        });
        const documentTreeButton = this.createButton(this.plugin.i18n.configure, () => {
            dialog.destroy();
            this.dailyNotes.openDocumentTreeFocusSettings(() => {
                void this.open();
            });
        });
        root.append(this.createTool({
            title: this.plugin.i18n.documentTreeFocusSettings,
            description: this.plugin.i18n.documentTreeFocusToolDescription,
            status: autoLocateStatus.textContent,
            statusState: autoLocateStatus.dataset.state as StatusState,
            statusElement: autoLocateStatus,
            controls: [autoLocateControl, documentTreeButton],
        }));

        root.append(this.createTool({
            title: this.plugin.i18n.documentFindTool,
            description: this.plugin.i18n.documentFindToolDescription,
            status: this.plugin.i18n.available,
            statusState: "primary",
        }));

        const documentBreadcrumbStatus = this.createStatus(
            documentBreadcrumbEnabled ? this.plugin.i18n.settingEnabled : this.plugin.i18n.settingDisabled,
            documentBreadcrumbEnabled ? "primary" : "neutral",
        );
        const documentBreadcrumbControl = this.createToggleControl({
            ariaLabel: this.plugin.i18n.documentBreadcrumbTool,
            disabledMessage: this.plugin.i18n.documentBreadcrumbDisabled,
            enabled: documentBreadcrumbEnabled,
            enabledMessage: this.plugin.i18n.documentBreadcrumbEnabled,
            label: this.plugin.i18n.showFeature,
            saveFailedMessage: this.plugin.i18n.documentBreadcrumbSaveFailed,
            setEnabled: (enabled) => this.documentBreadcrumb.setEnabled(enabled),
            status: documentBreadcrumbStatus,
        });
        root.append(this.createTool({
            title: this.plugin.i18n.documentBreadcrumbTool,
            description: this.plugin.i18n.documentBreadcrumbToolDescription,
            status: documentBreadcrumbStatus.textContent,
            statusState: documentBreadcrumbStatus.dataset.state as StatusState,
            statusElement: documentBreadcrumbStatus,
            controls: [documentBreadcrumbControl],
        }));

        const inlineBacklinksStatus = this.createStatus(
            inlineBacklinksEnabled ? this.plugin.i18n.settingEnabled : this.plugin.i18n.settingDisabled,
            inlineBacklinksEnabled ? "primary" : "neutral",
        );
        const inlineBacklinksControl = this.createToggleControl({
            ariaLabel: this.plugin.i18n.inlineBacklinksTool,
            disabledMessage: this.plugin.i18n.inlineBacklinksDisabled,
            enabled: inlineBacklinksEnabled,
            enabledMessage: this.plugin.i18n.inlineBacklinksEnabled,
            label: this.plugin.i18n.showFeature,
            saveFailedMessage: this.plugin.i18n.inlineBacklinksSaveFailed,
            setEnabled: (enabled) => this.inlineBacklinks.setEnabled(enabled),
            status: inlineBacklinksStatus,
        });
        root.append(this.createTool({
            title: this.plugin.i18n.inlineBacklinksTool,
            description: this.plugin.i18n.inlineBacklinksToolDescription,
            status: inlineBacklinksStatus.textContent,
            statusState: inlineBacklinksStatus.dataset.state as StatusState,
            statusElement: inlineBacklinksStatus,
            controls: [inlineBacklinksControl],
        }));

        const chooseFontButton = this.createButton(this.plugin.i18n.fontSwitcherChoose, () => {
            const anchor = chooseFontButton.getBoundingClientRect();
            void this.fontSwitcher.open(anchor);
        });
        root.append(this.createTool({
            title: this.plugin.i18n.fontSwitcherTool,
            description: this.plugin.i18n.fontSwitcherToolDescription,
            status: this.fontSwitcher.getCurrentFontName(),
            statusState: "neutral",
            controls: [chooseFontButton],
        }));

        const exportPdfButton = this.createButton(this.plugin.i18n.pdfExportPreviewAction, () => {
            dialog.destroy();
            void this.pdfExport.open();
        });
        root.append(this.createTool({
            title: this.plugin.i18n.pdfExportTool,
            description: this.plugin.i18n.pdfExportToolDescription,
            status: this.pdfExport.getStatusLabel(),
            statusState: "primary",
            controls: [exportPdfButton],
        }));

        root.append(this.createTool({
            title: this.plugin.i18n.blockRoles,
            description: this.plugin.i18n.blockRolesDescription,
            status: this.plugin.i18n.available,
            statusState: "primary",
            details: this.createRoleDetails(),
        }));
    }

    private createTool(options: ToolOptions) {
        const section = document.createElement("section");
        section.className = "stillmark-workbench__tool";

        const header = document.createElement("div");
        header.className = "stillmark-workbench__tool-header";

        const copy = document.createElement("div");
        copy.className = "stillmark-workbench__tool-copy";
        const title = document.createElement("div");
        title.className = "stillmark-workbench__tool-name";
        title.textContent = options.title;
        const description = document.createElement("div");
        description.className = "stillmark-workbench__tool-description";
        description.textContent = options.description;
        copy.append(title, description);

        const controls = document.createElement("div");
        controls.className = "stillmark-workbench__controls";
        controls.append(
            options.statusElement ?? this.createStatus(options.status, options.statusState),
            ...(options.controls ?? []),
        );
        header.append(copy, controls);
        section.append(header);
        if (options.details) {
            section.append(options.details);
        }
        return section;
    }

    private createStatus(label: string, state: StatusState) {
        const status = document.createElement("span");
        status.className = "stillmark-workbench__status";
        this.syncStatus(status, label, state);
        return status;
    }

    private syncStatus(status: HTMLElement, label: string, state: StatusState) {
        status.textContent = label;
        status.dataset.state = state;
    }

    private createButton(label: string, callback: () => void) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "b3-button b3-button--cancel stillmark-workbench__button";
        button.textContent = label;
        button.addEventListener("click", callback);
        return button;
    }

    private createToggleControl(options: ToggleOptions) {
        const label = document.createElement("label");
        label.className = "stillmark-workbench__switch";

        const text = document.createElement("span");
        text.textContent = options.label;
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "b3-switch";
        input.checked = options.enabled;
        input.setAttribute("aria-label", options.ariaLabel);
        input.addEventListener("change", () => {
            const requestedState = input.checked;
            input.disabled = true;
            void options.setEnabled(requestedState).then(() => {
                this.syncStatus(
                    options.status,
                    requestedState ? this.plugin.i18n.settingEnabled : this.plugin.i18n.settingDisabled,
                    requestedState ? "primary" : "neutral",
                );
                showMessage(
                    requestedState ? options.enabledMessage : options.disabledMessage,
                    3000,
                );
            }).catch((error) => {
                input.checked = !requestedState;
                showMessage(
                    `${options.saveFailedMessage}: ${errorMessage(error)}`,
                    5000,
                    "error",
                );
            }).finally(() => {
                input.disabled = false;
            });
        });
        label.append(text, input);
        return label;
    }

    private createRoleDetails() {
        const details = document.createElement("div");
        details.className = "stillmark-workbench__details";
        const roles = document.createElement("div");
        roles.className = "stillmark-workbench__roles";
        roles.setAttribute("aria-label", this.plugin.i18n.blockRoles);
        ROLE_DEFINITIONS.forEach((role) => {
            const chip = document.createElement("span");
            chip.dataset.role = role.value;
            chip.textContent = this.plugin.i18n[role.labelKey];
            roles.append(chip);
        });
        const usage = document.createElement("div");
        usage.className = "stillmark-workbench__usage";
        usage.textContent = this.plugin.i18n.blockRolesUsage;
        details.append(roles, usage);
        return details;
    }

    private dailyNotesStatusPresentation(status: "ready" | "not-configured" | "unavailable") {
        if (status === "ready") {
            return {label: this.plugin.i18n.settingConfigured, state: "primary" as const};
        }
        if (status === "not-configured") {
            return {label: this.plugin.i18n.settingNotConfigured, state: "warning" as const};
        }
        return {label: this.plugin.i18n.settingUnavailable, state: "warning" as const};
    }
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
