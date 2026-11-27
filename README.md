# Prunelle

**Write standard TypeScript & JSX. Zero `'use client'`, zero `client:load`.**
Static UI compiles to `0 KB` HTML strings; interactive components automatically become `~3.9 KB` fine-grained signal islands. Built natively on Bun with single-binary production deploys and a strict `PrunellePlugin` boundary.

---

prunelle began as kay v2: an app on kay v2 moves with `bunx prunelle upgrade`.

## Performance (vs kay v1, Solid, Svelte, Astro, Next.js & Nuxt)

| Metric | **Prunelle** | kay v1 | Solid | Svelte | Astro | Next.js | Nuxt |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Clean build** | **18.8 ms** | 460 ms | 140 ms | 90 ms | 1,190 ms | 2,180 ms | 2,580 ms |
| **Build output (gzip)** | **5.18 KB** | 65.9 KB | 8.2 KB | 22.5 KB | 137.8 KB | 328.6 KB | 614.7 KB |
| **SSR throughput (500 products)** | **7,017 req/s** | 3,983 req/s | 1,712 req/s | 3,861 req/s | 1,898 req/s | — | 583 req/s |
| **Products JS shipped (gzip)** | **3.86 KB** | 9.9 KB | 8.2 KB | 22.5 KB | 8.6 KB | 133.4 KB | 76.4 KB |
| **Table JS shipped (gzip)** | **7.02 KB** | 12.5 KB | 8.2 KB | 22.5 KB | 9.6 KB | 134.3 KB | 72.3 KB |
| **Table: create 10,000 rows** | **219.1 ms** | 262.0 ms | 226.0 ms | 232.0 ms | 234.0 ms | 360.0 ms | 266.0 ms |
| **Table: replace 1,000 rows** | **23.9 ms** | 25.5 ms | 24.3 ms | 25.9 ms | 24.5 ms | 29.9 ms | 27.4 ms |
| **Table: select row** | **0.20 ms** | **0.20 ms** | 0.30 ms | 1.00 ms | 0.30 ms | 1.20 ms | 0.70 ms |

---

## Quick Example

### Interactive Island (`src/components/Counter.tsx`)
No directives needed — using `signal` or an event handler automatically marks the component as an island. prunelle decides per component, not per file: a page can declare `Counter` itself and stay static, shipping only the counter.

```tsx
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

### Server Page (`src/routes/index.tsx`) — `0 KB` JS
`async` route components run strictly on the server:

```tsx
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

### Unified Server Action (`src/actions/posts.ts`)
Accepts any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType, TypeBox). Works both as a zero-JS progressive `<form action={createPost} method="post">` and as a typed island RPC (`await createPost(data)`), with server code automatically stripped from client bundles and CSRF verified:

```ts
import { action } from 'prunelle/server'
import { z } from 'zod'

export const createPost = action(
  z.object({ title: z.string().min(1) }),
  async (input, ctx) => {
    const post = await db.posts.create(input)
    return { id: post.id }
  },
)
```

### Smooth page changes, `0 KB` JS
Every page fades into the next with a cross-document view transition (off under reduced motion), and same-origin links are prefetched on hover through Speculation Rules (`navigation: { prerender: true }` opts into prerender; `data-pru-no-prefetch` opts a link out). Both are inline, hashed in the CSP and turned off in `prunelle.config.ts` with `navigation: { viewTransitions: false, prefetch: false }`. `data-pru-keep-scroll="side"` on a scrolling panel keeps its offset across plain page loads and on back/forward, with one small inline script only on pages that use it.

---

## Modular Ecosystem (`PrunellePlugin`)

Core holds the compiler, runtime, router, SSR and build. Every optional capability plugs in cleanly through `prunelle.config.ts`:

