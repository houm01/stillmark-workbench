import {fetchSyncPost} from "siyuan";

const STYLE_ID = "stillmark-link-favicon-rules";
const LINK_SELECTOR = [
    ".b3-typography a[href]",
    ".b3-typography span[data-type~='a'][data-href]",
    ".protyle-wysiwyg a[href]",
    ".protyle-wysiwyg span[data-type~='a'][data-href]",
].join(",");
const BLOCK_REFERENCE_SELECTOR = [
    ".b3-typography span[data-type~='block-ref'][data-id]",
    ".protyle-wysiwyg span[data-type~='block-ref'][data-id]",
].join(",");
const BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const REFERENCE_TARGET_ATTRIBUTE = "data-stillmark-ref-target";
const REFERENCE_BATCH_SIZE = 200;
const BOOKMARK_SELECTOR = ".sy__bookmark li[data-treetype='bookmark'][data-node-id]";
const BOOKMARK_DUPLICATE_CLASS = "stillmark-bookmark--duplicate";

type ReferenceTargetKind = "block" | "document";

interface LinkEntry {
    faviconUrl: string;
    key: string;
    origin: string;
    selector: string;
}

interface FaviconState {
    status: "failed" | "loaded" | "loading";
    url: string;
}

interface PendingImage {
    image: HTMLImageElement;
    timer: number;
}

interface BookmarkLocation {
    parentLabel: string;
    scopedLabel: string;
}

interface DocumentPathData {
    notebook?: string;
    path?: string;
}

interface BlockTypeRow {
    id?: string;
    type?: string;
}

export class ThemeEnhancementsFeature {
    private readonly bookmarkCache = new Map<string, BookmarkLocation | null>();
    private readonly bookmarkPending = new Map<string, Promise<BookmarkLocation | null>>();
    private readonly faviconByOrigin = new Map<string, FaviconState>();
    private readonly pendingImages = new Set<PendingImage>();
    private readonly referenceTargetCache = new Map<string, ReferenceTargetKind>();
    private bookmarkRaf = 0;
    private disposed = false;
    private entries = new Map<string, LinkEntry>();
    private observer?: MutationObserver;
    private raf = 0;
    private referenceRaf = 0;
    private referenceScanRequested = false;
    private referenceScanRunning = false;
    private ruleSignature = "";
    private style?: HTMLStyleElement;

