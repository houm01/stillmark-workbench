import {
    Dialog,
    Menu,
    Plugin,
    fetchSyncPost,
    getFrontend,
    showMessage,
} from "siyuan";
import {DailyNotesFeature} from "./daily-notes";
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
    private dailyNotes?: DailyNotesFeature;

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

    onload() {
        this.addIcons(`<symbol id="iconStillmarkWorkbench" viewBox="0 0 32 32">
<path d="M5 7.5h22v17H5zM9 12h14M9 16h9M9 20h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
</symbol>`);

        this.addCommand({
            langKey: "openWorkbench",
            hotkey: "⌥⇧W",
            callback: () => this.openWorkbench(),
        });

        this.eventBus.on("click-blockicon", this.blockMenuHandler);

        this.dailyNotes = new DailyNotesFeature(this);
        this.dailyNotes.onload();
    }

    onLayoutReady() {
        this.addTopBar({
            icon: "iconStillmarkWorkbench",
            title: this.i18n.openWorkbench,
            position: "right",
            callback: () => this.openWorkbench(),
        });

        this.dailyNotes?.onLayoutReady();
    }

    onunload() {
        this.eventBus.off("click-blockicon", this.blockMenuHandler);
        this.dailyNotes?.onunload();
    }

    private openWorkbench() {
        const frontend = getFrontend();
        const isMobile = frontend === "mobile" || frontend === "browser-mobile";

        new Dialog({
            title: this.i18n.workbenchTitle,
            content: `<div class="b3-dialog__content stillmark-workbench">
    <section class="stillmark-workbench__tool">
        <div class="stillmark-workbench__tool-header">
            <div>
                <div class="stillmark-workbench__tool-name">${this.i18n.blockRoles}</div>
                <div class="stillmark-workbench__tool-description">${this.i18n.blockRolesDescription}</div>
            </div>
            <span class="stillmark-workbench__status">${this.i18n.available}</span>
        </div>
        <div class="stillmark-workbench__roles" aria-label="${this.i18n.blockRoles}">
            ${
                ROLE_DEFINITIONS.map((role) => `<span data-role="${role.value}">${this.i18n[role.labelKey]}</span>`)
                    .join("")
            }
        </div>
        <div class="stillmark-workbench__usage">${this.i18n.blockRolesUsage}</div>
    </section>
</div>`,
            width: isMobile ? "92vw" : "520px",
        });
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
