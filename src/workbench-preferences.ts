import {Plugin} from "siyuan";

const STORAGE_NAME = "workbench-preferences.json";
const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const MAX_DISPLAY_NAME_LENGTH = 256;

interface StoredWorkbenchPreferences {
    annotationContinuousMode?: boolean;
    annotationsEnabled?: boolean;
    blockRolesEnabled?: boolean;
    dailyNotesEnabled?: boolean;
    documentBreadcrumbEnabled?: boolean;
    documentFindEnabled?: boolean;
    documentTreeFocusEnabled?: boolean;
    fontSwitcherEnabled?: boolean;
    inlineBacklinkDisplayNames?: Record<string, unknown>;
    inlineBacklinksEnabled?: boolean;
    pdfExportEnabled?: boolean;
}

interface WorkbenchPreferencesState {
    annotationContinuousMode: boolean;
    annotationsEnabled: boolean;
    blockRolesEnabled: boolean;
    dailyNotesEnabled: boolean;
    documentBreadcrumbEnabled: boolean;
    documentFindEnabled: boolean;
    documentTreeFocusEnabled: boolean;
    fontSwitcherEnabled: boolean;
    inlineBacklinkDisplayNames: Record<string, string>;
    inlineBacklinksEnabled: boolean;
    pdfExportEnabled: boolean;
}

type BooleanPreferenceKey =
    | "annotationContinuousMode"
    | "annotationsEnabled"
    | "blockRolesEnabled"
    | "dailyNotesEnabled"
    | "documentBreadcrumbEnabled"
    | "documentFindEnabled"
    | "documentTreeFocusEnabled"
    | "fontSwitcherEnabled"
    | "inlineBacklinksEnabled"
    | "pdfExportEnabled";

export type WorkbenchFeature =
    | "annotations"
    | "blockRoles"
    | "dailyNotes"
    | "documentBreadcrumb"
    | "documentFind"
    | "documentTreeFocus"
    | "fontSwitcher"
    | "inlineBacklinks"
    | "pdfExport";

const FEATURE_PREFERENCE_KEYS: Record<WorkbenchFeature, BooleanPreferenceKey> = {
    annotations: "annotationsEnabled",
    blockRoles: "blockRolesEnabled",
    dailyNotes: "dailyNotesEnabled",
    documentBreadcrumb: "documentBreadcrumbEnabled",
    documentFind: "documentFindEnabled",
    documentTreeFocus: "documentTreeFocusEnabled",
    fontSwitcher: "fontSwitcherEnabled",
    inlineBacklinks: "inlineBacklinksEnabled",
    pdfExport: "pdfExportEnabled",
};

const DEFAULT_PREFERENCES: WorkbenchPreferencesState = {
    annotationContinuousMode: false,
    annotationsEnabled: true,
    blockRolesEnabled: true,
    dailyNotesEnabled: true,
    documentBreadcrumbEnabled: true,
    documentFindEnabled: true,
    documentTreeFocusEnabled: true,
    fontSwitcherEnabled: true,
    inlineBacklinkDisplayNames: {},
    inlineBacklinksEnabled: true,
    pdfExportEnabled: true,
};

export class WorkbenchPreferences {
    private state = {...DEFAULT_PREFERENCES};
    private readonly readyPromise: Promise<void>;
    private saveQueue: Promise<void> = Promise.resolve();

    constructor(private readonly plugin: Plugin) {
        this.readyPromise = this.load();
    }

    ready() {
        return this.readyPromise;
    }

    async isFeatureEnabled(feature: WorkbenchFeature) {
        await this.readyPromise;
        return this.isFeatureEnabledCached(feature);
    }

    isFeatureEnabledCached(feature: WorkbenchFeature) {
        return this.state[FEATURE_PREFERENCE_KEYS[feature]];
    }

    async setFeatureEnabled(feature: WorkbenchFeature, enabled: boolean) {
        await this.setPreference(FEATURE_PREFERENCE_KEYS[feature], enabled);
    }

    async isDocumentBreadcrumbEnabled() {
        return this.isFeatureEnabled("documentBreadcrumb");
    }

    async setDocumentBreadcrumbEnabled(enabled: boolean) {
        await this.setFeatureEnabled("documentBreadcrumb", enabled);
    }

    async isInlineBacklinksEnabled() {
        return this.isFeatureEnabled("inlineBacklinks");
    }

    async setInlineBacklinksEnabled(enabled: boolean) {
        await this.setFeatureEnabled("inlineBacklinks", enabled);
    }

    async getInlineBacklinkDisplayName(sourceId: string) {
        await this.readyPromise;
        return this.state.inlineBacklinkDisplayNames[sourceId];
    }

