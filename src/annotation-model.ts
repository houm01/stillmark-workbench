export const ANNOTATION_ATTRIBUTE = "custom-stillmark-annotations";
export const ANNOTATION_MAX_NOTE_LENGTH = 4000;
export const ANNOTATION_MAX_QUOTE_LENGTH = 2000;

export const ANNOTATION_COLORS = [
    "default",
    "yellow",
    "green",
    "blue",
    "pink",
    "orange",
    "purple",
] as const;

export const ANNOTATION_BACKGROUND_COLORS = [
    "none",
    "yellow",
    "green",
    "blue",
    "pink",
    "orange",
    "purple",
] as const;

export const ANNOTATION_LINE_STYLES = [
    "none",
    "solid",
    "wavy",
    "dashed",
    "dotted",
    "double",
] as const;

export const ANNOTATION_TAGS = [
    "none",
    "pin",
    "important",
    "reading",
    "question",
    "todo",
] as const;

export type AnnotationColor = typeof ANNOTATION_COLORS[number];
export type AnnotationBackgroundColor = typeof ANNOTATION_BACKGROUND_COLORS[number];
export type AnnotationLineStyle = typeof ANNOTATION_LINE_STYLES[number];
export type AnnotationTag = typeof ANNOTATION_TAGS[number];

export interface AnnotationVisualStyle {
    backgroundColor: AnnotationBackgroundColor;
    color: AnnotationColor;
}

export interface AnnotationRecord {
    backgroundColor: AnnotationBackgroundColor;
    color: AnnotationColor;
    createdAt: number;
    end: number;
    id: string;
    lineStyle: AnnotationLineStyle;
    note: string;
    prefix: string;
    quote: string;
    start: number;
    suffix: string;
    tag: AnnotationTag;
    updatedAt: number;
}

export interface AnnotationSelection {
    backgroundColor: AnnotationBackgroundColor;
    blockId: string;
    color: AnnotationColor;
    end: number;
    lineStyle: AnnotationLineStyle;
    prefix: string;
    quote: string;
    rootId: string;
    start: number;
    suffix: string;
    tag: AnnotationTag;
}

export interface AnnotationListItem {
    blockId: string;
    orphaned: boolean;
    record: AnnotationRecord;
    rootId: string;
}

interface TextNodeIndex {
    fullText: string;
    nodes: Text[];
    offsets: number[];
}

type StoredAnnotationRecord = Omit<AnnotationRecord, "backgroundColor"> & {
    backgroundColor?: AnnotationBackgroundColor;
};

export function annotationHighlightName(color: AnnotationColor, lineStyle: AnnotationLineStyle) {
    return `stillmark-annotation-${color}-${lineStyle}`;
}

export function annotationBackgroundHighlightName(color: Exclude<AnnotationBackgroundColor, "none">) {
    return `stillmark-annotation-background-${color}`;
}

