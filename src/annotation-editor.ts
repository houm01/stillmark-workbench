import {
    Dialog,
    Plugin,
} from "siyuan";
import {
    ANNOTATION_LINE_STYLES,
    ANNOTATION_MAX_NOTE_LENGTH,
    ANNOTATION_TAGS,
    AnnotationLineStyle,
    AnnotationRecord,
    AnnotationSelection,
    AnnotationTag,
    annotationStyleForTag,
} from "./annotation-model";

interface AnnotationEditorOptions {
    onDelete?: () => Promise<void>;
    onSave: (value: AnnotationEditorValue) => Promise<void>;
    plugin: Plugin;
    record?: AnnotationRecord;
    selection: AnnotationSelection;
}

export interface AnnotationEditorValue {
    lineStyle: AnnotationLineStyle;
    note: string;
    tag: AnnotationTag;
}

const TAG_ICONS: Record<AnnotationTag, string> = {
    important: "★",
    none: "•",
    pin: "⌖",
    question: "?",
    reading: "▤",
    todo: "✓",
};

export function openAnnotationEditor(options: AnnotationEditorOptions) {
    const isEditing = Boolean(options.record);
    const dialog = new Dialog({
        title: isEditing ? options.plugin.i18n.annotationEditTitle : options.plugin.i18n.annotationCreateTitle,
        content: '<div class="b3-dialog__content stillmark-annotation-editor"></div>',
        width: "min(520px, 92vw)",
    });
    const root = dialog.element.querySelector<HTMLElement>(".stillmark-annotation-editor");
    if (!root) {
        return;
    }

    const value: AnnotationEditorValue = {
        lineStyle: options.record?.lineStyle ?? options.selection.lineStyle,
        note: options.record?.note ?? "",
        tag: options.record?.tag ?? options.selection.tag,
    };

    const quote = document.createElement("div");
    quote.className = "stillmark-annotation-editor__quote";
    quote.textContent = options.selection.quote;
    quote.title = options.selection.quote;

    const preview = document.createElement("span");
    preview.className = "stillmark-annotation-editor__preview";
    preview.textContent = "Aa";

    const tagLabel = createFieldLabel(options.plugin.i18n.annotationTag);
    const tagOptions = document.createElement("div");
    tagOptions.className = "stillmark-annotation-editor__options";
    const tagButtons = ANNOTATION_TAGS.map((tag) => {
        const button = createChoiceButton(options.plugin.i18n[`annotationTag_${tag}`], () => {
            value.tag = tag;
            syncChoices(tagButtons, tag);
            syncPreview(preview, value);
        });
        button.dataset.value = tag;
        button.dataset.tag = tag;
        button.textContent = `${TAG_ICONS[tag]} ${options.plugin.i18n[`annotationTag_${tag}`]}`;
        tagOptions.append(button);
        return button;
    });

    const lineLabel = createFieldLabel(options.plugin.i18n.annotationLineStyle);
    const lineOptions = document.createElement("div");
    lineOptions.className = "stillmark-annotation-editor__options";
    const lineButtons = ANNOTATION_LINE_STYLES.map((lineStyle) => {
        const button = createChoiceButton(options.plugin.i18n[`annotationLine_${lineStyle}`], () => {
            value.lineStyle = lineStyle;
            syncChoices(lineButtons, lineStyle);
            syncPreview(preview, value);
        });
        button.dataset.value = lineStyle;
        const sample = document.createElement("span");
        sample.className = "stillmark-annotation-editor__line-sample";
        sample.dataset.lineStyle = lineStyle;
        sample.textContent = options.plugin.i18n[`annotationLine_${lineStyle}`];
        button.replaceChildren(sample);
        lineOptions.append(button);
        return button;
    });

    const noteLabel = createFieldLabel(options.plugin.i18n.annotationNote);
    const note = document.createElement("textarea");
    note.className = "b3-text-field stillmark-annotation-editor__note";
    note.maxLength = ANNOTATION_MAX_NOTE_LENGTH;
    note.placeholder = options.plugin.i18n.annotationNotePlaceholder;
    note.value = value.note;
    note.addEventListener("input", () => {
        value.note = note.value;
    });

    const footer = document.createElement("div");
    footer.className = "stillmark-annotation-editor__footer";
    const footerStart = document.createElement("div");
    footerStart.className = "stillmark-annotation-editor__footer-start";
    if (options.onDelete) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "b3-button b3-button--cancel stillmark-annotation-editor__delete";
        deleteButton.textContent = options.plugin.i18n.annotationDelete;
        deleteButton.addEventListener("click", () => {
            deleteButton.disabled = true;
            void options.onDelete?.().then(() => dialog.destroy()).catch(() => {
                deleteButton.disabled = false;
            });
        });
        footerStart.append(deleteButton);
    }

    const footerEnd = document.createElement("div");
    footerEnd.className = "stillmark-annotation-editor__footer-end";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "b3-button b3-button--cancel";
    cancelButton.textContent = options.plugin.i18n.annotationCancel;
    cancelButton.addEventListener("click", () => dialog.destroy());
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "b3-button b3-button--text";
    saveButton.textContent = options.plugin.i18n.annotationSave;

    const save = () => {
        saveButton.disabled = true;
        cancelButton.disabled = true;
        void options.onSave({...value, note: note.value}).then(() => {
            dialog.destroy();
        }).catch(() => {
            saveButton.disabled = false;
            cancelButton.disabled = false;
        });
    };
    saveButton.addEventListener("click", save);
    note.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            save();
        }
    });

    footerEnd.append(cancelButton, saveButton);
    footer.append(footerStart, footerEnd);
    root.append(
        quote,
        preview,
        tagLabel,
        tagOptions,
        lineLabel,
        lineOptions,
        noteLabel,
        note,
        footer,
    );
    syncChoices(lineButtons, value.lineStyle);
    syncChoices(tagButtons, value.tag);
    syncPreview(preview, value);
    window.setTimeout(() => note.focus(), 0);
}

function createFieldLabel(text: string) {
    const label = document.createElement("div");
    label.className = "stillmark-annotation-editor__label";
    label.textContent = text;
    return label;
}

function createChoiceButton(label: string, onClick: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stillmark-annotation-editor__choice";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", onClick);
    return button;
}

function syncChoices(buttons: HTMLButtonElement[], selected: string) {
    buttons.forEach((button) => {
        const isSelected = button.dataset.value === selected;
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
    });
}

function syncPreview(preview: HTMLElement, value: AnnotationEditorValue) {
    const style = annotationStyleForTag(value.tag);
    preview.dataset.backgroundColor = style.backgroundColor;
    preview.dataset.color = style.color;
    preview.dataset.lineStyle = value.lineStyle;
}
