import {
    Menu,
    Plugin,
    Protyle,
    fetchSyncPost,
    showMessage,
} from "siyuan";
import {AnnotationsFeature} from "./annotations";
import {DailyNotesFeature} from "./daily-notes";
import {DatabasePageFeature} from "./database-page";
import {DatabaseRelationSyncFeature} from "./database-relation-sync";
import {DocumentBreadcrumbFeature} from "./document-breadcrumb";
import {DocumentFindFeature} from "./document-find";
import {DocumentOutlineFeature} from "./document-outline";
import {DocumentTreeFocusFeature} from "./document-tree-focus";
import {FontSwitcherFeature} from "./font-switcher";
import {HoverGuidesFeature} from "./hover-guides";
import {InlineBacklinksFeature} from "./inline-backlinks";
import {MindMapFeature} from "./mind-map";
import {NativeTagBrowserFeature} from "./native-tag-browser";
import {PdfExportFeature} from "./pdf-export";
import {ReferenceAliasLabelFeature} from "./reference-alias-label";
import {ThemeEnhancementsFeature} from "./theme-enhancements";
import {WorkbenchDialogFeature} from "./workbench-dialog";
import {WorkbenchPreferences} from "./workbench-preferences";
import "./index.scss";

const ROLE_ATTRIBUTE = "custom-stillmark-role";

type BlockRole = "note" | "tip" | "warning" | "important" | "muted";

interface RoleDefinition {
    value: BlockRole;
    labelKey: string;
    icon: string;
}

interface BlockMenuDetail {
    menu: Menu;
    blockElements: HTMLElement[];
}

const ROLE_DEFINITIONS: RoleDefinition[] = [
    {value: "note", labelKey: "roleNote", icon: "iconInfo"},
    {value: "tip", labelKey: "roleTip", icon: "iconLightbulb"},
    {value: "warning", labelKey: "roleWarning", icon: "iconWarning"},
    {value: "important", labelKey: "roleImportant", icon: "iconHeart"},
    {value: "muted", labelKey: "roleMuted", icon: "iconEyeoff"},
];

export default class StillmarkWorkbench extends Plugin {
    private annotations?: AnnotationsFeature;
    private dailyNotes?: DailyNotesFeature;
    private databaseRelationSync?: DatabaseRelationSyncFeature;
    private databasePage?: DatabasePageFeature;
    private documentBreadcrumb?: DocumentBreadcrumbFeature;
    private documentFind?: DocumentFindFeature;
    private documentOutline?: DocumentOutlineFeature;
    private documentTreeFocus?: DocumentTreeFocusFeature;
    private fontSwitcher?: FontSwitcherFeature;
    private hoverGuides?: HoverGuidesFeature;
    private inlineBacklinks?: InlineBacklinksFeature;
    private mindMap?: MindMapFeature;
    private nativeTagBrowser?: NativeTagBrowserFeature;
    private pdfExport?: PdfExportFeature;
    private referenceAliasLabel?: ReferenceAliasLabelFeature;
    private themeEnhancements?: ThemeEnhancementsFeature;
    private workbench?: WorkbenchDialogFeature;
    private workbenchPreferences?: WorkbenchPreferences;

    private readonly blockMenuHandler = ({detail}: CustomEvent<BlockMenuDetail>) => {
        if (!this.workbenchPreferences?.isFeatureEnabledCached("blockRoles")) {
            return;
        }
        detail.menu.addItem({
            id: "stillmark-workbench-block-role",
            icon: "iconStillmarkWorkbench",
            label: this.i18n.blockRoles,
            type: "submenu",
            submenu: [
                ...ROLE_DEFINITIONS.map((role) => ({
                    icon: role.icon,
                    label: this.i18n[role.labelKey],
                    click: () => {
                        void this.applyBlockRole(detail.blockElements, role.value);
                    },
                })),
                {type: "separator" as const},
                {
                    icon: "iconTrashcan",
                    label: this.i18n.clearRole,
                    click: () => {
                        void this.applyBlockRole(detail.blockElements, null);
                    },
                },
            ],
        });
    };

    updateProtyleToolbar(toolbar: Parameters<Plugin["updateProtyleToolbar"]>[0]) {
        if (!this.annotations?.isEnabledCached()) {
            return toolbar;
        }
        return [
            ...toolbar,
            {
                click: (protyle: Protyle) => this.annotations?.createFromProtyleToolbar(protyle),
                icon: "iconStillmarkAnnotation",
                name: "stillmark-annotation",
                tip: this.i18n?.annotationCreateCommand ?? "Annotate",
                tipPosition: "n",
            },
        ];
    }

