---
title: Routing & Layouts
description: File-based routes, dynamic params, matchers, route groups, nested layouts, middleware, API endpoints, view transitions, prerendering, and route caching.
section: core
order: 3
---

Every file in `src/routes/` maps directly to a URL path on `Bun.serve()`.

## Route conventions

| File path | URL pattern | Type |
| :--- | :--- | :--- |
| `src/routes/index.tsx` | `/` | Page |
| `src/routes/about.tsx` | `/about` | Page |
| `src/routes/posts/[slug].tsx` | `/posts/:slug` | Dynamic param (`params.slug`) |
| `src/routes/users/[id=integer].tsx` | `/users/:id=integer` | Matched param (`integer`, `uuid`, `slug`, or `src/params/<name>.ts`) |
| `src/routes/[[lang]]/about.tsx` | `/:lang?/about` | Optional segment (`params.lang`: `string \| undefined`) |
| `src/routes/(marketing)/pricing.tsx` | `/pricing` | Route group (applies its `_layout.tsx` & `_middleware.ts`, adds no URL segment) |
| `src/routes/docs/[...slug].tsx` | `/docs/*slug` | Catch-all (`params.slug`; also supports `[...slug=slug]`) |
| `src/routes/api/users.ts` | `/api/users` | API route (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) |
| `src/routes/_layout.tsx` | All sibling & nested routes | Nested layout (outer → inner) |
| `src/routes/_middleware.ts` | All sibling & nested routes | Request middleware (outer → inner) |
| `src/routes/_404.tsx` | Unmatched routes | 404 page (root or per-folder; emits `404.html` / `<folder>/404.html` in `--static`) |
| `src/routes/_error.tsx` | Uncaught route errors | Error page (root or per-folder; receives `{ error }`) |
| `src/routes/_401.tsx`, `_403.tsx`, `_429.tsx`, `_503.tsx` | Denied HTML requests | Status page (root or per-folder; receives `{ status, message, url, params, locals }`) |

Route precedence is `static > matched param > param > optional > catch-all`. Built-in matchers ship for `integer` (typed as `` `${number}` ``), `uuid` (typed as `` `${string}-${string}-${string}-${string}-${string}` ``), and `slug` (`string`). Add a custom matcher by creating `src/params/<name>.ts` exporting `match(value: string): boolean` (or a default function). When a matcher rejects a segment, matching falls through to the next route or 404. Unknown matchers, conflicting route patterns (including across `(group)/` folders), and unsupported status pages (such as `_418.tsx`) fail `prunelle check` and `prunelle build`.

Params arrive percent-decoded, so `/posts/caf%C3%A9` gives `params.slug === "café"`. A dynamic route never matches a segment containing an encoded `/`, `\`, or NUL, or a `.` / `..` segment: the request receives `404`, so params are safe to join into file paths. The same rule holds for static pages, `public/` files, and `prunelle start --static` (`/a%2fb.txt` never serves `a/b.txt`). A plugin route that needs such segments as text opts in with `encodedSlashes` (see [Plugin API](/docs/production/plugin-api)).

`_404.tsx`, `_error.tsx`, and status pages (`_401.tsx`, `_403.tsx`, `_429.tsx`, `_503.tsx`) can live at the root or in any subfolder (including `(group)/`). The nearest one wins and renders inside that folder's `_layout.tsx` chain. When a page, `load()`, or `_middleware.ts` calls `ctx.deny(status, message)` for a browser request (`Accept: text/html`), Prunelle renders the nearest `_<status>.tsx` (falling back to `_error.tsx`, then clean HTML) with that HTTP status; JSON requests receive `{ ok: false, status, error: message }`.

Every non-underscore file under `src/routes/` must export a page, a method handler, or an action (guarded by its folder's `_middleware.ts`). Helper modules without one fail `prunelle build` and `prunelle check` — move them outside `src/routes/` or prefix the file or folder with `_` (such as `_format.ts` or `_components/`). Special files fail the same way if they lack a default export.

## Data loading (`load` vs `async` page)

Use either an `async` route component (strictly server-only) or a sync route with `export async function load(ctx)`. `load()` returns data props, `notFound()` (which renders the nearest `_404.tsx` with HTTP `404`), or a `Response` (such as `ctx.redirect(...)`):

```tsx
// src/routes/posts/[slug].tsx
import type { PageProps, RouteContext } from 'prunelle'
import { Head } from 'prunelle'
import { notFound } from 'prunelle/server'
import { findPost } from '../../db'

export async function load(ctx: RouteContext<'/posts/[slug]'>) {
  const post = await findPost(ctx.params.slug)
  if (!post)
    return notFound()
  return { post }
}

export default function PostPage({ data }: PageProps<typeof load>) {
  return (
    <article>
      <Head><title>{data.post.title}</title></Head>
      <h1>{data.post.title}</h1>
    </article>
  )
}
```

## API routes & `RequestContext`

Export HTTP verb handlers from any `.ts` file under `src/routes/`:

```ts
// src/routes/api/items.ts
import type { RequestContext } from 'prunelle/server'

export function GET(ctx: RequestContext) {
  return ctx.json({ items: [], ip: ctx.ip, requestId: ctx.requestId })
}

