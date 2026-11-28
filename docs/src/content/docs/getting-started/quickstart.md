---
title: Quickstart (60s)
description: Scaffold a Prunelle app, run the dev server, and ship a static site or single standalone binary on Bun.
section: getting-started
order: 2
---

## Requirements

- **Bun 1.4+** (`bun --version`)

## Create a project

Pick one of the four built-in starter templates:

```bash
bunx prunelle new my-app --template minimal    # Static route + 1 auto-island
bunx prunelle new my-app --template fullstack  # Layouts, API route, Standard-Schema action
bunx prunelle new my-app --template blog       # @prunellejs/content + @prunellejs/ui + RSS (0 KB JS)
bunx prunelle new my-app --template app        # @prunellejs/auth + @prunellejs/ui + guarded /dashboard
```

Install dependencies and start the dev server:

```bash
cd my-app
bun install
bun run dev
```

Your app runs at `http://127.0.0.1:3000` with incremental rebuilds and live reload over SSE.

<Callout title="Inspect without building" tone="tip">
Run `prunelle inspect` at any time to list every route (including `cacheable` pages), island hydration trigger, server action, and plugin order without running a bundle.
</Callout>

## Build for production

<Tabs label="Deployment targets">
<Tab group="deploy" label="Bun Server" checked>

```bash
bun run build
bun run start
```

</Tab>
<Tab group="deploy" label="Single Executable (--compile)">

```bash
prunelle build --compile ./my-app-bin
./my-app-bin
```

</Tab>
<Tab group="deploy" label="Static HTML (--static)">

```bash
prunelle build --static
# Serve dist/ from nginx, Caddy, Cloudflare Pages, or S3
```

</Tab>
</Tabs>

Pass `--analyze` to `prunelle build` to print each route's eager JS, consolidated CSS, fonts, first-load brotli weight, GreenIT EcoIndex grade (`A–G`), and the islands behind it with the exact reason each became interactive. Pass `--auto-prerender` to automatically prerender static routes that read nothing from the request or clock, and `--max-js 40kb` to fail the build when any route's gzipped eager JS exceeds your budget.

## Validate before shipping

```bash
prunelle check
```

`prunelle check` runs TypeScript checking, Prunelle compiler guardrails, route and link conflict checks, form-vs-schema validation, RGAA/RGPD/LCEN compliance warnings, and every active plugin's `check` hook. Pass `--no-typecheck` when iterating quickly, or `--strict` in CI to fail on warnings too.