    onload() {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", this.init, {once: true});
        } else {
            this.init();
        }
    }

    onunload() {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        document.removeEventListener("DOMContentLoaded", this.init);
        this.observer?.disconnect();
        this.bookmarkPending.clear();
        this.referenceTargetCache.clear();
        document.querySelectorAll<HTMLElement>(BOOKMARK_SELECTOR).forEach(this.clearBookmarkAnnotation);
        document.querySelectorAll<HTMLElement>(BLOCK_REFERENCE_SELECTOR).forEach((element) => {
            element.removeAttribute(REFERENCE_TARGET_ATTRIBUTE);
        });
        if (this.raf) {
            window.cancelAnimationFrame(this.raf);
        }
        if (this.bookmarkRaf) {
            window.cancelAnimationFrame(this.bookmarkRaf);
        }
        if (this.referenceRaf) {
            window.cancelAnimationFrame(this.referenceRaf);
        }
        this.pendingImages.forEach(({image, timer}) => {
            window.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            image.src = "";
        });
        this.pendingImages.clear();
        this.style?.remove();
    }

    private readonly init = () => {
        if (this.disposed || this.observer || !document.body) {
            return;
        }

        this.observer = new MutationObserver((mutations) => {
            if (mutations.some(this.mutationTouchesLinks)) {
                this.scheduleLinkScan();
            }
            if (mutations.some(this.mutationTouchesBookmarks)) {
                this.bookmarkCache.clear();
                this.scheduleBookmarkScan();
            }
            if (mutations.some(this.mutationTouchesBlockReferences)) {
                this.scheduleReferenceScan();
            }
        });
        this.observer.observe(document.body, {
            attributeFilter: ["data-href", "data-id", "data-type", "href"],
            attributes: true,
            childList: true,
            subtree: true,
        });
        this.scheduleLinkScan();
        this.scheduleBookmarkScan();
        this.scheduleReferenceScan();
    };

    private normalizeUrl(rawValue: string) {
        const value = rawValue.trim();
        if (!value) {
            return null;
        }

        try {
            const url = value.startsWith("//") ? new URL(`https:${value}`) : new URL(value);
            return url.protocol === "http:" || url.protocol === "https:" ? url : null;
        } catch {
            return null;
        }
    }

    private getLinkEntry(element: HTMLElement): LinkEntry | null {
        const attribute = element.matches("a[href]") ? "href" : "data-href";
        const value = element.getAttribute(attribute) || "";
        const url = this.normalizeUrl(value);
        if (!url) {
            return null;
        }

        const escapedValue = CSS.escape(value);
        const selector = attribute === "href" ?
            `:is(.b3-typography, .protyle-wysiwyg) a[href="${escapedValue}"]` :
            `:is(.b3-typography, .protyle-wysiwyg) span[data-type~="a"][data-href="${escapedValue}"]`;

        return {
            faviconUrl: `${url.origin}/favicon.ico`,
            key: `${attribute}\u0000${value}`,
            origin: url.origin,
            selector,
        };
    }

    private renderLinkRules() {
        if (this.disposed) {
            return;
        }

        const selectorsByFavicon = new Map<string, string[]>();
        this.entries.forEach((entry) => {
            const favicon = this.faviconByOrigin.get(entry.origin);
            if (!favicon || favicon.status !== "loaded") {
                return;
            }

            const selectors = selectorsByFavicon.get(favicon.url) || [];
            selectors.push(entry.selector);
            selectorsByFavicon.set(favicon.url, selectors);
        });

        const rules = Array.from(selectorsByFavicon.entries())
            .sort(([firstUrl], [secondUrl]) => firstUrl.localeCompare(secondUrl))
            .map(([faviconUrl, selectors]) => {
                const uniqueSelectors = Array.from(new Set(selectors)).sort();
                return `${uniqueSelectors.join(",\n")} {\n    --stillmark-link-favicon: url(${
                    JSON.stringify(faviconUrl)
                });\n}`;
            })
            .join("\n");

        if (rules === this.ruleSignature) {
            return;
        }

        this.ruleSignature = rules;
        if (!rules) {
            this.style?.remove();
            this.style = undefined;
            return;
        }

        if (!this.style) {
            this.style = document.createElement("style");
            this.style.id = STYLE_ID;
            document.head.appendChild(this.style);
        }
        this.style.textContent = rules;
    }

    private loadFavicon(entry: LinkEntry) {
        if (this.faviconByOrigin.has(entry.origin)) {
            return;
        }

        this.faviconByOrigin.set(entry.origin, {status: "loading", url: entry.faviconUrl});
        const image = new Image();
        const pending: PendingImage = {image, timer: 0};
        this.pendingImages.add(pending);

        const finish = (status: FaviconState["status"]) => {
            if (!this.pendingImages.delete(pending)) {
                return;
            }
            window.clearTimeout(pending.timer);
            image.onload = null;
            image.onerror = null;
            this.faviconByOrigin.set(entry.origin, {status, url: entry.faviconUrl});
            this.renderLinkRules();
        };

        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.onload = () => finish(image.naturalWidth > 0 ? "loaded" : "failed");
        image.onerror = () => finish("failed");
        pending.timer = window.setTimeout(() => finish("failed"), 5000);
        image.src = entry.faviconUrl;
    }

    private readonly scanLinks = () => {
        this.raf = 0;
        if (this.disposed) {
            return;
        }

        const entries = new Map<string, LinkEntry>();
        document.querySelectorAll<HTMLElement>(LINK_SELECTOR).forEach((element) => {
            const entry = this.getLinkEntry(element);
            if (entry) {
                entries.set(entry.key, entry);
            }
        });

        this.entries = entries;
        entries.forEach((entry) => this.loadFavicon(entry));
        this.renderLinkRules();
    };

    private scheduleLinkScan() {
        if (!this.disposed && !this.raf) {
            this.raf = window.requestAnimationFrame(this.scanLinks);
        }
    }

    private containsLink(node: Node) {
        return node instanceof Element && (node.matches(LINK_SELECTOR) || node.querySelector(LINK_SELECTOR));
    }

    private readonly mutationTouchesLinks = (mutation: MutationRecord) => {
        if (mutation.type === "attributes") {
            return mutation.target instanceof Element && mutation.target.matches(LINK_SELECTOR);
        }
        return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => this.containsLink(node));
    };

    private containsBlockReference(node: Node) {
        return node instanceof Element &&
            (node.matches(BLOCK_REFERENCE_SELECTOR) || node.querySelector(BLOCK_REFERENCE_SELECTOR));
    }

    private readonly mutationTouchesBlockReferences = (mutation: MutationRecord) => {
        if (mutation.type === "attributes") {
            return mutation.target instanceof Element && mutation.target.matches(BLOCK_REFERENCE_SELECTOR);
        }
        return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => this.containsBlockReference(node));
    };

    private async loadReferenceTargetKinds(ids: string[]) {
        for (let index = 0; index < ids.length; index += REFERENCE_BATCH_SIZE) {
            const batch = ids.slice(index, index + REFERENCE_BATCH_SIZE);
            const quotedIds = batch.map((id) => `'${id}'`).join(", ");
            const rows = await this.postJson<BlockTypeRow[]>("/api/query/sql", {
                stmt: `SELECT id, type FROM blocks WHERE id IN (${quotedIds})`,
            });
            const kinds = new Map(
                (Array.isArray(rows) ? rows : [])
                    .filter((row) => typeof row?.id === "string")
                    .map((row) => [row.id as string, row.type === "d" ? "document" : "block"] as const),
            );
            batch.forEach((id) => {
                this.referenceTargetCache.set(id, kinds.get(id) || "block");
            });
        }
    }

    private async applyReferenceTargets() {
        const references = [...document.querySelectorAll<HTMLElement>(BLOCK_REFERENCE_SELECTOR)];
        const ids = [...new Set(references.map((element) => element.dataset.id || ""))]
            .filter((id) => BLOCK_ID_PATTERN.test(id));
        const uncachedIds = ids.filter((id) => !this.referenceTargetCache.has(id));

        if (uncachedIds.length > 0) {
            try {
                await this.loadReferenceTargetKinds(uncachedIds);
            } catch {
                return;
            }
        }
        if (this.disposed) {
            return;
        }

        references.forEach((element) => {
            const targetKind = this.referenceTargetCache.get(element.dataset.id || "");
            if (!targetKind) {
                element.removeAttribute(REFERENCE_TARGET_ATTRIBUTE);
            } else if (element.dataset.stillmarkRefTarget !== targetKind) {
                element.dataset.stillmarkRefTarget = targetKind;
            }
        });
    }

    private async scanReferences() {
        if (this.referenceScanRunning) {
            this.referenceScanRequested = true;
            return;
        }

        this.referenceScanRunning = true;
        try {
            do {
                this.referenceScanRequested = false;
                await this.applyReferenceTargets();
            } while (this.referenceScanRequested && !this.disposed);
        } finally {
            this.referenceScanRunning = false;
        }
    }

    private readonly flushReferenceScan = () => {
        this.referenceRaf = 0;
        void this.scanReferences();
    };

    private scheduleReferenceScan() {
        if (!this.disposed && !this.referenceRaf) {
            this.referenceRaf = window.requestAnimationFrame(this.flushReferenceScan);
        }
    }

    private async postJson<T>(path: string, payload: Record<string, string>) {
        const response = await fetchSyncPost(path, payload);
        if (response.code !== 0) {
            throw new Error(response.msg || "Request failed");
        }
        return response.data as T;
    }

    private getNotebookName(notebookId: string) {
        return window.siyuan?.notebooks?.find((notebook) => notebook.id === notebookId)?.name || "";
    }

    private loadBookmarkLocation(nodeId: string) {
        if (this.bookmarkCache.has(nodeId)) {
            return Promise.resolve(this.bookmarkCache.get(nodeId));
        }
        if (this.bookmarkPending.has(nodeId)) {
            return this.bookmarkPending.get(nodeId);
        }

        const request = (async () => {
            try {
                const file = await this.postJson<DocumentPathData>("/api/filetree/getPathByID", {id: nodeId});
                if (!file?.notebook || !file.path) {
                    return null;
                }

                const humanPath = await this.postJson<string>("/api/filetree/getHPathByPath", {
                    notebook: file.notebook,
                    path: file.path,
                });
                if (typeof humanPath !== "string") {
                    return null;
                }

                const parentSegments = humanPath.split("/").filter(Boolean);
                parentSegments.pop();
                const notebookName = this.getNotebookName(file.notebook);
                const parentLabel = parentSegments.join(" / ") || "根目录";
                return {
                    parentLabel,
                    scopedLabel: [notebookName, parentLabel].filter(Boolean).join(" / "),
                };
            } catch {
                return null;
            }
        })();

        this.bookmarkPending.set(nodeId, request);
        void request.then((location) => {
            this.bookmarkPending.delete(nodeId);
            if (!this.disposed) {
                this.bookmarkCache.set(nodeId, location);
                this.scheduleBookmarkScan();
            }
        });
        return request;
    }

    private formatNodeTimestamp(nodeId: string) {
        const match = nodeId.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\d{2}/);
        return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : nodeId;
    }

    private countLabels(labels: string[]) {
        return labels.reduce((counts, label) => {
            counts.set(label, (counts.get(label) || 0) + 1);
            return counts;
        }, new Map<string, number>());
    }

    private readonly clearBookmarkAnnotation = (row: HTMLElement) => {
        row.classList.remove(BOOKMARK_DUPLICATE_CLASS);
        const text = row.querySelector<HTMLElement>(":scope > .b3-list-item__text");
        if (text) {
            delete text.dataset.stillmarkBookmarkPath;
        }
    };

    private renderBookmarkGroup(rows: HTMLElement[]) {
        const locations = rows.map((row) => this.bookmarkCache.get(row.dataset.nodeId || ""));
        const parentLabels = locations.map((location) => location?.parentLabel || "未知位置");
        const parentCounts = this.countLabels(parentLabels);
        const scopedLabels = locations.map((location, index) =>
            parentCounts.get(parentLabels[index]) > 1 ?
                location?.scopedLabel || parentLabels[index] :
                parentLabels[index]
        );
        const scopedCounts = this.countLabels(scopedLabels);

        rows.forEach((row, index) => {
            const text = row.querySelector<HTMLElement>(":scope > .b3-list-item__text");
            if (!text) {
                return;
            }

            const nodeId = row.dataset.nodeId || "";
            const label = scopedCounts.get(scopedLabels[index]) > 1 ?
                `${this.formatNodeTimestamp(nodeId)} · ${scopedLabels[index]}` :
                scopedLabels[index];
            row.classList.add(BOOKMARK_DUPLICATE_CLASS);
            text.dataset.stillmarkBookmarkPath = label;
        });
    }

    private readonly scanBookmarks = () => {
        this.bookmarkRaf = 0;
        if (this.disposed) {
            return;
        }

        const rows = [...document.querySelectorAll<HTMLElement>(BOOKMARK_SELECTOR)];
        const groupsByList = new Map<HTMLElement, Map<string, HTMLElement[]>>();
        rows.forEach((row) => {
            const title = row.querySelector<HTMLElement>(":scope > .b3-list-item__text")?.textContent
                ?.replace(/\s+/g, " ").trim().toLocaleLowerCase();
            if (!title || !row.parentElement) {
                this.clearBookmarkAnnotation(row);
                return;
            }
            const groups = groupsByList.get(row.parentElement) || new Map<string, HTMLElement[]>();
            const group = groups.get(title) || [];
            group.push(row);
            groups.set(title, group);
            groupsByList.set(row.parentElement, groups);
        });

        groupsByList.forEach((groups) => {
            groups.forEach((group) => {
                if (group.length < 2) {
                    this.clearBookmarkAnnotation(group[0]);
                    return;
                }

                group.forEach((row) => void this.loadBookmarkLocation(row.dataset.nodeId || ""));
                if (group.every((row) => this.bookmarkCache.has(row.dataset.nodeId || ""))) {
                    this.renderBookmarkGroup(group);
                } else {
                    group.forEach(this.clearBookmarkAnnotation);
                }
            });
        });
    };

    private scheduleBookmarkScan() {
        if (!this.disposed && !this.bookmarkRaf) {
            this.bookmarkRaf = window.requestAnimationFrame(this.scanBookmarks);
        }
    }

    private containsBookmarkPanel(node: Node) {
        return node instanceof Element && (node.matches(".sy__bookmark") || node.querySelector(".sy__bookmark"));
    }

    private readonly mutationTouchesBookmarks = (mutation: MutationRecord) =>
        mutation.target instanceof Element &&
        (mutation.target.closest(".sy__bookmark") ||
            [...mutation.addedNodes, ...mutation.removedNodes].some((node) => this.containsBookmarkPanel(node)));
}
