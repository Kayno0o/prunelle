---
title: Automatic Islands
description: Zero-directive island detection via oxc-parser, native <pru-island> hydration strategies, prop serialization, and <pru-slot> static children.
section: core
order: 2
---

Prunelle analyzes every `.tsx` file at build time with `oxc-parser`. Static components compile to flat SSR string concatenation (`0 KB` JS), and interactive components become `<pru-island>` boundaries automatically.

## How detection works

You never write `'use client'` or `client:load`. A component becomes an island automatically when it uses any of:

- A reactive primitive: `signal`, `computed`, `effect`, `onMount`, `store`, or `selector`.
- DOM interactivity: `on*` event handlers (`onClick`, `onInput`, etc.) or `ref` on an HTML or SVG element (on a component tag, `on*` is a plain prop).
- Reactive state imported from another module, such as `export const cart = store([])` in `src/state.ts`.

Detection is **per component**, not per file:

- **Mixed files stay split**: A static component exported beside an island stays static and ships 0 bytes of JS.
- **Local islands inside static or `async` pages**: If a server page declares `Counter` and renders `<Counter />`, the page itself stays static and only `Counter` ships. Its client chunk includes only the code `Counter` reaches, so an `async` page can `await` server databases and still render a local interactive widget.
- **Helper functions vs. top-level primitives**: Calling a helper function (`renderDialog()`) runs where its caller runs — if the helper needs the browser, the caller becomes an island. Calling a primitive at a module's top level (`effect(...)`) marks every component in that file as an island.
- **Server-to-static handlers refused**: Passing `onClick={...}` from server code to a non-island component (`<Button onClick={...}>`) would never run in the browser, so `prunelle build` and `prunelle check` refuse it. Put the handler inside `Button` or render `Button` from an island.
- **Browser globals warned early**: Because islands render on the server first, reading `window`, `document`, or `localStorage` during render or module load throws on the first request. `prunelle check` and `prunelle build` warn with the file and line: read them inside `onMount()`, an effect, an event handler, or behind `typeof window !== 'undefined'`.

<Callout title="Zero-JS guarantee" tone="tip">
When a route renders only static components and native HTML forms, Prunelle omits the client runtime completely. Zero `<script>` tags are emitted in the HTML.
</Callout>

```tsx
// src/components/Counter.tsx — auto-detected island
import { signal } from 'prunelle'

export function Counter({ initial = 0 }: { initial?: number }) {
  const count = signal(initial)
  return (
    <button type="button" onClick={() => count.value++}>
      Clicked {count.value} times
    </button>
  )
}
```

## Why a route ships JS

`prunelle build --analyze` lists, under each route, the islands it loads and the exact reason each became one:

```text
/about                               0.00 KB       0.00 KB     0j/0c
/                                    3.68 KB       0.00 KB     5j/0c
  island: Clicker (src/components/Count.tsx) uses onClick
  island: Total (src/components/Count.tsx) reads count from '../stores/count'
  island, deferred: Later (src/components/Later.tsx) uses onClick
```

Here `/about` renders `Label`, a static export of `Count.tsx`, and ships no JS.

Deferred islands (any strategy other than `load`) stay out of a route's eager JS weight. A page whose islands are all deferred downloads only the ~1 KB island loader until the first one hydrates: these docs pages, whose only island is Search, ship **1.2 KB brotli** (`1.39 KB` gzip). A plugin with a `clientEntry` (such as `spa()`) loads on every page, so its weight counts on pages with no island too. Run `prunelle build --max-js 40kb` in CI to fail the build when any route's gzipped eager JS crosses your budget.

## Hydration strategies (`$hydrate`)

Control when an island downloads and hydrates with `$hydrate` at the call site, or set a default for all call sites via `export const hydrate = 'visible'` in the component file. Unknown modes and `$hydrate` on non-islands fail compilation.

| Strategy | When it hydrates | Best for |
| :--- | :--- | :--- |
| `$hydrate="load"` | Immediately on page load (default) | Critical above-the-fold controls |
| `$hydrate="visible"` | When scrolled into the viewport (`IntersectionObserver`) | Charts, tables, below-the-fold widgets |
| `$hydrate="interaction"` | On first pointer or keyboard interaction | Menus, dialogs, dropdowns, search palettes |
| `$hydrate="idle"` | Via `requestIdleCallback` | Non-blocking background enhancements |
| `$hydrate="media(max-width: 768px)"` | When the CSS media query matches | Mobile-only drawers or nav toggles |
| `$hydrate="client"` | Skips SSR and mounts client-side only | Browser-only canvas or WebGL widgets |

The loader bundles only the strategies the app actually uses, so an app hydrating everything on `load` ships none of the observer code. Each page preloads its `load` islands and every chunk they import; deferred islands download only when their trigger fires.

## Props across the island boundary

Props passed from server code into an island are serialized into HTML and restored in the browser:

- **Supported**: JSON primitives, arrays, plain objects, `Date`, `Map`, `Set`, `URL`, and `RegExp`. Plain JSON adds no extra JS; a page whose props include those richer classes preloads a tiny reviver chunk automatically.
- **Refused**: Functions, signals, and arbitrary class instances fail `prunelle check` and SSR. Define callbacks inside the island, or pass serializable IDs and data instead.
- **JSX goes in `children`**: Passing JSX in any other prop (`<Modal header={<h2>Hi</h2>} />`) fails `prunelle check` and SSR. Pass server markup as `children`, or render it inside the island.

## Static children inside islands (`<pru-slot>`)

When you pass server-rendered JSX children into an island (`<Modal><ServerMarkdown /></Modal>`), Prunelle renders them on the server inside `<pru-slot>`. Hydration leaves the slot untouched and ships **0 bytes** of client JS for its content. Children render before the island in the page's scope, so they can read the page's server contexts and contain nested islands of their own.

## Hydration resilience

Browser extensions and password managers occasionally inject nodes inside an island before hydration runs. Prunelle steps over injected nodes to attach to the markup it rendered. If a node's tag differs from what SSR emitted, the island redraws that subtree cleanly rather than binding handlers to the wrong element; if a list has fewer client items than SSR rows, extra rows are removed. Both protections run in production; in dev, the console also names the island and mismatched element.

## What an island cannot use

Because the browser renders an island without the surrounding page, Prunelle refuses constructs that only work on the server:

- `<Head>`, `<Suspense>`, `<Region>`, and `<ConsentGate>` are server-only and fail compilation inside an island. `<Catch>` works on both server and client.
- Contexts provided outside an island do not cross the boundary and throw during SSR (`prunelle: <Counter> reads a context provided outside the island`). Pass the value as a prop instead.

## Server-only `async` routes and layouts

An `export default async function Page()` route runs strictly on the server so you can `await` databases or files directly. Signals or DOM handlers inside an `async` route fail compilation — extract the interactive part into a child component.

`_layout.tsx`, `_error.tsx`, `_404.tsx`, and status pages (`_401.tsx`–`_503.tsx`) also render on the server only. Place interactive chrome (such as a theme toggle or search palette) in its own component and render it from the layout.

## What an island may import

An island ships to the browser with every module it reaches. If any reachable module imports a server-only package (`bun:sqlite`, `node:fs`, `prunelle/server`, etc.) or reads `process.env`, `prunelle build` fails and `prunelle check` names both the module and the island that reaches it.

Action files are the exception: the browser receives a tiny RPC stub instead of server code, and importing any non-action export from an action file inside an island fails the build.

Client code may read `process.env.PUBLIC_*`, which Prunelle inlines at build time — never store secrets in `PUBLIC_*` variables.
