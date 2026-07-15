[简体中文](README.zh-CN.md)

# Stillmark Workbench

Stillmark Workbench is a quiet collection of focused tools for SiYuan Note.

## Available tool

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
* Batch actions affect only blocks explicitly selected by the user.

## License

[MIT](LICENSE)
