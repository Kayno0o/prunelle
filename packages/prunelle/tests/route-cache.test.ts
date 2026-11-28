// Tests for Issue #6: `export const cache`, bounded SWR route cache, static cacheability inspection,
// `autoPrerender` / `--auto-prerender`, and private-read validation on cached routes.

import type { InspectReport } from '../src/cli/inspect'
import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from '../src/build/index'
import { checkProject } from '../src/cli/check'
import { formatInspectReport, inspectProject } from '../src/cli/inspect'
import { ACTION_ERROR_COOKIE } from '../src/server/action'
import { CompressionCache } from '../src/server/compress'
import { createServer } from '../src/server/index'
import { buildRouteCacheSpec, formatCacheSpec, parseCacheDuration, RouteCache } from '../src/server/route-cache'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const CLI = resolve(import.meta.dir, '../src/cli/index.ts')
const tempDirs: string[] = []

function makeApp(prefix: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  mkdirSync(join(dir, 'node_modules/@prunellejs'), { recursive: true })
  symlinkSync(join(REPO_ROOT, 'packages/prunelle'), join(dir, 'node_modules/prunelle'), 'dir')
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

async function runCli(args: string[], cwd: string): Promise<{ code: number, out: string, err: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, out, err }
}

afterAll(() => {
  for (const dir of tempDirs)
    rmSync(dir, { recursive: true, force: true })
})

describe('#6 cache duration parsing and export validation', () => {
  it('parses duration strings, seconds numbers, and builds Cache-Control headers', () => {
    expect(parseCacheDuration('500ms')).toBe(500)
    expect(parseCacheDuration('30s')).toBe(30_000)
    expect(parseCacheDuration('5m')).toBe(300_000)
    expect(parseCacheDuration('1h')).toBe(3_600_000)
    expect(parseCacheDuration('1d')).toBe(86_400_000)
    expect(parseCacheDuration(60)).toBe(60_000)
    expect(parseCacheDuration(0, true)).toBe(0)
    expect(parseCacheDuration(0, false)).toBeUndefined()
    expect(parseCacheDuration(-5)).toBeUndefined()
    expect(parseCacheDuration('forever')).toBeUndefined()

    const halfSec = buildRouteCacheSpec(500)
    expect(halfSec.cacheControl).toBe('public, s-maxage=1, stale-while-revalidate=1')
    expect(formatCacheSpec(halfSec)).toBe('500ms')

    const custom = buildRouteCacheSpec(3_600_000, 86_400_000)
    expect(custom.cacheControl).toBe('public, s-maxage=3600, stale-while-revalidate=86400')
    expect(formatCacheSpec(custom)).toBe('1h,swr=1d')
  })

  it('rejects invalid or runtime `export const cache` values in both check and build', async () => {
    const cases: [string, string][] = [
      ['export const cache = \'forever\'', 'invalid cache duration'],
      ['export const cache = 0', 'invalid cache duration'],
      ['export const cache = false', 'invalid cache export'],
      ['const ttl = \'1h\'; export const cache = ttl.trim()', 'cache set at runtime'],
      ['export const cache = {}', 'missing "maxAge"'],
      ['export const cache = { maxAge: \'1h\', foo: \'2h\' }', 'unknown cache option "foo"'],
      ['export const cache = { maxAge: \'1h\', swr: \'2h\', staleWhileRevalidate: \'3h\' }', 'not both'],
    ]

    for (const [decl, expected] of cases) {
      const dir = makeApp('prunelle-cache-invalid-', {
        'src/routes/index.tsx': `${decl}\nexport default function Home() { return <main>ok</main> }\n`,
      })
      const checked = await checkProject(dir, { skipTypecheck: true })
      expect(checked.ok).toBe(false)
      expect(checked.errors.some(e => e.includes(expected))).toBe(true)
      await expect(build({ root: dir, minify: false })).rejects.toThrow(expected)
    }
  })
})

