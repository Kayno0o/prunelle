---
title: Signals & Reactivity
description: Fine-grained push-pull signals with .value, glitch-free computed values, effects, context, hydration-safe IDs, O(1) selector, deep stores, and JSX rules.
section: core
order: 1
---

Prunelle's reactivity kernel (`prunelle`) uses a push-pull doubly-linked-list dependency graph. With `"sideEffects": false`, unused helpers tree-shake to **0 bytes**.

## Core primitives

```tsx
import { batch, computed, onCleanup, onMount, signal } from 'prunelle'

export function Counter({ step = 1 }: { step?: number }) {
  const count = signal(0)
  const doubled = computed(() => count.value * 2)

  onMount(() => {
    const id = setInterval(() => { count.value += step }, 1000)
    onCleanup(() => clearInterval(id))
  })

  return (
    <div>
      <p>{count.value} × 2 = {doubled.value}</p>
      <button type="button" onClick={() => batch(() => { count.value += step })}>
        +{step}
      </button>
    </div>
  )
}
```

| Primitive | Purpose |
| :--- | :--- |
| `signal(initial)` | Reactive cell. Read and write via `.value`; read without subscribing via `.peek()`. |
| `computed(fn)` | Lazy, memoized, glitch-free derived signal. |
| `effect(fn)` | Runs whenever tracked dependencies change. Return a cleanup function if needed. Skipped during SSR so timers and requests never outlive a response; derive rendered values with `computed`. |
| `batch(fn)` | Coalesces multiple signal writes into a single flush. |
| `untrack(fn)` | Reads signals without subscribing the enclosing computation. |
| `onMount(fn)` | Runs in the browser after the component's elements attach to the document. Return a cleanup function if needed. |
| `onCleanup(fn)` | Runs when the enclosing component or effect is disposed. |
| `root(dispose => ...)` | Creates an isolated disposal scope. |
| `getOwner()` | Returns the current reactive disposal owner (or `null`). |

## Compiler-safe prop destructuring

Destructuring props in Prunelle stays reactive. The compiler rewrites reads of destructured props inside client components to live getter reads:

```tsx
export function Badge({ count = 0, label }: { count?: number, label: string }) {
  return <span>{label}: {count}</span>
}
```

A default that is more than a literal or a name (`items = []`, `id = useId()`) runs once per component call, as in plain TypeScript, so `items` stays the same array on every read. If a passed prop later becomes `undefined`, the default is evaluated then, once.

To let a child mutate parent state, pass the signal itself as a prop (`<Modal open={isOpen} />`). No `bind:` syntax is needed.

## Context & hydration-safe IDs (`useId`)

Share values down a component tree with `createContext()`, `<Ctx.Provider value={...}>` (or `provideContext(Ctx, value, fn)`), and `useContext(Ctx)`:

```tsx
import { createContext, useContext, useId } from 'prunelle'

const ThemeCtx = createContext<'light' | 'dark'>('light')

export function FieldHint({ text }: { text: string }) {
  const id = useId('hint') // Deterministic across SSR and island hydration
  const theme = useContext(ThemeCtx)
  return <p id={id} data-theme={theme}>{text}</p>
}
```

`useId(prefix = 'k')` produces matching IDs on the server and during browser hydration, scoped per SSR request and per island.

<Callout title="Context & island boundaries" tone="warning">
A context provided on the server does not cross into an island — reading it inside an island throws during SSR. Pass server values into islands as props instead; contexts provided *inside* an island work on both sides.
</Callout>

## Tree-shakable helpers (`selector` & `store`)

- **`selector(() => selectedId.value)`**: Turns O(N) row-highlight checks in large tables into **O(1)** updates. Only the previously selected and newly selected rows re-run.
- **`store(initial)` + `snapshot(s)`**: Deep proxy store for nested objects and arrays. Costs 0 bytes if unimported.

## JSX rules

Prunelle's compiler and runtime reject common React, Solid, and Astro habits that would otherwise fail silently:

- **Raw HTML**: Use `innerHTML={html}` with a string (or `raw(html)` from `prunelle/server`). Never pass `{ __html }`, never use `dangerouslySetInnerHTML`, never combine `innerHTML` with children, and never put it on a void element.
- **Events**: Use camelCase DOM names (`onClick`, `onDblClick`, `onKeyDown`). Lowercase (`onclick`), namespaced (`on:click`), `onDoubleClick`, `*Capture`, string handlers, and render-time assignments (`onClick={count.value++}`) fail compilation. For capture listeners or custom events, call `addEventListener` inside a `ref`.
- **Refs**: Always pass a callback: `ref={el => ...}`. Ref objects (`{ current }`) are refused.
- **Attributes & SVG**: Use `class` or `className` (never both), standard `value`/`checked` (never `defaultValue`/`defaultChecked`), kebab-case SVG attributes (`stroke-width`, `fill-opacity`), and boolean `{false}` (never `"false"`). `style` accepts either a CSS string or an object (`style={{ color: 'red' }}`). HTML entities in string attributes decode like text (`title="Tom &amp; Jerry"` reads `Tom & Jerry`); only `innerHTML` strings stay as written.
- **Renderable values**: Promises, functions, raw signal objects, and plain objects throw in JSX text and attributes. Read `count.value` instead of passing `count`.
- **Signal reads in code**: Testing a local signal without `.value` (`if (count)`, `count ? a : b`, `!count`) fails compilation because a signal object is always truthy. So does `const { value } = count`, which reads once and stops tracking.
- **Effects**: `effect(async () => ...)` fails compilation. An effect tracks only reads before the first `await` and expects a cleanup function, not a Promise. Start async work inside a plain effect.
- **Directives**: `'use client'` and `'use server'` fail compilation. Interactive components become islands automatically, and server mutations use `action()`.
- **Spread safety**: `{...spread}` automatically strips `on*` handlers, `innerHTML`, `srcdoc`, and `javascript:`/`vbscript:` URLs during SSR.
