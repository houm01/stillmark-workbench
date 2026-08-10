import {
    Dialog,
    Plugin,
    getFrontend,
    showMessage,
} from "siyuan";
import {AnnotationsFeature} from "./annotations";
import {DailyNotesFeature} from "./daily-notes";
import {DocumentBreadcrumbFeature} from "./document-breadcrumb";
import {DocumentFindFeature} from "./document-find";
import {DocumentTreeFocusFeature} from "./document-tree-focus";
import {FontSwitcherFeature} from "./font-switcher";
import {InlineBacklinksFeature} from "./inline-backlinks";
import {PdfExportFeature} from "./pdf-export";
import {
    WorkbenchFeature,
    WorkbenchPreferences,
} from "./workbench-preferences";

type StatusState = "primary" | "neutral" | "warning";

interface ToolOptions {
    title: string;
    description: string;
    status?: string;
    statusState?: StatusState;
    statusElement?: HTMLElement;
    controls?: HTMLElement[];
    details?: HTMLElement;
}

interface ToggleOptions {
    ariaLabel: string;
    dependents?: HTMLElement[];
    disabled?: boolean;
    disabledMessage: string;
    enabled: boolean;
    enabledMessage: string;
    label: string;
    saveFailedMessage: string;
    setEnabled: (enabled: boolean) => Promise<void>;
    status?: HTMLElement;
}

interface ToggleUpdateOptions {
    announce?: boolean;
    keepDisabled?: boolean;
}

interface FeatureToggleHandle {
    control: HTMLElement;
    input: HTMLInputElement;
    title: string;
}

type ToggleUpdater = (enabled: boolean, options?: ToggleUpdateOptions) => Promise<void>;

const ROLE_DEFINITIONS = [
    {value: "note", labelKey: "roleNote"},
    {value: "tip", labelKey: "roleTip"},
    {value: "warning", labelKey: "roleWarning"},
    {value: "important", labelKey: "roleImportant"},
    {value: "muted", labelKey: "roleMuted"},
];

export class WorkbenchDialogFeature {
    private readonly toggleUpdaters = new WeakMap<HTMLElement, ToggleUpdater>();

    constructor(
        private readonly plugin: Plugin,
        private readonly annotations: AnnotationsFeature,
        private readonly dailyNotes: DailyNotesFeature,
        private readonly documentFind: DocumentFindFeature,
        private readonly documentBreadcrumb: DocumentBreadcrumbFeature,
        private readonly documentTreeFocus: DocumentTreeFocusFeature,
        private readonly inlineBacklinks: InlineBacklinksFeature,
        private readonly fontSwitcher: FontSwitcherFeature,
        private readonly pdfExport: PdfExportFeature,
        private readonly preferences: WorkbenchPreferences,
    ) {}