describe('#6 RouteCache bounded LRU and SWR unit behavior', () => {
  it('enforces maxEntries and maxBytes LRU eviction (including compressed variants)', async () => {
    const spec = buildRouteCacheSpec(60_000)
    const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': spec.cacheControl }

    // 1. maxEntries LRU: touching /a keeps /a and evicts /b when /c arrives
    const byCount = new RouteCache({ maxEntries: 2, maxBytes: 1024 * 1024 })
    byCount.set('/a', '<p>a</p>', headers, spec, 1000)
    byCount.set('/b', '<p>b</p>', headers, spec, 1000)
    expect(byCount.lookup('/a', 1000)?.status).toBe('fresh')
    byCount.set('/c', '<p>c</p>', headers, spec, 1000)
    expect(byCount.size).toBe(2)
    expect(byCount.lookup('/a', 1000)?.status).toBe('fresh')
    expect(byCount.lookup('/b', 1000)).toBeUndefined()
    expect(byCount.lookup('/c', 1000)?.status).toBe('fresh')

    // 2. maxBytes LRU: storing entries and compressed variants never exceeds maxBytes
    const payload = `<main>${'hello prunelle route cache '.repeat(25)}</main>` // ~700 B
    const payloadBytes = Buffer.byteLength(payload, 'utf8')
    const maxBytes = Math.floor(payloadBytes * 1.5)
    const byBytes = new RouteCache({ maxEntries: 50, maxBytes })
    const compress = new CompressionCache()

    const e1 = byBytes.set('/one', payload, headers, spec, 1000)
    expect(e1).toBeDefined()
    expect(byBytes.bytes).toBe(payloadBytes)
    const res = byBytes.respondHit(e1!, new Request('http://localhost/one', { headers: { 'accept-encoding': 'zstd' } }), 'req-1', compress, 2500)
    expect(res.headers.get('age')).toBe('1')
    expect(res.headers.get('content-encoding')).toBe('zstd')
    expect(byBytes.bytes).toBeLessThanOrEqual(maxBytes)

    byBytes.set('/two', payload, headers, spec, 3000)
    expect(byBytes.bytes).toBeLessThanOrEqual(maxBytes)
    expect(byBytes.lookup('/one', 3000)).toBeUndefined()
    expect(byBytes.lookup('/two', 3000)?.status).toBe('fresh')

    // 3. Single oversized entry > maxBytes is skipped without wiping cache
    expect(byBytes.set('/huge', 'x'.repeat(maxBytes + 100), headers, spec, 3000)).toBeUndefined()
    expect(byBytes.lookup('/two', 3000)?.status).toBe('fresh')
  })

  it('transitions fresh -> stale -> expired, deduplicates revalidation, and catches errors cleanly', async () => {
    const spec = buildRouteCacheSpec(100, 200) // fresh [0..100), stale [100..300), expired >= 300
    const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': spec.cacheControl }
    const cache = new RouteCache()
    cache.set('/p', '<p>v1</p>', headers, spec, 1000)

    expect(cache.lookup('/p', 1050)?.status).toBe('fresh')
    expect(cache.lookup('/p', 1150)?.status).toBe('stale')

    let runs = 0
    const errors: unknown[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })

    expect(cache.revalidate('/p', async () => {
      runs++
      await gate
      throw new Error('bg-boom')
    }, err => errors.push(err))).toBe(true)
    // Deduplicated while in flight
    expect(cache.revalidate('/p', async () => { runs++ }, err => errors.push(err))).toBe(false)
    expect(cache.hasInflight('/p')).toBe(true)

    release()
    await Bun.sleep(15)
    expect(runs).toBe(1)
    expect(cache.hasInflight('/p')).toBe(false)
    expect(errors.length).toBe(1)
    expect((errors[0] as Error).message).toBe('bg-boom')

    // Expired entry is removed on lookup
    expect(cache.lookup('/p', 1300)).toBeUndefined()
    expect(cache.size).toBe(0)
  })
})

