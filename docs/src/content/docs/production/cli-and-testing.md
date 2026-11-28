---
title: CLI & Testing
description: Prunelle CLI commands, plugin subcommands, bundle analysis, RGAA Chromium audits, and in-process or browser testing with prunelle/test.
section: production
order: 3
---

## CLI commands

| Command | Purpose |
| :--- | :--- |
| `prunelle new <dir> [--template minimal\|fullstack\|blog\|app] [--force]` | Scaffold a new project with `AGENTS.md`, `.gitignore`, `.mcp.json` (`prunelle mcp`), and `prunelle/ts-plugin` in `tsconfig.json`. |
| `prunelle check [dir] [--no-typecheck] [--json] [--strict]` | Validate compiler rules, routes, links, forms vs. schemas, RGAA/RGPD/LCEN compliance, plugin checks, and TypeScript (`bun check` / `tsgo` / `tsc`). |
| `prunelle inspect [dir] [--json]` | Statically list routes (groups, matchers, `cache`, `cacheable`), islands (trigger reason & `$hydrate`), actions, and plugin order without bundling. |
| `prunelle docs <words...> [--json] [--limit <n>]` | Search `llms.txt` of `prunelle` and every installed `@prunellejs/*` package at the installed versions, printing matching sections with file and line (`--json` for agents). |
| `prunelle render <url> [-X method] [-d body] [-H header] [-b cookie] [-i] [--fresh]` | Build or reuse a cached `testApp()` build and print the response with no port bound (exit `0` for `2xx`/`3xx`, `1` otherwise). |
| `prunelle mcp [dir] [--allow-write]` | Run the stdio MCP server for coding agents (`check`, `inspect`, `build_analyze`, `build`, `render`, `docs`, `dev_errors` tools and `prunelle://llms/*` resources). |
| `prunelle dev [dir] [--port 3000] [--host [addr]]` | Fast incremental dev server with live reload and `data-pru-src` Alt-click jump to `$PRUNELLE_EDITOR`/`$VISUAL` (`127.0.0.1` default; pass `--host` for `0.0.0.0`). |
| `prunelle build [dir] [--static] [--compile [out]] [--auto-prerender] [--analyze] [--json] [--max-js <size>]` | Single-pass production build, static export, or standalone binary with optional bundle/EcoIndex report and eager JS budget check. |
| `prunelle start [dir] [--port 3000] [--host [addr]]` | Serve a built `dist/` server or `--static` export on `Bun.serve()`, reloading new builds without restart. |
| `prunelle upgrade [dir] [--no-install]` | Migrate a kay v2 app (or workspace) onto Prunelle. See [Upgrading from kay](/docs/production/upgrading-from-kay). |
| `prunelle a11y [--routes /a,/b] [--all-static] [--json] [--draft [dest]] [--no-fail]` | Run `axe-core` in Chromium mapped to RGAA 4.1 and draft `src/routes/accessibilite.tsx` (via built-in `a11y()` plugin). |
| `prunelle ui-eject <grammar> [dest]` | Eject a `@prunellejs/ui` CSS Grammar into one standalone stylesheet. |
| `prunelle mcp-footprint` | Inspect `@prunellejs/mcp` tool sizes in bytes and estimated tokens. |
| `prunelle i18n-check` | List missing translation keys across `@prunellejs/i18n` locales. |
| `prunelle icons-find <words> [--set <prefix>] [--limit <n>]` | Search installed `@iconify-json/*` packs and local `.svg` folders by word, synonym, or typo. |

`prunelle check` reports every finding in one pass at `file:line:col` (`--json` outputs structured data; `--strict` exits `1` on warnings; the summary names which typechecker ran or why it was skipped). `prunelle build` enforces the same compile and form-schema errors without running the typechecker.

### How `prunelle dev` reloads

`prunelle dev` keeps the listening port and SSE live-reload stream in the parent process while running builds and your app in a child process. File saves rebuild incrementally inside that child, preserving its build cache and in-memory plugin state (such as dev sessions).

Editing `prunelle.config.ts` (or a local file it imports) — or exceeding 2 GB of child memory after a rebuild — cleanly recycles the child process while in-flight requests wait and open browser tabs reload once ready. Editing a file in `public/` reloads the browser with no rebuild. If the child crashes, requests show the exit status and stderr (JSON or plain text per `Accept`) until the next save.

### Jump to source on Alt-click (`prunelle dev`)

