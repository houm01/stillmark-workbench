const TREE_ROW_SELECTOR = ".file-tree [data-type='navigation-file']";
const LIST_ITEM_SELECTOR = ".protyle-wysiwyg [data-node-id].li:is([data-subtype='o'], [data-subtype='u'])";
const LIST_SELECTOR = ".protyle-wysiwyg [data-node-id].list";
const THEME_STYLESHEET_SELECTOR = "link[href*='/siyuan-theme-stillmark/theme.css']";

const GUIDE_CLASSES = [
    "stillmark-tree-guide-first",
    "stillmark-tree-guide-before",
    "stillmark-tree-guide-branch",
    "stillmark-tree-guide-current-leaf",
    "stillmark-list-guide-active",
    "stillmark-list-guide-parent",
    "stillmark-list-guide-parent-continued",
    "stillmark-list-guide-turn",
    "stillmark-list-guide-native-hidden",
    "stillmark-list-guide-before",
    "stillmark-list-guide-first-continued",
];

export class HoverGuidesFeature {
    private activeTarget?: HTMLElement;
    private readonly decoratedElements = new Set<HTMLElement>();
    private pointerKnown = false;
    private pointerX = 0;
    private pointerY = 0;
    private refreshFrame = 0;

    private readonly pointerMoveHandler = (event: PointerEvent) => {
        if (event.pointerType === "touch") {
            return;
        }
        this.pointerKnown = true;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
        this.scheduleRefresh();
    };

    private readonly pointerOutHandler = (event: PointerEvent) => {
        if (!event.relatedTarget) {
            this.pointerKnown = false;
            this.activeTarget = undefined;
            this.clearDecorations();
        }
    };

    private readonly scrollHandler = () => {
        if (this.pointerKnown) {
            this.scheduleRefresh();
        }
    };

    private readonly blurHandler = () => {
        this.pointerKnown = false;
        this.activeTarget = undefined;
        this.clearDecorations();
    };

    onload() {
        document.addEventListener("pointermove", this.pointerMoveHandler, {passive: true});
        document.addEventListener("pointerout", this.pointerOutHandler, {passive: true});
        document.addEventListener("scroll", this.scrollHandler, {capture: true, passive: true});
        window.addEventListener("blur", this.blurHandler);
    }

    onunload() {
        document.removeEventListener("pointermove", this.pointerMoveHandler);
        document.removeEventListener("pointerout", this.pointerOutHandler);
        document.removeEventListener("scroll", this.scrollHandler, true);
        window.removeEventListener("blur", this.blurHandler);
        if (this.refreshFrame) {
            window.cancelAnimationFrame(this.refreshFrame);
        }
        this.activeTarget = undefined;
        this.clearDecorations();
    }

    private scheduleRefresh() {
        if (!this.refreshFrame) {
            this.refreshFrame = window.requestAnimationFrame(this.refresh);
        }
    }

    private readonly refresh = () => {
        this.refreshFrame = 0;
        if (!this.pointerKnown || !document.querySelector(THEME_STYLESHEET_SELECTOR)) {
            this.activeTarget = undefined;
            this.clearDecorations();
            return;
        }

        const hit = document.elementFromPoint(this.pointerX, this.pointerY);
        const target = hit?.closest<HTMLElement>(TREE_ROW_SELECTOR) ??
            hit?.closest<HTMLElement>(LIST_ITEM_SELECTOR);
        if (target === this.activeTarget) {
            return;
        }

        this.activeTarget = target;
        this.clearDecorations();
        if (!target) {
            return;
        }
        if (target.matches(TREE_ROW_SELECTOR)) {
            this.decorateTree(target);
        } else {
            this.decorateList(target);
        }
    };

    private decorateTree(row: HTMLElement) {
        const list = row.parentElement;
        if (!list) {
            return;
        }

        const firstRow = [...list.children].find((element) => element.matches(TREE_ROW_SELECTOR));
        if (firstRow instanceof HTMLElement) {
            this.mark(firstRow, "stillmark-tree-guide-first");
        }

        for (let sibling = row.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
            if (!(sibling instanceof HTMLElement)) {
                continue;
            }
            if (sibling.matches(TREE_ROW_SELECTOR)) {
                this.mark(sibling, "stillmark-tree-guide-before");
            } else if (sibling.matches("ul")) {
                this.mark(sibling, "stillmark-tree-guide-branch");
            }
        }

        if (row.querySelector(":scope > .b3-list-item__toggle.fn__hidden")) {
            this.mark(row, "stillmark-tree-guide-current-leaf");
        }
    }

    private decorateList(hoveredItem: HTMLElement) {
        let pathItem: HTMLElement | null = hoveredItem;
        while (pathItem) {
            const list = pathItem.parentElement;
            if (!(list instanceof HTMLElement) || !list.matches(LIST_SELECTOR)) {
                break;
            }

            this.mark(list, "stillmark-list-guide-active");
            const items = [...list.children].filter(
                (element): element is HTMLElement =>
                    element instanceof HTMLElement && element.matches(LIST_ITEM_SELECTOR),
            );
            const activeIndex = items.indexOf(pathItem);
            const firstItem = items[0];
            for (const precedingItem of items.slice(0, Math.max(activeIndex, 0))) {
                this.mark(precedingItem, "stillmark-list-guide-before");
                this.mark(precedingItem, "stillmark-list-guide-native-hidden");
            }

            const parentItem = list.parentElement instanceof HTMLElement &&
                    list.parentElement.matches(LIST_ITEM_SELECTOR) ?
                list.parentElement :
                null;
            if (parentItem) {
                this.mark(parentItem, "stillmark-list-guide-parent");
                this.mark(parentItem, "stillmark-list-guide-native-hidden");
                if (firstItem && (pathItem !== firstItem || pathItem !== hoveredItem)) {
                    this.mark(parentItem, "stillmark-list-guide-parent-continued");
                    this.mark(firstItem, "stillmark-list-guide-turn");
                }
            }

            if (firstItem && activeIndex > 0) {
                this.mark(firstItem, "stillmark-list-guide-turn");
                this.mark(firstItem, "stillmark-list-guide-first-continued");
            }
            pathItem = parentItem;
        }
    }

    private mark(element: HTMLElement, className: string) {
        element.classList.add(className);
        this.decoratedElements.add(element);
    }

    private clearDecorations() {
        for (const element of this.decoratedElements) {
            element.classList.remove(...GUIDE_CLASSES);
        }
        this.decoratedElements.clear();
    }
}
