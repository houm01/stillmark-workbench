import {
    Menu,
    Plugin,
    fetchSyncPost,
    getFrontend,
    showMessage,
} from "siyuan";

const SIYUAN_EDITOR_FONT_SELECTOR = ".b3-typography:not(.b3-typography--default), .protyle-wysiwyg, .protyle-title";
const SIYUAN_EDITOR_FONT_RULE_PATTERN =
    /\.b3-typography:not\(\.b3-typography--default\), \.protyle-wysiwyg, \.protyle-title \{[^}]*\}/g;
const SIYUAN_EDITOR_FONT_SIZE_RULE_PATTERN = /:root\s*\{\s*--b3-font-size-editor:\s*[^}]+\}/;
const DEFAULT_EDITOR_FONT_SIZE = 16;
const MIN_EDITOR_FONT_SIZE = 9;
const MAX_EDITOR_FONT_SIZE = 72;

interface SystemFont {
    family: string;
    displayName: string;
    weight: number;
}

interface FontPreviewSession {
    committedFontSize: number;
    fontCommitRequested: boolean;
    originalFont: SystemFont;
}

interface FontMenuAnchor {
    right: number;
    bottom: number;
    height: number;
}

export class FontSwitcherFeature {
    private topBarElement?: HTMLElement;

    constructor(private readonly plugin: Plugin) {}

    onload() {
        this.plugin.addIcons(`<symbol id="iconStillmarkFont" viewBox="0 0 32 32">
<path d="M8 25 15.5 7h1L24 25M10.5 19h11M6 7h21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
</symbol>`);
    }

    onLayoutReady() {
        this.topBarElement = this.plugin.addTopBar({
            icon: "iconStillmarkFont",
            title: this.plugin.i18n.fontSwitcherButtonTitle,
            position: "left",
            callback: () => {
                void this.open();
            },
        });
        this.topBarElement.classList.add("stillmark-topbar-icon", "stillmark-topbar-icon--font");
    }

    async open(anchor?: FontMenuAnchor) {
        try {
            const fonts = await this.loadSystemFonts();
            this.showFontMenu(fonts, anchor);
        } catch (error) {
            showMessage(
                `${this.plugin.i18n.fontSwitcherLoadFailed}: ${errorMessage(error)}`,
                5000,
                "error",
            );
        }
    }

    getCurrentFontName() {
        return window.siyuan.config.editor.fontFamilyDisplay ||
            window.siyuan.config.editor.fontFamily ||
            this.plugin.i18n.fontSwitcherDefault;
    }

    private async loadSystemFonts() {
        const response = await fetchSyncPost("/api/system/getSysFonts", {});
        if (response.code !== 0) {
            throw new Error(response.msg || this.plugin.i18n.fontSwitcherLoadFailed);
        }
        if (!Array.isArray(response.data)) {
            throw new Error(this.plugin.i18n.fontSwitcherInvalidResponse);
        }

        return response.data.flatMap((font): SystemFont[] => {
            if (!font || typeof font.family !== "string") {
                return [];
            }

            return [{
                family: font.family,
                displayName: typeof font.displayName === "string" && font.displayName ?
                    font.displayName :
                    font.family,
                weight: Number.isFinite(font.weight) && font.weight > 0 ? font.weight : 400,
            }];
        });
    }

