---
title: Project Structure
description: File-based routing, layouts, middleware, custom matchers, actions, static assets, and prunelle.config.ts conventions.
section: getting-started
order: 3
---

A typical Prunelle project stays flat and predictable:

```text
my-app/
├── .gitignore                 # node_modules/, dist/ and .prunelle-cache/, written by prunelle new
├── prunelle.config.ts         # Shared site, lang, security, consent, and plugins
├── public/                    # Served at / (ETag/304 in prod, precompressed .br/.gz)
├── src/
│   ├── app.css                # Optional global stylesheet (CSS or Tailwind v4)
│   ├── actions/
│   │   └── preferences.ts     # Server actions (auto-stubbed on client)
│   ├── components/
│   │   ├── Counter.tsx        # Interactive -> auto-island
│   │   └── Header.tsx         # Static -> 0 KB JS
│   ├── params/
│   │   └── sku.ts             # Optional custom route param matchers
│   └── routes/
│       ├── _layout.tsx        # Root layout (wraps all nested routes)
│       ├── _middleware.ts     # Runs before matching routes and actions in this folder
│       ├── _404.tsx           # Custom 404 page (also emitted as 404.html)
│       ├── _403.tsx           # Optional status pages (_401, _403, _429, _503)
│       ├── _error.tsx         # Error boundary page
│       ├── index.tsx          # GET /
│       ├── posts/
│       │   └── [slug].tsx     # GET /posts/:slug
│       └── api/
│           └── health.ts      # GET /api/health (Web Request -> Response)
└── package.json
```

## TypeScript configuration

Enable Prunelle's JSX import source in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "prunelle",
    "noEmit": true
  }
}
```

## Configuration (`prunelle.config.ts`)

Declare shared settings like `site`, `lang`, and `trustProxy` once at the top level — plugins inherit them automatically:

```ts
import { seo } from '@prunellejs/seo'
import { ui } from '@prunellejs/ui/plugin'
import { defineConfig } from 'prunelle/config'

export default defineConfig({
  site: 'https://example.com',
  lang: 'en',
  plugins: [
    ui({ grammar: 'prunelle' }),
    seo({ name: 'My App', titleTemplate: '%s | My App' }),
  ],
})
```