describe('#6 end-to-end `export const cache` on fast static and compiled routes', () => {
  it('serves cached static page on fast path with Cache-Control, Age, compression, and SWR revalidation', async () => {
    const dir = makeApp('prunelle-cache-fast-', {
      'src/counter.ts': 'export let renders = 0\nexport function bump() { return ++renders }\n',
      'src/routes/index.tsx': [
        'import { bump } from \'../counter\'',
        'export const cache = { maxAge: \'60ms\', staleWhileRevalidate: \'500ms\' }',
        'export default function Home() {',
        '  const n = bump()',
        '  return <main><h1>Render {n}</h1><p>{"payload ".repeat(60)}</p></main>',
        '}',
      ].join('\n'),
    })

    await build({ root: dir, minify: false })
    const app = await createServer({ root: dir })
    try {
      // 1. Cold miss: renders #1, sets Cache-Control, no Age on miss
      const r1 = await app.handle(new Request('http://localhost/'))
      expect(r1.status).toBe(200)
      expect(r1.headers.get('cache-control')).toBe('public, s-maxage=1, stale-while-revalidate=1')
      expect(r1.headers.get('age')).toBeNull()
      expect(await r1.text()).toContain('Render 1')

      // 2. Fresh hit (including compressed zstd & HEAD): still Render 1, Age present
      const r2 = await app.handle(new Request('http://localhost/', { headers: { 'accept-encoding': 'zstd' } }))
      expect(r2.status).toBe(200)
      expect(r2.headers.get('age')).toBe('0')
      expect(r2.headers.get('content-encoding')).toBe('zstd')
      const body2 = new TextDecoder().decode(Bun.zstdDecompressSync(new Uint8Array(await r2.arrayBuffer())))
      expect(body2).toContain('Render 1')

      const rHead = await app.handle(new Request('http://localhost/', { method: 'HEAD' }))
      expect(rHead.status).toBe(200)
      expect(rHead.headers.get('age')).toBe('0')
      expect(await rHead.text()).toBe('')

      // 3. Wait past maxAge (60ms) into SWR window: returns stale Render 1 immediately and refreshes in background
      await Bun.sleep(80)
      const [staleA, staleB] = await Promise.all([
        app.handle(new Request('http://localhost/')),
        app.handle(new Request('http://localhost/')),
      ])
      expect(await staleA.text()).toContain('Render 1')
      expect(await staleB.text()).toContain('Render 1')

      // 4. After background refresh completes, subsequent hit serves Render 2 (deduped to 1 bg render)
      await Bun.sleep(40)
      const rFresh = await app.handle(new Request('http://localhost/'))
      expect(await rFresh.text()).toContain('Render 2')
      expect(rFresh.headers.get('age')).toBe('0')

      // 5. Flash cookie and x-pru-region bypass the cache
      const rFlash = await app.handle(new Request('http://localhost/', {
        headers: { cookie: `${ACTION_ERROR_COOKIE}=1` },
      }))
      expect(rFlash.headers.get('age')).toBeNull()
      expect(await rFlash.text()).toContain('Render 3')
    }
    finally {
      await app.dispose?.()
    }
  })

  it('caches dynamic routes with load() and <Head> by full URL, skips in dev:true and routeCache:false, and never caches Set-Cookie', async () => {
    const dir = makeApp('prunelle-cache-dyn-', {
      'src/state.ts': 'export const counts = new Map<string, number>()\nexport function nextCount(k: string) { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n }\n',
      'src/routes/posts/[slug].tsx': [
        'import type { RouteContext } from \'prunelle/server\'',
        'import { Head } from \'prunelle\'',
        'import { nextCount } from \'../../state\'',
        'export const cache = \'1h\'',
        'export async function load(ctx: RouteContext<\'/posts/[slug]\'>) {',
        '  const key = `${ctx.params.slug}:${ctx.url.searchParams.get(\'v\') ?? \'0\'}`',
        '  return { slug: ctx.params.slug, n: nextCount(key) }',
        '}',
        'export default function Post({ data }: { data: { slug: string, n: number } }) {',
        '  return <article><Head><title>{data.slug}</title></Head><h1>{data.slug} #{data.n}</h1></article>',
        '}',
      ].join('\n'),
      'src/routes/cookie-mw/_middleware.ts': [
        'import type { Middleware } from \'prunelle/server\'',
        'const mw: Middleware = async (ctx, next) => { ctx.cookies.set(\'visited\', \'1\'); return next() }',
        'export default mw',
      ].join('\n'),
      'src/routes/cookie-mw/index.tsx': [
        'import { nextCount } from \'../../state\'',
        'export const cache = \'1h\'',
        'export default function CookieMwPage() {',
        '  return <main>Visit #{nextCount(\'mw\')}</main>',
        '}',
      ].join('\n'),
    })

    expect((await checkProject(dir, { skipTypecheck: true })).errors).toEqual([])
    await build({ root: dir, minify: false })

    // Production server: caches per slug & query string, never caches response with Set-Cookie
    const app = await createServer({ root: dir })
    try {
      const a1 = await app.handle(new Request('http://localhost/posts/alpha'))
      expect(a1.headers.get('cache-control')).toBe('public, s-maxage=3600, stale-while-revalidate=3600')
      expect(await a1.text()).toContain('alpha #1')

      const a2 = await app.handle(new Request('http://localhost/posts/alpha'))
      expect(a2.headers.get('age')).toBe('0')
      expect(await a2.text()).toContain('alpha #1')

      const aQuery = await app.handle(new Request('http://localhost/posts/alpha?v=2'))
      expect(aQuery.headers.get('age')).toBeNull()
      expect(await aQuery.text()).toContain('alpha #1')

      const b1 = await app.handle(new Request('http://localhost/posts/beta'))
      expect(await b1.text()).toContain('beta #1')

      // Middleware sets cookie -> response MUST NOT be cached
      const c1 = await app.handle(new Request('http://localhost/cookie-mw'))
      expect(c1.headers.getSetCookie()[0]).toContain('visited=1')
      expect(await c1.text()).toContain('Visit #1')
      const c2 = await app.handle(new Request('http://localhost/cookie-mw'))
      expect(c2.headers.get('age')).toBeNull()
      expect(await c2.text()).toContain('Visit #2')
    }
    finally {
      await app.dispose?.()
    }

    // dev: true skips caching
    const devApp = await createServer({ root: dir, dev: true })
    try {
      const d1 = await devApp.handle(new Request('http://localhost/posts/devcheck'))
      const d2 = await devApp.handle(new Request('http://localhost/posts/devcheck'))
      expect(await d1.text()).toContain('devcheck #1')
      expect(await d2.text()).toContain('devcheck #2')
      expect(d2.headers.get('age')).toBeNull()
    }
    finally {
      await devApp.dispose?.()
    }

    // routeCache: false skips caching
    const disabledApp = await createServer({ root: dir, routeCache: false })
    try {
      const x1 = await disabledApp.handle(new Request('http://localhost/posts/off'))
      const x2 = await disabledApp.handle(new Request('http://localhost/posts/off'))
      expect(await x1.text()).toContain('off #1')
      expect(await x2.text()).toContain('off #2')
    }
    finally {
      await disabledApp.dispose?.()
    }
  })
})

