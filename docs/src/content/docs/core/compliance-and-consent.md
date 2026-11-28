---
title: Compliance & Consent
description: Built-in French web law checks (RGAA, RGPD, LCEN) in prunelle check and one-declaration CNIL consent gating with 0 KB of client JS.
section: core
order: 7
---

Prunelle treats accessibility, privacy, and legal compliance as first-class build checks rather than third-party plugins. Static checks run in `prunelle check` and production `prunelle build` as actionable warnings (pass `prunelle check --strict` in CI to fail on warnings), and consent gating ships **0 KB** of browser JavaScript.

## French web law checks (RGAA, RGPD, LCEN)

Every rule reports the exact `file:line:col` and how to fix it:

| Rule | What it checks |
| :--- | :--- |
| `rgaa/img-alt` | `<img>` missing an `alt` attribute (`alt=""` is accepted for decorative images). |
| `rgaa/form-label` | `<input>` (except `hidden`, `submit`, `reset`, `button`, `image`), `<select>`, or `<textarea>` without an enclosing `<label>`, matching `<label for>`, `aria-label`, `aria-labelledby`, or `title`. |
| `rgaa/accessible-name` | Empty or icon-only `<button>` or `<a>` with no visible text, `aria-label`, `aria-labelledby`, `title`, or labelled child image/icon. |
| `rgaa/duplicate-id` | Duplicate literal `id` attribute within the same component. |
| `rgaa/positive-tabindex` | Positive `tabindex` (`> 0`), which disrupts natural keyboard focus order (use `0` or `-1`). |
| `rgaa/nested-control` | Interactive element (`<a>`, `<button>`, `<input>`, `<select>`, `<textarea>`, `<summary>`) nested inside `<a>`, `<button>`, or `<summary>`. |
| `rgaa/link-as-button` | `<a>` without `href` that has an `onClick` handler (use `<button type="button">` or add `href`). |
| `rgaa/unknown-role` | Literal `role="..."` containing a token that is not a valid concrete WAI-ARIA role. |
| `rgaa/unknown-aria` | `aria-*` attribute name that is not a valid WAI-ARIA attribute. |
| `rgaa/invalid-aria-value` | Literal `aria-*` value that does not match its WAI-ARIA type (boolean, tristate, token enum, or numeric). |
| `rgaa/skipped-heading` | Downward heading level jump greater than 1 within a component (for example `<h1>` directly followed by `<h3>`). |
| `rgaa/table-without-header` | Data `<table>` with no `<th>` header cell (unless `role="presentation"` or `role="none"`). |
| `rgaa/fieldset-without-legend` | `<fieldset>` without a `<legend>` element. |
| `rgaa/click-without-key` | `onClick` on a non-interactive HTML element without `onKeyDown`, `onKeyUp`, or `onKeyPress`. |
| `rgaa/autofocus` | `autofocus` / `autoFocus` attribute that moves keyboard focus unexpectedly on page load. |
| `rgaa/meta-refresh` | `<meta http-equiv="refresh">` automatic redirect or reload. |
| `rgpd/third-party-url` | Third-party URL on `<script src>`, `<link rel="stylesheet\|preload\|preconnect\|dns-prefetch">`, `<iframe src>`, or CSS `@import`/`url(...)` outside `<ConsentGate>` (same-origin `site` and `localhost` are excluded). |
| `lcen/legal-notice` | Page app missing a legal notice route (`/mentions-legales`, `/legal`, `/legal-notice`, `/imprint`, `/impressum`, `/cgu`, `/cgv`, or custom `compliance.legalNotice`). Skipped for API-only apps. |
| `rgaa/accessibility-statement` | When `compliance: { publicBody: true }` is set, missing an accessibility statement route (`/accessibilite`, `/accessibility`, `/declaration-accessibilite`, or `/accessibility-statement`). |

<Callout title="Runtime RGAA audit" tone="tip">
Static JSX checks pair with the built-in `a11y()` plugin (`prunelle a11y`), which runs `axe-core` in Chromium and drafts an editable RGAA 4.1.2 declaration at `src/routes/accessibilite.tsx`. See [CLI & Testing](/docs/production/cli-and-testing).
</Callout>

## Silencing warnings

Silence a rule explicitly in `prunelle.config.ts` or inline with a comment naming the rule:

```ts
// prunelle.config.ts
import { defineConfig } from 'prunelle/config'

export default defineConfig({
  compliance: {
    publicBody: false,
    legalNotice: '/mentions-legales', // or false to disable lcen/legal-notice
    ignore: ['rgaa/img-alt'],
  },
})
```

```tsx
{/* prunelle-ignore rgaa/img-alt */}
<img src="/generated.png" />

// Or at the top of a file:
// prunelle-ignore-file rgpd/third-party-url
```

## One-declaration CNIL consent (`consent` & `<ConsentGate>`)

Declare your non-essential cookie and embed categories once in `prunelle.config.ts`. Prunelle wires everything automatically with **0 KB of browser JS**:

- A CSRF-protected `POST /_pru/consent` endpoint supporting both zero-JS HTML `<form>` posts (`303` redirect) and JSON (`200`).
- An `HttpOnly; SameSite=Lax` cookie (`pru_consent` by default, `180`-day CNIL retention).
- `ctx.consent` on every request (`decided`, `categories`, `has(category)`, `all()`).
- Automatic enforcement on `ctx.cookies.set(name, val, { category })`, refusing non-essential cookies until the visitor grants that category.
- Server-only `<ConsentGate category="..." fallback={...}>` (refused inside islands so third-party markup never leaks to the browser before consent).

```ts
// prunelle.config.ts
import { defineConfig } from 'prunelle/config'

export default defineConfig({
  consent: {
    categories: {
      analytics: 'Audience measurement',
      media: 'External video embeds',
    },
  },
})
```

```tsx
// src/routes/index.tsx
import type { PageProps, RouteContext } from 'prunelle'
import { ConsentGate } from 'prunelle'

export function load(ctx: RouteContext) {
  // Refused until the visitor grants 'analytics' consent
  ctx.cookies.set('visitor_id', 'v_123', { category: 'analytics' })
  return { decided: ctx.consent.decided }
}

export default function Home({ data }: PageProps<typeof load>) {
  return (
    <main>
      <ConsentGate category="media" fallback={<p>Accept media cookies to load this video.</p>}>
        <iframe src="https://video.example.com/embed/demo" title="Demo video" />
      </ConsentGate>

      {!data.decided && (
        <form method="post" action="/_pru/consent">
          <button type="submit" name="action" value="accept-all">Accept all</button>
          <button type="submit" name="action" value="reject-all">Reject all</button>
        </form>
      )}
    </main>
  )
}
```

Granular checkboxes (`<input type="checkbox" name="analytics" />`) work with the same zero-JS form, or send JSON `POST /_pru/consent` with `{ categories: { analytics: true, media: false } }`, `{ acceptAll: true }`, or `{ rejectAll: true }`.

For eco-design budgets and GreenIT EcoIndex scoring, see [Eco-design & RGESN](/docs/production/eco-design).
