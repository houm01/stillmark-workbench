import {
    IProtyle,
    Plugin,
    fetchSyncPost,
    getActiveEditor,
    getFrontend,
    openTab,
} from "siyuan";

const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const SEARCH_DEBOUNCE_MS = 140;
const SEARCH_PAGE_SIZE = 512;
const MAX_QUERY_LENGTH = 256;
const MATCH_HIGHLIGHT_NAME = "stillmark-document-find-match";
const CURRENT_HIGHLIGHT_NAME = "stillmark-document-find-current";
const CURRENT_BLOCK_CLASS = "stillmark-document-find__current-block";

interface SearchBlock {
    id: string;
    rootID: string;
    content?: string;
    children?: SearchBlock[];
}

interface SearchResponseData {
    blocks?: SearchBlock[];
    pageCount?: number;
}

type BlockDomResponseData = Record<string, string>;

interface DocumentMatch {
    blockId: string;
    occurrence: number;
}

interface LoadedRange {
    blockId: string;
    occurrence: number;
    range: Range;
}

export class DocumentFindFeature {
    private currentIndex = -1;
    private input?: HTMLInputElement;
    private matches: DocumentMatch[] = [];
    private nextButton?: HTMLButtonElement;
    private notebookId = "";
    private navigationGeneration = 0;
    private panel?: HTMLElement;
    private path = "";
    private previousButton?: HTMLButtonElement;
    private protyle?: IProtyle;
    private query = "";
    private requestGeneration = 0;
    private rootId = "";
    private searchTimer?: number;
    private status?: HTMLElement;

    private readonly editorChangedHandler = ({detail}: CustomEvent<{protyle: IProtyle;}>) => {
        if (!this.panel) {
            return;
        }
        if (getActiveEditor()?.protyle.element !== detail.protyle.element) {
            return;
        }
        if (detail.protyle.block.rootID !== this.rootId) {
            this.close();
            return;
        }
        this.attachToProtyle(detail.protyle);
        window.setTimeout(() => this.renderHighlights(), 0);
    };

    private readonly destroyProtyleHandler = ({detail}: CustomEvent<{protyle: IProtyle;}>) => {
        if (this.protyle?.element !== detail.protyle.element) {
            return;
        }
        window.setTimeout(() => {
            if (!this.panel || this.protyle?.element !== detail.protyle.element) {
                return;
            }
            const activeProtyle = getActiveEditor()?.protyle;
            if (activeProtyle?.block.rootID === this.rootId) {
                this.attachToProtyle(activeProtyle);
                this.renderHighlights();
            } else if (!document.contains(detail.protyle.element)) {
                this.close();
            }
        }, 0);
    };

    private readonly globalKeydownHandler = (event: KeyboardEvent) => {
        if (!isFindHotkey(event)) {
            return;
        }

        const target = event.target instanceof Node ? event.target : null;
        if (this.panel && target && this.panel.contains(target)) {
            stopShortcut(event);
            this.input?.focus();
            this.input?.select();
            return;
        }

        const protyle = getActiveEditor()?.protyle;
        if (!protyle || !isDocumentEditorTarget(target, protyle) || !isSearchableProtyle(protyle)) {
            return;
        }

        stopShortcut(event);
        this.open(protyle);
    };

    constructor(private readonly plugin: Plugin) {}

    onload() {
        if (isMobile()) {
            return;
        }
        document.addEventListener("keydown", this.globalKeydownHandler, true);
        this.plugin.eventBus.on("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.on("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.on("destroy-protyle", this.destroyProtyleHandler);
    }

    onunload() {
        document.removeEventListener("keydown", this.globalKeydownHandler, true);
        this.plugin.eventBus.off("loaded-protyle-static", this.editorChangedHandler);
        this.plugin.eventBus.off("switch-protyle", this.editorChangedHandler);
        this.plugin.eventBus.off("destroy-protyle", this.destroyProtyleHandler);
        this.close();
    }

    private open(protyle: IProtyle) {
        if (this.panel && this.rootId === protyle.block.rootID) {
            this.attachToProtyle(protyle);
            this.input?.focus();
            this.input?.select();
            return;
        }

        this.close();
        this.protyle = protyle;
        this.rootId = protyle.block.rootID;
        this.notebookId = protyle.notebookId;
        this.path = normalizedDocumentPath(protyle.path);

        const panel = document.createElement("div");
        panel.className = "stillmark-document-find";
        panel.setAttribute("role", "search");
        panel.setAttribute("aria-label", this.plugin.i18n.documentFindTool);
        panel.addEventListener("pointerdown", (event) => event.stopPropagation());

        const input = document.createElement("input");
        input.type = "search";
        input.className = "b3-text-field stillmark-document-find__input";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.maxLength = MAX_QUERY_LENGTH;
        input.placeholder = this.plugin.i18n.documentFindPlaceholder;
        input.value = selectedEditorText(protyle);
        input.addEventListener("input", () => this.scheduleSearch());
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                void this.move(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                this.close(true);
            }
        });

