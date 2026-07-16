# Stillmark Workbench Rules

## Scope

* This repository contains the Stillmark Workbench plugin for SiYuan Note.
* Keep tools independent and small; shared shell code belongs in `src/` and tool-specific logic should be split into focused modules as it grows.

## Workflow

* Do not use Superpowers skills, workflows, or document templates in this repository.
* Keep project plans and specifications in neutral project-owned paths such as `docs/plans/` and `docs/specs/` when they are needed.

## Git

* Do not modify `main` directly. Work on `feature/*` branches and merge through a pull request.
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
* In SiYuan `Setting`, use `direction: "row"` for full-width stacked controls; avoid placing custom full-width containers in `direction: "column"`, which produces oversized mobile layouts.
* PDF export follows the current editor font by default, allows choosing an installed system font for the current export, and includes H1-H3 bookmarks in the PDF reader's sidebar outline by default without inserting a contents page into the body.
* PDF export must generate PDF bytes through SiYuan desktop's print-to-PDF bridge and save them with a native file dialog; never invoke the system printer.

## Verification

* Run `pnpm check` and `git diff --check` before publishing changes.
* Verify data mutations against a disposable test block before a release.
* For local runtime verification, back up the served plugin assets, upload the built `dist/` assets through `/api/file/putFile`, and reload with `/api/petal/setPetalEnabled`; verify the served bytes and enabled state after reload. Do not copy files directly into the workspace.
