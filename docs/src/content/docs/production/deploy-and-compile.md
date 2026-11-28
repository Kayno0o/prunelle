---
title: Static & --compile
description: Deploy Prunelle as a Bun server, a CDN-ready static export (--static), or a zero-dependency single executable (--compile) with atomic reloads and health checks.
section: production
order: 1
---

Prunelle supports three first-class deployment modes from the exact same codebase.

## Bun Server (`prunelle build` + `prunelle start`)

```bash
prunelle build
PORT=3000 prunelle start
```

Serves dynamic SSR routes, streaming `<Suspense>`, server actions, API routes, prerendered pages, and immutable `/_pru/*` client assets directly from `Bun.serve()`.

`prunelle build` precompresses hashed assets, `public/` files, and prerendered pages (`>= 256` bytes) into `.br` (quality 11, content-cached in `.prunelle-cache/` for 7 days so repeat builds only compress changed files) and `.gz` sidecars, keeping each only when smaller. The server streams those sidecars directly and compresses dynamic or streamed `<Suspense>` responses on the fly (zstd or gzip). Pre-existing `.br`/`.gz` files in `public/` are preserved as-is.

## Single standalone executable (`prunelle build --compile`)

Compile your entire server, routes, `prunelle.config.ts` plugins, client bundles, and `public/` assets (`with { type: "file" }`) into **one self-contained binary**:

```bash
prunelle build --compile ./server
./server
```

- **Cold boot + first page**: **~15 ms** (`15.1 ms` measured on Bun 1.4.5, `9.3 MiB` anonymous RSS / `49.2 MiB` total VmRSS; see [Benchmarks](/docs/production/benchmarks))
- **`NODE_ENV`** defaults to `production` inside compiled binaries
- **SQLite (`bun:sqlite`)** works out of the box alongside the binary
- **Built-in health check & container `HEALTHCHECK`**: Every server exposes `GET /_pru/health` (or `${assetPrefix}/health`), answering `200 { ok: true }` (`Cache-Control: no-store`) or `503 { ok: false, checks }` when an app `healthCheck` or plugin `api.healthCheck(name, fn)` fails. Compiled binaries accept `--health` so Dockerfiles need no `curl`:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s CMD ["./server", "--health"]
```

Every response also carries an `x-request-id` header (reusing a safe incoming `x-request-id` only when `trustProxy` is truthy), exposed as `ctx.requestId` and passed to `onError`. Under `prunelle dev`, responses include a `Server-Timing` header breaking down `middleware`, `load`, `render`, and `stream` phases (zero overhead in production).

## Graceful shutdown

`prunelle start` and compiled binaries shut down gracefully on `SIGTERM`, `SIGINT`, or `SIGHUP`, so rolling deploys drop no requests. The server stops accepting new connections, `@prunellejs/live` closes open streams, and each plugin's `api.onShutdown()` hook runs. The process exits `0` once in-flight requests finish, or cuts stragglers and exits `1` after 10 seconds.

## Atomic `dist/` replacement & zero-downtime reload

`prunelle build` stages output beside `dist/` and swaps it into place only once every step (bundling, plugin hooks, prerendering, and `--compile`) succeeds. A failed build leaves the previous `dist/` byte-for-byte intact.

When a new build lands, a running `prunelle start` loads it in-process without restarting or dropping connections. Requests arriving during the swap wait briefly for the new build, plugin `server()` hooks initialize, and the old build's `api.onShutdown()` hooks run once it drains. If the new build fails to load, the error is logged and the previous build keeps serving. Changing port, host, or `maxRequestBodySize` still requires a restart.

To keep deferred island chunks working for pages loaded right before a deploy, each build carries forward dropped hashed client files from the previous build (via hard links, or copies if unsupported) for one deploy cycle before removing them.

Prunelle marks its build directory with `.prunelle-output` and refuses to overwrite an `outDir` containing unrecognized files, preventing a mistyped `outDir` from wiping unrelated data.

## Static HTML export (`prunelle build --static`)

```bash
prunelle build --static
```

Outputs a ready-to-host directory in `dist/` containing:

- Every route and `paths()` page (expanded across locales if `@prunellejs/i18n` is enabled). Dynamic pages without `paths()` fail the build because a static host cannot render them; dynamic API routes are skipped.
- `404.html` (from `src/routes/_404.tsx`), plus `<folder>/404.html` for each static non-group subfolder `_404.tsx`.
- Consolidated, content-hashed CSS/JS/font assets under `dist/_pru/` with `.br` and `.gz` sidecars.
- All `public/` files, RSS feeds, `sitemap.xml`, and generated OG `shareCard()` PNGs.

### Static export CSP & host headers

Unless `security: false` or `security: { csp: false }` is set, every exported HTML page (including `404.html`) embeds a `<meta http-equiv="Content-Security-Policy">` tag with exact SHA-256 hashes for that page's inline styles and scripts and no `'unsafe-inline'`.

Browsers ignore `frame-ancestors`, `report-uri`, and `sandbox` inside `<meta>` tags, so Prunelle strips them from the meta policy. Configure your static host or reverse proxy (Caddy, nginx, Cloudflare) to send the response headers that cannot live in HTML:

- `Content-Security-Policy: frame-ancestors 'self'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (on HTTPS)

`prunelle start` also serves a `--static` export directly from an in-memory file index (`17.1 µs` per `200`, `2.0 µs` per `304`), with `ETag`, `304`, `HEAD`, and automatic pickup of new static builds without restart.
