---
title: Streaming & Head
description: Document <Head> metadata collection, <Suspense> streaming SSR with 0 KB external JS, error/timeout handling, and <Catch> error boundaries.
section: core
order: 5
---

## Document `<Head>`

Place `<Head>` anywhere inside a layout or page. Prunelle collects all tags during SSR and hoists them into `<head>`. When multiple `<title>` tags render, the innermost page `<title>` wins:

```tsx
import { Head } from 'prunelle'

export default function AboutPage() {
  return (
    <>
      <Head>
        <title>About</title>
        <meta name="description" content="About our app" />
      </Head>
      <h1>About</h1>
    </>
  )
}
```

## Streaming `<Suspense>`

Wrap a slow `async` server component in `<Suspense fallback={...}>` to send the HTML shell immediately and stream the resolved chunk inline with **0 KB** of external JavaScript:

```tsx
import { Suspense } from 'prunelle'

async function LiveStats() {
  const stats = await fetchSlowAnalytics()
  return <p>{stats.visitors} visitors today</p>
}

export default function Dashboard() {
  return (
    <main>
      <h1>Dashboard</h1>
      <Suspense fallback={<p>Loading stats…</p>} error={<p>Stats unavailable.</p>}>
        <LiveStats />
      </Suspense>
    </main>
  )
}
```

- **One child per boundary**: Give each `<Suspense>` a single child (use one `<Suspense>` per async component). An async component renders only as that direct child; placing one anywhere else — even inside an `async` page — fails `prunelle build` and `prunelle check` with its file and line. Nested `<Suspense>` boundaries stream as well.
- **Error handling**: If the child throws, the boundary renders its `error` prop (markup or `(err) => Html`) in place of the fallback, the rest of the page keeps streaming, and `onError` in `prunelle.config.ts` is notified. Without `error`, a failed boundary renders nothing.
- **Timeout**: A boundary that does not resolve within `30` seconds fails so the response always finishes. Tune the limit with `streamTimeout` (in milliseconds) in `prunelle.config.ts`.
- **Compression**: Streamed responses compress in zstd or gzip and flush after each chunk, so the shell still arrives immediately.

## Catching errors with `<Catch>`

`<Catch>` renders its `fallback` in place of children that throw, keeping the rest of the page intact:

```tsx
import { Catch } from 'prunelle'

export default function Product({ product }) {
  return (
    <main>
      <h1>{product.name}</h1>
      <Catch fallback={<p>Reviews are unavailable right now.</p>}>
        <Reviews productId={product.id} />
      </Catch>
    </main>
  )
}
```

- **On the server**: A child that throws (or an awaited child that rejects) renders the fallback and notifies `onError`. Unlike `<Suspense>`, nothing streams — wrap async components in `<Suspense error={...}>` when you want streaming.
- **In an island**: `<Catch>` works on the client too, catching both render errors and child effect errors that throw later. Write it as a JSX tag (`<Catch>`), never as a direct function call. A function fallback receives `(error, retry)` so the visitor can re-render the subtree:

```tsx
<Catch fallback={(error, retry) => <button type="button" onClick={retry}>Reload the chart</button>}>
  <Chart points={points.value} />
</Catch>
```

- **Event handlers**: Errors thrown inside `onClick` or other event handlers are not caught by `<Catch>`; handle them in the handler itself.

For `defineEnv()`, cookies, and security headers, see [Configuration & Security](/docs/core/configuration-and-security). For RGAA/RGPD checks and `<ConsentGate>`, see [Compliance & Consent](/docs/core/compliance-and-consent).