export function createAnnotationRecord(
    selection: AnnotationSelection,
    note: string,
    now = Date.now(),
): AnnotationRecord {
    const style = annotationStyleForTag(selection.tag);
    return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        createdAt: now,
        end: selection.end,
        id: `${now.toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
        lineStyle: selection.lineStyle,
        note: note.trim(),
        prefix: selection.prefix,
        quote: selection.quote,
        start: selection.start,
        suffix: selection.suffix,
        tag: selection.tag,
        updatedAt: now,
    };
}

export function encodeAnnotations(records: AnnotationRecord[]) {
    return records.length === 0 ? "" : JSON.stringify(records);
}

export function annotationRecordsEqual(left: AnnotationRecord[], right: AnnotationRecord[]) {
    if (left.length !== right.length) {
        return false;
    }
    const leftById = new Map(left.map((record) => [record.id, record]));
    return right.every((record) => {
        const candidate = leftById.get(record.id);
        return candidate &&
            candidate.backgroundColor === record.backgroundColor &&
            candidate.color === record.color &&
            candidate.createdAt === record.createdAt &&
            candidate.end === record.end &&
            candidate.lineStyle === record.lineStyle &&
            candidate.note === record.note &&
            candidate.prefix === record.prefix &&
            candidate.quote === record.quote &&
            candidate.start === record.start &&
            candidate.suffix === record.suffix &&
            candidate.tag === record.tag &&
            candidate.updatedAt === record.updatedAt;
    });
}

export function parseAnnotations(value: string | null | undefined): AnnotationRecord[] {
    if (!value) {
        return [];
    }

    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter(isAnnotationRecord).map((record) => {
            const style = annotationStyleForTag(record.tag);
            return {
                ...record,
                backgroundColor: style.backgroundColor,
                color: style.color,
            };
        });
    } catch {
        return [];
    }
}

export function captureAnnotationSelection(
    block: HTMLElement,
    range: Range,
    rootId: string,
): AnnotationSelection | null {
    if (!block.dataset.nodeId || range.collapsed || !block.contains(range.commonAncestorContainer)) {
        return null;
    }

    const index = indexBlockText(block);
    const start = boundaryOffset(index, range.startContainer, range.startOffset);
    const end = boundaryOffset(index, range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) {
        return null;
    }

    const quote = index.fullText.slice(start, end);
    if (!quote.trim() || quote.length > ANNOTATION_MAX_QUOTE_LENGTH) {
        return null;
    }

    const style = annotationStyleForTag("none");
    return {
        backgroundColor: style.backgroundColor,
        blockId: block.dataset.nodeId,
        color: style.color,
        end,
        lineStyle: "none",
        prefix: index.fullText.slice(Math.max(0, start - 32), start),
        quote,
        rootId,
        start,
        suffix: index.fullText.slice(end, end + 32),
        tag: "none",
    };
}

export function resolveAnnotationRange(block: HTMLElement, record: AnnotationRecord) {
    const index = indexBlockText(block);
    const anchor = resolveAnchor(index.fullText, record);
    if (!anchor) {
        return null;
    }

    const start = locateTextPosition(index, anchor.start);
    const end = locateTextPosition(index, anchor.end);
    if (!start || !end) {
        return null;
    }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
}

export function selectionFromRecord(
    blockId: string,
    rootId: string,
    record: AnnotationRecord,
): AnnotationSelection {
    const style = annotationStyleForTag(record.tag);
    return {
        backgroundColor: style.backgroundColor,
        blockId,
        color: style.color,
        end: record.end,
        lineStyle: record.lineStyle,
        prefix: record.prefix,
        quote: record.quote,
        rootId,
        start: record.start,
        suffix: record.suffix,
        tag: record.tag,
    };
}

export function annotationStyleForTag(tag: AnnotationTag): AnnotationVisualStyle {
    const styles: Record<AnnotationTag, AnnotationVisualStyle> = {
        important: {backgroundColor: "pink", color: "pink"},
        none: {backgroundColor: "yellow", color: "yellow"},
        pin: {backgroundColor: "purple", color: "purple"},
        question: {backgroundColor: "orange", color: "orange"},
        reading: {backgroundColor: "blue", color: "blue"},
        todo: {backgroundColor: "green", color: "green"},
    };
    return styles[tag];
}

function indexBlockText(block: HTMLElement): TextNodeIndex {
    const nodes: Text[] = [];
    const offsets: number[] = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
            isEditableBlockText(node, block) ?
                NodeFilter.FILTER_ACCEPT :
                NodeFilter.FILTER_REJECT,
    });
    let fullText = "";
    let current = walker.nextNode();
    while (current) {
        const text = current as Text;
        offsets.push(fullText.length);
        nodes.push(text);
        fullText += text.data;
        current = walker.nextNode();
    }
    return {fullText, nodes, offsets};
}

function isEditableBlockText(node: Node, block: HTMLElement) {
    const parent = node.parentElement;
    if (!parent || parent.closest("[data-node-id]") !== block) {
        return false;
    }
    if (parent.closest(".protyle-attr, .protyle-action")) {
        return false;
    }
    return Boolean(parent.closest('[contenteditable="true"]'));
}

function boundaryOffset(index: TextNodeIndex, container: Node, offset: number) {
    if (container.nodeType === Node.TEXT_NODE) {
        const nodeIndex = index.nodes.indexOf(container as Text);
        if (nodeIndex < 0) {
            return null;
        }
        return index.offsets[nodeIndex] + Math.min(offset, (container as Text).data.length);
    }

    const boundary = document.createRange();
    try {
        boundary.setStart(container, offset);
        boundary.collapse(true);
    } catch {
        return null;
    }

    for (let nodeIndex = 0; nodeIndex < index.nodes.length; nodeIndex += 1) {
        const node = index.nodes[nodeIndex];
        const relation = boundary.comparePoint(node, 0);
        if (relation >= 0) {
            return index.offsets[nodeIndex];
        }
    }
    return index.fullText.length;
}

function locateTextPosition(index: TextNodeIndex, absoluteOffset: number) {
    const normalizedOffset = Math.max(0, Math.min(index.fullText.length, absoluteOffset));
    for (let nodeIndex = 0; nodeIndex < index.nodes.length; nodeIndex += 1) {
        const node = index.nodes[nodeIndex];
        const start = index.offsets[nodeIndex];
        const end = start + node.data.length;
        if (normalizedOffset <= end) {
            return {
                node,
                offset: Math.max(0, normalizedOffset - start),
            };
        }
    }
    const lastNode = index.nodes.at(-1);
    return lastNode ? {node: lastNode, offset: lastNode.data.length} : null;
}

function resolveAnchor(fullText: string, record: AnnotationRecord) {
    if (fullText.slice(record.start, record.end) === record.quote) {
        return {start: record.start, end: record.end};
    }

    const occurrences: number[] = [];
    let cursor = fullText.indexOf(record.quote);
    while (cursor >= 0) {
        occurrences.push(cursor);
        cursor = fullText.indexOf(record.quote, cursor + Math.max(1, record.quote.length));
    }
    if (occurrences.length === 0) {
        return null;
    }

    const scored = occurrences.map((start) => ({
        score: anchorContextScore(fullText, start, record),
        start,
    })).sort((left, right) =>
        right.score - left.score || Math.abs(left.start - record.start) -
            Math.abs(right.start - record.start)
    );
    return {
        start: scored[0].start,
        end: scored[0].start + record.quote.length,
    };
}

function anchorContextScore(fullText: string, start: number, record: AnnotationRecord) {
    const before = fullText.slice(Math.max(0, start - record.prefix.length), start);
    const after = fullText.slice(start + record.quote.length, start + record.quote.length + record.suffix.length);
    return sharedSuffixLength(before, record.prefix) + sharedPrefixLength(after, record.suffix);
}

function sharedPrefixLength(left: string, right: string) {
    let length = 0;
    while (length < left.length && length < right.length && left[length] === right[length]) {
        length += 1;
    }
    return length;
}

function sharedSuffixLength(left: string, right: string) {
    let length = 0;
    while (
        length < left.length &&
        length < right.length &&
        left[left.length - 1 - length] === right[right.length - 1 - length]
    ) {
        length += 1;
    }
    return length;
}

function isAnnotationRecord(value: unknown): value is StoredAnnotationRecord {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value as Partial<StoredAnnotationRecord>;
    return (
        typeof record.id === "string" &&
        typeof record.quote === "string" &&
        record.quote.length > 0 &&
        record.quote.length <= ANNOTATION_MAX_QUOTE_LENGTH &&
        typeof record.start === "number" &&
        typeof record.end === "number" &&
        record.end > record.start &&
        typeof record.note === "string" &&
        record.note.length <= ANNOTATION_MAX_NOTE_LENGTH &&
        typeof record.createdAt === "number" &&
        typeof record.updatedAt === "number" &&
        typeof record.prefix === "string" &&
        typeof record.suffix === "string" &&
        ANNOTATION_COLORS.includes(record.color as AnnotationColor) &&
        ANNOTATION_LINE_STYLES.includes(record.lineStyle as AnnotationLineStyle) &&
        ANNOTATION_TAGS.includes(record.tag as AnnotationTag)
    );
}
