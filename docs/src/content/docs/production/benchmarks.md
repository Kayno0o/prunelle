---
title: Benchmarks
description: Measured v0.3.0 server throughput, route caching, stylesheet consolidation, compiled cold boot, real-app migrations, and EcoIndex figures.
section: production
order: 2
---

Every figure below was measured on the same Linux x64 host running **Bun 1.4.5** and headless Chromium, comparing Prunelle releases and real production applications under identical workloads.

## Framework comparison

Measured on the shared benchmark suite (`bench-app`: 500-product SSR page with an interactive counter island, and a 10,000-row reactive table).

| Framework | Products JS (gz) | Table JS (gz) | Uncached SSR | 10k rows | Clean build |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Prunelle** | **3.82 KB** | **6.91 KB** | **5,484/s** | **219.1 ms** | **26.4 ms** |
| kay v1 | 9.90 KB | 12.50 KB | 3,983/s | 262.0 ms | 460 ms |
| SolidStart | 8.20 KB | 8.20 KB | 1,712/s | 226.0 ms | 140 ms |
| SvelteKit | 22.50 KB | 22.50 KB | 3,861/s | 232.0 ms | 90 ms |
| Astro | 8.60 KB | 9.60 KB | 1,898/s | 234.0 ms | 1,190 ms |
| Next.js | 133.4 KB | 134.3 KB | — | 360.0 ms | 2,180 ms |
| Nuxt | 76.4 KB | 72.3 KB | 583/s | 266.0 ms | 2,580 ms |

Static pages without interactive components ship **0 B** of JavaScript and emit zero `<script>` tags.

## Server throughput & route caching

In v0.3.0, exporting `export const cache = '1h'` caches 200 HTML responses and their compressed variants in a bounded in-memory LRU store (`500` entries / `32 MiB`) with stale-while-revalidate refresh, lifting gzip throughput by **58.3×** while keeping uncached SSR and memory footprint flat (`bench:server`, 500 products):

| Workload | v0.2.0 uncached | v0.3.0 uncached | v0.3.0 (`cache = '1h'`) |
| :--- | :---: | :---: | :---: |
| Raw HTML throughput | 5,272 req/s | 5,416 req/s | **140,120 req/s** |
| Gzip throughput (LRU) | 5,576 req/s | 5,484 req/s | **329,749 req/s** |
| Zstd throughput (LRU) | 5,660 req/s | 5,573 req/s | **318,676 req/s** |

### Compiled binary footprint (`--compile`)

| Metric (median of 3) | v0.2.0 | v0.3.0 |
| :--- | :---: | :---: |
| Cold boot + first page | 16.3 ms | **15.1 ms** |
| Anonymous RSS (`RssAnon`) after 1st page | 9.4 MiB | **9.3 MiB** |
| Total `VmRSS` after 1st page | 49.2 MiB | **49.2 MiB** |

### Static export serving

`createStaticDirServer()` indexes a `--static` export once at startup (`200` pages, median per request):

| Request type | Latency |
| :--- | :---: |
| HTML page (`200 OK`) | **17.1 µs** |
| Conditional hit (`304 Not Modified`) | **2.0 µs** |
| Hashed asset (`200 OK`) | **15.6 µs** |
| Missing path (`404`) | **1.2 µs** |

## Stylesheet consolidation & per-route CSS

In v0.3.0, `@prunellejs/ui` splits each grammar into `base.css` + per-component sheets, and `prunelle build` consolidates local stylesheets into at most one site-wide cached sheet plus one per-route sheet:

| Route | v0.2.0 CSS (raw / gz) | v0.3.0 CSS (raw / gz) | Delta (gz) |
| :--- | :---: | :---: | :---: |
| Docs `/` and `/docs/*` | 51.70 KB / 9.17 KB | **20.17 KB / 5.03 KB** | **−45.1%** |
| Noticeboard `/` | 22.01 KB / 3.83 KB | **10.96 KB / 3.12 KB** | **−18.5%** |
| Noticeboard `/login` | 22.01 KB / 3.83 KB | **9.99 KB / 2.84 KB** | **−25.8%** |
| Noticeboard `/notices/:id` | 22.01 KB / 3.83 KB | **8.28 KB / 2.24 KB** | **−41.5%** |