In `prunelle dev`, every rendered element carries `data-pru-src="file:line:col"` pointing to the TSX tag that emitted it. Hold `Alt` and click any element in the browser to open that file and line in `$PRUNELLE_EDITOR` or `$VISUAL` (supports VS Code / Cursor / VSCodium, Zed, JetBrains IDEs, Sublime / Helix, Vim / Neovim / Emacs, or a custom `{file}:{line}:{col}` template).

Production builds never emit `data-pru-src` and remain byte-identical.

### Editor diagnostics while typing (`prunelle/ts-plugin`)

`prunelle new` registers Prunelle's TypeScript language-service plugin in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "prunelle/ts-plugin" }]
  }
}
```

It reports compiler mistakes (bare signal reads without `.value`, React/Solid/Astro habits, invalid hydrate modes, server-only tags in islands) and RGAA/RGPD compliance warnings inline while typing with the exact same messages as `prunelle check`, and offers mechanical quick fixes (`n` → `n.value`, `onclick` → `onClick`, `ariaLabel` → `aria-label`, `strokeWidth` → `stroke-width`, `defaultValue` → `value`, `dangerouslySetInnerHTML` → `innerHTML`, `'use client'` removal, and more).

> **Note (`tsgo`)**: Language-service plugins currently work in `tsserver`-backed editors (VS Code, Neovim, Zed, JetBrains). Support for `tsgo` will follow once `tsgo` exposes a plugin API; until then `prunelle check` reports the same diagnostics in CI and the terminal.

### Agent MCP server (`prunelle mcp`), `prunelle render` & `prunelle docs`

`prunelle new` writes `.mcp.json` so MCP-aware coding agents can query Prunelle directly over stdio:

```json
{
  "mcpServers": {
    "prunelle": {
      "command": "bunx",
      "args": ["prunelle", "mcp"]
    }
  }
}
```

- **Tools**: `check` (JSON diagnostics), `inspect` (routes, islands, actions, plugins), `build_analyze` (read-only bundle weight & EcoIndex report without touching `dist/`), `build` (gated on `prunelle mcp --allow-write`), `render` (in-process HTTP rendering), `docs` (search installed `llms.txt`), and `dev_errors` (last build, crash, or runtime errors from `prunelle dev`). Every path argument is confined to the project root.
- **Resources**: `prunelle://llms/prunelle` and `prunelle://llms/@prunellejs/<pkg>` for every installed first-party plugin.

From the terminal, `prunelle render <url> [-X method] [-d body] [-H header] [-b cookie] [-i]` renders any URL in-process via `testApp()` (reusing a cached build in `.prunelle-cache/render-build`, exit `0` for `2xx`/`3xx`, `1` otherwise), and `prunelle docs <words...> [--json]` searches `llms.txt` across `prunelle` and every installed `@prunellejs/*` package.

Plugins can register custom subcommands via `PrunellePlugin.commands`. They are loaded from `prunelle.config.ts` only when the first argument is not a built-in command, and accept `--root <dir>` and `--help`.

## Help, completions & exit codes

Every command supports `--help` and suggests corrections for mistyped commands or flags (`prunelle chekc` suggests `check`). Generate shell completions with `prunelle --completions fish` (also `bash` and `zsh`):

```bash
prunelle --completions fish > ~/.config/fish/completions/prunelle.fish
```

| Code | Meaning |
| :--- | :--- |
| `0` | Success. |
| `1` | A finding or failure: `prunelle check` found an error (or warning under `--strict`), `prunelle upgrade` left manual steps, a build failed, or a route exceeded `--max-js`. |
| `2` | Usage error: unknown command/flag, invalid `--port` or `--max-js`, or missing argument. |

## In-process testing (`prunelle/test`)

Test routes, middleware, cookies, auth flows, and server actions in-process with `testApp()` — no port binding needed:

```ts
import { describe, expect, it } from 'bun:test'
import { testApp } from 'prunelle/test'

describe('app routes', () => {
  it('renders home and submits a server action', async () => {
    const app = await testApp({ root: process.cwd() })

    const res = await app.get('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Latest posts')

    // The app's own bundled copy, matching what routes and prunelle.config.ts use
    const { savePreferences } = await app.import('src/actions/preferences.ts')
    const submitRes = await app.submit(savePreferences, { project: 'orbit', target: 'binary' })
    expect(submitRes.status).toBe(200)
  })
})
```