export async function POST(ctx: RequestContext) {
  const body = await ctx.request.json()
  if (!body?.name)
    return ctx.deny(400, 'name is required', { name: 'Required' })
  return ctx.json({ created: body.name }, { status: 201 })
}
```

Every `RequestContext` provides: `request`, `url`, `params`, `cookies`, `locals`, `ip`, `requestId`, `region`, `consent`, `json(data, init?)`, `text(body, init?)`, `redirect(location, status?)`, and `deny(status, message, fieldErrors?)`.

Unsafe HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) verify `Origin` / `Sec-Fetch-Site` by default. Export `export const csrf = false` in an API route to opt out for external webhooks or bearer-token endpoints.

## Layouts & Middleware

Layouts receive `{ children, params, locals, url }`:

```tsx
import type { PrunelleChild } from 'prunelle'

export default function Layout({ children, locals }: { children: PrunelleChild, locals: Record<string, unknown> }) {
  return (
    <div class="shell">
      <header>{locals.user ? 'Signed in' : 'Guest'}</header>
      <main>{children}</main>
    </div>
  )
}
```

Middleware in `_middleware.ts` runs outer-to-inner before matching routes and actions in that directory:

```ts
// src/routes/admin/_middleware.ts
import type { Middleware } from 'prunelle/server'

const middleware: Middleware = async (ctx, next) => {
  if (!ctx.locals.user?.isAdmin)
    return ctx.deny(403, 'Administrator access required')
  return next()
}

export default middleware
```

## Page changes

Plain multi-page links stay **0 KB** of JavaScript, and Prunelle makes them feel seamless by default:

- **Cross-document view transitions**: Every page carries inline, CSP-hashed `@view-transition { navigation: auto }` inside `@media (prefers-reduced-motion: no-preference)`. To keep a shared header or sidebar still while content fades, give it a `view-transition-name` in CSS:

```css
header { view-transition-name: site-header; }
.side { view-transition-name: side; }
```

- **Speculation Rules prefetch on hover**: Same-origin links are prefetched on hover (`eagerness: moderate`). Prunelle automatically excludes external links, `/_pru/*` action URLs, `[download]`, `[rel~=nofollow]`, and any link or ancestor carrying `data-pru-no-prefetch` (use it on sign-out or state-changing links).
- **Opt-in prerender**: Prerendering executes `load()` before a click, so it is off by default. Configure all three in `prunelle.config.ts`:

```ts
export default defineConfig({
  navigation: {
    viewTransitions: true,    // false: plain browser repaint
    prefetch: 'moderate',     // 'conservative' (on press), 'eager', or false
    prerender: false,         // true is 'moderate'; also 'conservative' or 'eager'
  },
})
```

### Keeping a panel's scroll (`data-pru-keep-scroll`)

Browsers restore window scroll on back/forward, but not an inner scrolling sidebar. Mark any scrollable panel with a literal key:

```tsx
<nav class="contents" data-pru-keep-scroll="contents">...</nav>
```

When the next page renders an element with the same key, its scroll offset restores before first paint, and back/forward restores each history entry's offset. Pages without `data-pru-keep-scroll` ship nothing for it; marked pages receive one tiny CSP-hashed inline script. Duplicate keys on one page or non-literal keys are refused.

## Hybrid prerendering

Mark any static or dynamic route with `export const prerender = true`:

```tsx
export const prerender = true

export function paths() {
  return ['/posts/hello', '/posts/prunelle']
}
```

Dynamic routes with `prerender = true` must export `paths()` — without it, `prunelle check` and `prunelle build` fail at the `prerender` export. Requests for unlisted params return `404` instead of falling back to SSR. Prerendering is skipped in `prunelle dev` so routes render on demand, and runs concurrently in `prunelle build` and `prunelle build --static`.

## Route caching (`export const cache`) & auto-prerendering

Pages whose HTML can be shared across visitors can export `cache` — a duration string (`'30s'`, `'5m'`, `'1h'`, `'1d'`), a positive number of seconds, or `{ maxAge, staleWhileRevalidate? }`:

```tsx
export const cache = '1h'
// or: export const cache = { maxAge: '5m', staleWhileRevalidate: '1h' }

export async function load(ctx: RouteContext<'/category/[name]'>) {
  return { posts: await listPublicPosts(ctx.params.name) }
}
```

Prunelle stores 200 HTML responses (and their compressed variants) in a bounded in-memory LRU cache (`500` entries / `32 MiB` by default; tune or disable with `routeCache` in `prunelle.config.ts`), serving up to **329,749 req/s** gzip while emitting `Cache-Control: public, s-maxage=..., stale-while-revalidate=...` and `Age`. Once stale, hits keep answering immediately while one deduplicated background render refreshes the entry. Responses setting `Set-Cookie`, partial `<Region>` requests, flash-cookie requests, streamed `<Suspense>` responses, and `prunelle dev` bypass the cache.

To prevent leaking per-visitor state, `prunelle check` and `prunelle build` fail whenever a cached route's `load()`, page component, or ancestor `_layout.tsx` reads `ctx.cookies`, `ctx.locals`, `ctx.consent`, `request.headers.get('cookie')`, `getActionError()`, or `<ConsentGate>`.

Static pages that export no `load()`, are not `async`, sit outside `_middleware.ts`, and read nothing from the request or clock are reported as `cacheable` by `prunelle inspect`. Enable `autoPrerender: true` in `prunelle.config.ts` (or pass `prunelle build --auto-prerender`) to prerender them automatically at build time.
