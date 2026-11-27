---
title: Migrating from v1
description: Concrete differences and migration checklist for moving from Prunelle v1 (.prunelle files, Elysia) to Prunelle v2 (standard TSX, native Bun.serve, modular PrunellePlugin ecosystem).
section: production
order: 2
---

Prunelle v2 replaces v1's `.prunelle` single-file format and Elysia runtime with standard `.tsx`, native `Bun.serve()`, and a modular `PrunellePlugin` architecture.

## Side-by-side mapping

| Concept | Prunelle v1 | Prunelle v2 |
| :--- | :--- | :--- |
| File format | `.prunelle` (fences + pug template) | Standard `.tsx` (`jsxImportSource: "prunelle"`) |
| Package | `prunelle` | `prunelle`, `prunelle/server`, `prunelle/config`, `prunelle/test` |
| Signals | `const n = signal(0); n()` / `n++` | `const n = signal(0); n.value` / `n.value++` |
| Props | `const { x } = props<{ x: number }>()` | Standard TS params `({ x }: { x: number })` (reactive) |
| Loops | `for item of items key={item.id}` | `{items.map(item => <li key={item.id}>...</li>)}` |
| Conditionals | `if cond` / `else` | `{cond ? <A /> : <B />}` / `{cond && <A />}` |
| Server data | `--- server` fence | `export default async function Page()` or `export function load(ctx)` |
| Server actions | `_actions.prunelle` / inline actions | Top-level named `export const fn = action(schema, handler)` in `src/actions/*.ts` |
| Server runtime | Elysia | Native `Bun.serve()` (`ctx.locals`, `ctx.cookies`, `ctx.json()`, `ctx.deny()`) |
| Prerender | `export const page = { prerender: posts }` | `export const prerender = true; export const paths = () => posts.paths('/posts')` |
| Head tags | `head` block | `<Head><title>...</title></Head>` |
| UI library | `@prunelle/ui` v1 (JS recipes) | `@prunelle/ui` v2 (headless primitives + pure CSS `@layer kui` grammars) |
| Config extensions | `extensions: [...]` + built-in flags | Unified `plugins: [...]` (`PrunellePlugin`) |

## What changes in practice

### 1. Explicit imports and strict JSX
- Prunelle v2 has no auto-imports. Import `signal`, `computed`, `Head`, `Suspense`, and components explicitly.
- Pass HTML strings directly to `innerHTML={html}` (never `{ __html }` or `dangerouslySetInnerHTML`).
- Use camelCase DOM events (`onClick`, `onDblClick`, `onKeyDown`), callback refs (`ref={el => ...}`), and kebab-case SVG attributes (`stroke-width`).
- Never pass functions or signals from a server component into an island prop; `prunelle check` flags them.

### 2. Routes, actions, and middleware
- Move server mutations out of `_actions.prunelle` into top-level named exports in `src/actions/*.ts` using `action(schema, handler)` from `prunelle/server`.
- Replace Elysia `.derive()` / lifecycle hooks with `_middleware.ts` files (setting `ctx.locals.*`) or `PrunellePlugin.server(api)`.
- Behind nginx, Caddy, or Cloudflare, set `trustProxy: true` (or the hop count) in `prunelle.config.ts` so CSRF origin checks, `ctx.ip`, and HSTS read the right forwarded headers.
- Client code can only read `process.env.PUBLIC_*` (inlined at build time). Use `nodeEnv()` from `prunelle/server` when checking `NODE_ENV` inside `--compile` binaries.

### 3. Plugins (`@prunelle/ui`, `@prunelle/auth`, `@prunelle/content`, `@prunelle/mcp`)
- **`@prunelle/ui`**: Register `ui({ grammar: 'orbit' })` from `@prunelle/ui/plugin`. Styles live in pure CSS `@layer kui` instead of JS recipe engines.
- **`@prunelle/auth`**: `requireEmailVerification` defaults to `true`, `site` is required off localhost, and `secret` (`>= 32` bytes) is required in production.
- **`@prunelle/content`**: Call `await entry.render()` once in `load()` so index routes, sitemaps, and RSS feeds never pay to load Shiki or render Markdown bodies.
- **`@prunelle/mcp`**: Mount `mcp({ token, tools })` in `prunelle.config.ts` directly on your existing `action()` exports, and check tool token weight with `prunelle mcp-footprint`.

## Changes during the v2 beta

