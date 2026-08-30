import {
    Plugin,
    fetchSyncPost,
} from "siyuan";
import {WorkbenchPreferences} from "./workbench-preferences";

const DATABASE_NAMES = {
    cabinet: "机柜",
    customer: "客户",
    device: "设备",
    site: "站点",
};
const INITIAL_SYNC_DELAY = 1_500;
const CHANGE_SYNC_DELAY = 1_200;
const SAFETY_SYNC_INTERVAL = 5 * 60 * 1_000;
const BATCH_SIZE = 500;

type SyncState = "idle" | "syncing" | "success" | "unavailable" | "error";
type StatusState = "primary" | "neutral" | "warning";

interface AttributeViewKey {
    id: string;
    name: string;
    type: string;
    relation?: {
        avID?: string;
    };
}

interface AttributeView {
    id: string;
    name: string;
    keyValues: Array<{
        key: AttributeViewKey;
        values?: AttributeViewValue[];
    }>;
}

interface AttributeViewValue {
    blockID?: string;
    keyID?: string;
    relation?: {
        blockIDs?: string[];
    };
}

interface AttributeViewRow {
    id: string;
    values: Map<string, AttributeViewValue>;
}

interface RelationChain {
    cabinetAVID: string;
    cabinetSiteKeyID: string;
    customerAVID: string;
    deviceAVID: string;
    deviceCabinetKeyID: string;
    deviceCustomerKeyID: string;
    deviceSiteKeyID: string;
    siteAVID: string;
    siteCustomerKeyID: string;
}

interface SyncResult {
    changedCells: number;
    rows: number;
}

interface StatusPresentation {
    label: string;
    state: StatusState;
}

export class DatabaseRelationSyncFeature {
    private disposed = false;
    private syncTimer?: number;
    private safetyTimer?: number;
    private syncPromise?: Promise<SyncResult>;
    private state: SyncState = "idle";
    private lastResult?: SyncResult;
    private lastError = "";
    private watchedIDs = new Set<string>();

    private readonly webSocketHandler = ({detail}: CustomEvent<IWebSocketData>) => {
        if (detail?.cmd !== "transactions" || !this.preferences.isFeatureEnabledCached("databaseRelationSync")) {
            return;
        }

        if (this.watchedIDs.size > 0) {
            const transactionData = JSON.stringify(detail.data ?? "");
            if (![...this.watchedIDs].some((id) => transactionData.includes(id))) {
                return;
            }
        }
        this.scheduleSync(CHANGE_SYNC_DELAY);
    };

    constructor(
        private readonly plugin: Plugin,
        private readonly preferences: WorkbenchPreferences,
    ) {}

    onload() {
        this.plugin.eventBus.on("ws-main", this.webSocketHandler);
        this.safetyTimer = window.setInterval(() => {
            if (this.preferences.isFeatureEnabledCached("databaseRelationSync")) {
                this.scheduleSync(0);
            }
        }, SAFETY_SYNC_INTERVAL);
        if (this.preferences.isFeatureEnabledCached("databaseRelationSync")) {
            this.scheduleSync(INITIAL_SYNC_DELAY);
        }
    }

    onunload() {
        this.disposed = true;
        this.plugin.eventBus.off("ws-main", this.webSocketHandler);
        this.clearSyncTimer();
        if (this.safetyTimer !== undefined) {
            window.clearInterval(this.safetyTimer);
            this.safetyTimer = undefined;
        }
    }

    isEnabled() {
        return this.preferences.isFeatureEnabled("databaseRelationSync");
    }

    async setEnabled(enabled: boolean) {
        await this.preferences.setFeatureEnabled("databaseRelationSync", enabled);
        if (!enabled) {
            this.clearSyncTimer();
            this.state = "idle";
            return;
        }
        await this.syncNow().catch(() => undefined);
    }

    async syncNow() {
        this.clearSyncTimer();
        if (this.syncPromise) {
            return this.syncPromise;
        }

        this.syncPromise = this.performSync().finally(() => {
            this.syncPromise = undefined;
        });
        return this.syncPromise;
    }

