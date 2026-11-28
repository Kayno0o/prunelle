---
title: Routing & Layouts
description: File-based routes, dynamic params, nested layouts, directory middleware, API endpoints, and hybrid prerendering.
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

Route precedence is `static > matched param > param > optional > catch-all`. Built-in matchers ship for `integer` (typed as `` `${number}` ``), `uuid` (typed as `` `${string}-${string}-${string}-${string}-${string}` ``), and `slug` (`string`). Add a custom matcher by creating `src/params/<name>.ts` exporting `match(value: string): boolean` (or a default function). When a matcher rejects a segment, matching falls through to the next route or 404. Unknown matcher names, conflicting route patterns (including across `(group)/` folders), and unsupported status pages (such as `_418.tsx`) fail `prunelle check` and `prunelle build`.

Params arrive percent-decoded, so `/posts/caf%C3%A9` gives `params.slug === "café"`. A dynamic route never matches a segment holding an encoded `/`, `\` or NUL, or a `.` or `..` segment: the request gets a 404, so you can join a param into a file path without checking it for traversal. The same rule holds for static pages, `public/` files and a `prunelle start --static` export: `/a%2fb.txt` never serves `a/b.txt`, and a file whose name holds a literal `%2f` is reached through `%252f`. A plugin route that needs such segments as text opts in with `encodedSlashes` ([Plugin API](/docs/production/plugin-api)).

`_404.tsx`, `_error.tsx`, and status pages (`_401.tsx`, `_403.tsx`, `_429.tsx`, `_503.tsx`) can live at the root or in any subfolder (including `(group)/`). The nearest one wins and renders inside that folder's `_layout.tsx` chain. When a page, `load()`, or `_middleware.ts` calls `ctx.deny(status, message)` for a browser request (`Accept: text/html`), Prunelle renders the nearest matching `_<status>.tsx` (falling back to the nearest `_error.tsx`, then clean HTML) with that HTTP status; non-HTML and JSON requests receive `{ ok: false, status, error: message }`.

Every other file under `src/routes/` must export a page, a method handler or an action, since an action placed there is guarded by its folder's `_middleware.ts`. A helper with none of these fails `prunelle build` and `prunelle check`: move it elsewhere, or prefix its name or folder with `_`, as in `_format.ts` or `_components/`. Special files fail the same way without a default export.

## Data loading (`load` vs `async` page)

Use either an `async` route component (strictly server-only) or a sync route with `export async function load(ctx)`. `load()` can return data props or a `Response` (such as a `404` or redirect):

```tsx
import type { RequestContext } from 'prunelle/server'

export async function load(ctx: RequestContext) {
  const post = await findPost(ctx.params.slug)
  if (!post)
    return new Response('Not found', { status: 404 })
  return { post }
}

export default function PostPage({ data }: { data: { post: Post } }) {
  return <article><h1>{data.post.title}</h1></article>
}
```

## API routes & `RequestContext`

Export HTTP verb handlers from any `.ts` file under `src/routes/`:

```ts
// src/routes/api/items.ts
import type { RequestContext } from 'prunelle/server'

export function GET(ctx: RequestContext) {
  return ctx.json({ items: [], ip: ctx.ip })
}

export async function POST(ctx: RequestContext) {
  const body = await ctx.request.json()
  if (!body?.name)
    return ctx.deny(400, 'name is required', { name: 'Required' })
  return ctx.json({ created: body.name }, { status: 201 })
}
```

Every `RequestContext` provides: `request`, `url`, `params`, `cookies`, `locals`, `ip`, `json(data, init?)`, `text(body, init?)`, `redirect(location, status?)`, and `deny(status, message, fieldErrors?)`.

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
import type { Middleware } from 'prunelle/server'

const middleware: Middleware = async (ctx, next) => {
  ctx.locals.requestId = crypto.randomUUID()
  return next()
}

export default middleware
```

## Page changes

A plain link loads the next page, and prunelle makes that load smoother without shipping any JavaScript. Three things happen on every page, and each can be turned off.

**Pages fade into each other.** Every page carries `@view-transition { navigation: auto }`, so browsers that support cross-document view transitions fade from one page to the next. A visitor who asks for less motion gets the plain repaint. Other browsers get a normal page load.

To keep a part of the page still while the rest fades, give it a name in your CSS. There is no new syntax:

```css
header { view-transition-name: site-header; }
.side { view-transition-name: side; }
```

**Links are fetched when the pointer reaches them.** Prunelle adds Speculation Rules that prefetch a same-origin link on hover, so the page is often there by the time of the click. Browsers without Speculation Rules ignore them. Prunelle never prefetches:

- a link to another origin,
- a link with `data-pru-no-prefetch`, or inside an element that has it (use it on sign-out and other links that change something),
- a link with `download` or `rel="nofollow"`,
- a prunelle route such as an action's URL.

**Prerender is opt-in.** It renders the page before the click, so it runs that page's `load()` for pages nobody opens. Turn it on only when that cost is fine.

```ts
export default defineConfig({
  navigation: {
    viewTransitions: true,    // false: the browser's plain repaint
    prefetch: 'moderate',     // 'conservative' (on press), 'eager', or false
    prerender: false,         // true is 'moderate'; also 'conservative' or 'eager'
  },
})
```

The style and the rules are inline, and the page's CSP carries their hashes, so the strict policy stays strict.

### Keeping a panel's scroll

The browser restores the window's scroll when you go back, but not the scroll of a panel inside the page. A sidebar list that scrolls would jump to the top on every page change. Mark it with a key:

```tsx
<ul class="side" data-pru-keep-scroll="side">...</ul>
```

When the next page has an element with the same key, its scroll offset is set again before the first paint. Back and forward restore the offset that history entry had. A page that has no marked element ships nothing for this. A marked page gets one small inline script, hashed in its CSP. If `sessionStorage` is blocked, the page renders as usual.

The key must be a plain string, and one page can use each key once. A key that is not a literal, or a panel inside a panel with the same key, fails the compile. Two elements with the same key on one rendered page (one in a layout, one in the page) throw when the page renders.

## Hybrid prerendering

Mark any static or dynamic route with `export const prerender = true`:

```tsx
export const prerender = true

export function paths() {
  return ['/posts/hello', '/posts/prunelle']
}
```

Dynamic routes with `prerender = true` must export `paths()`. Without it, `prunelle check` and `prunelle build` both fail at the `prerender` export. Any request for a param not returned by `paths()` receives a `404` instead of falling back to SSR.

In `prunelle dev`, prerendering is skipped so routes render on demand. In `prunelle build` and `prunelle build --static`, all paths prerender concurrently.

## Route caching (`export const cache`) & auto-prerendering

Pages whose HTML can be shared across visitors can export `cache` (a duration string such as `'30s'`, `'5m'`, `'1h'`, `'1d'`, a positive number of seconds, or `{ maxAge, staleWhileRevalidate? }`):

```tsx
export const cache = '1h'
// or: export const cache = { maxAge: '5m', staleWhileRevalidate: '1h' }

export async function load(ctx: RequestContext) {
  return { posts: await listPublicPosts(ctx.params.category) }
}
```

Prunelle keeps rendered 200 HTML responses in a bounded in-memory LRU cache (default: 500 entries / 32 MiB; configure or disable via `routeCache` in `prunelle.config.ts`) and sends `Cache-Control: public, s-maxage=<maxAge>, stale-while-revalidate=<swr>` (plus `Age: <seconds>` on hits). Once an entry is stale, hits keep serving immediately while a single deduplicated background render refreshes it. Responses that set cookies (`Set-Cookie`), partial `<Region>` requests, flash-cookie requests, streamed `<Suspense>` responses, and `prunelle dev` bypass the cache.

To prevent leaking per-visitor state across users, `prunelle check` and `prunelle build` fail whenever a cached route's `load()`, page component, or ancestor `_layout.tsx` reads `ctx.cookies`, `cookies`, `ctx.locals`, `locals`, `ctx.consent`, `request.headers.get('cookie')`, `getActionError()`, or `<ConsentGate>`.

Static pages that export no `load()`, are not `async`, sit outside `_middleware.ts`, and read nothing from the request (`params`, `url`, `locals`, `cookies`, `headers`, `consent`, `ip`) or the clock (`Date.now()`, `new Date()`, `performance.now()`) are reported as `cacheable` by `prunelle inspect`. Enable `autoPrerender: true` in `prunelle.config.ts` (or pass `prunelle build --auto-prerender`) to automatically prerender them at build time (skipping pages with `export const prerender = false` or `export const cache`).
