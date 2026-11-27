---
title: CLI & Testing
description: Prunelle CLI commands, plugin subcommands, bundle analysis, and in-process integration testing with testApp() from prunelle/test.
section: production
order: 4
---

## CLI commands

| Command | Description |
| :--- | :--- |
| `prunelle new <dir> [--template minimal\|fullstack\|blog\|app] [--force]` | Scaffold a new project |
| `prunelle check [dir] [--no-typecheck] [--json] [--strict]` | Run Prunelle compiler checks, route checks, plugin `check()` hooks, and `bun check`/`tsgo`/`tsc`. Every mistake in a file is reported in one run, each at its `file:line:col`. `--json` prints the findings as data, and `--strict` fails on a warning too. The last line says which tool typechecked, or why none did: no `tsconfig.json`, `--no-typecheck`, or no checker installed. `prunelle build` refuses the same mistakes and skips only the typecheck |
| `prunelle inspect [dir] [--json]` | Statically inspect routes (file and plugin routes, layouts, `_middleware.ts`, `load`, `prerender`), islands (with interactivity `reason` and `hydrate` mode), actions (with URL and guarding `_middleware.ts`), and active plugins (resolved order, `providesLocals`, `readsLocals`, CLI commands) without running a bundle. `--json` prints `{ routes, islands, actions, plugins }` |
| `prunelle dev [dir] [--port 3000] [--host [addr]]` | Dev server with live reload (binds `127.0.0.1` by default; pass `--host` for `0.0.0.0`). A `prunelle.config.ts` that fails to load stops it with the error and its `file:line:column` |
| `prunelle build [dir] [--analyze] [--json] [--max-js <size>]` | Single-pass production build into `dist/`. `--analyze` prints per-route JS/CSS weights, the fonts and the first load (everything a first visit downloads besides the HTML, brotli), and each island with the reason it became one; add `--json` to print `BundleReport` as JSON on stdout without summary lines. `--max-js 40kb` (or a byte count) fails the build when a route's gzipped eager JS is over the size, naming the route and its islands |
| `prunelle build --static` | Static HTML + asset export into `dist/` |
| `prunelle build --compile [out]` | Compile into a single standalone Bun executable |
| `prunelle start [dir] [--port 3000] [--host [addr]]` | Serve a built `dist/` app on `Bun.serve()` (binds `127.0.0.1` by default) |
| `prunelle upgrade [dir] [--no-install]` | Move an app written for kay v2 onto prunelle: its dependencies, config file, imports and the names they bring, then run `bun install`. What it cannot move is printed with its file and line. See [Upgrading from kay](/docs/production/upgrading-from-kay) |
| `prunelle ui-eject <grammar> [dest]` | Eject a `@prunelle/ui` CSS Grammar into your repo |
| `prunelle mcp-footprint` | Print `@prunelle/mcp` tool sizes in bytes and estimated tokens |
| `prunelle i18n-check` | List missing translation keys across `@prunelle/i18n` locales |

### How `prunelle dev` reloads

`prunelle dev` keeps the port and the browser's reload stream in its own process, and runs the build and the app in a child process behind it. A save rebuilds what changed inside that child, keeping its build cache and the in-memory state of plugins, such as sessions.

An edit to `prunelle.config.ts`, or to a local file it imports such as a plugin of your own, starts a new child that loads both fresh. So does a child that passes 2 GB of memory after a rebuild. Requests made during the swap wait for the new child, and open tabs reload once it has built.

A child that crashes shows its exit and the end of its error output in the page, as JSON or plain text when the request asks for it. The next save starts it again.

An edit to a file in `public/` reloads the browser without a rebuild. Adding or removing one rebuilds, since the list of served files changes.

Plugins can register additional commands via `PrunellePlugin.commands`. They are read from `prunelle.config.ts` only when the first word is not a built-in command, and they take `--root <dir>` to name the app folder and `--help`. A `prunelle.config.ts` that fails to load leaves `prunelle --help` and the built-in commands working; a plugin command typed then prints the error and exits 1.

## Help, completion and exit codes

Every command answers `--help` with its options and its exit codes. A mistyped command or option names the one you meant (`prunelle chekc` suggests `check`).

Print a shell completion script with `prunelle --completions fish` (also `bash` and `zsh`), for example `prunelle --completions fish > ~/.config/fish/completions/prunelle.fish`.

