<p align="center">
  <img src="icon.png" width="96" height="96" alt="Stillmark Workbench icon">
</p>

<h1 align="center">Stillmark Workbench</h1>

<p align="center">A quiet collection of focused tools for SiYuan Note.</p>

<p align="center">
  <a href="https://github.com/houm01/stillmark-workbench/releases/latest"><img src="https://img.shields.io/github/v/release/houm01/stillmark-workbench?style=flat-square&amp;color=b42335" alt="Latest release"></a>
  <a href="https://github.com/siyuan-note/siyuan"><img src="https://img.shields.io/badge/SiYuan-%E2%89%A5%203.7.0-b42335?style=flat-square" alt="SiYuan 3.7.0 or later"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/houm01/stillmark-workbench?style=flat-square&amp;color=6f6b68" alt="MIT license"></a>
</p>

<p align="center"><a href="README.zh-CN.md">简体中文</a></p>

## Available tools

The upper-right Stillmark Workbench shows every tool and its current status, with direct entry points for daily notes, document-tree location, fonts, and PDF export. Automatic document-tree location can also be toggled there. Settings opened from the workbench provide a direct return action and reopen the workbench after a successful save.

### Find in document

Press `Command + F` in the document editor (`Ctrl + F` on Windows/Linux) to open a compact find bar in the editor's upper-right corner. The plugin searches only the current document, highlights matches in document order, and supports `Enter` for next, `Shift + Enter` for previous, and `Esc` to close.

SiYuan's native `Command + P` global search is unchanged. The plugin does not intercept `Command + F` in the workbench, settings, PDFs, or other non-document areas.

### Daily notes

The calendar button in the upper-left top bar provides two entry points:

* Left-click to create or open today's daily note.
* Right-click on desktop or long-press on mobile to view today and the previous six days. Missing dates are shown as unavailable and are never backfilled.

Choose the target notebook, journal root directory, and optional template in the plugin settings. A root such as `/Journal` produces `root/year/month/YYYY-MM-DD`.

Choose one template source:

* Open any document page and choose Use current page. The plugin refreshes its template snapshot before the day's note is first created.
* Enter a path relative to `data/templates`, such as `daily.md`.

Create on startup can silently ensure that today's note exists when SiYuan opens without opening the document. Paths and templates continue to reuse the selected notebook's native SiYuan daily-note configuration.

### Document tree focus

A manual locate button sits immediately to the right of the daily-note button and expands and selects the current note in the document tree. Automatic location can be enabled under “Document tree location” in plugin settings or toggled by right-clicking the locate button on desktop. The locate button does not provide a long-press menu.

### Quick font switching

An upper-left font and size button provides 1px size controls, direct size input, and a 16px reset above the installed-font search. Hovering a font previews it temporarily in the document; closing the compact floating menu restores the original font, while clicking saves the choice. The default font remains available.

### Polished PDF export

The upper-left PDF button loads the current document into a dedicated preview. Exports follow the current editor font by default, with any installed system font available for the current export, and include H1-H3 bookmarks in the PDF reader's sidebar outline by default without inserting a contents page into the body. Choose Reader, Minimal, or Report typesetting; A4, A5, or Letter paper; balanced or compact margins; and whether to include subdocuments or retain folded content.

The export uses SiYuan's export-preview API and preserves images, tables, code, math, and common rendered blocks. PDF styles refine heading hierarchy, long tables, code blocks, and page breaks. After clicking Export PDF, choose a local folder and filename; the file is written directly without opening a printer or the system print panel.

### Semantic block roles

Open the block menu and choose Stillmark Workbench to assign one of these roles to one or more blocks:

* Note
* Tip
* Warning
* Important
* Muted

The role is stored in the `custom-stillmark-role` block attribute and rendered with restrained light and dark mode styles. Clearing a role does not change block content.

## Development

Node.js 24 or later and pnpm 11 are required.

```bash
pnpm install
pnpm dev
```

Run the complete production check with:

```bash
pnpm check
```

Build output is written to `dist/`, and the marketplace package is written to `package.zip`.

## Safety boundaries

* Note and block data is accessed only through SiYuan kernel APIs.
* The plugin does not directly read or write the workspace `data` directory.
* Find in document reads only the current document through SiYuan's search API and never changes block content.
* Daily notes are written only to the explicitly configured, currently open notebook.
* The seven-day history menu is read-only and never creates missing historical notes.
* Batch actions affect only blocks explicitly selected by the user.
* PDF export reads only the current document and any subdocuments explicitly included by the user; it does not change note content.

## License

[MIT](LICENSE)
