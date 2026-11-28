---
title: "@prunellejs/i18n · mail · spa · tailwind · icons"
description: Composable plugins for localization, email delivery, partial Regions and opt-in SPA swaps, Tailwind v4, and inline SVG icon sets.
section: plugins
order: 7
---

Every remaining capability is an opt-in package built strictly on `PrunellePlugin` via `definePlugin(...)`.

## Conventions & ordering

- **Stateless plugins** export a camelCase factory matching the package name: `tailwind()`, `images()`, `i18n()`, `content()`, `seo()`, `spa()`, `regions()`, `mcp()`.
- **Stateful service plugins** return one object that is both the plugin and the app handle: `plugins: [auth, mail, rooms]` registers what `createAuth()`, `createMailer()`, and `createRooms()` return.
- **Client-safe barrels**: `@prunellejs/ui` and `@prunellejs/icons` export only browser-safe components; their build plugins live at `@prunellejs/ui/plugin` (`ui()`) and `@prunellejs/icons/plugin` (`icons()`).
- **Declarative ordering**: Plugins declare `enforce: 'pre' | 'post'`, `after: ['...']`, `providesLocals`, and `readsLocals`. Core sorts plugins deterministically (`pre` → normal → `post`, respecting `after`), rejects duplicate plugin names, catches typo'd `after` names, and fails startup if a reader runs before its `providesLocals` provider.

## `@prunellejs/i18n`

Prefix-free default locale with prefixed secondary locales (`/fr/...`), automatic `<html lang>` and internal `<a href="/...">` rewriting, `prerenderPaths` expansion, `hreflang` alternate links, and `Intl` helpers (`localizePath`, `alternateLinks`, `formatDate`, `formatNumber`):

```ts
import { i18n } from '@prunellejs/i18n'

i18n({
  locales: ['en', 'fr'],
  defaultLocale: 'en',
  messages: { en, fr },
})
```

- Every request receives `ctx.locals.locale`, `ctx.locals.t(key)`, `ctx.locals.localize(path, target?)`, and `ctx.locals.alternates()`.
- Add `data-no-localize` to any `<a>` tag to skip automatic locale prefixing.
- Missing translation keys are reported by both `prunelle check` and `prunelle i18n-check`.

## `@prunellejs/mail`

Send transactional email through Resend or any custom `MailTransport`, with a dev-only outbox preview at `/_pru/mail` (and `/_pru/mail.json`):

```ts
// src/mail.ts
import { createMailer, resend } from '@prunellejs/mail'

export const mail = createMailer({
  from: 'hello@example.com',
  // Omit transport to auto-use RESEND_API_KEY when set
  transport: process.env.RESEND_API_KEY ? resend() : undefined,
})
```

Register `mail` in `prunelle.config.ts`. In development and tests, sent messages are recorded in `mail.outbox` and rendered at `/_pru/mail`. In `NODE_ENV=production`, preview routes are never mounted and no outbox copy is retained in memory.

`resend()` retries `429` and `5xx` responses twice using the server's wait interval, sending the message ID as an idempotency key so retried mail is never delivered twice (`retries: 0` disables retries).

## `@prunellejs/icons`

Zero-runtime inline SVGs from any `@iconify-json/*` pack or your own SVG folders. Register `icons()` from `@prunellejs/icons/plugin` in `prunelle.config.ts`, then import icons anywhere, including islands:

```tsx
import { Icon } from '@prunellejs/icons'
import arrowRight from '~icons/tabler/arrow-right'

<Icon icon={arrowRight} class="size-4" />
```

- **Local SVGs**: Place `.svg` files in `src/icons/` and import them as `~icons/local/<name>` (each needs a `viewBox`, or `width` and `height`). Configure extra folders with `icons({ dirs: { brand: 'assets/brand' } })`. `prunelle dev` reloads edited SVGs automatically.
- **Accessibility**: `<Icon>` forwards SVG attributes and overrides `width`, `height`, and `viewBox`. Icons with a non-blank `aria-label` or `aria-labelledby` receive `role="img"`; decorative icons receive `aria-hidden="true"`.
- **Compile checks**: Missing icon names or sets fail `prunelle check` and `prunelle build`, suggesting the closest match.
- **Discovery (`prunelle icons-find`)**: Search installed Iconify packs and local folders by related word, typo, or prefix (`prunelle icons-find garbage` finds `~icons/tabler/trash`; use `--set <prefix>` and `--limit <n>`). Apps building their own icon picker can import `findIcons` and `relatedWords` from `@prunellejs/icons/search` (keep it server-side: it reads a ~1.7 MB word table).

