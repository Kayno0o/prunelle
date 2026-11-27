# __APP_NAME__

A prunelle app. Read `node_modules/prunelle/llms.txt` before writing code: it holds prunelle's whole API for the version installed here, on one page. When using first-party plugins (`@prunelle/*`), also read each installed plugin's `node_modules/@prunelle/<plugin>/llms.txt` if present.

## Workflow

- **Verify changes**: run `bun run check` (`prunelle check` + TypeScript), `bun test` (in-process `testApp` from `prunelle/test` — no dev server needed), and `prunelle build --analyze` to inspect each route's JS weight and islands.
- **Discover, don't guess**: use plugin commands when installed — `prunelle icons-find <words>` for icon names, `prunelle i18n-check` for translation keys, and `prunelle mcp-footprint` for MCP tool token budgets.

@node_modules/prunelle/llms.txt
