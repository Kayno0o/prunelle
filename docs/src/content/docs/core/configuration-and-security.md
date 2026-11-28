---
title: Configuration & Security
description: prunelle.config.ts options, strict SHA-256 hashed CSP, HSTS, proxy trust, route caching, cookies, health checks, and typed env vars.
section: core
order: 6
---

Configure your app once in `prunelle.config.ts` with `defineConfig()` from `prunelle/config`:

```ts
import { defineConfig } from 'prunelle/config'

export default defineConfig({
  site: 'https://example.com',
  lang: 'en',
  port: 3000,
  trustProxy: true,
  maxRequestBodySize: 2 * 1024 * 1024,
  streamTimeout: 15_000,
  onError({ error, request, source, requestId }) {
    console.error(`[${source}] [${requestId ?? '-'}] ${request.method} ${request.url}`, error)
  },
  plugins: [],
})
```

## `prunelle.config.ts` options

Any unknown key fails `prunelle check`, `prunelle dev`, and `prunelle build`, naming the closest valid option (`outDirr` suggests `outDir`).

| Option | Default | Purpose |
| :--- | :--- | :--- |
| `site` | `undefined` | Public origin (e.g. `'https://example.com'`), inherited by `@prunellejs/seo`, `@prunellejs/i18n`, `@prunellejs/content`, `@prunellejs/images`, and `@prunellejs/auth`. |
| `lang` | `'en'` | Default `<html lang="...">` attribute. |
| `port` | `3000` | Default port for `prunelle start` (overridden by `PORT` or `--port`). |
| `routesDir` | `'src/routes'` | Directory scanned for file-based routes. |
| `outDir` | `'dist'` | Build output directory. |
| `publicDir` | `'public'` | Static files served at `/` with ETag and `304`. |
| `assetPrefix` | `'/_pru'` | URL prefix for immutable hashed build assets. |
| `security` | Enabled | Security headers config, or `false` to disable all of them. |
| `trustedOrigins` | `undefined` | Extra origins allowed by CSRF checks (e.g. `['https://app.example.com']`). |
| `trustProxy` | `false` | Reverse proxies in front of Prunelle: `true` for 1 hop, or `N` hops (e.g. `2` for CDN + nginx). |
| `maxRequestBodySize` | `1048576` (1 MiB) | Maximum request body size before returning `413 Payload Too Large`. |
| `navigation` | `{ viewTransitions: true, prefetch: 'moderate', prerender: false }` | Zero-JS cross-document view transitions and Speculation Rules: see [Page changes](/docs/core/routing-and-layouts#page-changes). |
| `routeCache` | `{ maxEntries: 500, maxBytes: 33554432 }` | Bounded in-memory LRU cache for routes exporting `cache` (`false` to disable). |
| `autoPrerender` | `false` | Automatically prerender static pages that read nothing from the request or clock. |
| `consent` | `undefined` | CNIL/RGPD consent categories, cookie name (`'pru_consent'`), retention (`180` days), and `POST` endpoint (`'/_pru/consent'`). |
| `compliance` | `undefined` | French web law check overrides (`{ ignore?, publicBody?, legalNotice? }`). See [Compliance & Consent](/docs/core/compliance-and-consent). |
| `streamTimeout` | `30000` | Milliseconds a `<Suspense>` boundary may wait before failing. |
| `compress` | `true` (prod) / `false` (dev) | Serves precompressed `.br`/`.gz` sidecars and compresses dynamic or streamed responses on the fly (zstd, gzip). |
| `healthCheck` | `undefined` | Check function or named map evaluated on `GET /_pru/health` (`503` on failure). |
| `onError` | `undefined` | Hook called on unhandled errors (`{ error, request, source, requestId }`). Without one, Prunelle logs unhandled errors with stack and request ID to stderr. |
| `plugins` | `[]` | Array of `PrunellePlugin` instances. |

## Security headers & strict CSP

Prunelle attaches hardened security headers to every response out of the box:

- `Content-Security-Policy`: Defaults to `DEFAULT_CSP` (`default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`).
- **Automatic SHA-256 hashes**: Each page's CSP receives exact SHA-256 hashes for its island/Suspense styles, inline `<style>` blocks, navigation rules, and registered plugin inline scripts — no `'unsafe-inline'` for scripts or stylesheets.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- `Strict-Transport-Security`: Sent on HTTPS requests (`max-age=31536000; includeSubDomains` by default).

Extend individual directives of `DEFAULT_CSP`, override headers, or disable one with `false`:

```ts
export default defineConfig({
  security: {
    // Merges onto DEFAULT_CSP; automatic SHA-256 hashes still land in extended directives.
    csp: {
      'style-src': ['https://fonts.googleapis.com'],
      'font-src': ['https://fonts.gstatic.com'],
    },
    frameOptions: 'DENY',
    hsts: false,
  },
})
```

Passing a directive object merges onto `DEFAULT_CSP` (new `*-src` directives inherit `'self'` from `default-src` automatically, while `"'none'"` tightens a directive). Pass a full string to replace `DEFAULT_CSP` completely, or use `DEFAULT_CSP` and `extendCsp` from `prunelle/server`.

## Reverse proxies (`trustProxy`)

Forwarded headers (`X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-For`, and incoming `x-request-id`) are ignored unless `trustProxy` is set. Prunelle reads the right-most entries written by trusted hops so clients cannot spoof their IP or protocol. This governs `ctx.ip`, HTTPS cookie `Secure` flags, HSTS headers, and CSRF `Origin` checks.

## Cookies

Read and write cookies through `ctx.cookies` inside `load()`, middleware, API routes, and actions:

```ts
const theme = ctx.cookies.get('theme')
ctx.cookies.set('theme', 'dark', { httpOnly: true, sameSite: 'lax', path: '/' })
ctx.cookies.delete('theme')
```

Pass `category` for any non-essential cookie (`{ category: 'analytics' }`). Prunelle refuses to set it until the visitor grants consent for that category. Essential cookies (no `category` or `category: 'essential'`) always work. See [Compliance & Consent](/docs/core/compliance-and-consent).

## Typed environment variables (`defineEnv` & `nodeEnv`)

Validate required server environment variables once at startup with any Standard Schema validator:

```ts
import { defineEnv, nodeEnv } from 'prunelle/server'
import { z } from 'zod'

export const env = defineEnv(z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
}))

const isProd = nodeEnv() === 'production'
```

Read `nodeEnv()` instead of `process.env.NODE_ENV` in server code. `prunelle build` does not set `NODE_ENV` when prerendering, and `Bun.build` can inline `process.env.NODE_ENV` in `--compile` binaries. `prunelle check` and `prunelle build` warn on server-side `process.env.NODE_ENV` reads (islands may read it because their bundle inlines the value).
