import {
    Menu,
    Plugin,
    fetchSyncPost,
    getFrontend,
    openMobileFileById,
    openTab,
    showMessage,
} from "siyuan";
import {
    DailyNotesSettings,
    Notebook,
} from "./daily-notes-settings";

const DAILY_NOTE_ATTRIBUTE_PREFIX = "custom-dailynote-";
const SHANGHAI_UTC_OFFSET = 8 * 60 * 60 * 1000;
const LONG_PRESS_DELAY = 550;
const LONG_PRESS_MOVE_TOLERANCE = 10;
const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;

interface DailyNoteData {
    id: string;
}

interface DailyNoteRow {
    id: string;
    ial: string;
}

interface DailyNoteResult {
    id: string;
    created: boolean;
}

interface RecentDay {
    key: string;
    label: string;
    weekday: number;
}

class DailyNotesConfigurationError extends Error {}

export class DailyNotesFeature {
    private readonly settings: DailyNotesSettings;
    private openTodayPromise: Promise<void> | null = null;
    private ensureTodayPromise: Promise<DailyNoteResult> | null = null;
    private topBarElement?: HTMLElement;
    private longPressTimer?: number;
    private longPressStart?: {x: number; y: number;};
    private suppressClickUntil = 0;

    private readonly contextMenuHandler = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        void this.showHistoryMenu();
    };

    private readonly touchContextMenuHandler = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
    };

    private readonly pointerDownHandler = (event: PointerEvent) => {
        if (event.pointerType === "mouse" || event.button !== 0) {
            return;
        }

        this.cancelLongPress();
        this.longPressStart = {x: event.clientX, y: event.clientY};
        this.longPressTimer = window.setTimeout(() => {
            this.longPressTimer = undefined;
            this.suppressClickUntil = Date.now() + 1000;
            void this.showHistoryMenu();
        }, LONG_PRESS_DELAY);
    };

    private readonly pointerMoveHandler = (event: PointerEvent) => {
        if (!this.longPressStart) {
            return;
        }

        const distance = Math.hypot(
            event.clientX - this.longPressStart.x,
            event.clientY - this.longPressStart.y,
        );
        if (distance > LONG_PRESS_MOVE_TOLERANCE) {
            this.cancelLongPress();
        }
    };

    private readonly pointerEndHandler = () => {
        this.cancelLongPress();
    };

    constructor(private readonly plugin: Plugin) {
        this.settings = new DailyNotesSettings(plugin);
    }

    onload() {
        this.plugin.addIcons(`<symbol id="iconStillmarkDailyNote" viewBox="0 0 32 32">
<rect x="5" y="7" width="22" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="2"></rect>
<path d="M10 4v6M22 4v6M5 13h22M10 18h5M10 22h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
</symbol>`);
        this.settings.onload();
    }

    onLayoutReady() {
        const isMobile = this.isMobile();
        this.topBarElement = this.plugin.addTopBar({
            icon: "iconStillmarkDailyNote",
            title: this.plugin.i18n.dailyNotesButtonTitle,
            position: "left",
            callback: () => {
                if (Date.now() < this.suppressClickUntil) {
                    this.suppressClickUntil = 0;
                    return;
                }
                void this.openToday();
            },
        });

        if (isMobile) {
            this.topBarElement.addEventListener("contextmenu", this.touchContextMenuHandler);
            this.topBarElement.addEventListener("pointerdown", this.pointerDownHandler);
            this.topBarElement.addEventListener("pointermove", this.pointerMoveHandler);
            this.topBarElement.addEventListener("pointerup", this.pointerEndHandler);
            this.topBarElement.addEventListener("pointercancel", this.pointerEndHandler);
        } else {
            this.topBarElement.addEventListener("contextmenu", this.contextMenuHandler);
        }

        void this.createOnStartup();
    }

    onunload() {
        this.settings.onunload();
        this.cancelLongPress();

        if (!this.topBarElement) {
            return;
        }

        this.topBarElement.removeEventListener("contextmenu", this.contextMenuHandler);
        this.topBarElement.removeEventListener("contextmenu", this.touchContextMenuHandler);
        this.topBarElement.removeEventListener("pointerdown", this.pointerDownHandler);
        this.topBarElement.removeEventListener("pointermove", this.pointerMoveHandler);
        this.topBarElement.removeEventListener("pointerup", this.pointerEndHandler);
        this.topBarElement.removeEventListener("pointercancel", this.pointerEndHandler);
    }

    private openToday() {
        if (this.openTodayPromise) {
            return this.openTodayPromise;
        }

        const request = this.openTodayOnce();
        this.openTodayPromise = request;
        void request.then(
            () => this.clearOpenRequest(request),
            () => this.clearOpenRequest(request),
        );
        return request;
    }

    private clearOpenRequest(request: Promise<void>) {
        if (this.openTodayPromise === request) {
            this.openTodayPromise = null;
        }
    }

    private async openTodayOnce() {
        try {
            const result = await this.ensureToday();
            await this.openDocument(result.id);
        } catch (error) {
            if (error instanceof DailyNotesConfigurationError) {
                this.showConfigurationError(error.message);
                return;
            }
            showMessage(`${this.plugin.i18n.dailyNotesCreateFailed}: ${errorMessage(error)}`, 6000, "error");
        }
    }

    private ensureToday() {
        if (this.ensureTodayPromise) {
            return this.ensureTodayPromise;
        }

        const request = this.createOrGetToday();
        this.ensureTodayPromise = request;
        void request.then(
            () => this.clearEnsureRequest(request),
            () => this.clearEnsureRequest(request),
        );
        return request;
    }

    private clearEnsureRequest(request: Promise<DailyNoteResult>) {
        if (this.ensureTodayPromise === request) {
            this.ensureTodayPromise = null;
        }
    }

    private async createOrGetToday(): Promise<DailyNoteResult> {
        const notebook = await this.requireConfiguredNotebook();
        const today = recentDays()[0];
        const rows = await this.findDailyNotes(notebook.id, [today]);
        const existing = findNoteForDay(rows, today);
        if (existing) {
            return {id: existing.id, created: false};
        }

        await this.settings.refreshPageTemplate(notebook.id);
        const data = await this.post<DailyNoteData>("/api/filetree/createDailyNote", {
            notebook: notebook.id,
            app: this.plugin.app.appId,
        }, this.plugin.i18n.dailyNotesCreateFailed);

        if (!data || !BLOCK_ID_PATTERN.test(data.id)) {
            throw new Error(this.plugin.i18n.dailyNotesInvalidResponse);
        }
        return {id: data.id, created: true};
    }

    private async createOnStartup() {
        try {
            if (!await this.settings.shouldAutoCreateOnStartup()) {
                return;
            }
            await this.ensureToday();
        } catch (error) {
            showMessage(`${this.plugin.i18n.dailyNotesAutoCreateFailed}: ${errorMessage(error)}`, 6000, "error");
        }
    }

    private async showHistoryMenu() {
        try {
            const notebook = await this.requireConfiguredNotebook();
            const days = recentDays();
            const rows = await this.findDailyNotes(notebook.id, days);
            const menu = new Menu(`${this.plugin.name}-daily-notes-history`);

            for (const [index, day] of days.entries()) {
                const marker = `${DAILY_NOTE_ATTRIBUTE_PREFIX}${day.key}`;
                const note = rows.find((row) => row.ial.includes(marker) && BLOCK_ID_PATTERN.test(row.id));
                const weekday = this.plugin.i18n[`dailyNotesWeekday${day.weekday}`];
                const baseLabel = `${day.label} ${weekday}`;

                menu.addItem({
                    icon: "iconStillmarkDailyNote",
                    label: note ? baseLabel : `${baseLabel} · ${this.plugin.i18n.dailyNotesNotCreated}`,
                    disabled: !note,
                    current: index === 0,
                    click: note ?
                        () => {
                            void this.openDocument(note.id).catch((error) => {
                                showMessage(
                                    `${this.plugin.i18n.dailyNotesOpenFailed}: ${errorMessage(error)}`,
                                    6000,
                                    "error",
                                );
                            });
                        } :
                        undefined,
                });
            }

            menu.addSeparator();
            menu.addItem({
                icon: "iconSettings",
                label: this.plugin.i18n.dailyNotesSettings,
                click: () => this.settings.open(),
            });

            if (this.isMobile()) {
                menu.fullscreen();
            } else {
                const rect = this.topBarElement?.getBoundingClientRect();
                menu.open({
                    x: rect?.right ?? window.innerWidth,
                    y: rect?.bottom ?? 32,
                    isLeft: true,
                });
            }
        } catch (error) {
            if (error instanceof DailyNotesConfigurationError) {
                this.showConfigurationError(error.message);
                return;
            }
            showMessage(`${this.plugin.i18n.dailyNotesHistoryFailed}: ${errorMessage(error)}`, 6000, "error");
        }
    }

    private async findDailyNotes(notebookId: string, days: RecentDay[]) {
        if (!BLOCK_ID_PATTERN.test(notebookId)) {
            throw new Error(this.plugin.i18n.dailyNotesNotebookUnavailable);
        }

        const conditions = days.map((day) => `ial LIKE '%${DAILY_NOTE_ATTRIBUTE_PREFIX}${day.key}%'`);
        const statement = `SELECT id, ial FROM blocks WHERE type = 'd' AND box = '${notebookId}' AND (${
            conditions.join(" OR ")
        }) ORDER BY updated DESC LIMIT 50`;
        const data = await this.post<DailyNoteRow[]>(
            "/api/query/sql",
            {stmt: statement},
            this.plugin.i18n.dailyNotesHistoryFailed,
        );

        return Array.isArray(data) ?
            data.filter((row) => typeof row?.id === "string" && typeof row?.ial === "string") :
            [];
    }

    private async requireConfiguredNotebook(): Promise<Notebook> {
        const result = await this.settings.resolveNotebook();
        if (result.status === "not-configured") {
            throw new DailyNotesConfigurationError(this.plugin.i18n.dailyNotesNotConfigured);
        }
        if (result.status === "unavailable") {
            throw new DailyNotesConfigurationError(this.plugin.i18n.dailyNotesNotebookUnavailable);
        }
        return result.notebook;
    }

    private showConfigurationError(message: string) {
        showMessage(message, 5000, "error");
        this.settings.open();
    }

    private async openDocument(id: string) {
        if (this.isMobile()) {
            openMobileFileById(this.plugin.app, id);
            return;
        }

        await openTab({
            app: this.plugin.app,
            doc: {id},
            openNewTab: true,
        });
    }

    private async post<T>(url: string, body: unknown, fallbackMessage: string): Promise<T> {
        const response = await fetchSyncPost(url, body);
        if (response.code !== 0) {
            throw new Error(response.msg || fallbackMessage);
        }
        return response.data as T;
    }

    private cancelLongPress() {
        if (this.longPressTimer !== undefined) {
            window.clearTimeout(this.longPressTimer);
            this.longPressTimer = undefined;
        }
        this.longPressStart = undefined;
    }

    private isMobile() {
        const frontend = getFrontend();
        return frontend === "mobile" || frontend === "browser-mobile";
    }
}

function recentDays(now = Date.now()): RecentDay[] {
    const shanghaiNow = new Date(now + SHANGHAI_UTC_OFFSET);
    const anchor = Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth(),
        shanghaiNow.getUTCDate(),
    );

    return Array.from({length: 7}, (_, index) => {
        const date = new Date(anchor - index * 24 * 60 * 60 * 1000);
        const year = String(date.getUTCFullYear());
        const month = padTwo(date.getUTCMonth() + 1);
        const day = padTwo(date.getUTCDate());
        return {
            key: `${year}${month}${day}`,
            label: `${year}-${month}-${day}`,
            weekday: date.getUTCDay(),
        };
    });
}

function padTwo(value: number) {
    return value < 10 ? `0${value}` : String(value);
}

function findNoteForDay(rows: DailyNoteRow[], day: RecentDay) {
    const marker = `${DAILY_NOTE_ATTRIBUTE_PREFIX}${day.key}`;
    return rows.find((row) => row.ial.includes(marker) && BLOCK_ID_PATTERN.test(row.id));
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
