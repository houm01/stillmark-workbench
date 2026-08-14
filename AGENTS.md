# Stillmark Workbench Rules

## Scope

* This repository contains the Stillmark Workbench plugin for SiYuan Note.
* Keep tools independent and small; shared shell code belongs in `src/` and tool-specific logic should be split into focused modules as it grows.

## Workflow

* Do not use Superpowers skills, workflows, or document templates in this repository.
* Keep project plans and specifications in neutral project-owned paths such as `docs/plans/` and `docs/specs/` when they are needed.

## Git

* Do not modify `main` directly. Use `dev` as the only development branch and merge `dev` into `main` through a pull request; do not create other development branches.
* Do not create worktrees.

## SiYuan data safety

* Use official plugin and kernel APIs before relying on internal DOM behavior.
* Do not directly read or write files under the SiYuan workspace `data` directory.
* Scope mutations to explicit user selections and report partial failures.

## Interface

* Reuse SiYuan variables and native component classes.
* Keep the interface quiet, compact, and free of decorative gradients or heavy shadows.
* Support light and dark modes without changing global appearance settings.
* Give plugin-owned top-bar icons restrained, distinct accent colors instead of leaving them monochrome.
* Anchor top-bar context menus below the triggering button instead of opening entirely to its left; leave enough vertical clearance for the native tooltip.
* Floating tools launched from the workbench must anchor to the clicked workbench control, not to a separate top-bar shortcut.
* Settings opened from the workbench should provide a direct return action and reopen the workbench after a successful save.
* Current-document search matches use yellow backgrounds; keep the active match more saturated than the other matches.
* Native tag-panel enhancements use slash-delimited hierarchy; clicking a tag expands its unique related documents, parent tags include descendant-tag documents, and native search and context actions remain available.
* In SiYuan `Setting`, use `direction: "row"` for full-width stacked controls; avoid placing custom full-width containers in `direction: "column"`, which produces oversized mobile layouts.
* PDF export follows the current editor font by default, allows choosing an installed system font for the current export, and includes H1-H3 bookmarks in the PDF reader's sidebar outline by default without inserting a contents page into the body.
* PDF export must generate PDF bytes through SiYuan desktop's print-to-PDF bridge and save them with a native file dialog; never invoke the system printer.
* Keep PDF export typography compact and information-dense: modest paragraph and list spacing, readable reduced font size and line height, quiet code blocks, and no decorative rules under document or section headings. Tables should discard editor-fixed column widths, prefer single-line cells with density fallbacks, and repeat headers across pages; long code blocks may paginate instead of leaving large blank areas.
* Keep document switches visually stable: reserve the breadcrumb's final height while its path loads, disable the native title-margin transition beside it, and do not call `expandDocTree` when the target document is already focused in the tree.
* Database-backed document pages should present the native field panel as a quiet compact card and collapse it on each fresh document render, while preserving manual expand/collapse for the current editor instance.
* Theme-owned JavaScript enhancements belong in this plugin: source-site favicons use direct no-referrer `/favicon.ico` requests with no third-party service, and duplicate bookmark labels use read-only file-tree API path lookup without changing document content.
* Continuous Stillmark document-tree and editor-list hover guides use `HoverGuidesFeature` state classes. Update them only when the hovered target changes or a scroller moves; do not reintroduce document-wide relational `:has(...:hover)` selectors.
* Content references may use a read-only batched target-type lookup and annotate only their current rendered nodes with `data-stillmark-ref-target="block|document"`; cache results, mark newly rendered references incrementally, and never change document content.
* The current-document outline should follow editor clicks, caret movement, and scrolling: highlight the nearest heading, keep it visible in the outline, and reveal its collapsed ancestor path without expanding unrelated branches.
* Every current-document outline row must reserve the same disclosure-control column whether or not the heading has children; keep it compact for fine pointers while preserving the 24px disclosure target for coarse pointers. Nesting indentation is independent of disclosure availability, and the active background spans the full row.
* When deploying runtime assets through `/api/file/putFile`, send the current Unix time in milliseconds as a nonzero `modTime` and confirm `readDir.updated` is current; `modTime=0` or seconds can leave installed files older than marketplace assets and allow stale CSS/JS to reappear.

## Verification

* Run `pnpm check` and `git diff --check` before publishing changes.
* Verify data mutations against a disposable test block before a release.
* For local runtime verification, back up the served plugin assets, upload the built `dist/` assets through `/api/file/putFile`, and reload with `/api/petal/setPetalEnabled`; verify the served bytes and enabled state after reload. Do not copy files directly into the workspace.
* Verify content-reference target annotations in a real document containing both heading/block and whole-document targets; confirm the attributes return after a rerender and produce distinct light/dark theme styles.
* For document-switch jump regressions, sample the title position, breadcrumb loading state, and following tree-item position across animation frames; a settled screenshot alone can miss the transient shift.
* Verify PDF code-block spacing in the actual export dialog after `ProtyleMethod.highlightRender`; raw export HTML does not include the renderer's later theme padding and inline whitespace styles.
