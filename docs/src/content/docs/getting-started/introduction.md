---
title: Introduction
description: Why Prunelle exists — standard TypeScript and TSX, zero-directive islands, .value signals, French web law defaults, and single-binary deploys.
section: getting-started
order: 1
---

Prunelle is a Bun-native full-stack web framework. You write standard TypeScript and TSX, and Prunelle decides what reaches the browser: static pages ship **0 KB** of JavaScript, interactive components become islands automatically, and production deploys as a Bun server, a static export, or a single executable.

## What makes Prunelle different

- **Zero directives**: No `'use client'`, no `'use server'`, no `client:load`. `oxc-parser` analyzes every `.tsx` file at build time and splits static SSR trees from interactive `<pru-island>` roots per component.
- **Plain `.value` signals**: A push-pull doubly-linked-list reactivity kernel (`signal`, `computed`, `effect`, `batch`, `selector`, `store`) with standard TypeScript and zero compiler assignment magic.
- **Fast SSR & route caching**: Static JSX compiles to flat string concatenation (`5,484 req/s` uncached gzip on 500 products, and `329,749 req/s` gzip with `export const cache = '1h'`).
- **Unified server actions**: Write one `action(schema, handler)` with any Standard Schema validator (Zod, Valibot, ArkType, TypeBox). It works as a zero-JS progressive `<form action={fn} method="post">` with automatic HTML5 constraints and bot protection, and as a typed island RPC via `useAction()`.
- **Secure & compliant by default**: Strict SHA-256 hashed CSP, CSRF verification before middleware, 19 built-in RGAA/RGPD/LCEN static checks, GreenIT EcoIndex scoring in `--analyze`, and zero-JS CNIL consent gating via `<ConsentGate>`.
- **Single-pass build & `--compile`**: One `Bun.build()` pass builds in `26.4 ms` clean, consolidates stylesheets into a single site-wide cached sheet, and `prunelle build --compile` packs everything into a standalone executable with a `15.1 ms` cold boot and `9.3 MiB` anonymous RSS. See [Benchmarks](/docs/production/benchmarks).
- **Small core, modular plugins**: Twelve first-party packages (`@prunellejs/ui`, `@prunellejs/auth`, `@prunellejs/content`, `@prunellejs/live`, `@prunellejs/mcp`, `@prunellejs/images`, `@prunellejs/seo`, `@prunellejs/i18n`, `@prunellejs/mail`, `@prunellejs/icons`, `@prunellejs/tailwind`, `@prunellejs/spa`) all plug in through the public `PrunellePlugin` contract.

## A quick taste

An interactive component needs no directive — reading a `signal` or attaching an `onClick` handler turns it into an island automatically:

```tsx
// src/components/Counter.tsx
import { signal } from 'prunelle'

export function Counter({ start = 0 }: { start?: number }) {
  const count = signal(start)
  return (
    <button type="button" onClick={() => count.value++}>
      Clicked {count.value}
    </button>
  )
}
```

An `async` route runs strictly on the server and ships **0 KB** of JavaScript for its static markup, hydrating only `<Counter />`:

```tsx
// src/routes/index.tsx
import { Head } from 'prunelle'
import { Counter } from '../components/Counter'
import { db } from '../db'

export default async function Home() {
  const posts = await db.posts.list()
  return (
    <>
      <Head><title>Blog</title></Head>
      <h1>Posts</h1>
      <Counter start={0} />
      <ul>
        {posts.map(post => (
          <li key={post.id}><a href={`/posts/${post.slug}`}>{post.title}</a></li>
        ))}
      </ul>
    </>
  )
}
```

<Callout title="Coding-agent reference" tone="tip">
The entire Prunelle API fits on one page at [`/llms.txt`](/llms.txt). Every install carries the copy for its own version at `node_modules/prunelle/llms.txt`, and the `AGENTS.md` written by `prunelle new` points agents straight to it.
</Callout>