    getStatusPresentation(): StatusPresentation {
        if (this.state === "syncing") {
            return {label: this.plugin.i18n.databaseRelationSyncRunning, state: "neutral"};
        }
        if (this.state === "success" && this.lastResult) {
            const label = this.plugin.i18n.databaseRelationSyncSuccess
                .replace("${rows}", String(this.lastResult.rows))
                .replace("${cells}", String(this.lastResult.changedCells));
            return {label, state: "primary"};
        }
        if (this.state === "unavailable") {
            return {label: this.plugin.i18n.databaseRelationSyncUnavailable, state: "warning"};
        }
        if (this.state === "error") {
            return {
                label: this.lastError || this.plugin.i18n.databaseRelationSyncFailed,
                state: "warning",
            };
        }
        return {label: this.plugin.i18n.databaseRelationSyncWaiting, state: "neutral"};
    }

    private scheduleSync(delay: number) {
        if (this.disposed) {
            return;
        }
        this.clearSyncTimer();
        this.syncTimer = window.setTimeout(() => {
            this.syncTimer = undefined;
            void this.syncNow().catch(() => undefined);
        }, delay);
    }

    private clearSyncTimer() {
        if (this.syncTimer !== undefined) {
            window.clearTimeout(this.syncTimer);
            this.syncTimer = undefined;
        }
    }

    private async performSync(): Promise<SyncResult> {
        this.state = "syncing";
        this.lastError = "";
        try {
            const chain = await this.discoverRelationChain();
            this.watchedIDs = new Set(Object.values(chain));
            const [deviceRows, cabinetRows, siteRows] = await Promise.all([
                this.getRows(chain.deviceAVID),
                this.getRows(chain.cabinetAVID),
                this.getRows(chain.siteAVID),
            ]);

            const cabinetSites = relationMap(cabinetRows, chain.cabinetSiteKeyID);
            const siteCustomers = relationMap(siteRows, chain.siteCustomerKeyID);
            const updates: Array<{keyID: string; itemID: string; value: unknown;}> = [];
            const expected = new Map<string, {sites: string[]; customers: string[];}>();

            deviceRows.forEach((row) => {
                const cabinetIDs = relationIDs(row, chain.deviceCabinetKeyID);
                const siteIDs = unique(cabinetIDs.flatMap((cabinetID) => cabinetSites.get(cabinetID) ?? []));
                const customerIDs = unique(siteIDs.flatMap((siteID) => siteCustomers.get(siteID) ?? []));
                expected.set(row.id, {sites: siteIDs, customers: customerIDs});

                if (!sameIDs(relationIDs(row, chain.deviceSiteKeyID), siteIDs)) {
                    updates.push(relationUpdate(row.id, chain.deviceSiteKeyID, siteIDs));
                }
                if (!sameIDs(relationIDs(row, chain.deviceCustomerKeyID), customerIDs)) {
                    updates.push(relationUpdate(row.id, chain.deviceCustomerKeyID, customerIDs));
                }
            });

            for (let index = 0; index < updates.length; index += BATCH_SIZE) {
                await apiPost("/api/av/batchSetAttributeViewBlockAttrs", {
                    avID: chain.deviceAVID,
                    values: updates.slice(index, index + BATCH_SIZE),
                });
            }

            const verifiedRows = await this.getRows(chain.deviceAVID);
            const mismatches = verifiedRows.filter((row) => {
                const rowExpected = expected.get(row.id);
                return !rowExpected ||
                    !sameIDs(relationIDs(row, chain.deviceSiteKeyID), rowExpected.sites) ||
                    !sameIDs(relationIDs(row, chain.deviceCustomerKeyID), rowExpected.customers);
            });
            if (verifiedRows.length !== deviceRows.length || mismatches.length > 0) {
                throw new Error(this.plugin.i18n.databaseRelationSyncVerificationFailed);
            }

            const result = {changedCells: updates.length, rows: deviceRows.length};
            this.lastResult = result;
            this.state = "success";
            return result;
        } catch (error) {
            const message = errorMessage(error);
            this.lastError = message;
            this.state = message === this.plugin.i18n.databaseRelationSyncUnavailable ? "unavailable" : "error";
            throw error;
        }
    }