`TestApp` helpers:

- `app.get(path, headers?)`: Sends a `GET` request with the persistent cookie jar.
- `app.post(path, body?, headers?)`: Sends JSON or `FormData` with `Origin: http://localhost`.
- `app.import(path)`: Imports the app's bundled copy of a route, middleware, action file, or `prunelle.config.ts` so module state and action URLs match the running app.
- `app.submit(action, fields, headers?)`: Submits `FormData` to an action from `app.import()` (or a URL), automatically populating a clean honeypot and aged signed timestamp for `protect`ed actions unless overridden.
- `app.fetch(pathOrRequest, init?)`: Low-level request helper with cookie jar persistence.
- `app.cookies` / `app.clearCookies()`: Inspect or reset cookies between test cases.
- `app.errors`: Captures unhandled route, action, and plugin errors (`route GET /boom: message`).
- **Isolated builds**: `testApp()` builds into `.prunelle-cache/test-*` (removed on exit) so tests never touch `dist/`. Pass `prebuilt: true` to reuse the latest build, `outDir` to build to a custom folder, or `dev: true` to return full dev error stacks in `500` responses.

### Unhandled errors & source maps

Unhandled errors answer with a bare `500 Internal Server Error` in production so visitors never see internal details. When no `onError` hook is configured, Prunelle logs each unhandled route, action, plugin, and streamed `<Suspense>` error (with method, path, request ID, and stack) to stderr in both `prunelle start` and `prunelle dev`. With `dev: true` (or `prunelle dev`), `500` responses return `{ ok: false, status: 500, error, stack }` for JSON clients or plain text otherwise.

Every stack frame maps back to your `src/` file and line via generated server source maps (including `error.stack` passed to `onError` in `prunelle start`).

## Testing islands in a browser (`testBrowser`)

`testBrowser()` builds the app for production, serves it on an ephemeral loopback port, and opens pages in headless Chromium with `load`/`client` islands hydrated (`playwright-core` is an optional dev dependency):

```ts
import { expect, it } from 'bun:test'
import { testBrowser } from 'prunelle/test'

it('counts clicks', async () => {
  const browser = await testBrowser({ root: process.cwd() })
  try {
    const page = await browser.open('/')
    await page.click('#counter')
    await page.waitFor(() => document.getElementById('counter')?.textContent === '1')
    expect(await page.text('#counter')).toBe('1')
    expect(page.errors).toEqual([])
  }
  finally {
    await browser.close()
  }
})
```

- `browser.open(path, { reducedMotion? })`: Opens a fresh browser context and resolves once initial islands hydrate.
- `page.click(sel)`, `page.hover(sel)`, `page.fill(sel, value)`, `page.press(key)`, `page.text(sel)`: Drive and inspect the page (`press('Escape')`, `press('Tab')`, `press('ArrowRight')` exercise the browser's real keyboard pipeline).
- `page.waitFor(sel | fn)` & `page.evaluate(fn)`: Wait on DOM state or evaluate expressions in the page.
- `page.errors`: Collects page errors, `console.error` calls, and 4xx/5xx responses.
- `browser.app` & `browser.origin`: Access the underlying `TestApp` and `http://127.0.0.1:<port>`.

## Accessibility audit & RGAA declaration (`a11y()`)

The built-in `a11y()` plugin in `prunelle/config` adds `prunelle a11y`, which opens your rendered routes in Chromium via `testBrowser()`, runs `axe-core` (WCAG 2.0/2.1 A & AA), maps violations to French RGAA 4.1 criteria, and can draft an editable RGAA 4.1.2 accessibility declaration page:

```bash
bun add -d axe-core playwright-core
```

```ts
// prunelle.config.ts
import { a11y, defineConfig } from 'prunelle/config'

export default defineConfig({
  plugins: [a11y()],
})
```

```bash
prunelle a11y                                                  # Audit routes (exits 1 on violations)
prunelle a11y --routes /,/contact --json --no-fail             # Machine-readable JSON report
prunelle a11y --draft --org "Mon organisme" --contact a11y@ex.fr # Draft src/routes/accessibilite.tsx
```

`axe-core` and `playwright-core` remain dev dependencies and never enter client or server bundles. Automated `axe-core` checks cover only part of RGAA 4.1.2 — review the drafted declaration and complete a manual RGAA audit before declaring `totalement conforme`.
