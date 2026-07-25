import {
    IProtyle,
    IWebSocketData,
    Plugin,
    Protyle,
    TProtyleAction,
    confirm as confirmDialog,
    fetchSyncPost,
    getActiveEditor,
    getAllEditor,
    getFrontend,
    openMobileFileById,
    openTab,
    showMessage,
} from "siyuan";
import {
    AnnotationEditorValue,
    openAnnotationEditor,
} from "./annotation-editor";
import {
    ANNOTATION_ATTRIBUTE,
    ANNOTATION_BACKGROUND_COLORS,
    ANNOTATION_COLORS,
    ANNOTATION_LINE_STYLES,
    ANNOTATION_TAGS,
    AnnotationListItem,
    AnnotationRecord,
    AnnotationSelection,
    AnnotationTag,
    annotationBackgroundHighlightName,
    annotationHighlightName,
    annotationRecordsEqual,
    annotationStyleForTag,
    captureAnnotationSelection,
    createAnnotationRecord,
    encodeAnnotations,
    parseAnnotations,
    resolveAnnotationRange,
    selectionFromRecord,
} from "./annotation-model";

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const HIGHLIGHT_REFRESH_DELAY_MS = 120;
const PANEL_REFRESH_DELAY_MS = 180;
const SAVE_VERIFICATION_DELAYS_MS = [0, 80, 160, 320, 640] as const;
const OPEN_BLOCK_ACTIONS: TProtyleAction[] = [
    "cb-get-focus",
    "cb-get-context",
    "cb-get-scroll",
];
const ANNOTATION_HIGHLIGHT_NAMES = ANNOTATION_COLORS.flatMap((color) =>
    ANNOTATION_LINE_STYLES.map((lineStyle) => annotationHighlightName(color, lineStyle))
);
const ANNOTATION_BACKGROUND_HIGHLIGHT_NAMES = ANNOTATION_BACKGROUND_COLORS
    .filter((color) => color !== "none")
    .map((color) => annotationBackgroundHighlightName(color));

interface AnnotationSqlRow {
    id?: string;
    root_id?: string;
}

interface RenderedAnnotation {
    blockId: string;
    range: Range;
    record: AnnotationRecord;
    rootId: string;
}

interface BlockAttrsResponse {
    [ANNOTATION_ATTRIBUTE]?: string;
}

const TAG_ICONS: Record<AnnotationTag, string> = {
    important: "★",
    none: "•",
    pin: "⌖",
    question: "?",
    reading: "▤",
    todo: "✓",
};

export class AnnotationsFeature {
    private activeFilter: AnnotationTag | "all" = "all";
    private activeRootId = "";
    private blockSaveQueues = new Map<string, Promise<void>>();
    private currentHighlightTimer?: number;
    private dockCount?: HTMLElement;
    private dockEmpty?: HTMLElement;
    private dockFilters?: HTMLElement;
    private dockList?: HTMLElement;
    private dockRoot?: HTMLElement;
    private dockSearch?: HTMLInputElement;
    private highlightRefreshTimer?: number;
    private hoverHideTimer?: number;
    private hoverKey = "";
    private hoverRoot?: HTMLElement;
    private items: AnnotationListItem[] = [];
    private overviewButton?: HTMLElement;
    private overviewCount?: HTMLElement;
    private overviewEmpty?: HTMLElement;
    private overviewList?: HTMLElement;
    private overviewRoot?: HTMLElement;
    private overviewSearch?: HTMLInputElement;
    private panelRefreshTimer?: number;
    private renderedAnnotations: RenderedAnnotation[] = [];

    private readonly editorChangedHandler = ({detail}: CustomEvent<{protyle: IProtyle;}>) => {
        if (getActiveEditor()?.protyle.element === detail.protyle.element) {
            const nextRootId = detail.protyle.block.rootID ?? "";
            if (nextRootId !== this.activeRootId) {
                this.activeRootId = nextRootId;
                this.items = [];
                this.renderDock();
                this.renderOverview();
            }
            this.schedulePanelRefresh();
        }
        this.scheduleHighlightRefresh();
    };

    private readonly destroyProtyleHandler = () => {
        this.scheduleHighlightRefresh();
    };

    private readonly webSocketHandler = ({detail}: CustomEvent<IWebSocketData>) => {
        if (detail?.cmd !== "transactions") {
            return;
        }
        this.scheduleHighlightRefresh();
        this.schedulePanelRefresh();
    };