    async onload() {
        this.workbenchPreferences = new WorkbenchPreferences(this);
        await this.workbenchPreferences.ready();

        this.addIcons(
            `<symbol id="iconStillmarkWorkbench" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 9h18M9 21V9"></path>
</symbol>
<symbol id="iconStillmarkAnnotation" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4zM8 9h8M8 13h5"></path>
</symbol>
<symbol id="iconStillmarkOutline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
<path d="M4 6h2M4 12h2M4 18h2M10 6h10M10 12h7M10 18h10"></path>
</symbol>`,
        );

        this.addCommand({
            langKey: "openWorkbench",
            hotkey: "⌥⇧W",
            callback: () => {
                void this.workbench?.open();
            },
        });

        this.eventBus.on("click-blockicon", this.blockMenuHandler);

        this.dailyNotes = new DailyNotesFeature(this, this.workbenchPreferences);
        this.dailyNotes.onload();

        this.databaseRelationSync = new DatabaseRelationSyncFeature(this, this.workbenchPreferences);
        this.databaseRelationSync.onload();

        this.databasePage = new DatabasePageFeature(this);
        this.databasePage.onload();

        this.referenceAliasLabel = new ReferenceAliasLabelFeature(this);
        this.referenceAliasLabel.onload();

        this.themeEnhancements = new ThemeEnhancementsFeature();
        this.themeEnhancements.onload();

        this.hoverGuides = new HoverGuidesFeature();
        this.hoverGuides.onload();

        this.annotations = new AnnotationsFeature(this, this.workbenchPreferences);
        this.annotations.onload();

        this.documentBreadcrumb = new DocumentBreadcrumbFeature(this, this.workbenchPreferences);
        this.documentBreadcrumb.onload();

        this.documentFind = new DocumentFindFeature(this, this.workbenchPreferences);
        this.documentFind.onload();

        this.documentOutline = new DocumentOutlineFeature(this, this.workbenchPreferences);
        this.documentOutline.onload();

        this.documentTreeFocus = new DocumentTreeFocusFeature(
            this,
            this.dailyNotes,
            this.workbenchPreferences,
        );
        this.documentTreeFocus.onload();

        this.fontSwitcher = new FontSwitcherFeature(this, this.workbenchPreferences);
        this.fontSwitcher.onload();

        this.inlineBacklinks = new InlineBacklinksFeature(this, this.workbenchPreferences);
        this.inlineBacklinks.onload();

        this.mindMap = new MindMapFeature(this, this.workbenchPreferences);
        this.mindMap.onload();

        this.nativeTagBrowser = new NativeTagBrowserFeature(this);
        this.nativeTagBrowser.onload();

        this.pdfExport = new PdfExportFeature(this, this.workbenchPreferences);
        this.pdfExport.onload();

        this.workbench = new WorkbenchDialogFeature(
            this,
            this.annotations,
            this.dailyNotes,
            this.databaseRelationSync,
            this.documentFind,
            this.documentOutline,
            this.documentBreadcrumb,
            this.documentTreeFocus,
            this.inlineBacklinks,
            this.mindMap,
            this.fontSwitcher,
            this.pdfExport,
            this.workbenchPreferences,
        );
    }

    onLayoutReady() {
        const topBarElement = this.addTopBar({
            icon: "iconStillmarkWorkbench",
            title: this.i18n.openWorkbench,
            position: "right",
            callback: () => {
                void this.workbench?.open();
            },
        });
        topBarElement.classList.add("stillmark-topbar-icon", "stillmark-topbar-icon--workbench");

        this.referenceAliasLabel?.onLayoutReady();
        this.dailyNotes?.onLayoutReady();
        this.annotations?.onLayoutReady();
        this.databasePage?.onLayoutReady();
        this.documentBreadcrumb?.onLayoutReady();
        this.documentOutline?.onLayoutReady();
        this.documentTreeFocus?.onLayoutReady();
        this.fontSwitcher?.onLayoutReady();
        this.inlineBacklinks?.onLayoutReady();
        this.mindMap?.onLayoutReady();
        this.nativeTagBrowser?.onLayoutReady();
        this.pdfExport?.onLayoutReady();
    }

    onunload() {
        this.eventBus.off("click-blockicon", this.blockMenuHandler);
        this.workbench?.onunload();
        this.annotations?.onunload();
        this.databasePage?.onunload();
        this.documentBreadcrumb?.onunload();
        this.documentFind?.onunload();
        this.documentOutline?.onunload();
        this.documentTreeFocus?.onunload();
        this.inlineBacklinks?.onunload();
        this.mindMap?.onunload();
        this.nativeTagBrowser?.onunload();
        this.pdfExport?.onunload();
        this.dailyNotes?.onunload();
        this.databaseRelationSync?.onunload();
        this.referenceAliasLabel?.onunload();
        this.hoverGuides?.onunload();
        this.themeEnhancements?.onunload();
    }

    private async applyBlockRole(blockElements: HTMLElement[], role: BlockRole | null) {
        const blocks = blockElements.filter((element) => element.dataset.nodeId);
        const uniqueBlocks = [...new Map(blocks.map((element) => [element.dataset.nodeId, element])).values()];

        if (uniqueBlocks.length === 0) {
            showMessage(this.i18n.noBlocksSelected, 4000, "error");
            return;
        }

        try {
            await Promise.all(uniqueBlocks.map(async (element) => {
                const response = await fetchSyncPost("/api/attr/setBlockAttrs", {
                    id: element.dataset.nodeId,
                    attrs: {
                        [ROLE_ATTRIBUTE]: role ?? "",
                    },
                });

                if (response.code !== 0) {
                    throw new Error(response.msg || this.i18n.applyRoleFailed);
                }

                if (role) {
                    element.setAttribute(ROLE_ATTRIBUTE, role);
                } else {
                    element.removeAttribute(ROLE_ATTRIBUTE);
                }
            }));

            const message = role ? this.i18n.roleApplied : this.i18n.roleCleared;
            showMessage(message.replace("${count}", String(uniqueBlocks.length)), 3000);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showMessage(`${this.i18n.applyRoleFailed}: ${message}`, 5000, "error");
        }
    }
}