    private showFontMenu(fonts: SystemFont[], anchor?: FontMenuAnchor) {
        const currentFamily = window.siyuan.config.editor.fontFamily;
        const currentWeight = window.siyuan.config.editor.fontWeight || 400;
        const session: FontPreviewSession = {
            committedFontSize: clampFontSize(window.siyuan.config.editor.fontSize),
            fontCommitRequested: false,
            originalFont: {
                family: currentFamily,
                displayName: window.siyuan.config.editor.fontFamilyDisplay || currentFamily,
                weight: currentWeight,
            },
        };
        const menu = new Menu(`${this.plugin.name}-font-switcher`, () => {
            if (!session.fontCommitRequested) {
                refreshEditorFontStyle(session.originalFont);
            }
            refreshEditorFontSizeStyle(session.committedFontSize);
        });
        const searchableItems: HTMLElement[] = [];

        menu.addItem({
            iconHTML: "",
            type: "empty",
            label: `<div class="stillmark-font-switcher__panel">
    <div class="stillmark-font-switcher__size-controls">
        <button class="b3-button b3-button--cancel stillmark-font-switcher__size-button" type="button" data-action="decrease" aria-label="${
                escapeHtml(this.plugin.i18n.fontSwitcherDecreaseSize)
            }">A−</button>
        <label class="b3-text-field stillmark-font-switcher__size-field">
            <input type="number" min="${MIN_EDITOR_FONT_SIZE}" max="${MAX_EDITOR_FONT_SIZE}" step="1" value="${session.committedFontSize}" aria-label="${
                escapeHtml(this.plugin.i18n.fontSwitcherFontSize)
            }">
            <span>px</span>
        </label>
        <button class="b3-button b3-button--cancel stillmark-font-switcher__size-button" type="button" data-action="increase" aria-label="${
                escapeHtml(this.plugin.i18n.fontSwitcherIncreaseSize)
            }">A+</button>
        <button class="b3-button b3-button--cancel stillmark-font-switcher__size-reset" type="button" data-action="reset">${
                escapeHtml(this.plugin.i18n.fontSwitcherResetSize)
            }</button>
    </div>
    <div class="stillmark-font-switcher__filter">
        <input class="b3-text-field" type="search" autocomplete="off" spellcheck="false" placeholder="${
                escapeHtml(this.plugin.i18n.fontSwitcherSearchPlaceholder)
            }">
    </div>
</div>`,
            bind: (element) => {
                const searchInput = element.querySelector<HTMLInputElement>(".stillmark-font-switcher__filter input");
                const sizeInput = element.querySelector<HTMLInputElement>(".stillmark-font-switcher__size-field input");
                let targetFontSize = session.committedFontSize;
                let queuedFontSize: number | undefined;
                let saveInFlight = false;

                const flushFontSize = async () => {
                    if (saveInFlight) {
                        return;
                    }
                    saveInFlight = true;
                    while (queuedFontSize !== undefined) {
                        const size = queuedFontSize;
                        queuedFontSize = undefined;
                        if (!await this.applyFontSize(size, session)) {
                            queuedFontSize = undefined;
                            targetFontSize = session.committedFontSize;
                            if (sizeInput) {
                                sizeInput.value = String(targetFontSize);
                            }
                            break;
                        }
                    }
                    saveInFlight = false;
                };

                const requestFontSize = (size: number) => {
                    targetFontSize = clampFontSize(size);
                    if (sizeInput) {
                        sizeInput.value = String(targetFontSize);
                    }
                    refreshEditorFontSizeStyle(targetFontSize);
                    queuedFontSize = targetFontSize;
                    void flushFontSize();
                };

                element.querySelector<HTMLButtonElement>('[data-action="decrease"]')?.addEventListener(
                    "click",
                    (event) => {
                        event.stopPropagation();
                        requestFontSize(targetFontSize - 1);
                    },
                );
                element.querySelector<HTMLButtonElement>('[data-action="increase"]')?.addEventListener(
                    "click",
                    (event) => {
                        event.stopPropagation();
                        requestFontSize(targetFontSize + 1);
                    },
                );
                element.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener(
                    "click",
                    (event) => {
                        event.stopPropagation();
                        requestFontSize(DEFAULT_EDITOR_FONT_SIZE);
                    },
                );
                sizeInput?.addEventListener("input", () => {
                    const size = parseFontSize(sizeInput.value);
                    if (size !== null) {
                        targetFontSize = size;
                        refreshEditorFontSizeStyle(size);
                    }
                });
                sizeInput?.addEventListener("change", () => {
                    requestFontSize(parseFontSize(sizeInput.value) ?? session.committedFontSize);
                });
                sizeInput?.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        requestFontSize(parseFontSize(sizeInput.value) ?? session.committedFontSize);
                        sizeInput.select();
                    }
                });

                searchInput?.addEventListener("input", () => {
                    const query = normalizeSearchText(searchInput.value);
                    let matches = 0;
                    searchableItems.forEach((item) => {
                        const matched = !query || item.dataset.searchText?.includes(query);
                        item.classList.toggle("fn__none", !matched);
                        if (matched) {
                            matches += 1;
                        }
                    });
                    emptyElement?.classList.toggle("fn__none", matches > 0);
                });
            },
        });

        const emptyElement = menu.addItem({
            iconHTML: "",
            type: "readonly",
            label: this.plugin.i18n.fontSwitcherNoResults,
        });
        emptyElement?.classList.add("fn__none");

        const defaultFont: SystemFont = {
            family: "",
            displayName: "",
            weight: 400,
        };
        const defaultItem = menu.addItem({
            icon: currentFamily ? undefined : "iconSelect",
            label: this.plugin.i18n.fontSwitcherDefault,
            click: () => this.applyFont(defaultFont, session),
        });
        this.prepareFontItem(
            defaultItem,
            defaultFont,
            this.plugin.i18n.fontSwitcherDefault,
            searchableItems,
        );
        menu.addSeparator();

        fonts.forEach((font) => {
            const item = menu.addItem({
                icon: font.family === currentFamily && font.weight === currentWeight ? "iconSelect" : undefined,
                label: escapeHtml(font.displayName),
                click: () => this.applyFont(font, session),
            });
            const label = item?.querySelector<HTMLElement>(".b3-menu__label");
            if (label) {
                label.style.fontFamily = `"${escapeCssString(font.family)}", var(--b3-font-family)`;
                label.style.fontWeight = String(font.weight);
            }
            this.prepareFontItem(item, font, `${font.displayName} ${font.family}`, searchableItems);
        });

        if (isMobile()) {
            menu.fullscreen();
        } else {
            const rect = anchor ?? this.topBarElement?.getBoundingClientRect();
            menu.open({
                x: rect?.right ?? 0,
                y: rect?.bottom ?? 0,
                h: rect?.height,
                isLeft: true,
            });
            window.setTimeout(() => {
                menu.element.querySelector<HTMLInputElement>(".stillmark-font-switcher__filter input")?.focus();
            });
        }
    }

    private prepareFontItem(
        item: HTMLElement | undefined,
        font: SystemFont,
        searchText: string,
        searchableItems: HTMLElement[],
    ) {
        if (!item) {
            return;
        }
        item.dataset.searchText = normalizeSearchText(searchText);
        const preview = () => refreshEditorFontStyle(font);
        item.addEventListener("pointerenter", preview);
        item.addEventListener("focus", preview);
        searchableItems.push(item);
    }

    private async applyFont(font: SystemFont, session: FontPreviewSession) {
        session.fontCommitRequested = true;
        try {
            const response = await fetchSyncPost("/api/setting/setEditor", {
                ...window.siyuan.config.editor,
                fontFamily: font.family,
                fontFamilyDisplay: font.displayName,
                fontWeight: font.weight,
            });
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.fontSwitcherSwitchFailed);
            }

            const readback = await fetchSyncPost("/api/system/getConf", {});
            if (
                readback.code !== 0 ||
                readback.data?.conf?.editor?.fontFamily !== font.family ||
                readback.data?.conf?.editor?.fontWeight !== font.weight
            ) {
                throw new Error(this.plugin.i18n.fontSwitcherVerificationFailed);
            }

            window.siyuan.config.editor = readback.data.conf.editor;
            refreshEditorFontStyle({
                family: readback.data.conf.editor.fontFamily,
                displayName: readback.data.conf.editor.fontFamilyDisplay,
                weight: readback.data.conf.editor.fontWeight,
            });
            const displayName = font.displayName || this.plugin.i18n.fontSwitcherDefault;
            showMessage(
                this.plugin.i18n.fontSwitcherSwitched.replace("${font}", displayName),
                3000,
            );
        } catch (error) {
            refreshEditorFontStyle(session.originalFont);
            showMessage(
                `${this.plugin.i18n.fontSwitcherSwitchFailed}: ${errorMessage(error)}`,
                5000,
                "error",
            );
        }
    }

    private async applyFontSize(fontSize: number, session: FontPreviewSession) {
        try {
            const response = await fetchSyncPost("/api/setting/setEditor", {
                ...window.siyuan.config.editor,
                fontSize,
            });
            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.fontSwitcherSizeSwitchFailed);
            }

            const readback = await fetchSyncPost("/api/system/getConf", {});
            if (
                readback.code !== 0 ||
                readback.data?.conf?.editor?.fontSize !== fontSize
            ) {
                throw new Error(this.plugin.i18n.fontSwitcherSizeVerificationFailed);
            }

            window.siyuan.config.editor = readback.data.conf.editor;
            session.committedFontSize = readback.data.conf.editor.fontSize;
            refreshEditorFontSizeStyle(session.committedFontSize);
            return true;
        } catch (error) {
            refreshEditorFontSizeStyle(session.committedFontSize);
            showMessage(
                `${this.plugin.i18n.fontSwitcherSizeSwitchFailed}: ${errorMessage(error)}`,
                5000,
                "error",
            );
            return false;
        }
    }
}