    private readonly pointerUpHandler = (event: PointerEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        if (
            !target?.closest(".protyle-wysiwyg") ||
            target.closest(".stillmark-annotation-hover")
        ) {
            return;
        }

        window.setTimeout(() => {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) {
                return;
            }

            const rendered = this.annotationsAtPoint(event.clientX, event.clientY);
            if (rendered.length > 0) {
                this.hideAnnotationHover();
                this.openEditEditor(
                    rendered[0].blockId,
                    rendered[0].rootId,
                    rendered[0].record,
                );
            }
        }, 0);
    };

    private readonly pointerMoveHandler = (event: PointerEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target && this.hoverRoot?.contains(target)) {
            window.clearTimeout(this.hoverHideTimer);
            return;
        }
        const selection = window.getSelection();
        if (
            !target?.closest(".protyle-wysiwyg") ||
            (selection && !selection.isCollapsed)
        ) {
            this.scheduleAnnotationHoverHide();
            return;
        }
        const rendered = this.annotationsAtPoint(event.clientX, event.clientY);
        if (rendered.length === 0) {
            this.scheduleAnnotationHoverHide();
            return;
        }
        this.showAnnotationHover(rendered, event.clientX, event.clientY);
    };

    private readonly pointerDownHandler = (event: PointerEvent) => {
        const target = event.target instanceof Node ? event.target : null;
        if (
            target &&
            (this.overviewRoot?.contains(target) || this.overviewButton?.contains(target))
        ) {
            return;
        }
        this.hideOverview();
    };

    private readonly inputHandler = (event: Event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".protyle-wysiwyg")) {
            this.hideAnnotationHover();
            this.scheduleHighlightRefresh();
        }
    };

    private readonly keydownHandler = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            this.hideAnnotationHover();
            this.hideOverview();
        }
    };

    private readonly resizeHandler = () => {
        this.hideAnnotationHover();
        this.hideOverview();
    };

    private readonly scrollHandler = () => this.hideAnnotationHover();

    constructor(private readonly plugin: Plugin) {}

    onload() {
        this.plugin.addCommand({
            editorCallback: () => this.createFromCurrentSelection(true),
            hotkey: "⌥⌘C",
            langKey: "annotationCreateCommand",
        });

        this.plugin.addDock({
            config: {
                icon: "iconStillmarkAnnotation",
                position: "RightBottom",
                show: false,
                size: {
                    height: null,
                    width: 340,
                },
                title: this.plugin.i18n.annotationPanelTitle,
            },
            data: {},
            init: (custom) => {
                if (custom.element instanceof HTMLElement) {
                    this.mountDock(custom.element);
                }
            },
            type: "stillmark-annotations",
        });

        this.plugin.eventBus.on("destroy-protyle", this.destroyProtyleHandler);
        this.plugin.eventBus.on("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle-mode", this.editorChangedHandler);
        this.plugin.eventBus.on("ws-main", this.webSocketHandler);
        document.addEventListener("pointerup", this.pointerUpHandler, true);
        document.addEventListener("pointermove", this.pointerMoveHandler, true);
        document.addEventListener("pointerdown", this.pointerDownHandler, true);
        document.addEventListener("input", this.inputHandler, true);
        document.addEventListener("keydown", this.keydownHandler, true);
        document.addEventListener("scroll", this.scrollHandler, true);
        window.addEventListener("resize", this.resizeHandler);
    }

    onLayoutReady() {
        if (!this.overviewButton) {
            this.overviewButton = this.plugin.addTopBar({
                callback: (event) => {
                    void this.toggleOverview(event.currentTarget as HTMLElement);
                },
                icon: "iconStillmarkAnnotation",
                position: "left",
                title: this.plugin.i18n.annotationPageOverviewTitle,
            });
            this.overviewButton.classList.add(
                "stillmark-topbar-icon",
                "stillmark-topbar-icon--annotation",
            );
            this.overviewButton.setAttribute("aria-expanded", "false");
        }
        this.activeRootId = getActiveEditor()?.protyle.block.rootID ?? "";
        this.scheduleHighlightRefresh(0);
        this.schedulePanelRefresh(0);
    }

    onunload() {
        this.plugin.eventBus.off("destroy-protyle", this.destroyProtyleHandler);
        this.plugin.eventBus.off("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle-mode", this.editorChangedHandler);
        this.plugin.eventBus.off("ws-main", this.webSocketHandler);
        document.removeEventListener("pointerup", this.pointerUpHandler, true);
        document.removeEventListener("pointermove", this.pointerMoveHandler, true);
        document.removeEventListener("pointerdown", this.pointerDownHandler, true);
        document.removeEventListener("input", this.inputHandler, true);
        document.removeEventListener("keydown", this.keydownHandler, true);
        document.removeEventListener("scroll", this.scrollHandler, true);
        window.removeEventListener("resize", this.resizeHandler);
        window.clearTimeout(this.highlightRefreshTimer);
        window.clearTimeout(this.panelRefreshTimer);
        window.clearTimeout(this.currentHighlightTimer);
        this.hideAnnotationHover();
        this.hideOverview();
        this.clearAnnotationHighlights();
        CSS.highlights.delete("stillmark-annotation-current");
    }

    createFromCurrentSelection(reportFailure = false) {
        const selection = this.captureCurrentSelection();
        if (!selection) {
            if (reportFailure) {
                showMessage(this.plugin.i18n.annotationSelectionRequired, 4000, "error");
            }
            return;
        }
        this.openCreateEditor(selection);
    }

    createFromProtyleToolbar(instance: Protyle) {
        const protyle = instance.protyle;
        const range = protyle.toolbar?.range?.cloneRange();
        const selection = range ? this.captureRangeSelection(range, protyle) : null;
        if (!selection) {
            showMessage(this.plugin.i18n.annotationSelectionRequired, 4000, "error");
            return;
        }
        this.openCreateEditor(selection);
    }

    private captureCurrentSelection() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return null;
        }
        const range = selection.getRangeAt(0);
        const editor = getAllEditor().find((item) => item.protyle.element.contains(range.commonAncestorContainer));
        return editor ? this.captureRangeSelection(range, editor.protyle) : null;
    }

    private captureRangeSelection(range: Range, protyle: IProtyle) {
        if (range.collapsed) {
            return null;
        }
        const startElement = range.startContainer instanceof Element ?
            range.startContainer :
            range.startContainer.parentElement;
        const endElement = range.endContainer instanceof Element ?
            range.endContainer :
            range.endContainer.parentElement;
        const startBlock = startElement?.closest<HTMLElement>(".protyle-wysiwyg [data-node-id]");
        const endBlock = endElement?.closest<HTMLElement>(".protyle-wysiwyg [data-node-id]");
        if (!startBlock || startBlock !== endBlock) {
            return null;
        }
        if (!protyle.element.contains(startBlock)) {
            return null;
        }
        const rootId = protyle.block.rootID;
        if (!rootId || !BLOCK_ID_PATTERN.test(rootId)) {
            return null;
        }
        return captureAnnotationSelection(startBlock, range, rootId);
    }

    private openCreateEditor(selection: AnnotationSelection) {
        this.hideAnnotationHover();
        openAnnotationEditor({
            onSave: (value) => this.saveAnnotation(selection, value),
            plugin: this.plugin,
            selection,
        });
    }

    private openEditEditor(blockId: string, rootId: string, record: AnnotationRecord) {
        this.hideAnnotationHover();
        const selection = selectionFromRecord(blockId, rootId, record);
        openAnnotationEditor({
            onDelete: () => this.deleteAnnotation(blockId, record.id),
            onSave: (value) => this.saveAnnotation(selection, value, record),
            plugin: this.plugin,
            record,
            selection,
        });
    }

    private async saveAnnotation(
        selection: AnnotationSelection,
        value: AnnotationEditorValue,
        existing?: AnnotationRecord,
    ) {
        try {
            await this.queueBlockSave(selection.blockId, async () => {
                const records = await this.readBlockAnnotations(selection.blockId);
                const now = Date.now();
                const style = annotationStyleForTag(value.tag);
                const nextRecord = existing ?
                    {
                        ...existing,
                        backgroundColor: style.backgroundColor,
                        color: style.color,
                        lineStyle: value.lineStyle,
                        note: value.note.trim(),
                        tag: value.tag,
                        updatedAt: now,
                    } :
                    {
                        ...createAnnotationRecord(selection, value.note, now),
                        backgroundColor: style.backgroundColor,
                        color: style.color,
                        lineStyle: value.lineStyle,
                        tag: value.tag,
                    };
                const nextRecords = existing ?
                    records.map((record) => record.id === existing.id ? nextRecord : record) :
                    [...records, nextRecord];
                if (existing && !nextRecords.some((record) => record.id === existing.id)) {
                    throw new Error(this.plugin.i18n.annotationMissing);
                }
                await this.writeBlockAnnotations(selection.blockId, nextRecords);
            });
            showMessage(
                existing ? this.plugin.i18n.annotationUpdated : this.plugin.i18n.annotationCreated,
                3000,
            );
            this.scheduleHighlightRefresh(0);
            this.schedulePanelRefresh(0);
        } catch (error) {
            showMessage(
                `${this.plugin.i18n.annotationSaveFailed}: ${errorMessage(error)}`,
                5000,
                "error",
            );
            throw error;
        }
    }

    private async deleteAnnotation(blockId: string, annotationId: string) {
        try {
            await this.queueBlockSave(blockId, async () => {
                const records = await this.readBlockAnnotations(blockId);
                const nextRecords = records.filter((record) => record.id !== annotationId);
                if (nextRecords.length === records.length) {
                    throw new Error(this.plugin.i18n.annotationMissing);
                }
                await this.writeBlockAnnotations(blockId, nextRecords);
            });
            showMessage(this.plugin.i18n.annotationDeleted, 3000);
            this.scheduleHighlightRefresh(0);
            this.schedulePanelRefresh(0);
        } catch (error) {
            showMessage(
                `${this.plugin.i18n.annotationDeleteFailed}: ${errorMessage(error)}`,
                5000,
                "error",
            );
            throw error;
        }
    }

    private confirmDeleteAnnotation(blockId: string, record: AnnotationRecord) {
        this.hideAnnotationHover();
        confirmDialog(
            this.plugin.i18n.annotationDeleteConfirmTitle,
            this.plugin.i18n.annotationDeleteConfirmText,
            () => {
                void this.deleteAnnotation(blockId, record.id).catch(() => undefined);
            },
        );
    }

    private confirmDeleteAllAnnotations(
        targets: Array<{annotationId: string; blockId: string;}>,
    ) {
        if (targets.length === 0) {
            return;
        }
        this.hideAnnotationHover();
        confirmDialog(
            this.plugin.i18n.annotationDeleteAllConfirmTitle,
            this.plugin.i18n.annotationDeleteAllConfirmText.replace(
                "${count}",
                String(targets.length),
            ),
            () => {
                void this.deleteAllAnnotations(targets).catch(() => undefined);
            },
        );
    }

    private async deleteAllAnnotations(
        targets: Array<{annotationId: string; blockId: string;}>,
    ) {
        const targetsByBlock = new Map<string, Set<string>>();
        targets.forEach((target) => {
            const annotationIds = targetsByBlock.get(target.blockId) ?? new Set<string>();
            annotationIds.add(target.annotationId);
            targetsByBlock.set(target.blockId, annotationIds);
        });

        const blockTargets = [...targetsByBlock];
        const results = await Promise.allSettled(
            blockTargets.map(async ([blockId, annotationIds]) => {
                let deletedCount = 0;
                await this.queueBlockSave(blockId, async () => {
                    const records = await this.readBlockAnnotations(blockId);
                    const nextRecords = records.filter((record) => !annotationIds.has(record.id));
                    deletedCount = records.length - nextRecords.length;
                    if (deletedCount > 0) {
                        await this.writeBlockAnnotations(blockId, nextRecords);
                    }
                });
                return deletedCount;
            }),
        );

        let deletedCount = 0;
        let failedCount = 0;
        results.forEach((result, index) => {
            if (result.status === "fulfilled") {
                deletedCount += result.value;
                return;
            }
            failedCount += blockTargets[index]?.[1].size ?? 0;
        });

        this.scheduleHighlightRefresh(0);
        this.schedulePanelRefresh(0);
        if (failedCount > 0) {
            showMessage(
                this.plugin.i18n.annotationDeleteAllPartial
                    .replace("${deleted}", String(deletedCount))
                    .replace("${failed}", String(failedCount)),
                6000,
                "error",
            );
            return;
        }
        showMessage(
            this.plugin.i18n.annotationDeleteAllSucceeded.replace(
                "${count}",
                String(deletedCount),
            ),
            3000,
        );
    }

    private queueBlockSave(blockId: string, save: () => Promise<void>) {
        const previous = this.blockSaveQueues.get(blockId) ?? Promise.resolve();
        const operation = previous.catch(() => undefined).then(save);
        this.blockSaveQueues.set(blockId, operation);
        void operation.finally(() => {
            if (this.blockSaveQueues.get(blockId) === operation) {
                this.blockSaveQueues.delete(blockId);
            }
        });
        return operation;
    }

    private async readBlockAnnotations(blockId: string) {
        const response = await fetchSyncPost("/api/attr/getBlockAttrs", {id: blockId});
        if (response.code !== 0) {
            throw new Error(response.msg || this.plugin.i18n.annotationLoadFailed);
        }
        const attrs = response.data as BlockAttrsResponse | null;
        return parseAnnotations(attrs?.[ANNOTATION_ATTRIBUTE]);
    }

    private async writeBlockAnnotations(blockId: string, records: AnnotationRecord[]) {
        const encoded = encodeAnnotations(records);
        const response = await fetchSyncPost("/api/attr/setBlockAttrs", {
            attrs: {
                [ANNOTATION_ATTRIBUTE]: encoded,
            },
            id: blockId,
        });
        if (response.code !== 0) {
            throw new Error(response.msg || this.plugin.i18n.annotationSaveFailed);
        }

        let verified = false;
        for (const delayMilliseconds of SAVE_VERIFICATION_DELAYS_MS) {
            if (delayMilliseconds > 0) {
                await delay(delayMilliseconds);
            }
            const readback = await this.readBlockAnnotations(blockId);
            if (annotationRecordsEqual(readback, records)) {
                verified = true;
                break;
            }
        }
        if (!verified) {
            throw new Error(this.plugin.i18n.annotationVerificationFailed);
        }
        document.querySelectorAll<HTMLElement>(`[data-node-id="${blockId}"]`).forEach((block) => {
            if (encoded) {
                block.setAttribute(ANNOTATION_ATTRIBUTE, encoded);
            } else {
                block.removeAttribute(ANNOTATION_ATTRIBUTE);
            }
        });
    }

    private scheduleHighlightRefresh(delay = HIGHLIGHT_REFRESH_DELAY_MS) {
        window.clearTimeout(this.highlightRefreshTimer);
        this.highlightRefreshTimer = window.setTimeout(() => this.renderHighlights(), delay);
    }

    private renderHighlights() {
        const backgroundGrouped = new Map<string, Range[]>();
        const underlineGrouped = new Map<string, Range[]>();
        const rendered: RenderedAnnotation[] = [];
        document.querySelectorAll<HTMLElement>(
            `.protyle-wysiwyg [data-node-id][${ANNOTATION_ATTRIBUTE}]`,
        ).forEach((block) => {
            const blockId = block.dataset.nodeId;
            if (!blockId) {
                return;
            }
            const editor = getAllEditor().find((item) => item.protyle.element.contains(block));
            const rootId = editor?.protyle.block.rootID;
            if (!rootId) {
                return;
            }
            parseAnnotations(block.getAttribute(ANNOTATION_ATTRIBUTE)).forEach((record) => {
                const range = resolveAnnotationRange(block, record);
                if (!range) {
                    return;
                }
                if (record.lineStyle !== "none") {
                    const name = annotationHighlightName(record.color, record.lineStyle);
                    const ranges = underlineGrouped.get(name) ?? [];
                    ranges.push(range);
                    underlineGrouped.set(name, ranges);
                }
                if (record.backgroundColor !== "none") {
                    const backgroundName = annotationBackgroundHighlightName(record.backgroundColor);
                    const backgroundRanges = backgroundGrouped.get(backgroundName) ?? [];
                    backgroundRanges.push(range);
                    backgroundGrouped.set(backgroundName, backgroundRanges);
                }
                rendered.push({blockId, range, record, rootId});
            });
        });

        this.clearAnnotationHighlights();
        backgroundGrouped.forEach((ranges, name) => {
            CSS.highlights.set(name, new Highlight(...ranges));
        });
        underlineGrouped.forEach((ranges, name) => {
            CSS.highlights.set(name, new Highlight(...ranges));
        });
        this.renderedAnnotations = rendered;
    }

    private clearAnnotationHighlights() {
        this.hideAnnotationHover();
        ANNOTATION_BACKGROUND_HIGHLIGHT_NAMES.forEach((name) => CSS.highlights.delete(name));
        ANNOTATION_HIGHLIGHT_NAMES.forEach((name) => CSS.highlights.delete(name));
        this.renderedAnnotations = [];
    }

    private annotationsAtPoint(x: number, y: number) {
        return this.renderedAnnotations.filter((rendered) =>
            [...rendered.range.getClientRects()].some((rect) =>
                x >= rect.left - 2 &&
                x <= rect.right + 2 &&
                y >= rect.top - 2 &&
                y <= rect.bottom + 2
            )
        ).sort((left, right) => right.record.updatedAt - left.record.updatedAt);
    }

    private showAnnotationHover(rendered: RenderedAnnotation[], x: number, y: number) {
        window.clearTimeout(this.hoverHideTimer);
        const key = rendered.map((item) => `${item.blockId}:${item.record.id}`).join("|");
        let created = false;
        if (!this.hoverRoot || this.hoverKey !== key) {
            this.hideAnnotationHover();
            const root = document.createElement("aside");
            root.className = "stillmark-annotation-hover";
            root.setAttribute("aria-label", this.plugin.i18n.annotationHoverTitle);
            root.setAttribute("role", "dialog");
            const header = document.createElement("div");
            header.className = "stillmark-annotation-hover__header";
            const count = document.createElement("span");
            count.textContent = this.plugin.i18n.annotationHoverCount.replace(
                "${count}",
                String(rendered.length),
            );
            const deleteAll = document.createElement("button");
            deleteAll.type = "button";
            deleteAll.className = "stillmark-annotation-hover__delete-all";
            deleteAll.textContent = this.plugin.i18n.annotationDeleteAll;
            deleteAll.addEventListener("pointerdown", (event) => {
                event.stopPropagation();
            });
            deleteAll.addEventListener("click", (event) => {
                event.stopPropagation();
                this.confirmDeleteAllAnnotations(rendered.map((item) => ({
                    annotationId: item.record.id,
                    blockId: item.blockId,
                })));
            });
            header.append(count, deleteAll);

            root.replaceChildren(
                header,
                ...rendered.map((item) => {
                    const entry = document.createElement("div");
                    entry.className = "stillmark-annotation-hover__entry";
                    entry.dataset.backgroundColor = item.record.backgroundColor;

                    const meta = document.createElement("div");
                    meta.className = "stillmark-annotation-hover__meta";
                    const tag = document.createElement("span");
                    tag.textContent = item.record.tag === "none" ?
                        this.plugin.i18n.annotationTag_none :
                        `${TAG_ICONS[item.record.tag]} ${this.plugin.i18n[`annotationTag_${item.record.tag}`]}`;
                    const time = document.createElement("time");
                    time.dateTime = new Date(item.record.updatedAt).toISOString();
                    time.textContent = formatShanghaiTime(item.record.updatedAt);
                    const actions = document.createElement("div");
                    actions.className = "stillmark-annotation-hover__actions";
                    const deleteButton = document.createElement("button");
                    deleteButton.type = "button";
                    deleteButton.className = "stillmark-annotation-hover__delete";
                    deleteButton.textContent = this.plugin.i18n.annotationDeleteOne;
                    deleteButton.title = this.plugin.i18n.annotationDelete;
                    deleteButton.addEventListener("pointerdown", (event) => {
                        event.stopPropagation();
                    });
                    deleteButton.addEventListener("click", (event) => {
                        event.stopPropagation();
                        this.confirmDeleteAnnotation(item.blockId, item.record);
                    });
                    actions.append(time, deleteButton);
                    meta.append(tag, actions);

                    const note = document.createElement("div");
                    note.className = "stillmark-annotation-hover__note";
                    note.textContent = item.record.note || this.plugin.i18n.annotationNoNote;
                    entry.append(meta, note);
                    return entry;
                }),
            );
            document.body.append(root);
            this.hoverKey = key;
            this.hoverRoot = root;
            created = true;
        }
        if (created) {
            this.positionAnnotationHover(x, y);
        }
    }

    private positionAnnotationHover(x: number, y: number) {
        if (!this.hoverRoot) {
            return;
        }
        const margin = 8;
        const offset = 14;
        const width = this.hoverRoot.offsetWidth;
        const height = this.hoverRoot.offsetHeight;
        const left = x + offset + width <= window.innerWidth - margin ?
            x + offset :
            Math.max(margin, x - width - offset);
        const top = y + offset + height <= window.innerHeight - margin ?
            y + offset :
            Math.max(margin, y - height - offset);
        this.hoverRoot.style.left = `${left}px`;
        this.hoverRoot.style.top = `${top}px`;
    }

    private hideAnnotationHover() {
        window.clearTimeout(this.hoverHideTimer);
        this.hoverRoot?.remove();
        this.hoverRoot = undefined;
        this.hoverKey = "";
    }

    private scheduleAnnotationHoverHide() {
        window.clearTimeout(this.hoverHideTimer);
        this.hoverHideTimer = window.setTimeout(() => this.hideAnnotationHover(), 160);
    }

    private async toggleOverview(anchor: HTMLElement) {
        if (this.overviewRoot) {
            this.hideOverview();
            return;
        }

        const root = document.createElement("section");
        root.className = "stillmark-annotation-overview";
        root.setAttribute("aria-label", this.plugin.i18n.annotationPageOverviewTitle);
        root.setAttribute("role", "dialog");

        const header = document.createElement("div");
        header.className = "stillmark-annotation-overview__header";
        const title = document.createElement("strong");
        title.textContent = this.plugin.i18n.annotationPageOverviewTitle;
        const count = document.createElement("span");
        count.className = "stillmark-annotations-dock__count stillmark-annotation-overview__count";
        count.textContent = "0";
        const close = document.createElement("button");
        close.type = "button";
        close.className = "b3-tooltips__nw b3-button--cancel stillmark-annotation-overview__close";
        close.setAttribute("aria-label", this.plugin.i18n.annotationClosePageOverview);
        close.title = this.plugin.i18n.annotationClosePageOverview;
        close.textContent = "×";
        close.addEventListener("click", () => this.hideOverview());
        header.append(title, count, close);

        const search = document.createElement("input");
        search.type = "search";
        search.className = "b3-text-field stillmark-annotation-overview__search";
        search.placeholder = this.plugin.i18n.annotationSearchPlaceholder;
        search.addEventListener("input", () => this.renderOverviewItems());

        const list = document.createElement("div");
        list.className = "stillmark-annotations-dock__list stillmark-annotation-overview__list";
        const empty = document.createElement("div");
        empty.className = "stillmark-annotations-dock__empty stillmark-annotation-overview__empty";
        empty.textContent = this.plugin.i18n.annotationLoading;

        root.append(header, search, list, empty);
        document.body.append(root);
        this.overviewButton?.setAttribute("aria-expanded", "true");
        this.overviewRoot = root;
        this.overviewCount = count;
        this.overviewSearch = search;
        this.overviewList = list;
        this.overviewEmpty = empty;
        this.positionOverview(anchor);
        this.renderOverview();
        await this.refreshPanel();
    }

    private positionOverview(anchor: HTMLElement) {
        if (!this.overviewRoot) {
            return;
        }
        const rect = anchor.getBoundingClientRect();
        const width = this.overviewRoot.offsetWidth;
        const left = Math.min(
            Math.max(8, rect.left),
            Math.max(8, window.innerWidth - width - 8),
        );
        this.overviewRoot.style.left = `${left}px`;
        this.overviewRoot.style.top = `${rect.bottom + 10}px`;
    }

    private hideOverview() {
        this.overviewButton?.setAttribute("aria-expanded", "false");
        this.overviewRoot?.remove();
        this.overviewRoot = undefined;
        this.overviewCount = undefined;
        this.overviewEmpty = undefined;
        this.overviewList = undefined;
        this.overviewSearch = undefined;
    }

    private renderOverview() {
        if (!this.overviewRoot || !this.overviewCount || !this.overviewSearch) {
            return;
        }
        const hasDocument = BLOCK_ID_PATTERN.test(this.activeRootId);
        this.overviewCount.textContent = String(this.items.length);
        this.overviewSearch.hidden = !hasDocument;
        this.renderOverviewItems();
    }

    private renderOverviewItems() {
        if (!this.overviewList || !this.overviewEmpty) {
            return;
        }
        const hasDocument = BLOCK_ID_PATTERN.test(this.activeRootId);
        const query = this.overviewSearch?.value.trim().toLocaleLowerCase() ?? "";
        const filtered = this.items.filter((item) =>
            !query || `${item.record.quote}\n${item.record.note}`.toLocaleLowerCase().includes(query)
        );
        this.overviewList.replaceChildren(...filtered.map((item) => this.createDockCard(item)));
        this.overviewList.hidden = filtered.length === 0;
        this.overviewEmpty.hidden = filtered.length > 0;
        this.overviewEmpty.dataset.state = "";
        if (!hasDocument) {
            this.overviewEmpty.textContent = this.plugin.i18n.annotationNoDocument;
        } else if (this.items.length === 0) {
            this.overviewEmpty.textContent = this.plugin.i18n.annotationEmpty;
        } else {
            this.overviewEmpty.textContent = this.plugin.i18n.annotationNoMatches;
        }
    }

    private setPanelState(message: string, state: "" | "error" | "loading") {
        if (state) {
            [this.dockList, this.overviewList].forEach((list) => {
                if (list) {
                    list.hidden = true;
                }
            });
        }
        [this.dockEmpty, this.overviewEmpty].forEach((empty) => {
            if (!empty) {
                return;
            }
            empty.textContent = message;
            empty.dataset.state = state;
            empty.hidden = false;
        });
    }

    private mountDock(root: HTMLElement) {
        root.classList.add("stillmark-annotations-dock");
        const header = document.createElement("div");
        header.className = "stillmark-annotations-dock__header";
        const title = document.createElement("strong");
        title.textContent = this.plugin.i18n.annotationPanelTitle;
        const count = document.createElement("span");
        count.className = "stillmark-annotations-dock__count";
        count.textContent = "0";
        header.append(title, count);

        const filters = document.createElement("div");
        filters.className = "stillmark-annotations-dock__filters";
        const search = document.createElement("input");
        search.type = "search";
        search.className = "b3-text-field stillmark-annotations-dock__search";
        search.placeholder = this.plugin.i18n.annotationSearchPlaceholder;
        search.addEventListener("input", () => this.renderDockItems());
        const list = document.createElement("div");
        list.className = "stillmark-annotations-dock__list";
        const empty = document.createElement("div");
        empty.className = "stillmark-annotations-dock__empty";
        empty.textContent = this.plugin.i18n.annotationNoDocument;
        root.replaceChildren(header, filters, search, list, empty);

        this.dockRoot = root;
        this.dockCount = count;
        this.dockFilters = filters;
        this.dockSearch = search;
        this.dockList = list;
        this.dockEmpty = empty;
        this.schedulePanelRefresh(0);
    }

    private schedulePanelRefresh(delay = PANEL_REFRESH_DELAY_MS) {
        if (!this.dockRoot && !this.overviewRoot) {
            return;
        }
        window.clearTimeout(this.panelRefreshTimer);
        this.panelRefreshTimer = window.setTimeout(() => {
            void this.refreshPanel();
        }, delay);
    }

    private async refreshPanel() {
        const rootId = getActiveEditor()?.protyle.block.rootID ?? this.activeRootId;
        this.activeRootId = rootId;
        if (!BLOCK_ID_PATTERN.test(rootId)) {
            this.items = [];
            this.renderDock();
            this.renderOverview();
            return;
        }

        const requestedRootId = rootId;
        this.setPanelState(this.plugin.i18n.annotationLoading, "loading");
        try {
            const response = await fetchSyncPost("/api/query/sql", {
                stmt: `SELECT id, root_id FROM blocks WHERE root_id = '${rootId}' ` +
                    `AND ial LIKE '%${ANNOTATION_ATTRIBUTE}%' ORDER BY sort ASC`,
            });
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.annotationLoadFailed);
            }
            if (requestedRootId !== this.activeRootId) {
                return;
            }

            const rows = Array.isArray(response.data) ? response.data as AnnotationSqlRow[] : [];
            const items = (await Promise.all(
                rows.filter((row) => Boolean(row.id && BLOCK_ID_PATTERN.test(row.id))).map(async (row) => {
                    const blockId = row.id!;
                    const records = await this.readBlockAnnotations(blockId);
                    const visibleBlock = document.querySelector<HTMLElement>(
                        `.protyle-wysiwyg [data-node-id="${blockId}"]`,
                    );
                    return records.map((record): AnnotationListItem => ({
                        blockId,
                        orphaned: Boolean(visibleBlock && !resolveAnnotationRange(visibleBlock, record)),
                        record,
                        rootId,
                    }));
                }),
            )).flat();
            if (requestedRootId !== this.activeRootId) {
                return;
            }
            this.items = items;
            this.renderDock();
            this.renderOverview();
        } catch (error) {
            if (requestedRootId !== this.activeRootId) {
                return;
            }
            this.items = [];
            this.renderDock();
            this.renderOverview();
            this.setPanelState(
                `${this.plugin.i18n.annotationLoadFailed}: ${errorMessage(error)}`,
                "error",
            );
        }
    }

    private renderDock() {
        if (!this.dockRoot || !this.dockCount || !this.dockFilters || !this.dockEmpty) {
            return;
        }
        const hasDocument = BLOCK_ID_PATTERN.test(this.activeRootId);
        this.dockCount.textContent = String(this.items.length);
        this.dockFilters.hidden = !hasDocument;
        if (this.dockSearch) {
            this.dockSearch.hidden = !hasDocument;
        }
        this.renderDockFilters();
        this.renderDockItems();
    }

    private renderDockFilters() {
        if (!this.dockFilters) {
            return;
        }
        const counts = new Map<AnnotationTag, number>();
        ANNOTATION_TAGS.forEach((tag) => counts.set(tag, 0));
        this.items.forEach((item) => counts.set(item.record.tag, (counts.get(item.record.tag) ?? 0) + 1));
        const entries: Array<{label: string; tag: AnnotationTag | "all";}> = [
            {label: this.plugin.i18n.annotationFilterAll, tag: "all"},
            ...ANNOTATION_TAGS.filter((tag) => tag !== "none").map((tag) => ({
                label: `${TAG_ICONS[tag]} ${this.plugin.i18n[`annotationTag_${tag}`]}`,
                tag,
            })),
        ];
        this.dockFilters.replaceChildren(...entries.map((entry) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "stillmark-annotations-dock__filter";
            const count = entry.tag === "all" ? this.items.length : counts.get(entry.tag) ?? 0;
            button.textContent = `${entry.label} ${count}`;
            button.classList.toggle("is-active", this.activeFilter === entry.tag);
            button.addEventListener("click", () => {
                this.activeFilter = entry.tag;
                this.renderDockFilters();
                this.renderDockItems();
            });
            return button;
        }));
    }

    private renderDockItems() {
        if (!this.dockList || !this.dockEmpty) {
            return;
        }
        const hasDocument = BLOCK_ID_PATTERN.test(this.activeRootId);
        const query = this.dockSearch?.value.trim().toLocaleLowerCase() ?? "";
        const filtered = this.items.filter((item) =>
            (this.activeFilter === "all" || item.record.tag === this.activeFilter) &&
            (!query || `${item.record.quote}\n${item.record.note}`.toLocaleLowerCase().includes(query))
        );
        this.dockList.replaceChildren(...filtered.map((item) => this.createDockCard(item)));
        this.dockList.hidden = filtered.length === 0;
        this.dockEmpty.hidden = filtered.length > 0;
        this.dockEmpty.dataset.state = "";
        if (!hasDocument) {
            this.dockEmpty.textContent = this.plugin.i18n.annotationNoDocument;
        } else if (this.items.length === 0) {
            this.dockEmpty.textContent = this.plugin.i18n.annotationEmpty;
        } else {
            this.dockEmpty.textContent = this.plugin.i18n.annotationNoMatches;
        }
    }

    private createDockCard(item: AnnotationListItem) {
        const card = document.createElement("article");
        card.className = "stillmark-annotations-dock__card";
        const style = annotationStyleForTag(item.record.tag);
        card.dataset.backgroundColor = style.backgroundColor;
        card.dataset.color = style.color;
        card.dataset.lineStyle = item.record.lineStyle;

        const meta = document.createElement("div");
        meta.className = "stillmark-annotations-dock__meta";
        const tag = document.createElement("span");
        tag.className = "stillmark-annotations-dock__tag";
        tag.dataset.tag = item.record.tag;
        tag.textContent = item.record.tag === "none" ?
            this.plugin.i18n.annotationTag_none :
            `${TAG_ICONS[item.record.tag]} ${this.plugin.i18n[`annotationTag_${item.record.tag}`]}`;
        const time = document.createElement("time");
        time.dateTime = new Date(item.record.updatedAt).toISOString();
        time.textContent = formatShanghaiTime(item.record.updatedAt);
        meta.append(tag, time);
        if (item.orphaned) {
            const orphan = document.createElement("span");
            orphan.className = "stillmark-annotations-dock__orphan";
            orphan.textContent = this.plugin.i18n.annotationOrphaned;
            meta.append(orphan);
        }

        const quote = document.createElement("button");
        quote.type = "button";
        quote.className = "stillmark-annotations-dock__quote";
        quote.textContent = item.record.quote;
        quote.title = item.record.quote;
        quote.addEventListener("click", () => {
            void this.focusAnnotation(item);
        });

        const footer = document.createElement("div");
        footer.className = "stillmark-annotations-dock__card-footer";
        const note = document.createElement("div");
        note.className = "stillmark-annotations-dock__note";
        note.textContent = item.record.note || this.plugin.i18n.annotationNoNote;
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "b3-button b3-button--cancel stillmark-annotations-dock__edit";
        edit.textContent = this.plugin.i18n.annotationEdit;
        edit.addEventListener("click", () => {
            this.openEditEditor(item.blockId, item.rootId, item.record);
        });
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "b3-button b3-button--cancel stillmark-annotations-dock__delete";
        deleteButton.textContent = this.plugin.i18n.annotationDeleteOne;
        deleteButton.title = this.plugin.i18n.annotationDelete;
        deleteButton.addEventListener("click", () => {
            this.confirmDeleteAnnotation(item.blockId, item.record);
        });
        footer.append(note, edit, deleteButton);
        card.append(meta, quote, footer);
        return card;
    }

    private async focusAnnotation(item: AnnotationListItem) {
        await this.openBlock(item.blockId);
        const range = await this.waitForAnnotationRange(item.blockId, item.record);
        if (!range) {
            showMessage(this.plugin.i18n.annotationOrphanedMessage, 4000, "error");
            return;
        }
        const block = range.commonAncestorContainer instanceof Element ?
            range.commonAncestorContainer.closest<HTMLElement>("[data-node-id]") :
            range.commonAncestorContainer.parentElement?.closest<HTMLElement>("[data-node-id]");
        block?.scrollIntoView({behavior: "smooth", block: "center"});
        CSS.highlights.set("stillmark-annotation-current", new Highlight(range));
        window.clearTimeout(this.currentHighlightTimer);
        this.currentHighlightTimer = window.setTimeout(() => {
            CSS.highlights.delete("stillmark-annotation-current");
        }, 2400);
    }

    private async waitForAnnotationRange(blockId: string, record: AnnotationRecord) {
        for (let attempt = 0; attempt < 18; attempt += 1) {
            const block = [...document.querySelectorAll<HTMLElement>(
                `.protyle-wysiwyg [data-node-id="${blockId}"]`,
            )].find((element) => element.offsetParent !== null);
            if (block) {
                const range = resolveAnnotationRange(block, record);
                if (range) {
                    return range;
                }
            }
            await delay(80);
        }
        return null;
    }

    private async openBlock(id: string) {
        if (isMobile()) {
            openMobileFileById(this.plugin.app, id, OPEN_BLOCK_ACTIONS);
            return;
        }
        await openTab({
            app: this.plugin.app,
            doc: {
                action: OPEN_BLOCK_ACTIONS,
                id,
            },
            openNewTab: false,
        });
    }
}

function isMobile() {
    return ["mobile", "browser-mobile"].includes(getFrontend());
}

function formatShanghaiTime(timestamp: number) {
    const parts = new Intl.DateTimeFormat("zh-CN", {
        day: "2-digit",
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        month: "2-digit",
        timeZone: "Asia/Shanghai",
        year: "numeric",
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function delay(milliseconds: number) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