| Code | Meaning |
| :--- | :--- |
| `0` | The command did what was asked |
| `1` | A finding or a failure: `prunelle check` found an error (or a warning, with `--strict`), `prunelle upgrade` has steps left to do by hand, a build failed or a route is over `--max-js` |
| `2` | A usage error: an unknown command or option, a bad `--port` or `--max-js`, a missing argument |

The CLI does not write a usage log: it runs on `@kaynooo/cli-kit` with that turned off.

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

    // The app's own bundled copy, the one its routes and prunelle.config.ts use
    const { savePreferences } = await app.import('src/actions/preferences.ts')
    const submitRes = await app.submit(savePreferences, { project: 'orbit', target: 'binary' })
    expect(submitRes.status).toBe(200)
  })
})
```

`TestApp` helpers:

- `app.get(path, headers?)`: Sends a `GET` request with the current cookie jar.
- `app.post(path, body?, headers?)`: Sends JSON (or `FormData`) with `Origin: http://localhost`.
- `app.import(path)`: The app's bundled copy of a route, layout, middleware, action file or `prunelle.config.ts`, by path from the root. Read module state and actions from it: a module the test file imports itself is a second copy, and its actions have no URL.
- `app.submit(action, fields, headers?)`: Sends `FormData` with `Origin: http://localhost` to an action from `app.import()`, or to an action URL.
- `app.fetch(pathOrRequest, init?)`: Low-level request helper with cookie jar persistence.
- `app.cookies` / `app.clearCookies()`: Inspect or reset cookies between test cases.
- `app.errors`: The route, action and plugin errors the app did not handle, one line each (`route GET /boom: the message`). A request that came back as a 500 left one here, so a test can read what failed instead of an opaque `Internal Server Error`.
- `testApp()` builds into a folder of its own under `.prunelle-cache/`, removed when the test process exits, so running the tests never replaces the app's `dist/`. Pass `outDir` to build somewhere else, such as a test that reads the built files.
- Pass `prebuilt: true` to reuse a build instead of making one: the latest `testApp()` build of the same app in this test process, or else the app's `dist/`.
- Pass `dev: true` to see the failure in the response too, as `prunelle dev` does (see below).

### Unhandled errors in dev

An error that no `onError` hook and no `_error.tsx` handled answers with a bare `500 Internal Server Error`, so a production visitor never sees a message or a stack.

With `dev: true` in `testApp()`, and always under `prunelle dev`, the response carries the real error instead. A request that asks for JSON gets `{ ok: false, status: 500, error, stack }`, and any other request gets the stack as plain text. An app with an `_error.tsx` still renders that page. The error is also logged with `console.error`, unless the app has an `onError` hook, which is then the one that hears it.

Each frame of the stack names the file under `src/` and the line it was written on, for a `.tsx` page or component as for a `.ts` route. That also holds for the `error.stack` an `onError` hook gets under `prunelle start`, since `prunelle build` writes a source map beside each server file. A `--compile` binary is the exception: its frames point into the binary's own code.

When a build fails, `prunelle dev` answers every request with the build error: JSON for `Accept: application/json`, plain text for `Accept: text/plain`, and the error page with live reload for a browser.

When an island fails to hydrate, the browser console names its component in dev, for instance `<CartButton>`, next to the chunk URL that is a hash.

## Testing islands in a browser

`testBrowser()` builds the app for production, serves it on a loopback port it picks itself and opens pages in Chromium with their islands hydrated: `open()` resolves once the page has loaded and every island that hydrates on load has done so. It does not wait for the network to go quiet, so a page that polls opens as fast as any other. It needs `playwright-core` (`bun add -d playwright-core`) and a Chrome or Chromium, found through `BUN_CHROME_PATH`, Playwright's own install or `/usr/bin`.

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

- `browser.open(path)`: Opens a page in its own context and resolves when it has loaded.
- `page.click(selector)`, `page.hover(selector)`, `page.fill(selector, value)`, `page.text(selector)`: Drive and read the page. `b.open(path, { reducedMotion: true })` opens the page for a visitor who asks for less motion.
- `page.waitFor(selector | fn)`: Waits for a selector to match, or for a function run in the page to return a truthy value.
- `page.evaluate(fn | expression)`: Runs code in the page and returns its result.
- `page.errors`: Page errors, `console.error` messages and failed requests collected since the page opened.
- `browser.app`, `browser.origin`: The `testApp` of the build, and `http://127.0.0.1:<port>`.
- Options are those of `testApp()`, plus `browserPath` and `timeout` (milliseconds, default 10000).