describe('#6 private-read validation on cached routes (check + build parity)', () => {
  const cases: { name: string, files: Record<string, string>, expectedFile: string, expectedText: string }[] = [
    {
      name: 'load(ctx) reading ctx.cookies',
      files: {
        'src/routes/index.tsx': [
          'import type { RequestContext } from \'prunelle/server\'',
          'export const cache = \'1h\'',
          'export async function load(ctx: RequestContext) {',
          '  return { sid: ctx.cookies.get(\'sid\') }',
          '}',
          'export default function Home({ data }: { data: { sid?: string } }) { return <p>{data.sid}</p> }',
        ].join('\n'),
      },
      expectedFile: 'src/routes/index.tsx:4:',
      expectedText: 'cached route reads ctx.cookies',
    },
    {
      name: 'load({ cookies }) destructuring cookies',
      files: {
        'src/routes/index.tsx': [
          'import type { RequestContext } from \'prunelle/server\'',
          'export const cache = \'1h\'',
          'export async function load({ cookies }: RequestContext) {',
          '  return { sid: cookies.get(\'sid\') }',
          '}',
          'export default function Home({ data }: { data: { sid?: string } }) { return <p>{data.sid}</p> }',
        ].join('\n'),
      },
      expectedFile: 'src/routes/index.tsx:3:',
      expectedText: 'cached route reads cookies',
    },
    {
      name: 'load(ctx) reading ctx.locals',
      files: {
        'src/routes/index.tsx': [
          'import type { RequestContext } from \'prunelle/server\'',
          'export const cache = \'1h\'',
          'export async function load(ctx: RequestContext) {',
          '  return { u: ctx.locals }',
          '}',
          'export default function Home() { return <p>hi</p> }',
        ].join('\n'),
      },
      expectedFile: 'src/routes/index.tsx:4:',
      expectedText: 'cached route reads ctx.locals',
    },
    {
      name: 'load(ctx) reading request.headers.get(\'cookie\')',
      files: {
        'src/routes/index.tsx': [
          'import type { RequestContext } from \'prunelle/server\'',
          'export const cache = \'1h\'',
          'export async function load(ctx: RequestContext) {',
          '  return { raw: ctx.request.headers.get(\'Cookie\') }',
          '}',
          'export default function Home() { return <p>hi</p> }',
        ].join('\n'),
      },
      expectedFile: 'src/routes/index.tsx:4:',
      expectedText: 'request.headers.get(\'cookie\')',
    },
    {
      name: 'page component reading locals',
      files: {
        'src/routes/index.tsx': [
          'import type { PageProps } from \'prunelle/server\'',
          'export const cache = \'1h\'',
          'export default function Home({ locals }: PageProps) {',
          '  return <p>{String(Boolean(locals))}</p>',
          '}',
        ].join('\n'),
      },
      expectedFile: 'src/routes/index.tsx:3:',
      expectedText: 'cached route reads locals',
    },
    {
      name: 'ancestor _layout.tsx reading locals',
      files: {
        'src/routes/_layout.tsx': [
          'import type { LayoutProps } from \'prunelle/server\'',
          'export default function Layout({ children, locals }: LayoutProps) {',
          '  return <div>{Boolean(locals) ? \'in\' : \'out\'}{children}</div>',
          '}',
        ].join('\n'),
        'src/routes/pricing.tsx': [
          'export const cache = \'1h\'',
          'export default function Pricing() { return <main>Pricing</main> }',
        ].join('\n'),
      },
      expectedFile: 'src/routes/_layout.tsx:2:',
      expectedText: 'inherits layout reading locals',
    },
  ]

  for (const tc of cases) {
    it(`rejects ${tc.name} in both prunelle check and prunelle build`, async () => {
      const dir = makeApp('prunelle-cache-private-', tc.files)
      const checked = await checkProject(dir, { skipTypecheck: true })
      expect(checked.ok).toBe(false)
      expect(checked.errors.some(e => e.startsWith(tc.expectedFile) && e.includes(tc.expectedText))).toBe(true)
      await expect(build({ root: dir, minify: false })).rejects.toThrow(tc.expectedText)
    })
  }
})

