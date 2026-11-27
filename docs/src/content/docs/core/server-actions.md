---
title: Server Actions
description: Unified Standard-Schema server actions that work as zero-JS progressive HTML forms and typed island RPCs with built-in CSRF protection and error flash.
section: core
order: 4
---

Define server mutations once with `action(schema, handler)` from `prunelle/server`. It accepts any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType, TypeBox, or custom).

## Defining an action

Declare every action as a **top-level named export** so Prunelle can assign it a stable endpoint URL and strip its server code from client bundles:

```ts
// src/actions/preferences.ts
import { action } from 'prunelle/server'
import { z } from 'zod'

export const savePreferences = action(
  z.object({
    project: z.string().min(1),
    target: z.enum(['binary', 'static']),
  }),
  async (input, ctx) => {
    if (!ctx.locals.user)
      return ctx.deny(401, 'Sign in required')
    await db.save(ctx.locals.user.id, input)
    return { saved: true, project: input.project }
  },
)
```

Actions that take no input can omit the schema: `export const signOut = action(async (ctx) => ctx.redirect('/'))`.

Inside the handler, `ctx` provides `request`, `url`, `params`, `cookies`, `locals`, `ip`, `redirect(location, status?)`, and `deny(status, message, fieldErrors?)`.

## 1. Zero-JS progressive `<form>`

Pass the action directly to `<form action={savePreferences} method="post">`:

```tsx
import { getActionError } from 'prunelle/server'
import { savePreferences } from '../actions/preferences'

export default function SettingsPage({ locals }: { locals: Record<string, unknown> }) {
  const err = getActionError(locals)
  return (
    <form action={savePreferences} method="post">
      <input name="project" value={err?.values?.project ?? ''} required />
      {err?.fieldErrors?.project && <p>{err.fieldErrors.project}</p>}
      <select name="target">
        <option value="binary">Single binary</option>
        <option value="static">Static HTML</option>
      </select>
      <button type="submit">Save</button>
    </form>
  )
}
```

No client JavaScript is shipped. Form fields are parsed, validated, and executed on the server.

- **Array fields**: A field your schema declares as an array always arrives as one — including a checkbox group with zero or one box checked, or a multi-select with a single choice. When a non-JSON form submit fails with a top-level array or missing-field mismatch, Prunelle retries validation once with those fields wrapped as arrays, so keep async schema refinements side-effect free if the same form also contains array fields.
- **Validation error flash**: When a plain HTML form fails validation, Prunelle stores `fieldErrors` and safe submitted `values` in a short-lived `HttpOnly` cookie and responds with a `303` redirect back to the trusted `Referer`. Read and clear it on the next render with `getActionError(locals)`.
- **Sensitive fields**: Password, token, secret, card, and similar fields are stripped from flashed values automatically. Pass `{ flashFields: ['project', 'target'] }` as the third argument to `action()` to specify an explicit allowlist.
- **Automatic HTML5 constraints & static field checks (0 B JS)**: When SSR renders `<form action={fn}>` (or an island `<form action={form.action}>` via `useAction(fn)`), Prunelle reads JSON Schema from `fn`'s Standard Schema and adds `required`, `minlength`/`maxlength`, `min`/`max`/`step`, `pattern`, and `type="email"|"url"|"number"` to matching `<input>`, `<select>`, and `<textarea>` controls (including `tags[]` arrays, `a.b` nested fields, and fields inside child components) whenever you did not already specify that attribute. `prunelle check` and `prunelle build` also catch unknown form field names (suggesting the closest schema field), missing required schema fields, and `<select>` options outside a schema enum; schema libraries without JSON Schema output are skipped with one warning naming the library.
- **Public form protection (`protect`)**: Pass `{ protect: { rateLimit: { max: 3, windowMs: 60_000 }, honeypot: true, minTime: 1500 } }` as the third argument to `action()` (or top-level `rateLimit` for rate limiting alone) to protect public forms with zero third-party CAPTCHAs. Prunelle renders the hidden honeypot input and HMAC-signed `_pru_ts` timestamp inside `<form action={fn}>` automatically (0 B JS) and refuses bots or too-fast submits with `400` and excessive submits with `429` + `Retry-After` (or flash + `303` redirect for zero-JS forms) before your handler runs. `prunelle check` warns on a form action rendered on a page with no `_middleware.ts` guard and no `protect`. `testApp().submit(action, fields)` supplies a clean honeypot and aged timestamp automatically so tests need no workaround.

## 2. Typed RPC from islands

Import and call the exact same export from an interactive island. Prunelle strips all server code and replaces it with a tiny RPC stub in the client bundle:

```tsx
import { signal } from 'prunelle'
import { savePreferences } from '../actions/preferences'

export function QuickSave() {
  const status = signal('')
  const onSave = async () => {
    const res = await savePreferences({ project: 'orbit', target: 'binary' })
    status.value = res.ok ? `Saved ${res.data.project}` : res.error
  }
  return <button onClick={onSave}>{status.value || 'Save'}</button>
}
```

The call always resolves to an `ActionResult`: `{ ok: true, data }` or `{ ok: false, status, error, fieldErrors?, issues? }`. A network failure returns `{ ok: false, status: 0, error }`. Pass a `FormData` object to upload files. If the action returns a redirect, the browser navigates there and the promise never resolves.

## 3. Calls from server code

A route, a `load()`, a middleware or another action can call an action directly. The call runs in the current request: it validates its input, runs the `_middleware.ts` chain of the action's folder, and resolves to the same `ActionResult`.

```ts
// src/routes/api/notes.ts
import type { RequestContext } from 'prunelle/server'
import { addNote } from '../../actions/notes'

export async function POST(ctx: RequestContext) {
  const res = await addNote({ title: 'From the API' })
  return res.ok ? ctx.json(res.data) : ctx.json(res, { status: res.status })
}
```

Called outside a request, at a module's top level or from a timer, the action throws and names itself. In a test, submit it with `app.submit(action, input)`.

## Middleware & CSRF order

Every action `POST` runs in this order:

1. **CSRF check** (`Origin` / `Sec-Fetch-Site`) — cross-site requests fail with `403` before any middleware runs or the body is read.
2. **Body size limit** (`maxRequestBodySize`, default `1 MiB`) — oversized payloads fail with `413`.
3. **Middleware** — global plugin middleware, then any `_middleware.ts` files in the action's directory chain.
4. **Schema validation & handler**.

<Callout title="Behind a reverse proxy" tone="info">
Set `trustProxy: true` (or the hop count, such as `2` behind a CDN + nginx) in `prunelle.config.ts` so CSRF origin checks honor `X-Forwarded-Proto` and `X-Forwarded-Host`. See [Configuration & Security](/docs/core/configuration-and-security).
</Callout>