        const status = document.createElement("span");
        status.className = "stillmark-document-find__status";
        status.setAttribute("aria-live", "polite");
        status.textContent = "0 / 0";

        const previousButton = this.createIconButton(
            "iconUp",
            this.plugin.i18n.documentFindPrevious,
            () => void this.move(-1),
        );
        const nextButton = this.createIconButton(
            "iconDown",
            this.plugin.i18n.documentFindNext,
            () => void this.move(1),
        );
        const closeButton = this.createIconButton(
            "iconClose",
            this.plugin.i18n.documentFindClose,
            () => this.close(true),
        );

        panel.append(input, status, previousButton, nextButton, closeButton);
        this.panel = panel;
        this.input = input;
        this.status = status;
        this.previousButton = previousButton;
        this.nextButton = nextButton;
        this.attachToProtyle(protyle);
        this.updateControls();

        input.focus();
        input.select();
        if (input.value) {
            this.scheduleSearch(true);
        }
    }

    private createIconButton(icon: string, label: string, click: () => void) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "block__icon block__icon--show ariaLabel stillmark-document-find__button";
        button.dataset.position = "9south";
        button.setAttribute("aria-label", label);
        button.innerHTML = `<svg><use xlink:href="#${icon}"></use></svg>`;
        button.addEventListener("click", click);
        return button;
    }

    private attachToProtyle(protyle: IProtyle) {
        this.protyle = protyle;
        if (this.panel && this.panel.parentElement !== protyle.element) {
            protyle.element.append(this.panel);
        }
    }

    private scheduleSearch(immediate = false) {
        if (!this.input) {
            return;
        }
        window.clearTimeout(this.searchTimer);
        const generation = ++this.requestGeneration;
        const query = this.input.value.trim();
        this.query = query;
        this.matches = [];
        this.currentIndex = -1;
        ++this.navigationGeneration;
        this.clearHighlights();

        if (!query) {
            this.panel?.removeAttribute("data-state");
            this.updateControls();
            return;
        }

        this.panel?.setAttribute("data-state", "loading");
        if (this.status) {
            this.status.textContent = this.plugin.i18n.documentFindLoading;
        }
        this.updateControls(false);
        this.searchTimer = window.setTimeout(
            () => void this.search(query, generation),
            immediate ? 0 : SEARCH_DEBOUNCE_MS,
        );
    }

    private async search(query: string, generation: number) {
        try {
            const blocks = await this.searchAllPages(query, generation);
            const exactContents = await this.loadExactContents(blocks, generation);
            if (generation !== this.requestGeneration || query !== this.query) {
                return;
            }
            this.matches = buildMatches(blocks, exactContents, query, this.rootId);
            this.currentIndex = this.matches.length > 0 ? 0 : -1;
            this.panel?.setAttribute("data-state", this.matches.length > 0 ? "ready" : "empty");
            this.updateControls();
            if (this.matches.length > 0) {
                await this.navigateToCurrent();
            }
        } catch (error) {
            if (generation !== this.requestGeneration) {
                return;
            }
            console.error("Stillmark document find failed:", error);
            this.matches = [];
            this.currentIndex = -1;
            this.panel?.setAttribute("data-state", "error");
            if (this.status) {
                this.status.textContent = this.plugin.i18n.documentFindFailed;
            }
            this.updateControls(false);
        }
    }

    private async searchAllPages(query: string, generation: number) {
        const blocks: SearchBlock[] = [];
        let page = 1;
        while (true) {
            const response = await fetchSyncPost("/api/search/fullTextSearchBlock", {
                query: `(?i)${escapeRegExp(query)}`,
                method: 3,
                types: allSearchTypes(),
                subTypes: {
                    h1: false,
                    h2: false,
                    h3: false,
                    h4: false,
                    h5: false,
                    h6: false,
                    o: false,
                    u: false,
                    t: false,
                },
                paths: [`${this.notebookId}${this.path}`],
                notebook: this.notebookId,
                groupBy: 1,
                orderBy: 5,
                page,
                pageSize: SEARCH_PAGE_SIZE,
            });
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.documentFindFailed);
            }
            if (generation !== this.requestGeneration) {
                return [];
            }
            const data = response.data as SearchResponseData;
            blocks.push(...(data.blocks ?? []));
            const pageCount = Math.max(1, data.pageCount ?? 1);
            if (page >= pageCount) {
                break;
            }
            page++;
        }
        return blocks;
    }

    private async loadExactContents(blocks: SearchBlock[], generation: number) {
        const contents = new Map<string, string>();
        const blockIds: string[] = [];
        blocks.forEach((root) => {
            if (root.id === this.rootId) {
                contents.set(root.id, htmlText(root.content ?? ""));
            }
            (root.children ?? []).forEach((child) => {
                if (BLOCK_ID_PATTERN.test(child.id)) {
                    blockIds.push(child.id);
                }
            });
        });

        const uniqueBlockIds = [...new Set(blockIds)];
        for (let index = 0; index < uniqueBlockIds.length; index += 128) {
            const ids = uniqueBlockIds.slice(index, index + 128);
            const response = await fetchSyncPost("/api/block/getBlockDOMs", {
                ids,
                notebook: this.notebookId,
            });
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.documentFindFailed);
            }
            if (generation !== this.requestGeneration) {
                return new Map<string, string>();
            }
            const doms = response.data as BlockDomResponseData;
            ids.forEach((id) => contents.set(id, htmlText(doms?.[id] ?? "")));
        }
        return contents;
    }

    private async move(direction: -1 | 1) {
        if (this.matches.length === 0) {
            return;
        }
        this.currentIndex = (this.currentIndex + direction + this.matches.length) % this.matches.length;
        this.updateControls();
        await this.navigateToCurrent();
    }

    private async navigateToCurrent() {
        const match = this.matches[this.currentIndex];
        if (!match || !this.protyle) {
            return;
        }
        const navigationGeneration = ++this.navigationGeneration;

        let targetElement = findBlockElement(this.protyle, match.blockId, this.rootId);
        if (!targetElement) {
            await openTab({
                app: this.plugin.app,
                doc: {
                    id: match.blockId,
                    action: ["cb-get-focus", "cb-get-context", "cb-get-scroll"],
                },
                keepCursor: true,
                openNewTab: false,
            });
            if (navigationGeneration !== this.navigationGeneration || !this.panel) {
                return;
            }
            const activeProtyle = getActiveEditor()?.protyle;
            if (activeProtyle?.block.rootID === this.rootId) {
                this.attachToProtyle(activeProtyle);
            }
            targetElement = await waitForBlock(this.protyle, match.blockId, this.rootId);
        }

        if (navigationGeneration !== this.navigationGeneration || !this.panel) {
            return;
        }

        const currentRange = this.renderHighlights();
        if (currentRange && this.protyle) {
            scrollRangeToCenter(this.protyle, currentRange);
            if (!supportsCssHighlights()) {
                targetElement?.classList.add(CURRENT_BLOCK_CLASS);
            }
        } else if (targetElement) {
            targetElement.classList.add(CURRENT_BLOCK_CLASS);
            targetElement.scrollIntoView({block: "center", inline: "nearest"});
        }
        this.input?.focus({preventScroll: true});
    }

    private renderHighlights() {
        this.clearHighlights();
        if (!this.protyle || !this.query || this.currentIndex < 0) {
            return undefined;
        }

        const current = this.matches[this.currentIndex];
        const ranges = collectLoadedRanges(this.protyle, this.query, this.rootId);
        const matchingBlocks = new Set(this.matches.map((match) => match.blockId));
        const canHighlight = supportsCssHighlights();
        const matchHighlight = canHighlight ? new Highlight() : undefined;
        const currentHighlight = canHighlight ? new Highlight() : undefined;
        let currentRange: Range | undefined;

        ranges.forEach((loadedRange) => {
            if (!matchingBlocks.has(loadedRange.blockId)) {
                return;
            }
            if (loadedRange.blockId === current.blockId && loadedRange.occurrence === current.occurrence) {
                currentHighlight?.add(loadedRange.range);
                currentRange = loadedRange.range;
            } else {
                matchHighlight?.add(loadedRange.range);
            }
        });
        if (matchHighlight && currentHighlight) {
            CSS.highlights.set(MATCH_HIGHLIGHT_NAME, matchHighlight);
            CSS.highlights.set(CURRENT_HIGHLIGHT_NAME, currentHighlight);
        }
        return currentRange;
    }

    private updateControls(updateStatus = true) {
        const hasMatches = this.matches.length > 0;
        if (this.previousButton) {
            this.previousButton.disabled = !hasMatches;
        }
        if (this.nextButton) {
            this.nextButton.disabled = !hasMatches;
        }
        if (updateStatus && this.status) {
            this.status.textContent = hasMatches ? `${this.currentIndex + 1} / ${this.matches.length}` : "0 / 0";
        }
    }

    private clearHighlights() {
        if (supportsCssHighlights()) {
            CSS.highlights.delete(MATCH_HIGHLIGHT_NAME);
            CSS.highlights.delete(CURRENT_HIGHLIGHT_NAME);
        }
        document.querySelectorAll(`.${CURRENT_BLOCK_CLASS}`).forEach((element) => {
            element.classList.remove(CURRENT_BLOCK_CLASS);
        });
    }

    private close(restoreEditorFocus = false) {
        ++this.requestGeneration;
        ++this.navigationGeneration;
        window.clearTimeout(this.searchTimer);
        const protyle = this.protyle;
        this.clearHighlights();
        this.panel?.remove();
        this.panel = undefined;
        this.input = undefined;
        this.status = undefined;
        this.previousButton = undefined;
        this.nextButton = undefined;
        this.protyle = undefined;
        this.rootId = "";
        this.notebookId = "";
        this.path = "";
        this.query = "";
        this.matches = [];
        this.currentIndex = -1;
        if (restoreEditorFocus) {
            protyle?.wysiwyg?.element.focus({preventScroll: true});
        }
    }
}

