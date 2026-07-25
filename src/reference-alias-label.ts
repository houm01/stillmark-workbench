import {Plugin} from "siyuan";

export class ReferenceAliasLabelFeature {
    private appliedLabel?: string;
    private originalLabel?: string;

    constructor(private readonly plugin: Plugin) {}

    onload() {
        this.apply();
    }

    onLayoutReady() {
        this.apply();
    }

    private apply() {
        const languages = window.siyuan.languages;
        const replacement = this.plugin.i18n.referenceAliasLabel;
        if (
            !languages ||
            typeof languages.anchor !== "string" ||
            typeof replacement !== "string" ||
            !replacement.trim()
        ) {
            return;
        }

        this.originalLabel ??= languages.anchor;
        this.appliedLabel = replacement.trim();
        languages.anchor = this.appliedLabel;
    }

    onunload() {
        const languages = window.siyuan.languages;
        if (
            languages &&
            this.originalLabel &&
            this.appliedLabel &&
            languages.anchor === this.appliedLabel
        ) {
            languages.anchor = this.originalLabel;
        }
        this.appliedLabel = undefined;
        this.originalLabel = undefined;
    }
}
