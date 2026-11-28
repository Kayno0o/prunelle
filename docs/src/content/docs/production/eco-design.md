---
title: Eco-design & RGESN
description: Measure EcoIndex (A–G) in prunelle build --analyze and map French RGESN eco-design criteria to Prunelle defaults, build checks, and app responsibilities.
section: production
order: 4
---

Prunelle treats eco-design as an engineering constraint: ship **0 KB** of JavaScript on static pages, consolidate CSS per route, precompress everything at brotli quality 11, block third-party requests before consent, and measure every page's weight at build time.

## EcoIndex in `prunelle build --analyze`

When you run `prunelle build --analyze` (including `--static`), Prunelle computes the [GreenIT EcoIndex](https://www.ecoindex.fr/comment-ca-marche/) grade (**A–G**) and score (**0–100**) for every prerendered route from three metrics measured on the actual emitted HTML and assets:

- **DOM elements** — total opening element tags in the rendered HTML document.
- **HTTP requests** — `1` for the HTML document plus every file a first visit fetches (stylesheets, eager scripts and static chunk imports, preloaded and `@font-face` fonts, eager images, and the favicon).
- **Transfer weight** — brotli-compressed bytes of the HTML document and all first-visit assets.

From the score, Prunelle derives per-view estimates for greenhouse gas emissions (**gCO2e**) and water consumption (**cl**). For dynamic routes with `paths()`, Prunelle scores every prerendered URL and reports the **worst (lowest) score** with its URL so a heavy page cannot hide behind lighter siblings.

```bash
# Human-readable bundle & EcoIndex table
prunelle build --analyze

# Machine-readable JSON for CI budgets and trend tracking
prunelle build --analyze --json

# Fail the build when any route ships more eager JS than allowed
prunelle build --max-js 20kb
```

In `--json` output, each prerendered route entry includes an `ecoIndex` object:

```json
{
  "grade": "A",
  "score": 94.6,
  "dom": 48,
  "requests": 3,
  "weightBytes": 14820,
  "ghgGrams": 1.11,
  "waterCl": 1.66
}
```

Dynamic prerendered routes also include `"url": "/posts/longest-post"` naming the heaviest URL. Routes rendered on demand show `-` in the table and omit `ecoIndex` in JSON.

## RGESN coverage matrix

The French **RGESN** (*Référentiel Général d'Écoconception de Services Numériques*, published by Arcep, Arcom, ADEME, and DINUM) organizes digital eco-design into eight themes. The table below maps what Prunelle satisfies by default, what it checks or measures automatically, and what stays in the app's hands.

| RGESN theme | Met by Prunelle by default | Checked or measured by Prunelle | App responsibility |
| :--- | :--- | :--- | :--- |
| **Strategy** (*Stratégie*) | Zero-JS static output and single-binary deploys minimize infrastructure footprint from day one. | `prunelle build --analyze --json` exports per-route weight and EcoIndex metrics for tracking regressions over time. | Define service usefulness, target audience, supported devices, and environmental KPIs. |
| **Specifications** (*Spécifications*) | No client-side SPA router, telemetry, or third-party SDK bundled by default; forms work without JavaScript. | `prunelle check` flags third-party URLs (`rgpd/third-party-url`) and missing legal/accessibility pages. | Limit feature scope, avoid infinite scroll or autoplay, and set data-retention policies. |
| **Architecture** | Hybrid prerendering, `export const cache`, and `--static` avoid redundant renders; immutable `/_pru/*` assets cache forever. | `prunelle build --analyze` measures first-load weight and EcoIndex per prerendered route; `--max-js` enforces eager JS budgets in CI. | Choose caching TTLs for dynamic routes, paginate large datasets, and purge obsolete data. |
| **UX / UI** | Progressive enhancement: native `<form>` submissions and full-page navigations with zero JS; accessible semantic markup in `@prunellejs/ui`. | `prunelle check` runs 16 RGAA rules (`--strict` fails CI), and `prunelle a11y` audits rendered pages in Chromium. | Keep layouts simple, respect `prefers-reduced-motion`, avoid dark patterns, and keep DOM depth shallow. |
| **Contents** (*Contenus*) | `@prunellejs/images` emits responsive AVIF/WebP `<Picture>` variants; `@prunellejs/seo` self-hosts `.woff2` fonts; third-party embeds wait for `<ConsentGate>`. | `prunelle build --analyze` reports font bytes, first-load bytes, and EcoIndex counts; `prunelle check` flags un-gated third-party embeds. | Write concise copy, compress uploaded media, avoid decorative auto-playing video, and subset fonts. |
| **Frontend** | 0 KB of JS on static pages; [automatic islands](/docs/core/automatic-islands) with `$hydrate="visible"` and `$hydrate="idle"` deferral; per-route consolidated CSS (`−19%` to `−45%` gz); quality-11 brotli sidecars. | `prunelle build --analyze` lists every island and why it became interactive; `--max-js` fails the build on eager JS regressions. | Defer below-the-fold islands (`export const hydrate = 'visible'`), avoid heavy client libraries, and keep DOM counts low. |
| **Backend** | Flat-string SSR with no virtual DOM; precompressed `.br`/`.gz` sidecars; standalone `--compile` binary with `15.1 ms` cold boot and `9.3 MiB` anonymous RSS. | `prunelle check` catches server/client mistakes at build time; `prunelle dev` exposes `Server-Timing` breakdowns (`middleware`, `load`, `render`, `stream`). | Index database queries, avoid N+1 loads in `load()`, bound background jobs, and stream or paginate large responses. |
| **Hosting** (*Hébergement*) | Runs as a static export on any CDN (`prunelle build --static`) or a single low-memory Bun binary (`prunelle build --compile`) with `/_pru/health` probes and graceful shutdown. | Built-in `/_pru/health` and `--health` probe simplify right-sized container orchestration. | Pick a low-carbon hosting provider (PUE, WUE, energy mix), locate servers near users, and scale down idle environments. |

## Keeping pages at grade A

1. **Prerender pages that do not vary per visitor** (`export const prerender = true`, `autoPrerender: true`, or `prunelle build --static`) so they are compressed once at build time and scored by EcoIndex.
2. **Defer non-critical islands** with `$hydrate="visible"` or `$hydrate="interaction"` (or `export const hydrate = 'visible'`) so their chunks stay out of first-load JS and requests. See [Automatic Islands](/docs/core/automatic-islands).
3. **Gate third-party scripts and embeds behind `<ConsentGate>`** so visitors make zero third-party requests before consenting. See [Compliance & Consent](/docs/core/compliance-and-consent).
4. **Serve modern images and self-hosted fonts** with `@prunellejs/images` and `@prunellejs/seo` instead of hotlinked media or external font CDNs. See [Images & SEO](/docs/plugins/images-and-seo).
5. **Enforce budgets in CI** with `prunelle build --max-js 20kb` and `prunelle check --strict`, and archive `prunelle build --analyze --json` output across releases. See [Benchmarks](/docs/production/benchmarks) and [CLI & Testing](/docs/production/cli-and-testing).
