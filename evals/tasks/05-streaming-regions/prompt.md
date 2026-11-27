# Task 05: Streaming Suspense & Partial Region Swaps

Build a searchable article/library catalog page at `/` that combines streaming `<Suspense>` with `<Region>` partial HTML swaps using `@prunelle/spa` (`regions()`).

## Requirements

1. **Plugin Setup (`prunelle.config.ts`)**:
   - Register `regions()` from `@prunelle/spa` in `prunelle.config.ts`.

2. **Search & Detail Page (`src/routes/index.tsx`)**:
   - Have a dataset of at least 5 items (each with `id`, `title`, `category`, `summary`), including clearly distinct searchable titles (for example containing words like `Signals`, `Streaming`, `Regions`, `Actions`, `Auth`).
   - Render a `<form method="get" data-pru-target="results" data-pru-live>` with `<input name="q" value={q} data-pru-sync />` and a submit `<button type="submit">` so it works with and without JS.
   - Render category or item filter links `<a href="/?q=..." data-pru-target="results">`.
   - Wrap the dynamic results pane in `<Region name="results" aria-label="Search results">` (from `prunelle`).
   - Inside `<Region name="results">`, wrap an async server component (e.g. `<AsyncResults query={q} />` that awaits a small async lookup) in `<Suspense fallback={<p>Loading results…</p>}>` so the results stream cleanly.
   - Set `<Head><title>...</title></Head>` reflecting the active query.

3. **Verification**:
   - `prunelle check` and `prunelle build --analyze --max-js 15kb` pass.
   - `GET /` returns full HTML (`<!DOCTYPE html>`) with `data-pru-region="results"` and streamed items.
   - `GET /?q=<term>` works without JS (full HTML with filtered items).
   - `GET /?q=<term>` with header `x-pru-region: results` returns only the region HTML (no `<!DOCTYPE html>`), sets `Vary: x-pru-region`, and includes the filtered results.