| Package | Purpose | Notes |
| :--- | :--- | :--- |
| **`prunelle`** | Compiler, linked-list signals, DOM runtime, router, SSR/Suspense, actions, build/compile, `prunelle/test` | 2 runtime deps (`oxc-parser`, `@kaynooo/cli-kit` for the CLI) |
| **`@prunellejs/ui`** | Platform-first headless primitives + 6 structurally distinct pure CSS `@layer kui` Grammars (`prunelle`, `editorial`, `workshop`, `console`, `soft`, `orbit`) + `prunelle ui-eject` | Zero JS recipe engine, zero Tailwind lock-in |
| **`@prunellejs/auth`** | Argon2id passwords, hashed DB sessions, email verification, magic links, OAuth 2.0 + PKCE (GitHub/Discord/Google), `auth.guard()`, RGPD helpers, `bun:sqlite` store | Zero external deps |
| **`@prunellejs/live`** | Typed real-time SSE rooms, microtask-coalesced presence, `useLive()` browser signal hook | Zero external deps |
| **`@prunellejs/content`** | `Bun.markdown` GFM collections, YAML frontmatter + Standard Schema, lazy `render()`, heading TOC, `paths()` prerender, RSS XML | Zero external deps |
| **`@prunellejs/mcp`** | Streamable HTTP (`2025-03-26`) MCP server exposing typed `action()` tools with schema compaction, shared schemas, `resources`, output shaping, and `prunelle mcp-footprint` | Zero external deps |
| **`@prunellejs/mail`** | Resend HTTP transport, custom transports, and dev-only `/_pru/mail` outbox preview | Zero external deps |
| **`@prunellejs/images`** | Build-time responsive AVIF/WebP pipeline + content-hash cache + `<Picture>` + OG `shareCard()` | ImageMagick / librsvg-backed (zero npm deps) |
| **`@prunellejs/icons`** | Virtual `~icons/<set>/<name>` imports + browser-pure `<Icon>`, your `.svg` folders as sets, `prunelle icons-find` search by related word or typo | Iconify JSON sets |
| **`@prunellejs/seo`** | `titleTemplate`, OpenGraph/Twitter meta, JSON-LD, sitemap, redirects, self-hosted fonts | Zero external deps |
| **`@prunellejs/tailwind`** | Tailwind v4 CSS integration (auto-loads `bun-plugin-tailwind`) | Opt-in |
| **`@prunellejs/spa`** | `regions()` swaps one `<Region>` of a page in a view transition and keeps its scroll per history entry, shipping its client only on pages that render one (the default beside plain page loads); opt-in `spa()` navigation for apps that need `[data-persist]` islands kept alive | Opt-in |
| **`@prunellejs/i18n`** | Locale URL rewriting, dictionary lookup, localized HTML & `prunelle i18n-check` | Zero external deps |

---

## Examples

- **[`examples/showcase`](examples/showcase)** — Live `@prunellejs/ui` Grammar Switcher (`prunelle` / `editorial` / `workshop` / `console` / `soft` / `orbit` / `bare`), every UI primitive, and guarded `@prunellejs/auth` routes.
- **[`examples/noticeboard`](examples/noticeboard)** — Full-stack real-time app combining `@prunellejs/auth`, `@prunellejs/live` (SSE presence & live push), `@prunellejs/mail`, `@prunellejs/ui`, Standard-Schema `action()`, and `bun:sqlite`.

```sh
cd examples/showcase && bun run dev
cd examples/noticeboard && bun run dev
```

## CLI Commands

```sh
bunx prunelle new my-app [--template minimal|fullstack|blog|app]  # Scaffold a new project
prunelle check [--no-typecheck]             # Validate routes, compiler rules, RGAA/RGPD/LCEN compliance, plugin checks & types
prunelle dev [--port 3000] [--host [addr]]  # Fast rebuild + live reload, the app in a child process (127.0.0.1 by default)
prunelle build [--analyze] [--max-js 40kb] # Production build; per-route islands, fonts and first-load report, or a JS budget
prunelle build --static                     # Pure static HTML export
prunelle build --compile [out]              # Single standalone executable
prunelle start [--port 3000] [--host [addr]] # Serve the built app or static export, reloading each new build
prunelle upgrade [--no-install]             # Move an app written for kay v2 onto prunelle
prunelle ui-eject <grammar> [dest]          # Eject a standalone @prunellejs/ui CSS Grammar
prunelle mcp-footprint                      # Inspect @prunellejs/mcp tool byte & token budgets
prunelle --completions fish                 # Shell completion script (also bash, zsh)
```

Every command answers `--help`. Exit codes: 0 done, 1 a finding or failure (`prunelle check` found an error), 2 a usage error. `prunelle build` refuses the same mistakes as `prunelle check`, at the same `file:line:col`, and only skips the typecheck; `prunelle check` says when it skipped one and why. A build replaces `dist/` only once every step has passed, so a failed one leaves the last build in place. A running `prunelle start` loads the new build when it lands, with no restart. A stack trace names the `src/` file and line that threw, in `prunelle dev`, `testApp()` and `prunelle start`. `testApp()` builds into a folder of its own.