    async open() {
        const [
            dailyNotesStatus,
            autoLocateInTree,
            dailyNotesEnabled,
            documentTreeFocusEnabled,
            documentFindEnabled,
            annotationsEnabled,
            documentBreadcrumbEnabled,
            inlineBacklinksEnabled,
            fontSwitcherEnabled,
            pdfExportEnabled,
            blockRolesEnabled,
        ] = await Promise.all([
            this.dailyNotes.getConfigurationStatus().catch(() => "unavailable" as const),
            this.dailyNotes.shouldAutoLocateInTreeOnOpen().catch(() => false),
            this.dailyNotes.isEnabled(),
            this.documentTreeFocus.isEnabled(),
            this.documentFind.isEnabled(),
            this.annotations.isEnabled(),
            this.documentBreadcrumb.isEnabled(),
            this.inlineBacklinks.isEnabled(),
            this.fontSwitcher.isEnabled(),
            this.pdfExport.isEnabled(),
            this.preferences.isFeatureEnabled("blockRoles"),
        ]);
        const isMobile = ["mobile", "browser-mobile"].includes(getFrontend());
        const dialog = new Dialog({
            title: this.plugin.i18n.workbenchTitle,
            content: '<div class="b3-dialog__content stillmark-workbench"></div>',
            width: isMobile ? "calc(100vw - 16px)" : "min(680px, calc(100vw - 24px))",
        });
        dialog.element.classList.add("stillmark-workbench-dialog");
        const root = dialog.element.querySelector<HTMLElement>(".stillmark-workbench");
        if (!root) {
            return;
        }
        const featureToggles: FeatureToggleHandle[] = [];

        const dailyNotesButton = this.createButton(this.plugin.i18n.configure, () => {
            dialog.destroy();
            this.dailyNotes.openDailyNotesSettings(() => {
                void this.open();
            });
        });
        const dailyNotesStatusPresentation = this.dailyNotesStatusPresentation(dailyNotesStatus);
        const dailyNotesToggle = this.createFeatureToggle(
            "dailyNotes",
            this.plugin.i18n.dailyNotesTool,
            dailyNotesEnabled,
            (enabled) => this.dailyNotes.setEnabled(enabled),
            [],
            featureToggles,
        );
        root.append(this.createTool({
            title: this.plugin.i18n.dailyNotesTool,
            description: this.plugin.i18n.dailyNotesToolDescription,
            status: dailyNotesStatusPresentation.label,
            statusState: dailyNotesStatusPresentation.state,
            controls: [dailyNotesToggle, dailyNotesButton],
        }));

        const autoLocateControl = this.createToggleControl({
            ariaLabel: this.plugin.i18n.documentTreeAutoFocus,
            disabled: !documentTreeFocusEnabled,
            disabledMessage: this.plugin.i18n.documentTreeAutoFocusDisabled,
            enabled: autoLocateInTree,
            enabledMessage: this.plugin.i18n.documentTreeAutoFocusEnabled,
            label: this.plugin.i18n.autoLocate,
            saveFailedMessage: this.plugin.i18n.documentTreeAutoFocusSaveFailed,
            setEnabled: (enabled) => this.dailyNotes.setAutoLocateInTreeOnOpen(enabled),
        });
        const documentTreeButton = this.createButton(this.plugin.i18n.configure, () => {
            dialog.destroy();
            this.dailyNotes.openDocumentTreeFocusSettings(() => {
                void this.open();
            });
        });
        const documentTreeToggle = this.createFeatureToggle(
            "documentTreeFocus",
            this.plugin.i18n.documentTreeFocusSettings,
            documentTreeFocusEnabled,
            (enabled) => this.documentTreeFocus.setEnabled(enabled),
            [autoLocateControl],
            featureToggles,
        );
        root.append(this.createTool({
            title: this.plugin.i18n.documentTreeFocusSettings,
            description: this.plugin.i18n.documentTreeFocusToolDescription,
            controls: [documentTreeToggle, autoLocateControl, documentTreeButton],
        }));

        const documentFindToggle = this.createFeatureToggle(
            "documentFind",
            this.plugin.i18n.documentFindTool,
            documentFindEnabled,
            (enabled) => this.documentFind.setEnabled(enabled),
            [],
            featureToggles,
        );
        root.append(this.createTool({
            title: this.plugin.i18n.documentFindTool,
            description: this.plugin.i18n.documentFindToolDescription,
            controls: [documentFindToggle],
        }));

        const annotationButton = this.createButton(this.plugin.i18n.annotationCreate, () => {
            dialog.destroy();
            this.annotations.createFromCurrentSelection(true);
        });
        annotationButton.disabled = !annotationsEnabled;
        const annotationsToggle = this.createFeatureToggle(
            "annotations",
            this.plugin.i18n.annotationTool,
            annotationsEnabled,
            (enabled) => this.annotations.setEnabled(enabled),
            [annotationButton],
            featureToggles,
        );
        root.append(this.createTool({
            title: this.plugin.i18n.annotationTool,
            description: this.plugin.i18n.annotationToolDescription,
            controls: [annotationsToggle, annotationButton],
        }));

        const documentBreadcrumbControl = this.createFeatureToggle(
            "documentBreadcrumb",
            this.plugin.i18n.documentBreadcrumbTool,
            documentBreadcrumbEnabled,
            (enabled) => this.documentBreadcrumb.setEnabled(enabled),
            [],
            featureToggles,
        );
        root.append(this.createTool({
            title: this.plugin.i18n.documentBreadcrumbTool,
            description: this.plugin.i18n.documentBreadcrumbToolDescription,
            controls: [documentBreadcrumbControl],
        }));

        const inlineBacklinksControl = this.createFeatureToggle(
            "inlineBacklinks",
            this.plugin.i18n.inlineBacklinksTool,
            inlineBacklinksEnabled,
            (enabled) => this.inlineBacklinks.setEnabled(enabled),
            [],
            featureToggles,
        );
        root.append(this.createTool({
            title: this.plugin.i18n.inlineBacklinksTool,
            description: this.plugin.i18n.inlineBacklinksToolDescription,
            controls: [inlineBacklinksControl],
        }));

        const chooseFontButton = this.createButton(this.plugin.i18n.fontSwitcherChoose, () => {
            const anchor = chooseFontButton.getBoundingClientRect();
            void this.fontSwitcher.open(anchor);
        });
        chooseFontButton.disabled = !fontSwitcherEnabled;
        const fontSwitcherToggle = this.createFeatureToggle(
            "fontSwitcher",
            this.plugin.i18n.fontSwitcherTool,
            fontSwitcherEnabled,
            (enabled) => this.fontSwitcher.setEnabled(enabled),
            [chooseFontButton],
            featureToggles,
        );
        root.append(this.createTool({
            title: this.plugin.i18n.fontSwitcherTool,
            description: this.plugin.i18n.fontSwitcherToolDescription,
            status: this.fontSwitcher.getCurrentFontName(),
            statusState: "neutral",
            controls: [fontSwitcherToggle, chooseFontButton],
        }));

        const exportPdfButton = this.createButton(this.plugin.i18n.pdfExportPreviewAction, () => {
            dialog.destroy();
            void this.pdfExport.open();
        });
        exportPdfButton.disabled = !pdfExportEnabled;
        const pdfExportToggle = this.createFeatureToggle(
            "pdfExport",
            this.plugin.i18n.pdfExportTool,
            pdfExportEnabled,
            (enabled) => this.pdfExport.setEnabled(enabled),
            [exportPdfButton],
            featureToggles,
        );
        root.append(this.createTool({
            title: this.plugin.i18n.pdfExportTool,
            description: this.plugin.i18n.pdfExportToolDescription,
            status: this.pdfExport.getStatusLabel(),
            statusState: "primary",
            controls: [pdfExportToggle, exportPdfButton],
        }));

        const blockRolesToggle = this.createFeatureToggle(
            "blockRoles",
            this.plugin.i18n.blockRoles,
            blockRolesEnabled,
            (enabled) => this.preferences.setFeatureEnabled("blockRoles", enabled),
            [],
            featureToggles,
        );
        root.append(this.createTool({
            title: this.plugin.i18n.blockRoles,
            description: this.plugin.i18n.blockRolesDescription,
            controls: [blockRolesToggle],
            details: this.createRoleDetails(),
        }));
        root.prepend(this.createBulkActions(featureToggles));
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
        if (options.statusElement) {
            controls.append(options.statusElement);
        } else if (options.status) {
            controls.append(this.createStatus(options.status, options.statusState ?? "neutral"));
        }
        controls.append(...(options.controls ?? []));
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

    private createFeatureToggle(
        feature: WorkbenchFeature,
        title: string,
        enabled: boolean,
        setEnabled: (enabled: boolean) => Promise<void>,
        dependents: HTMLElement[] = [],
        registry?: FeatureToggleHandle[],
    ) {
        const control = this.createToggleControl({
            ariaLabel: `${title} · ${this.plugin.i18n.enableFeature}`,
            dependents,
            disabledMessage: featureMessage(this.plugin.i18n.featureDisabled, title),
            enabled,
            enabledMessage: featureMessage(this.plugin.i18n.featureEnabled, title),
            label: this.plugin.i18n.enableFeature,
            saveFailedMessage: featureMessage(this.plugin.i18n.featureSaveFailed, title),
            setEnabled,
        });
        control.dataset.feature = feature;
        this.setControlsDisabled(dependents, !enabled);
        const input = control.querySelector<HTMLInputElement>("input.b3-switch");
        if (input) {
            registry?.push({control, input, title});
        }
        return control;
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
        input.disabled = options.disabled === true;
        input.setAttribute("aria-label", options.ariaLabel);
        const update: ToggleUpdater = async (requestedState, updateOptions = {}) => {
            input.checked = requestedState;
            input.disabled = true;
            try {
                await options.setEnabled(requestedState);
                if (options.status) {
                    this.syncStatus(
                        options.status,
                        requestedState ? this.plugin.i18n.settingEnabled : this.plugin.i18n.settingDisabled,
                        requestedState ? "primary" : "neutral",
                    );
                }
                this.setControlsDisabled(options.dependents ?? [], !requestedState);
                if (updateOptions.announce !== false) {
                    showMessage(
                        requestedState ? options.enabledMessage : options.disabledMessage,
                        3000,
                    );
                }
            } catch (error) {
                input.checked = !requestedState;
                if (updateOptions.announce !== false) {
                    showMessage(
                        `${options.saveFailedMessage}: ${errorMessage(error)}`,
                        5000,
                        "error",
                    );
                }
                throw error;
            } finally {
                if (!updateOptions.keepDisabled) {
                    input.disabled = false;
                }
            }
        };
        this.toggleUpdaters.set(label, update);
        input.addEventListener("change", () => {
            void update(input.checked).catch(() => undefined);
        });
        label.append(text, input);
        return label;
    }

    private createBulkActions(toggles: FeatureToggleHandle[]) {
        const toolbar = document.createElement("div");
        toolbar.className = "stillmark-workbench__bulk-actions";
        toolbar.setAttribute("role", "group");
        toolbar.setAttribute("aria-label", this.plugin.i18n.featureBulkActions);

        const label = document.createElement("span");
        label.className = "stillmark-workbench__bulk-label";
        label.textContent = this.plugin.i18n.featureBulkActions;

        let buttons: HTMLButtonElement[] = [];
        const updateAll = async (enabled: boolean) => {
            buttons.forEach((button) => button.disabled = true);
            toggles.forEach((toggle) => toggle.input.disabled = true);
            const failed: string[] = [];
            try {
                for (const toggle of toggles) {
                    if (toggle.input.checked === enabled) {
                        continue;
                    }
                    const update = this.toggleUpdaters.get(toggle.control);
                    if (!update) {
                        failed.push(toggle.title);
                        continue;
                    }
                    try {
                        await update(enabled, {announce: false, keepDisabled: true});
                    } catch {
                        failed.push(toggle.title);
                    }
                }
                if (failed.length === 0) {
                    showMessage(
                        enabled ? this.plugin.i18n.allFeaturesEnabled : this.plugin.i18n.allFeaturesDisabled,
                        3000,
                    );
                } else {
                    showMessage(
                        this.plugin.i18n.bulkFeatureUpdateFailed.replace(
                            "${features}",
                            failed.join(this.plugin.i18n.featureListSeparator),
                        ),
                        5000,
                        "error",
                    );
                }
            } finally {
                toggles.forEach((toggle) => toggle.input.disabled = false);
                buttons.forEach((button) => button.disabled = false);
            }
        };

        const enableAll = this.createButton(this.plugin.i18n.enableAllFeatures, () => {
            void updateAll(true);
        });
        enableAll.classList.remove("b3-button--cancel");
        enableAll.classList.add("b3-button--text", "stillmark-workbench__bulk-button");
        const disableAll = this.createButton(this.plugin.i18n.disableAllFeatures, () => {
            void updateAll(false);
        });
        disableAll.classList.add("stillmark-workbench__bulk-button");
        buttons = [enableAll, disableAll];
        toolbar.append(label, enableAll, disableAll);
        return toolbar;
    }

    private setControlsDisabled(controls: HTMLElement[], disabled: boolean) {
        controls.forEach((control) => {
            control.classList.toggle("stillmark-workbench__control--disabled", disabled);
            control.setAttribute("aria-disabled", String(disabled));
            if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) {
                control.disabled = disabled;
            }
            control.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((input) => {
                input.disabled = disabled;
            });
        });
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

function featureMessage(template: string, feature: string) {
    return template.replace("${feature}", feature);
}
