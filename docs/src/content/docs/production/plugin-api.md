---
title: Plugin API
description: Extend Prunelle with PrunellePlugin hooks — server routes, middleware, health checks, build hooks, prunelle check rules, HTML transforms, and CLI commands.
section: production
order: 5
---

Every first-party package in Prunelle is built exclusively on the public `PrunellePlugin` interface, with zero special cases in core.

## `PrunellePlugin` contract

```ts
import { definePlugin } from 'prunelle/config'

export function myPlugin() {
  return definePlugin({
    name: 'my-plugin',

    // Register global middleware, custom routes, URL rewrites, or shared server services
    server(api) {
      api.use(async (ctx, next) => {
        ctx.locals.startedAt = performance.now()
        return next()
      })
      api.route('GET', '/health', ctx => ctx.json({ ok: true }))
      api.route('POST', '/webhook', ctx => ctx.json({ received: true }), { csrf: false })
      api.healthCheck('my-plugin', () => true)
    },

    // Observe unhandled errors from routes, actions, or plugins
    onError({ error, request, source, requestId }) {
      console.error(`[${source}] [${requestId ?? '-'}] ${request.url}`, error)
    },

    // Emit hashed client assets, public files, <link> styles, <head> tags, or build data
    build(ctx) {
      ctx.emitPublic('robots.txt', 'User-agent: *\nAllow: /\n')
      ctx.setData({ builtAt: Date.now() })
    },

    // Run after prerendering (route.prerendered & publicFiles are populated)
    afterPrerender(ctx) {
      // Ideal for sitemaps, feeds, or inspecting generated static files
    },

    // Expand prerendered URLs (used by @prunellejs/i18n)
    prerenderPaths(paths) {
      return paths
    },

    // Post-process rendered HTML (pages, <Suspense> shells, _error.tsx, _404.tsx)
    transformHtml(html, ctx) {
      return html
    },

    // Inline scripts the plugin writes into pages: every page's CSP allows them by hash
    inlineScripts: [],

    // Native Bun.build plugins per target ('client' | 'server' | 'compile')
    bunPlugins: ({ root, assetPrefix, minify, target }) => [],

    // Global CSS files or optional client bootstrap script
    css: ['src/plugin.css'],
    clientEntry: undefined,

    // Validate plugin invariants during `prunelle check`
    check(ctx) {
      // ctx.error('missing required file'), or ctx.warn('...') for what may be intended
    },

    // What the plugin cannot run in production without
    requires(ctx) {
      return process.env.MY_PLUGIN_KEY ? [] : ['no `MY_PLUGIN_KEY`, so every call fails: set it in the environment.']
    },

    // Extra paths for `prunelle dev` to watch
    watchPaths: ['src/content'],

    // Custom CLI subcommands (`prunelle my-cmd`)
    commands: {
      'my-cmd': async (args, root) => {
        console.log('Running in', root, args)
      },
    },
  })
}
```

## Lifecycle, state & production checks

- **Runtime state**: Create timers, connections, and caches inside `server(api)` and release them in `api.onShutdown()` — never in the plugin factory. `prunelle dev` may start a new server on the same instance before shutting the previous one down, and `prunelle start` / `--compile` run `onShutdown()` on `SIGTERM`. A throwing `onShutdown` or `onError` hook is logged with its plugin name while remaining hooks still run.
- **Production requirements (`requires`)**: Return one message per missing production setting (naming it and its fix). Production starts (`NODE_ENV=production`) refuse to boot while any requirement is unmet; `prunelle dev`, tests, and `prunelle check` warn once instead. First-party plugins use this for `@prunellejs/auth` (in-memory store), `@prunellejs/mail` (missing transport or `from`), `@prunellejs/mcp` (missing token), and `@prunellejs/seo` / `@prunellejs/content` feeds (missing `site`).
- **Build vs. runtime instances**: `build`, `afterPrerender`, `prerenderPaths`, `check`, `commands`, `css`, and `bunPlugins` run on the config `prunelle build` loads. `server`, `head`, and `transformHtml` run on the app's bundled config (the same copy routes import).

## Build handoff, assets & services

- **`ctx.setData(data)` / `api.getBuildData()`**: Persists JSON-serializable build data into `manifest.pluginData[plugin.name]`, surviving cold starts and `--compile`.
- **`provide(key, value)` / `inject(key)`**: Available on both `BuildPluginContext` and `ServerPluginAPI` (typed with `serviceKey<T>(name)` from `prunelle/config`) to share services between plugins without module singletons.
- **Per-route assets**: Use `ctx.addRouteStyle(routePath, href)` and `ctx.addRouteHead(routePath, html)` when an asset belongs on specific routes rather than every page. Local stylesheets emitted via `addStyle` / `addRouteStyle` are automatically consolidated into site-wide and per-route bundles at build time.

## Routes, middleware scope & rate limiting

- **Security headers & CSRF**: `api.route()` responses inherit the app's security headers (and CSP with inline `<style>` hashes for HTML) and enforce `Origin` / `Sec-Fetch-Site` on unsafe methods by default. Pass `{ csrf: false }` for webhooks or bearer-token endpoints.
- **Encoded slashes**: Routes reject path segments containing `%2F`, `%5C`, or `%00` by default. Catch-all routes that intentionally accept text like URLs (`/qr/*text`) can opt in with `{ encodedSlashes: true }`; the segment arrives still encoded in `ctx.params`.
- **Route & custom rate limits**: Pass `{ rateLimit: { max: 20, windowMs: 60_000, key? } }` to `api.route()` to reply `429` with `Retry-After` before the handler runs (keyed by `ctx.ip` by default). For non-route keys (such as per email), call `api.rateLimiter({ max, windowMs })` and `limiter.hit(key)` — all limiters share one bounded LRU store (`10,000` keys / `1,000,000` hits), swept every minute and cleared on restart.
- **Middleware scope**: `api.use(mw, { scope })` accepts `'all'` (default, including prerendered pages), `'rendered'` (skips prerendered pages — ideal for session loaders like `@prunellejs/auth`), `'dynamic'` (also skips pages without `load`), or a path prefix. Prerendered pages with no matching middleware are served straight from Bun's route table.
- **Rewrites**: `api.rewrite()` runs once per prerendered page at startup on an anonymous `GET` — keep rewrites side-effect free.

## Helpers for plugin code

First-party plugins use these shared helpers from `prunelle/config` and `prunelle/server`:

- **`isInside(dir, target, { orSame })`** (`prunelle/config`): Checks whether `target` lies inside `dir` (call `realpathSync` first when guarding against symlinks).
- **`readStringFields(request)`** (`prunelle/server`): Reads string fields from JSON, urlencoded, or multipart bodies onto a null-prototype object (throws on malformed bodies).
- **`wantsJson(request)`** (`prunelle/server`): Detects JSON clients so handlers can reply with JSON instead of HTML or redirects.
- **`safeRedirect(target, fallback)`** (`prunelle/server`): Returns `target` only if it is a safe same-site path; otherwise returns `fallback`.
- **`escJson(json)`** (`prunelle/server`): Escapes `<` and Unicode line separators so JSON is safe inside `<script>` tags (JSON-LD or hydration payloads).
- **`safeEqual(a, b)`** (`prunelle/server`): Constant-time secret comparison (hashed first so length is not leaked).
