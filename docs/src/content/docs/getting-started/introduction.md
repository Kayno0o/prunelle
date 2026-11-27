---
title: Introduction
description: Why Prunelle exists — standard TypeScript & JSX, zero-directive automatic islands, fine-grained .value signals, and single-binary Bun deploys.
section: getting-started
order: 1
---

Prunelle is a Bun-native web framework. You write standard TypeScript and JSX. Static components ship zero JavaScript, and interactive components become islands automatically.

## What makes Prunelle different

- **Zero directives**: No `'use client'`, no `'use server'`, no `client:load`. `oxc-parser` analyzes your `.tsx` files at build time and splits static SSR trees from interactive `<pru-island>` roots.
- **Plain `.value` signals**: A doubly-linked-list reactivity kernel (`signal`, `computed`, `effect`, `batch`, `selector`, `store`) with no compiler assignment magic.
- **Flat-string SSR**: Static JSX compiles directly to flat string concatenation (`7,017 renders/s` on the products benchmark).
- **Unified server actions**: Write one `action(schema, handler)` with any Standard Schema validator (Zod, Valibot, ArkType, TypeBox). It works as a zero-JS `<form action={fn} method="post">` and as a typed RPC call from islands.
- **Single-pass build & `--compile`**: One `Bun.build()` pass compiles your app in `18.8 ms` clean. `prunelle build --compile` packs routes, plugins, and `public/` assets into a single executable with a `35.4 ms` cold start.
- **Small core, modular plugins**: Everything optional (`@prunellejs/ui`, `@prunellejs/auth`, `@prunellejs/content`, `@prunellejs/live`, `@prunellejs/mcp`, `@prunellejs/images`, `@prunellejs/seo`, `@prunellejs/i18n`, `@prunellejs/mail`, `@prunellejs/icons`, `@prunellejs/tailwind`, `@prunellejs/spa`) plugs in through `PrunellePlugin`.

<Callout title="Coding-agent reference" tone="tip">
The entire Prunelle API fits on one dense page at [`/llms.txt`](/llms.txt). Every install carries the copy for its own version at `node_modules/prunelle/llms.txt`, and the `AGENTS.md` that `prunelle new` writes points coding agents at it.
</Callout>