function isFindHotkey(event: KeyboardEvent) {
    if (event.altKey || event.shiftKey || event.key.toLowerCase() !== "f") {
        return false;
    }
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

function stopShortcut(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

function isDocumentEditorTarget(target: Node, protyle: IProtyle) {
    return document.contains(protyle.element) && protyle.element.contains(target);
}

function isSearchableProtyle(protyle: IProtyle) {
    return !!(
        protyle.block.rootID && BLOCK_ID_PATTERN.test(protyle.block.rootID) &&
        protyle.notebookId && BLOCK_ID_PATTERN.test(protyle.notebookId) &&
        protyle.path && protyle.wysiwyg?.element
    );
}

function normalizedDocumentPath(path: string) {
    return path.endsWith(".sy") ? path : `${path}.sy`;
}

function selectedEditorText(protyle: IProtyle) {
    const selection = getSelection();
    if (
        !selection || selection.isCollapsed || !selection.anchorNode || !protyle.element.contains(selection.anchorNode)
    ) {
        return "";
    }
    return selection.toString().replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

function allSearchTypes(): Config.IUILayoutTabSearchConfigTypes {
    return {
        audioBlock: true,
        blockquote: false,
        callout: false,
        codeBlock: true,
        databaseBlock: true,
        document: true,
        embedBlock: false,
        heading: true,
        htmlBlock: true,
        iframeBlock: true,
        list: false,
        listItem: false,
        mathBlock: true,
        paragraph: true,
        superBlock: false,
        table: true,
        videoBlock: true,
        widgetBlock: true,
    };
}

function buildMatches(blocks: SearchBlock[], contents: Map<string, string>, query: string, rootId: string) {
    const orderedBlocks = new Map<string, SearchBlock>();
    blocks.forEach((root) => {
        if (root.id === rootId && countOccurrences(contents.get(root.id) ?? "", query) > 0) {
            orderedBlocks.set(root.id, root);
        }
        (root.children ?? []).forEach((child) => orderedBlocks.set(child.id, child));
    });

    const matches: DocumentMatch[] = [];
    orderedBlocks.forEach((block) => {
        const count = countOccurrences(contents.get(block.id) ?? "", query);
        for (let occurrence = 0; occurrence < count; occurrence++) {
            matches.push({blockId: block.id, occurrence});
        }
    });
    return matches;
}

function htmlText(value: string) {
    const template = document.createElement("template");
    template.innerHTML = value;
    return template.content.textContent ?? "";
}

function countOccurrences(content: string, query: string) {
    if (!content || !query) {
        return 0;
    }
    return Array.from(content.matchAll(new RegExp(escapeRegExp(query), "giu"))).length;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectLoadedRanges(protyle: IProtyle, query: string, rootId: string) {
    const contentElement = protyle.contentElement ?? protyle.element;
    const textNodes: Text[] = [];
    const cumulativeSizes: number[] = [];
    let totalSize = 0;
    const walker = document.createTreeWalker(contentElement, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    while (currentNode) {
        const parent = currentNode.parentElement;
        if (parent && !parent.closest(".stillmark-document-find")) {
            textNodes.push(currentNode as Text);
            totalSize += currentNode.textContent?.length ?? 0;
            cumulativeSizes.push(totalSize);
        }
        currentNode = walker.nextNode();
    }

    const text = textNodes.map((node) => node.textContent ?? "").join("");
    const occurrences = new Map<string, number>();
    const ranges: LoadedRange[] = [];
    for (const match of text.matchAll(new RegExp(escapeRegExp(query), "giu"))) {
        if (match.index === undefined || !match[0]) {
            continue;
        }
        const startIndex = match.index;
        const endIndex = startIndex + match[0].length;
        const startNodeIndex = nodeIndexAt(cumulativeSizes, startIndex, false);
        const endNodeIndex = nodeIndexAt(cumulativeSizes, endIndex, true);
        const startNode = textNodes[startNodeIndex];
        const endNode = textNodes[endNodeIndex];
        if (!startNode || !endNode) {
            continue;
        }

        const startOffset = startIndex - (startNodeIndex > 0 ? cumulativeSizes[startNodeIndex - 1] : 0);
        const endOffset = endIndex - (endNodeIndex > 0 ? cumulativeSizes[endNodeIndex - 1] : 0);
        const range = new Range();
        try {
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
        } catch (error) {
            console.error("Stillmark document find range failed:", error);
            continue;
        }

        const blockId = closestBlockId(startNode, protyle, rootId);
        if (!blockId) {
            continue;
        }
        const occurrence = occurrences.get(blockId) ?? 0;
        occurrences.set(blockId, occurrence + 1);
        ranges.push({blockId, occurrence, range});
    }
    return ranges;
}

function nodeIndexAt(cumulativeSizes: number[], offset: number, isEnd: boolean) {
    let index = 0;
    while (
        index < cumulativeSizes.length - 1 &&
        (isEnd ? cumulativeSizes[index] < offset : cumulativeSizes[index] <= offset)
    ) {
        index++;
    }
    return index;
}

function closestBlockId(node: Node, protyle: IProtyle, rootId: string) {
    const parent = node.parentElement;
    const blockElement = parent?.closest<HTMLElement>("[data-node-id]");
    if (blockElement?.dataset.nodeId) {
        return blockElement.dataset.nodeId;
    }
    if (protyle.title?.element.contains(node)) {
        return rootId;
    }
    return "";
}

function findBlockElement(protyle: IProtyle, blockId: string, rootId: string) {
    if (blockId === rootId && protyle.title?.element.getClientRects().length) {
        return protyle.title.element;
    }
    const elements = protyle.wysiwyg?.element.querySelectorAll<HTMLElement>(`[data-node-id="${CSS.escape(blockId)}"]`);
    return Array.from(elements ?? []).find((element) => element.getClientRects().length > 0);
}

async function waitForBlock(protyle: IProtyle, blockId: string, rootId: string) {
    const startedAt = performance.now();
    let element = findBlockElement(protyle, blockId, rootId);
    while (!element && performance.now() - startedAt < 1500) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        element = findBlockElement(protyle, blockId, rootId);
    }
    return element;
}

function scrollRangeToCenter(protyle: IProtyle, range: Range) {
    const contentElement = protyle.contentElement;
    if (!contentElement) {
        range.startContainer.parentElement?.scrollIntoView({block: "center", inline: "nearest"});
        return;
    }
    const rangeRect = range.getBoundingClientRect();
    const contentRect = contentElement.getBoundingClientRect();
    contentElement.scrollTop += rangeRect.top - contentRect.top - contentRect.height / 2;
}

function supportsCssHighlights() {
    return typeof CSS !== "undefined" && !!CSS.highlights;
}

function isMobile() {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile";
}