Measured in headless Chromium (median of 5 fresh browser contexts navigating `/` cold then `/docs/plugins/ui` warm):

- Linked stylesheets on `/` and `/docs/*` dropped from **3 → 1** (and **3 → 2** on `/grammars`).
- First-visit CSS transfer on `/` dropped from **8.88 KB → 4.76 KB** (`−46.4%`).
- First-visit CSS render-blocking span dropped from **4.10 ms → 3.10 ms**.
- Second-visit `DOMContentLoaded` on `/docs/plugins/ui` (100% cached CSS): **5.10 ms**.

<Callout title="Zero client JS regressions" tone="tip">
v0.3.0 added **0 bytes** of eager client JS across `bench-app`, `examples/noticeboard`, `examples/showcase`, and this docs site. CI fails any commit that grows a tracked route's eager JS by more than 100 B.
</Callout>

## Real-world apps

Interleaved benchmarks against production applications migrated from kay v1 onto Prunelle on identical databases and content.

### Full-stack app (`polaris`: SQLite, `@prunellejs/ui`, `@prunellejs/mcp`, `--compile`)

100 seeded bookmarks across 8 folders in SQLite, compiled as a standalone executable:

| Metric | Before (kay v1) | Prunelle | Delta |
| :--- | :---: | :---: | :---: |
| Cold build wall / CPU | 2,797 ms / 7,047 ms | **168 ms / 362 ms** | **−94.0% / −94.9%** |
| Cold build Peak RSS | 484.8 MiB | **154.9 MiB** | **−68.0%** |
| `build --compile` wall | 2,904 ms | **466 ms** | **−84.0%** |
| Standalone binary size | 125.63 MiB | **104.77 MiB** | **−16.6%** |
| Cold boot to first `200 OK` | 98.9 ms | **72.5 ms** | **−26.7%** |
| Idle `RssAnon` / `PSS` | 39.4 / 93.5 MiB | **25.6 / 64.7 MiB** | **−35.0% / −30.8%** |
| SSR `GET /` (gzip, c=4) | 406.1 req/s | **773.6 req/s** | **+90.5%** |
| Home `/` eager JS (gz) | 90.31 KB (62 files) | **17.92 KB (17 files)** | **−80.2%** |
| Home `/` CSS (gz) | 20.53 KB | **9.29 KB** | **−54.8%** |

### Static content site (`devlog`: Markdown, Shiki, AVIF/WebP images, `--static`)

| Metric | Before (kay v1) | Prunelle | Delta |
| :--- | :---: | :---: | :---: |
| Cold `--static` build wall / CPU | 2,287 ms / 6,690 ms | **1,665 ms / 2,565 ms** | **−27.2% / −61.7%** |
| Cold build Peak RSS | 824 MiB | **336 MiB** | **−59.2%** |
| `dist/` raw size | 7.29 MiB (166 files) | **1.93 MiB (95 files)** | **−73.5%** |
| Home `/` HTML (br) | 8.62 KB | **2.85 KB** | **−66.9%** |
| Home `/` JS (br) | 147 B | **0 B** | **−100%** |
| `bun.lock` dependency graph | 407 packages | **101 packages** | **−75.2%** |

## Reproducing locally

Run the benchmark scripts from the repository root, or inspect any Prunelle app's exact per-route JS, CSS, font, first-load, and EcoIndex weights with `--analyze`:

```bash
bun run bench          # Build, SSR throughput, and Chromium table ops
bun run bench:server   # Compiled binary cold boot, RSS, and cached/uncached SSR
bun run bench:weight   # Eager JS budget check across bench-app, examples, and docs
prunelle build --analyze
```
