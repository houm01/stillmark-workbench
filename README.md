[简体中文](README.zh-CN.md)

# Stillmark Workbench

Stillmark Workbench is a quiet collection of focused tools for SiYuan Note.

## Available tools

### Daily notes

The calendar button in the upper-left top bar provides two entry points:

* Left-click to create or open today's daily note.
* Right-click on desktop or long-press on mobile to view today and the previous six days. Missing dates are shown as unavailable and are never backfilled.

Choose the target notebook, journal root directory, and optional template in the plugin settings. A root such as `/Journal` produces `root/year/month/YYYY-MM-DD`.

Choose one template source:

* Open any document page and choose Use current page. The plugin refreshes its template snapshot before the day's note is first created.
* Enter a path relative to `data/templates`, such as `daily.md`.

Create on startup can silently ensure that today's note exists when SiYuan opens without opening the document. Paths and templates continue to reuse the selected notebook's native SiYuan daily-note configuration.

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
* Daily notes are written only to the explicitly configured, currently open notebook.
* The seven-day history menu is read-only and never creates missing historical notes.
* Batch actions affect only blocks explicitly selected by the user.

## License

[MIT](LICENSE)