function refreshEditorFontStyle(font: SystemFont) {
    const style = document.querySelector<HTMLStyleElement>("#siyuanStyle");
    if (!style) {
        return;
    }

    const retainedCss = style.textContent.replace(SIYUAN_EDITOR_FONT_RULE_PATTERN, "").trimEnd();
    if (!font.family) {
        style.textContent = retainedCss;
        return;
    }

    const fontWeight = font.weight ? `font-weight: ${font.weight};` : "";
    style.textContent =
        `${retainedCss}\n${SIYUAN_EDITOR_FONT_SELECTOR} {${fontWeight}font-family: "Emojis Additional", "Emojis Reset", "${
            escapeCssString(font.family)
        }", var(--b3-font-family)}`;
}

function refreshEditorFontSizeStyle(fontSize: number) {
    const style = document.querySelector<HTMLStyleElement>("#siyuanStyle");
    if (!style) {
        return;
    }

    const rule = `:root { --b3-font-size-editor: ${clampFontSize(fontSize)}px }`;
    style.textContent = SIYUAN_EDITOR_FONT_SIZE_RULE_PATTERN.test(style.textContent) ?
        style.textContent.replace(SIYUAN_EDITOR_FONT_SIZE_RULE_PATTERN, rule) :
        `${style.textContent.trimEnd()}\n${rule}`;
}

function parseFontSize(value: string) {
    const fontSize = Number.parseInt(value, 10);
    if (!Number.isFinite(fontSize) || fontSize < MIN_EDITOR_FONT_SIZE || fontSize > MAX_EDITOR_FONT_SIZE) {
        return null;
    }
    return fontSize;
}

function clampFontSize(fontSize: number) {
    return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, Math.round(fontSize)));
}

function normalizeSearchText(value: string) {
    return value.trim().toLocaleLowerCase();
}

function escapeHtml(value: string) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function escapeCssString(value: string) {
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"')
        .replace(/[\n\r\f]/g, " ");
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function isMobile() {
    const frontend = getFrontend();
    return frontend === "mobile" || frontend === "browser-mobile";
}