    private async discoverRelationChain(): Promise<RelationChain> {
        const searchData = await apiPost("/api/av/searchAttributeView", {keyword: DATABASE_NAMES.device}) as {
            results?: Array<{avID?: string; avName?: string;}>;
        };
        const deviceIDs = unique(
            (searchData.results ?? [])
                .filter((result) => result.avName === DATABASE_NAMES.device && result.avID)
                .map((result) => result.avID as string),
        );
        if (deviceIDs.length !== 1) {
            throw new Error(this.plugin.i18n.databaseRelationSyncUnavailable);
        }

        const device = await this.getAttributeView(deviceIDs[0]);
        const deviceCabinet = relationKey(device, DATABASE_NAMES.cabinet);
        const cabinet = await this.getAttributeView(deviceCabinet.relation?.avID ?? "");
        const cabinetSite = relationKey(cabinet, DATABASE_NAMES.site);
        const site = await this.getAttributeView(cabinetSite.relation?.avID ?? "");
        const siteCustomer = relationKey(site, DATABASE_NAMES.customer);
        const deviceSite = relationKey(device, DATABASE_NAMES.site, site.id);
        const deviceCustomer = relationKey(device, DATABASE_NAMES.customer, siteCustomer.relation?.avID);

        return {
            cabinetAVID: cabinet.id,
            cabinetSiteKeyID: cabinetSite.id,
            customerAVID: siteCustomer.relation?.avID ?? "",
            deviceAVID: device.id,
            deviceCabinetKeyID: deviceCabinet.id,
            deviceCustomerKeyID: deviceCustomer.id,
            deviceSiteKeyID: deviceSite.id,
            siteAVID: site.id,
            siteCustomerKeyID: siteCustomer.id,
        };
    }

    private async getAttributeView(id: string): Promise<AttributeView> {
        if (!id) {
            throw new Error(this.plugin.i18n.databaseRelationSyncUnavailable);
        }
        const data = await apiPost("/api/av/getAttributeView", {id}) as {av?: AttributeView;};
        if (!data.av?.id) {
            throw new Error(this.plugin.i18n.databaseRelationSyncUnavailable);
        }
        return data.av;
    }

    private async getRows(id: string): Promise<AttributeViewRow[]> {
        const av = await this.getAttributeView(id);
        return rowsFromAttributeView(av);
    }
}

async function apiPost(path: string, payload: Record<string, unknown>) {
    const response = await fetchSyncPost(path, payload) as {
        code?: number;
        data?: unknown;
        msg?: string;
    };
    if (response.code !== 0) {
        throw new Error(response.msg || path);
    }
    return response.data;
}

function relationKey(av: AttributeView, name: string, targetAVID?: string) {
    const matches = av.keyValues
        .map(({key}) => key)
        .filter((key) => key.name === name && key.type === "relation" && key.relation?.avID);
    const matched = targetAVID ? matches.filter((key) => key.relation?.avID === targetAVID) : matches;
    if (matched.length !== 1) {
        throw new Error(`Relation field unavailable: ${av.name}.${name}`);
    }
    return matched[0];
}

function relationIDs(row: AttributeViewRow, keyID: string) {
    return unique(row.values.get(keyID)?.relation?.blockIDs ?? []);
}

function relationMap(rows: AttributeViewRow[], keyID: string) {
    return new Map(rows.map((row) => [row.id, relationIDs(row, keyID)]));
}

function rowsFromAttributeView(av: AttributeView) {
    const primary = av.keyValues.find(({key}) => key.type === "block");
    const rows = new Map<string, AttributeViewRow>();
    (primary?.values ?? []).forEach((value) => {
        if (value.blockID) {
            rows.set(value.blockID, {id: value.blockID, values: new Map()});
        }
    });
    av.keyValues.forEach(({key, values}) => {
        (values ?? []).forEach((value) => {
            if (!value.blockID) {
                return;
            }
            const row = rows.get(value.blockID);
            if (!row) {
                return;
            }
            row.values.set(key.id, value);
        });
    });
    return [...rows.values()];
}

function relationUpdate(itemID: string, keyID: string, blockIDs: string[]) {
    return {
        itemID,
        keyID,
        value: {
            type: "relation",
            relation: {blockIDs},
        },
    };
}

function sameIDs(left: string[], right: string[]) {
    return [...left].sort().join("\n") === [...right].sort().join("\n");
}

function unique(values: string[]) {
    return [...new Set(values.filter(Boolean))];
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