    async setInlineBacklinkDisplayName(sourceId: string, displayName?: string) {
        if (!BLOCK_ID_PATTERN.test(sourceId)) {
            throw new Error(this.plugin.i18n.workbenchPreferenceSaveFailed);
        }

        await this.readyPromise;
        const normalizedName = normalizeDisplayName(displayName);
        const operation = this.saveQueue.then(async () => {
            const inlineBacklinkDisplayNames = {
                ...this.state.inlineBacklinkDisplayNames,
            };
            if (normalizedName) {
                inlineBacklinkDisplayNames[sourceId] = normalizedName;
            } else {
                delete inlineBacklinkDisplayNames[sourceId];
            }

            const nextState: WorkbenchPreferencesState = {
                ...this.state,
                inlineBacklinkDisplayNames,
            };
            const response = await this.plugin.saveData(STORAGE_NAME, nextState);
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.workbenchPreferenceSaveFailed);
            }

            const readback = await this.plugin.loadData(STORAGE_NAME) as StoredWorkbenchPreferences | undefined;
            const normalizedReadback = normalizePreferences(readback);
            if (normalizedReadback.inlineBacklinkDisplayNames[sourceId] !== normalizedName) {
                throw new Error(this.plugin.i18n.workbenchPreferenceVerificationFailed);
            }
            this.state = normalizedReadback;
        });
        this.saveQueue = operation.catch(() => undefined);
        await operation;
    }

    async isAnnotationContinuousMode() {
        await this.readyPromise;
        return this.state.annotationContinuousMode;
    }

    async setAnnotationContinuousMode(enabled: boolean) {
        await this.setPreference("annotationContinuousMode", enabled);
    }

    private async load() {
        try {
            const stored = await this.plugin.loadData(STORAGE_NAME) as StoredWorkbenchPreferences | undefined;
            this.state = normalizePreferences(stored);
        } catch {
            this.state = {...DEFAULT_PREFERENCES};
        }
    }

    private async setPreference(key: BooleanPreferenceKey, enabled: boolean) {
        await this.readyPromise;
        const operation = this.saveQueue.then(async () => {
            const nextState: WorkbenchPreferencesState = {
                ...this.state,
                [key]: enabled,
            };
            const response = await this.plugin.saveData(STORAGE_NAME, nextState);
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.workbenchPreferenceSaveFailed);
            }

            const readback = await this.plugin.loadData(STORAGE_NAME) as StoredWorkbenchPreferences | undefined;
            if (readback?.[key] !== enabled) {
                throw new Error(this.plugin.i18n.workbenchPreferenceVerificationFailed);
            }
            this.state = normalizePreferences(readback);
        });
        this.saveQueue = operation.catch(() => undefined);
        await operation;
    }
}

function normalizePreferences(stored?: StoredWorkbenchPreferences): WorkbenchPreferencesState {
    return {
        annotationContinuousMode: stored?.annotationContinuousMode === true,
        annotationsEnabled: stored?.annotationsEnabled !== false,
        blockRolesEnabled: stored?.blockRolesEnabled !== false,
        dailyNotesEnabled: stored?.dailyNotesEnabled !== false,
        documentBreadcrumbEnabled: stored?.documentBreadcrumbEnabled !== false,
        documentFindEnabled: stored?.documentFindEnabled !== false,
        documentTreeFocusEnabled: stored?.documentTreeFocusEnabled !== false,
        fontSwitcherEnabled: stored?.fontSwitcherEnabled !== false,
        inlineBacklinkDisplayNames: normalizeDisplayNames(stored?.inlineBacklinkDisplayNames),
        inlineBacklinksEnabled: stored?.inlineBacklinksEnabled !== false,
        pdfExportEnabled: stored?.pdfExportEnabled !== false,
    };
}

function normalizeDisplayNames(stored?: Record<string, unknown>) {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
        return {};
    }

    const displayNames: Record<string, string> = {};
    Object.entries(stored).forEach(([sourceId, displayName]) => {
        if (!BLOCK_ID_PATTERN.test(sourceId) || typeof displayName !== "string") {
            return;
        }
        const normalizedName = normalizeDisplayName(displayName);
        if (normalizedName) {
            displayNames[sourceId] = normalizedName;
        }
    });
    return displayNames;
}

function normalizeDisplayName(displayName?: string) {
    return displayName
        ?.replace(/[\r\n\u2028\u2029]+/g, " ")
        .trim()
        .slice(0, MAX_DISPLAY_NAME_LENGTH) || undefined;
}
