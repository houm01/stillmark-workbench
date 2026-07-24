import {Plugin} from "siyuan";

const STORAGE_NAME = "workbench-preferences.json";

interface StoredWorkbenchPreferences {
    documentBreadcrumbEnabled?: boolean;
    inlineBacklinksEnabled?: boolean;
}

interface WorkbenchPreferencesState {
    documentBreadcrumbEnabled: boolean;
    inlineBacklinksEnabled: boolean;
}

type PreferenceKey = keyof WorkbenchPreferencesState;

const DEFAULT_PREFERENCES: WorkbenchPreferencesState = {
    documentBreadcrumbEnabled: true,
    inlineBacklinksEnabled: true,
};

export class WorkbenchPreferences {
    private state = {...DEFAULT_PREFERENCES};
    private readonly readyPromise: Promise<void>;
    private saveQueue: Promise<void> = Promise.resolve();

    constructor(private readonly plugin: Plugin) {
        this.readyPromise = this.load();
    }

    async isDocumentBreadcrumbEnabled() {
        await this.readyPromise;
        return this.state.documentBreadcrumbEnabled;
    }

    async setDocumentBreadcrumbEnabled(enabled: boolean) {
        await this.setPreference("documentBreadcrumbEnabled", enabled);
    }

    async isInlineBacklinksEnabled() {
        await this.readyPromise;
        return this.state.inlineBacklinksEnabled;
    }

    async setInlineBacklinksEnabled(enabled: boolean) {
        await this.setPreference("inlineBacklinksEnabled", enabled);
    }

    private async load() {
        try {
            const stored = await this.plugin.loadData(STORAGE_NAME) as StoredWorkbenchPreferences | undefined;
            this.state = normalizePreferences(stored);
        } catch {
            this.state = {...DEFAULT_PREFERENCES};
        }
    }

    private async setPreference(key: PreferenceKey, enabled: boolean) {
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
        documentBreadcrumbEnabled: stored?.documentBreadcrumbEnabled !== false,
        inlineBacklinksEnabled: stored?.inlineBacklinksEnabled !== false,
    };
}
