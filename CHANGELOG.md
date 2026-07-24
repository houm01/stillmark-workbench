# Changelog

This file records user-visible changes to Stillmark Workbench.

## Unreleased

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

* Anchor the font and size menu to its workbench button instead of the upper-left toolbar shortcut.
* Generate PDF bytes directly and save them through the native file dialog instead of invoking the system printer or PDF.js print overlay.
* Restore multi-page PDF pagination under SiYuan's fixed-height desktop shell, move the table of contents into the PDF outline, and tighten the title-to-body spacing.

## 0.1.0 — 2026-07-15

Initial release.

### Added

* Add the Stillmark Workbench top-bar entry and command.
* Add semantic block roles through the block menu.
* Add Simplified Chinese and English interfaces.