## `@prunellejs/tailwind`

Opt-in Tailwind CSS v4 integration. `tailwind()` auto-loads `bun-plugin-tailwind` from your project and defaults to `src/app.css`:

```ts
import { tailwind } from '@prunellejs/tailwind'

tailwind({ css: 'src/app.css' })
```

## `@prunellejs/spa` (`regions()` & `spa()`)

Plain multi-page navigation (`0 KB` JS, with view transitions and Speculation Rules) is the default. When part of a page needs to swap in place — such as a detail pane, filterable results, or "Load more" — add `regions()`. Reach for full-page `spa()` only when a `[data-persist]` island must stay mounted across routes.

### Partial swaps with `regions()`

`regions()` swaps one `<Region>` of a page and asks the server for that fragment alone (no layouts, no full document). Its client ships **only on routes that render a `<Region>`** and works with or without `spa()`:

```ts
import { regions } from '@prunellejs/spa'
import { defineConfig } from 'prunelle/config'

export default defineConfig({
  plugins: [regions()],
})
```

```tsx
import { Region } from 'prunelle'

export default function Icons({ data }) {
  return (
    <main>
      <Region name="results">
        {data.items.map(i => <a key={i} href={`?icon=${i}`} data-pru-target="pane">{i}</a>)}
      </Region>
      <Region name="pane" aria-label="Icon detail">
        <h2>{data.icon}</h2>
      </Region>
    </main>
  )
}
```

- **How it works**: Links with `data-pru-target="pane"` send `x-pru-region: pane`. The server skips layouts and other regions (`ctx.region` lets `load()` skip unneeded work), updates `document.title` via `x-pru-title`, pushes history, restores scroll per entry, runs in a view transition (off under reduced motion), updates `aria-current="page"`, moves focus, sets `aria-busy="true"` after 150 ms, and hydrates any islands in the new HTML. Without JS — or on fetch error — the link falls back to a full page load.
- **Append ("Load more")**: Add `data-pru-append` to append new HTML, remove the clicked link, and replace the history entry.
- **GET & POST forms**: `<form method="get" data-pru-target="results">` swaps on submit (dropping empty fields); add `data-pru-live` for debounced live filtering (200 ms, one history entry per typing burst). `<form method="post" data-pru-target="x">` posts in the background, follows redirects, and swaps region `x`.
- **Sync, prefetch & nesting**: `data-pru-sync="q icon"` keeps external links/inputs synced with current query params; links inside `[data-pru-prefetch]` prefetch on hover/focus; regions can nest (each with its own name) so an inner list appends while an outer search swaps cleanly.
- **Refresh from script**: Call `await refreshRegion('side')` from `@prunellejs/spa/regions` after a background mutation to redraw a region at the current URL without touching history or focus.
- **Compile & check safety**: `prunelle check` catches `data-pru-target` pointing to a missing `<Region>`; nested same-name regions and invalid attributes fail compile.

### Full-page `spa()`

Add `spa()` only when an island must stay alive across route changes:

```ts
import { spa } from '@prunellejs/spa'

export default defineConfig({
  plugins: [spa()],
})
```

- **Persistent islands**: Add `data-persist="id"` to keep live DOM and state across navigations.
- **Prefetch & opt-out**: Add `data-pru-prefetch` to prefetch on hover/focus (respects `Save-Data`), or `data-no-spa` for a full page load.
- **Accessibility, styles & scroll**: Updates `<title>`, `<html lang>`, head stylesheets in cascade order, focus, polite `aria-live` announcements, view transitions (respecting reduced motion), and `data-pru-keep-scroll` panels.