describe('#6 static cacheability inspection and autoPrerender / --auto-prerender', () => {
  it('accurately detects cacheable vs non-cacheable routes in inspect and auto-prerenders eligible ones', async () => {
    const dir = makeApp('prunelle-cacheability-', {
      'src/components/Counter.tsx': [
        'import { signal } from \'prunelle\'',
        'export function Counter() {',
        '  const n = signal(0)',
        '  return <button type="button" onClick={() => { n.value = Date.now() }}>{n.value}</button>',
        '}',
      ].join('\n'),
      'src/components/LiveYear.tsx': [
        'export function LiveYear() { return <footer>{new Date().getFullYear()}</footer> }',
      ].join('\n'),
      'src/routes/_layout.tsx': [
        'import type { PrunelleChild } from \'prunelle\'',
        'export default function Layout({ children }: { children: PrunelleChild }) { return <main>{children}</main> }',
      ].join('\n'),
      // Cacheable static page with island & fixed Date literal
      'src/routes/about.tsx': [
        'import { Counter } from \'../components/Counter\'',
        'const founded = new Date(\'2025-01-01\').getUTCFullYear()',
        'export default function About() { return <section><h1>About {founded}</h1><Counter /></section> }',
      ].join('\n'),
      // Cacheable static page with explicit `export const cache` (autoPrerender should NOT prerender it)
      'src/routes/cached.tsx': [
        'export const cache = \'30m\'',
        'export default function Cached() { return <section><h1>Cached</h1></section> }',
      ].join('\n'),
      // Explicitly opted out via `prerender = false`
      'src/routes/no-pre.tsx': [
        'export const prerender = false',
        'export default function NoPre() { return <section><h1>NoPre</h1></section> }',
      ].join('\n'),
      // Reads `url`
      'src/routes/reads-url.tsx': [
        'import type { PageProps } from \'prunelle/server\'',
        'export default function ReadsUrl({ url }: PageProps) { return <p>{url.pathname}</p> }',
      ].join('\n'),
      // Imports local non-island reading clock `new Date()`
      'src/routes/reads-clock.tsx': [
        'import { LiveYear } from \'../components/LiveYear\'',
        'export default function ReadsClock() { return <section><LiveYear /></section> }',
      ].join('\n'),
      // Has `load()`
      'src/routes/with-load.tsx': [
        'export async function load() { return { ok: true } }',
        'export default function WithLoad({ data }: { data: { ok: boolean } }) { return <p>{String(data.ok)}</p> }',
      ].join('\n'),
      // Under `_middleware.ts`
      'src/routes/guarded/_middleware.ts': [
        'import type { Middleware } from \'prunelle/server\'',
        'const mw: Middleware = (_ctx, next) => next()',
        'export default mw',
      ].join('\n'),
      'src/routes/guarded/index.tsx': 'export default function Guarded() { return <p>guarded</p> }\n',
      // Dynamic route
      'src/routes/items/[id].tsx': 'export default function Item() { return <p>item</p> }\n',
    })

    const report: InspectReport = await inspectProject(dir)
    const byPath = new Map(report.routes.map(r => [r.path, r]))

    expect(byPath.get('/about')?.cacheable).toBe(true)
    expect(byPath.get('/cached')?.cacheable).toBe(true)
    expect(byPath.get('/cached')?.cache).toEqual({
      maxAgeMs: 1_800_000,
      swrMs: 1_800_000,
      cacheControl: 'public, s-maxage=1800, stale-while-revalidate=1800',
    })
    expect(byPath.get('/no-pre')?.cacheable).toBeUndefined()
    expect(byPath.get('/reads-url')?.cacheable).toBeUndefined()
    expect(byPath.get('/reads-clock')?.cacheable).toBeUndefined()
    expect(byPath.get('/with-load')?.cacheable).toBeUndefined()
    expect(byPath.get('/guarded')?.cacheable).toBeUndefined()
    expect(byPath.get('/items/:id')?.cacheable).toBeUndefined()

    const text = formatInspectReport(report)
    expect(text).toContain('/about  src/routes/about.tsx  cacheable')
    expect(text).toContain('/cached  src/routes/cached.tsx  cache=30m  cacheable')

    // Build with CLI `--auto-prerender`: only `/about` gets auto-prerendered
    const cli = await runCli(['build', '--auto-prerender'], dir)
    expect(cli.code).toBe(0)
    expect(existsSync(join(dir, 'dist/prerendered/about/index.html'))).toBe(true)
    expect(existsSync(join(dir, 'dist/prerendered/cached/index.html'))).toBe(false)
    expect(existsSync(join(dir, 'dist/prerendered/no-pre/index.html'))).toBe(false)
    expect(existsSync(join(dir, 'dist/prerendered/reads-url/index.html'))).toBe(false)
    expect(existsSync(join(dir, 'dist/prerendered/reads-clock/index.html'))).toBe(false)
    expect(existsSync(join(dir, 'dist/prerendered/with-load/index.html'))).toBe(false)
    expect(existsSync(join(dir, 'dist/prerendered/guarded/index.html'))).toBe(false)

    // Also works via `prunelle.config.ts` `autoPrerender: true`
    writeFileSync(join(dir, 'prunelle.config.ts'), 'export default { autoPrerender: true }\n')
    const manifest = await build({ root: dir, minify: false })
    const mByPath = new Map(manifest.routes.map(r => [r.path, r]))
    expect(mByPath.get('/about')?.prerender).toBe(true)
    expect(mByPath.get('/about')?.prerendered).toEqual({ '/about': 'prerendered/about/index.html' })
    expect(mByPath.get('/cached')?.prerender).toBe(false)
    expect(mByPath.get('/cached')?.cache?.maxAgeMs).toBe(1_800_000)
    expect(mByPath.get('/no-pre')?.prerender).toBe(false)
  })
})