- **2.0.0-beta.9**: a production start refuses while a plugin's `requires()` lists something unmet: `@prunelle/auth` on an in-memory store, `@prunelle/mail` with no transport or no `from` (unless `optional: true`), `@prunelle/mcp` with no token, `@prunelle/seo` or a `@prunelle/content` feed with no `site`. A `seo({ favicon })` path that resolves to no file fails the build, where it was skipped. `prunelle dev`, tests and `prunelle check` warn instead. `@prunelle/mail`'s `send()` with no recipient throws where it sent to `dev@localhost`.
- **2.0.0-beta.9**: `@prunelle/mcp` answers `429` past 120 calls a minute from one address; raise it with `rateLimit: { max, windowMs }` or turn it off with `rateLimit: false`. `@prunelle/auth`'s limits count in the server's store and add `Retry-After` to their `429`; its `createRateLimiter`, `RateLimiter` and `rateLimit.maxKeys` are deprecated, removed in the next release, in favour of `rateLimit` on `api.route()` and `action()` and `api.rateLimiter()`. A `rateLimit` whose `max` is not a whole number of 1 or more, or whose `windowMs` is not above 0, throws where it is set.
- **2.0.0-beta.9**: after a deploy, the previous build's hashed client files that the new one dropped still answer `200` for one more deploy, where they answered `404`; each output gains a `.prunelle-assets.json` listing them.
- **2.0.0-beta.9**: an `@prunelle/images` asset and `readImageDimensions()` give a JPEG's size as displayed, so a photo with an EXIF orientation of 5 to 8 has its `width` and `height` swapped and its variants labelled by their real width. The variant cache key changed, so the first build re-encodes every image.
- **2.0.0-beta.9**: a `public/` file shipped with a `.br` or `.gz` beside it, such as `public/app.css.br`, is now sent as that file in brotli or gzip, and `prunelle build` no longer writes its own over it. Prerendered pages and `public/` files come compressed from the build, so the server no longer answers them in zstd. A page streamed past `<Suspense>` is now compressed in zstd or gzip too, where it used to go out uncompressed.
- **2.0.0-beta.9**: opening a mailed `@prunelle/auth` link (`/auth/verify-email`, `/auth/magic-link/verify`) no longer uses it up. The `GET` shows a page with one button, and its form `POST`s the token to the same URL, which signs in or verifies and redirects with `303`. A mail scanner that opens the link first no longer burns it. A client that called the `GET` itself now sends `POST` with `{ token }`.
- **2.0.0-beta.9**: `prunelle build` now refuses what `prunelle check` refuses, with the file and line. A function prop passed into an island fails the build. So do a dynamic route exporting `prerender = true` without `paths()`, an `on*` handler passed from server code to a component that is not an island, and an async component that is not the only child of a `<Suspense>`. `prunelle build --static` also fails on a dynamic page with no `paths()`, where it used to skip it with a warning: export `paths()`, or drop the page from a static site. An unknown `prunelle.config.ts` key, two plugins sharing a `name`, and an `after` name one typo from a registered plugin now fail with the name meant.
- **2.0.0-beta.9**: `@prunelle/ui`'s `Dialog` and `Drawer` ship no JS and take no `open` signal: a dialog your code opens or closes is now `<ControlledDialog open={open}>` (or `ControlledDrawer`), and any other button opens one with `commandfor={id} command="show-modal"`.
- **2.0.0-beta.9**: `@prunelle/ui`'s `Menu` and `Select` popups are `popover="auto"` elements in the top layer, placed by `position-area` against their trigger: drop any `position`, `inset` or `z-index` your stylesheet set on `[data-ui="menu"] [data-part="content"]` or `[data-ui="select"] [data-part="listbox"]`. Opening one closes an open `Popover`, as two auto popovers do.
- **2.0.0-beta.9**: a component rendering a same-file island as `<Counter />` no longer becomes an island itself: the island hydrates on its own and the component stays static. A handler, signal or JSX it passes to that island as a prop now fails the build, as it does for an imported island: move the handler into the island, or make the parent interactive. A context the parent provides no longer reaches the island in the browser: pass the value as a prop.
- **2.0.0-beta.9**: `prunelle build` refuses to replace an `outDir` holding files it did not build: delete the folder, or point `outDir` at one of its own. `testApp()` no longer builds into `dist/`, so a test that reads the built files passes `outDir: 'dist'`.
- **2.0.0-beta.4**: `icons()` moves to `@prunelle/icons/plugin`, so an island can import `<Icon>` from `@prunelle/icons`. `prunelle upgrade` rewrites the import.
- **2.0.0-beta.4**: prunelle is imported as `prunelle` only, and a bare `prunelle` import now fails the compile. Run `bunx prunelle@beta upgrade` in the app: it depends on `"prunelle"`, sets `"jsxImportSource": "prunelle"` and rewrites every import, then prints any it could not move. `defineConfig`, `definePlugin` and the plugin types move from `prunelle/server` to `prunelle/config`. `prunelle/server` no longer exports prunelle's internals (`loadConfig`, `DEFAULT_CSP`, `withCspHashes`, compression and app-context helpers). A plugin HTML route gets the app's CSP with its `<style>` blocks hashed, so it no longer builds its own. What `createAuth()`, `createMailer()` and `createRooms()` return is the plugin itself: register `auth`, `mail` and `rooms` instead of `auth.plugin`, `mail.plugin()` and `rooms.plugin({...})`, whose options move into `createRooms({ path, member, ... })`. `mailer()` is now `createMailer()` (taking the preview options), `mailPlugin()` is gone, and `contentPlugin()` is `content()`. `provide` and `inject` take a key from `serviceKey<T>(name)` instead of a string, and `PrunellePlugin.dispose` is gone: release state in `api.onShutdown()`. `prunelle upgrade` does the renames and registrations, and names each `plugin(...)` call whose options you move by hand. A server action called from a route, `load()`, middleware or another action now runs in that request, so `ServerPluginAPI.invokeAction` is gone: call the action itself. `island()` is gone: write `export const hydrate = 'visible'` in the component's file, or `$hydrate` where it renders. A file under `src/routes/` exporting no page, method handler or action now fails the build: prefix a helper or its folder with `_`. `_layout`, `_middleware`, `_error` and `_404` need a default export. `<Head>` and `<Suspense>` in an island fail the compile, and an island reading a context provided outside it throws during SSR: pass the value as a prop. `formatBundleReport()` from `prunelle/build` takes the report `analyzeBundleWeights()` returns. Islands are decided per component: a static component exported beside an island no longer ships as one, a file importing `signal` without calling it stays static, and an island's reason reads `uses signal` instead of `imports signal from 'prunelle'`.

<Callout title="Verify after porting" tone="tip">
Run `prunelle check` and `prunelle build --analyze` after migrating a route or app. `prunelle check` catches server-only imports in islands, non-serializable island props, missing `paths()`, and invalid JSX before runtime.
</Callout>
