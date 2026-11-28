---
title: Server Actions
description: Unified Standard-Schema server actions that work as zero-JS progressive HTML forms, useAction() island forms, and typed RPCs with CSRF and bot protection.
section: core
order: 4
---

Define server mutations once with `action(schema, handler, options?)` from `prunelle/server`. It accepts any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType, TypeBox, or custom).

## Defining an action

Declare every action as a **top-level named export** so Prunelle can assign it a stable URL and strip its server code from client bundles:

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

Actions taking no input can omit the schema: `export const signOut = action(async ctx => ctx.redirect('/'))`.

Inside the handler, `ctx` provides `request`, `url`, `params`, `cookies`, `locals`, `ip`, `requestId`, `redirect(location, status?)`, and `deny(status, message, fieldErrors?)`.

## Zero-JS progressive `<form>`

Pass the action directly to `<form action={savePreferences} method="post">`:

```tsx
import { getActionError } from 'prunelle/server'
import { savePreferences } from '../actions/preferences'

export default function SettingsPage({ locals }: { locals: Record<string, unknown> }) {
  const err = getActionError(locals)
  return (
    <form action={savePreferences} method="post">
      <input name="project" value={err?.values?.project ?? ''} />
      {err?.fieldErrors?.project && <p role="alert">{err.fieldErrors.project}</p>}
      <select name="target">
        <option value="binary">Single binary</option>
        <option value="static">Static HTML</option>
      </select>
      <button type="submit">Save</button>
    </form>
  )
}
```

No client JavaScript is shipped. Form fields are parsed, validated, and executed on the server:

- **Array fields**: Fields declared as arrays in your schema always arrive as arrays — even when zero or one checkbox is checked or one option is selected.
- **Validation error flash**: Failed HTML form submissions store `fieldErrors` and safe submitted `values` in a short-lived `HttpOnly` cookie and reply with a `303` redirect to the trusted `Referer`. Read and clear it on the next render with `getActionError(locals)`.
- **Sensitive fields**: Password, token, secret, card, and similar fields are stripped from flashed values automatically. Pass `{ flashFields: ['project', 'target'] }` as the third argument to `action()` for an explicit allowlist.

### Automatic HTML5 constraints & static checks (0 B JS)

When SSR renders `<form action={fn}>` (or an island `<form action={form.action}>` via `useAction(fn)`), Prunelle inspects `fn`'s Standard JSON Schema and automatically adds `required`, `minlength`/`maxlength`, `min`/`max`/`step`, `pattern`, and `type="email"|"url"|"number"` to matching `<input>`, `<select>`, and `<textarea>` controls whenever you did not already set that attribute.

`prunelle check` and `prunelle build` also catch unknown field names (suggesting the closest schema key), missing required schema fields, and `<select>` options outside a schema enum. Schema libraries without JSON Schema output emit one warning naming the library.

### Public form protection (`protect`)

Protect public forms (contact forms, sign-up, comments) without third-party CAPTCHAs by passing `protect` as the third argument to `action()` (or top-level `rateLimit` for rate limiting alone):

```ts
export const sendMessage = action(
  contactSchema,
  async (input) => { /* ... */ },
  {
    protect: {
      rateLimit: { max: 3, windowMs: 60_000 },
      honeypot: true,
      minTime: 1500,
    },
  },
)
```

Prunelle injects the hidden honeypot input and HMAC-signed `_pru_ts` timestamp inside `<form action={fn}>` automatically (**0 B** JS), rejecting bots or instant submits with `400` and rate-limit bursts with `429` + `Retry-After` (or flash + `303` for zero-JS forms) before the handler runs. `prunelle check` warns on unguarded public form actions without `protect`, and `testApp().submit(action, fields)` fills a clean honeypot and aged timestamp automatically in tests.

## Progressive island forms (`useAction`)

For inline pending states, field errors, and instant feedback inside an island — while still working before hydration or without JS — wire `useAction(fn, options?)` from `prunelle`:

```tsx
import { useAction } from 'prunelle'
import { savePreferences } from '../actions/preferences'

export function PreferencesForm() {
  const form = useAction(savePreferences, { reset: true })

  return (
    <form action={form.action} method="post" onSubmit={form.onSubmit}>
      <input name="project" />
      {form.fieldErrors.value.project && <p role="alert">{form.fieldErrors.value.project}</p>}
      <select name="target">
        <option value="binary">Single binary</option>
        <option value="static">Static HTML</option>
      </select>
      <button type="submit" disabled={form.pending.value}>
        {form.pending.value ? 'Saving…' : 'Save'}
      </button>
      {form.data.value && <p>Saved {form.data.value.project}</p>}
    </form>
  )
}
```

`useAction()` returns `{ pending, error, fieldErrors, data, action, onSubmit, submit, reset }`, where `pending`, `error`, `fieldErrors`, and `data` are `ReadonlySignal`s. You can also pass `onSuccess` and `onError` callbacks.

## Typed RPC from islands

You can also call any exported action directly as an async function from an island. Prunelle strips all server code and ships a tiny RPC stub:

```tsx
import { signal } from 'prunelle'
import { savePreferences } from '../actions/preferences'

export function QuickSave() {
  const status = signal('')
  const onSave = async () => {
    const res = await savePreferences({ project: 'orbit', target: 'binary' })
    status.value = res.ok ? `Saved ${res.data.project}` : res.error
  }
  return <button type="button" onClick={onSave}>{status.value || 'Save'}</button>
}
```

Every call resolves to an `ActionResult`: `{ ok: true, data }` or `{ ok: false, status, error, fieldErrors?, issues? }` (network failures return `status: 0`). Pass a `FormData` object to upload files. If the action returns a redirect, the browser navigates there.

## Calls from server code

A route, `load()`, middleware, or another action can call an action directly inside a request. It validates the input, runs the action's folder `_middleware.ts` chain, and returns the same `ActionResult`:

```ts
// src/routes/api/notes.ts
import type { RequestContext } from 'prunelle/server'
import { addNote } from '../../actions/notes'

export async function POST(ctx: RequestContext) {
  const res = await addNote({ title: 'From the API' })
  return res.ok ? ctx.json(res.data) : ctx.json(res, { status: res.status })
}
```

Calling an action outside an active request (at module top level or from a timer) throws and names the action. In tests, submit it with `app.submit(action, input)`.

## Middleware & CSRF order

Every action `POST` executes in this order:

1. **CSRF check** (`Origin` / `Sec-Fetch-Site`) — cross-site requests fail with `403` before middleware runs or the body is parsed.
2. **Body size limit** (`maxRequestBodySize`, default `1 MiB`) — oversized payloads fail with `413`.
3. **Middleware** — global plugin middleware, then `_middleware.ts` files in the action's directory chain.
4. **Protection, schema validation & handler**.

<Callout title="Behind a reverse proxy" tone="info">
Set `trustProxy: true` (or the hop count, such as `2` behind a CDN + nginx) in `prunelle.config.ts` so CSRF origin checks honor `X-Forwarded-Proto` and `X-Forwarded-Host`. See [Configuration & Security](/docs/core/configuration-and-security).
</Callout>
