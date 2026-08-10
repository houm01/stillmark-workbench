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
import {DocumentBreadcrumbFeature} from "./document-breadcrumb";
import {DocumentFindFeature} from "./document-find";
import {DocumentTreeFocusFeature} from "./document-tree-focus";
import {FontSwitcherFeature} from "./font-switcher";
import {InlineBacklinksFeature} from "./inline-backlinks";
import {NativeTagBrowserFeature} from "./native-tag-browser";
import {PdfExportFeature} from "./pdf-export";
import {ReferenceAliasLabelFeature} from "./reference-alias-label";
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
    private databasePage?: DatabasePageFeature;
    private documentBreadcrumb?: DocumentBreadcrumbFeature;
    private documentFind?: DocumentFindFeature;
    private documentTreeFocus?: DocumentTreeFocusFeature;
    private fontSwitcher?: FontSwitcherFeature;
    private inlineBacklinks?: InlineBacklinksFeature;
    private nativeTagBrowser?: NativeTagBrowserFeature;
    private pdfExport?: PdfExportFeature;
    private referenceAliasLabel?: ReferenceAliasLabelFeature;
    private workbench?: WorkbenchDialogFeature;
    private workbenchPreferences?: WorkbenchPreferences;

    private readonly blockMenuHandler = ({detail}: CustomEvent<BlockMenuDetail>) => {
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

    onload() {
        this.addIcons(`<symbol id="iconStillmarkWorkbench" viewBox="0 0 32 32">
<path d="M5 7.5h22v17H5zM9 12h14M9 16h9M9 20h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
</symbol>
<symbol id="iconStillmarkAnnotation" viewBox="0 0 32 32">
<path d="M7 6h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H14l-7 5v-5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM10 12h12M10 16h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
</symbol>`);

        this.addCommand({
            langKey: "openWorkbench",
            hotkey: "⌥⇧W",
            callback: () => {
                void this.workbench?.open();
            },
        });

        this.eventBus.on("click-blockicon", this.blockMenuHandler);

        this.dailyNotes = new DailyNotesFeature(this);
        this.dailyNotes.onload();

        this.databasePage = new DatabasePageFeature(this);
        this.databasePage.onload();

        this.workbenchPreferences = new WorkbenchPreferences(this);

        this.referenceAliasLabel = new ReferenceAliasLabelFeature(this);
        this.referenceAliasLabel.onload();

        this.annotations = new AnnotationsFeature(this);
        this.annotations.onload();

        this.documentBreadcrumb = new DocumentBreadcrumbFeature(this, this.workbenchPreferences);
        this.documentBreadcrumb.onload();

        this.documentFind = new DocumentFindFeature(this);
        this.documentFind.onload();

        this.documentTreeFocus = new DocumentTreeFocusFeature(this, this.dailyNotes);
        this.documentTreeFocus.onload();

        this.fontSwitcher = new FontSwitcherFeature(this);
        this.fontSwitcher.onload();

        this.inlineBacklinks = new InlineBacklinksFeature(this, this.workbenchPreferences);
        this.inlineBacklinks.onload();

        this.nativeTagBrowser = new NativeTagBrowserFeature(this);
        this.nativeTagBrowser.onload();

        this.pdfExport = new PdfExportFeature(this);
        this.pdfExport.onload();

        this.workbench = new WorkbenchDialogFeature(
            this,
            this.annotations,
            this.dailyNotes,
            this.documentBreadcrumb,
            this.inlineBacklinks,
            this.fontSwitcher,
            this.pdfExport,
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
        this.documentTreeFocus?.onLayoutReady();
        this.fontSwitcher?.onLayoutReady();
        this.inlineBacklinks?.onLayoutReady();
        this.nativeTagBrowser?.onLayoutReady();
        this.pdfExport?.onLayoutReady();
    }

    onunload() {
        this.eventBus.off("click-blockicon", this.blockMenuHandler);
        this.annotations?.onunload();
        this.databasePage?.onunload();
        this.documentBreadcrumb?.onunload();
        this.documentFind?.onunload();
        this.documentTreeFocus?.onunload();
        this.inlineBacklinks?.onunload();
        this.nativeTagBrowser?.onunload();
        this.pdfExport?.onunload();
        this.dailyNotes?.onunload();
        this.referenceAliasLabel?.onunload();
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
