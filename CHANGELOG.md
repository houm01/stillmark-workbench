# Changelog

This file records user-visible changes to Stillmark Workbench.

## 0.4.9 — 2026-09-01

### Fixed

* Keep the annotation toolbar item registered consistently during plugin construction so SiYuan's shortcut settings can open without a missing keymap entry.

## 0.4.8 — 2026-08-31

### Added

* Add background database relation sync that materializes Device → Cabinet → Site → Customer chains as real Device relations, with change-triggered and five-minute reconciliation, manual sync, strict discovery, and full readback verification.

### Changed

* Keep database pages out of both automatic and button-triggered document-tree location by default, preventing large databases from expanding the left tree.

### Fixed

* Restore automatic document-tree location for ordinary documents when SiYuan renders an empty database-attribute placeholder.

## 0.4.7 — 2026-08-27

### Changed

* Keep the current-document outline closed by default on database-backed pages while preserving manual opening for the current page and restoring the previous presentation after leaving it.

## 0.4.6 — 2026-08-23

### Fixed

* Restore default collapsing for database-backed document field panels after SiYuan's native toggle markup changed, including panels that render asynchronously, while preserving manual expansion for the current editor.

## 0.4.5 — 2026-08-14

### Changed

* Preserve Stillmark's continuous document-tree and editor-list hover guides with small state classes instead of relational hover selectors that force full-page style recalculation.

## 0.4.4 — 2026-08-12

### Changed

* Tighten the document-outline disclosure gutter, heading marker, and spacing for fine pointers while retaining aligned rows, consistent nested indentation, and the 24px disclosure target for coarse pointers.

## 0.4.3 — 2026-08-11

### Fixed

* Align document-outline headings at the same depth whether or not they have children, while retaining consistent nested indentation and full-row active highlighting.

## 0.4.2 — 2026-08-11

### Added

* Add a persistent current-document outline with selectable right-dock and floating-editor modes, automatic heading refresh, and direct heading navigation.
* Classify rendered block references as block or whole-document targets through cached, read-only lookups for distinct theme presentation.

### Changed

* Move the note-path breadcrumb directly below SiYuan's native breadcrumb while keeping it independent from the native breadcrumb DOM.
* Match the document outline to SiYuan's native order and hierarchy, add collapsible branches and editor-position tracking, use a denser opaque floating surface, open the selected right dock when the layout is ready, and keep leaf and child-heading indentation visually consistent.
* Refresh unchanged native tag and document-outline trees in place instead of rebuilding their rendered structure.

### Fixed

* Close workbench dialogs during plugin reloads so stale dialog handlers cannot block native shortcuts such as Command + P.
* Reconnect the enhanced tag tree when SiYuan replaces the native panel host during a rerender.

## 0.4.1 — 2026-08-10

### Added

* Enhance the Stillmark theme with direct source-site favicons and parent-path subtitles for duplicate bookmark titles without writing to document content.

## 0.4.0 — 2026-08-10

### Added

* Expand tags in SiYuan's native tag panel to show unique related documents, with slash-delimited hierarchy, parent-tag aggregation, filtering, and preserved native search and context actions.
* Show the macOS PingFang Simplified, Traditional, Hong Kong, and Macau families in the editor and PDF font pickers, including the available editor font weights omitted by SiYuan's system-font API.
* Add persistent master switches for every tool shown in the workbench, including bulk enable/disable controls and full annotation entry-point and runtime cleanup without deleting stored annotations.

### Changed

* Align plugin-owned top-bar icons with SiYuan's restrained line-icon language while keeping subtle feature accents.
* Make workbench rows respond to the dialog's actual width and keep the dialog content-height sized while the application window changes.

### Fixed

* Activate the destination editor tab when opening a document from the enhanced native tag panel.
* Flush SiYuan's pending attribute index writes and verify annotation mutations against persisted attributes instead of the potentially stale block-attribute cache, with a longer compatibility retry fallback.

## 0.3.0 — 2026-07-26

### Added

* Add native selected-text annotations with tag-based styling, optional underlines, multiple notes on the same passage, hover details, per-entry and same-passage group deletion, and a current-page overview.
* Add editable reference aliases for Linked pages sources and use clearer reference-alias wording in the native interface.

### Changed

* Keep database attribute cards compact and collapsed by default on database-backed document pages.

### Fixed

* Retry annotation attribute readback and compare records semantically to avoid reporting a failed save when SiYuan has already persisted the annotation.
* Keep document titles, breadcrumbs, and nearby tree items visually stable while switching documents.
* Prevent long exported tables from overlapping later headings and paragraphs across PDF pages.
* Use the note name as the PDF document title instead of inheriting the SiYuan window title.
* Tighten PDF typography and block spacing, soften code blocks, and remove decorative heading rules.
* Fit exported table columns to their content, prefer single-line cells, override post-render theme padding so code blocks stay at content height, and paginate long code blocks without wasting most of a page.

## 0.2.1 — 2026-07-25

### Added

* Add a compact note-path breadcrumb above each document title with direct parent-document navigation and deep-path overflow handling.
* Add a macOS Copy PDF action that generates a temporary PDF and places its file reference on the clipboard for direct attachment pasting without opening a save dialog.
* Add a read-only Linked pages section below document content with grouped backlink context, native sorting and expansion defaults, lazy loading, and exact source-block navigation.
* Add persistent workbench switches for breadcrumb navigation and Linked pages display, with immediate updates in open documents.

## 0.2.0 — 2026-07-16

### Added

* Add a dedicated daily-note top-bar button for opening today's note.
* Add a read-only seven-day history menu through right-click or mobile long-press.
* Add native SiYuan notebook, journal root, and template configuration with readback verification.
* Add document-page templates that refresh before the daily note is first created.
* Add an option to create today's note silently when SiYuan starts.
* Add a manual document-tree locate button immediately to the right of the daily-note button.
* Add an optional automatic document-tree location mode with a dedicated plugin setting and a desktop right-click shortcut.
* Add an upper-left font and size switcher with 1px size controls, direct input, system-font search, non-blocking hover previews, and default resets.
* Add an upper-left polished PDF export with live preview, current-font defaults, selectable system fonts, default H1-H3 sidebar bookmarks, three quiet typesetting presets, paper and margin controls, subdocument options, direct local-file saving, and PDF-focused pagination.
* Add a compact current-document find bar for `Command + F` / `Ctrl + F`, with ordered navigation and non-mutating match highlights.

### Changed

* Move the daily-note button to the upper-left top bar.
* Rework daily-note settings into a compact native layout for desktop and mobile.
* Turn the upper-right workbench into a unified tool and configuration hub with live status.
* Add a direct return path from workbench settings and reopen the workbench after saving.

### Fixed

* Correct the marketplace platform metadata so `all` is not mixed with explicit platform values.
* Anchor the font and size menu to its workbench button instead of the upper-left toolbar shortcut.
* Generate PDF bytes directly and save them through the native file dialog instead of invoking the system printer or PDF.js print overlay.
* Restore multi-page PDF pagination under SiYuan's fixed-height desktop shell, move the table of contents into the PDF outline, and tighten the title-to-body spacing.

## 0.1.0 — 2026-07-15

Initial release.

### Added

* Add the Stillmark Workbench top-bar entry and command.
* Add semantic block roles through the block menu.
* Add Simplified Chinese and English interfaces.
