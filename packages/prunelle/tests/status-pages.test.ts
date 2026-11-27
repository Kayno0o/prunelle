// Tests for issue #2: HTML `ctx.deny()` and nested `_404`, `_error`, `_401`, `_403`, `_429`, `_503` status pages.

import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../src/build/index'
import { checkProject } from '../src/cli/check'
import { testApp } from '../src/test/index'

const PRUNELLE_PKG_DIR = join(import.meta.dir, '..')
const tempDirs: string[] = []

function makeApp(prefix: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  symlinkSync(PRUNELLE_PKG_DIR, join(dir, 'node_modules/prunelle'), 'dir')
  for (const [file, content] of Object.entries(files)) {
    const abs = join(dir, file)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

afterAll(() => {
  for (const dir of tempDirs)
    rmSync(dir, { recursive: true, force: true })
})

const HTML_ACCEPT = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }

describe('HTML ctx.deny() and status pages _401/_403/_429/_503 (#2)', () => {
  it('renders dedicated status pages for HTML requests, falls back to _error.tsx, and returns JSON for API/JSON callers', async () => {
    const root = makeApp('prunelle-status-pages-', {
      'src/routes/_layout.tsx': `
        export default function RootLayout({ children }: { children: unknown }) {
          return <div data-shell="root">{children}</div>
        }
      `,
      'src/routes/_401.tsx': `
        import type { StatusPageProps } from 'prunelle/server'
        export default function Unauth({ status, message, url }: StatusPageProps) {
          return <main data-status="401"><h1>Auth {status}</h1><p>{message}</p><span>{url.pathname}</span></main>
        }
      `,
      'src/routes/_403.tsx': `
        import type { StatusPageProps } from 'prunelle/server'
        export default function Forbidden({ status, message, locals }: StatusPageProps) {
          return <main data-status="403"><h1>Denied {status}</h1><p>{message}</p><span>{String(locals.role ?? '')}</span></main>
        }
      `,
      'src/routes/_429.tsx': `
        import type { StatusPageProps } from 'prunelle/server'
        export default function TooMany({ status, message }: StatusPageProps) {
          return <main data-status="429"><h1>Slow down {status}</h1><p>{message}</p></main>
        }
      `,
      'src/routes/_error.tsx': `
        export default function RootError({ error, status, message }: { error: unknown, status?: number, message?: string }) {
          return <main data-error="root"><h1>Error {status ?? 500}</h1><p>{message ?? (error instanceof Error ? error.message : String(error))}</p></main>
        }
      `,
      // Fast-path static page calling ctx.deny in load()
      'src/routes/static-deny.tsx': `
        import type { RequestContext } from 'prunelle/server'
        export function load(ctx: RequestContext) {
          const code = Number(ctx.url.searchParams.get('code') ?? '403')
          return ctx.deny(code, 'Static load denied')
        }
        export default function StaticDeny() { return <p>never</p> }
      `,
      // Dynamic route with middleware calling ctx.deny()
      'src/routes/protected/_middleware.ts': `
        import type { Middleware } from 'prunelle/server'
        const mw: Middleware = ctx => {
          ctx.locals.role = 'guest'
          if (ctx.url.searchParams.get('mode') === '401')
            return ctx.deny(401, 'Sign in first')
          if (ctx.url.searchParams.get('mode') === '429')
            return ctx.deny(429, 'Rate limit exceeded')
          if (ctx.url.searchParams.get('mode') === '503')
            return ctx.deny(503, 'Maintenance mode')
          return ctx.deny(403, 'Admins only')
        }
        export default mw
      `,
      'src/routes/protected/index.tsx': `
        export default function Protected() { return <p>secret</p> }
      `,
      // API route calling ctx.deny() stays JSON even with Accept: text/html
      'src/routes/api/secret.ts': `
        import type { RequestContext } from 'prunelle/server'
        export function GET(ctx: RequestContext) {
          return ctx.deny(403, 'API forbidden')
        }
      `,
    })

    const app = await testApp({ root })

    // 1. Static fast-path load() ctx.deny(403) -> renders _403.tsx wrapped in _layout.tsx for HTML
    const staticHtml = await app.get('/static-deny?code=403', HTML_ACCEPT)
    expect(staticHtml.status).toBe(403)
    expect(staticHtml.headers.get('content-type')).toContain('text/html')
    const staticBody = await staticHtml.text()
    expect(staticBody).toContain('data-shell="root"')
    expect(staticBody).toContain('data-status="403"')
    expect(staticBody).toContain('Static load denied')

    // 2. Same route with JSON or no Accept header -> JSON response
    const staticJson = await app.get('/static-deny?code=403', { accept: 'application/json' })
    expect(staticJson.status).toBe(403)
    expect(await staticJson.json()).toEqual({ ok: false, status: 403, error: 'Static load denied' })

    const staticDefault = await app.get('/static-deny?code=403')
    expect(staticDefault.status).toBe(403)
    expect(await staticDefault.json()).toEqual({ ok: false, status: 403, error: 'Static load denied' })

    // 3. Middleware ctx.deny(401/403/429) renders dedicated status page with locals & url
    const r401 = await app.get('/protected?mode=401', HTML_ACCEPT)
    expect(r401.status).toBe(401)
    const b401 = await r401.text()
    expect(b401).toContain('data-status="401"')
    expect(b401).toContain('Sign in first')
    expect(b401).toContain('/protected')

    const r403 = await app.get('/protected', HTML_ACCEPT)
    expect(r403.status).toBe(403)
    const b403 = await r403.text()
    expect(b403).toContain('data-status="403"')
    expect(b403).toContain('Admins only')
    expect(b403).toContain('guest')

    const r429 = await app.get('/protected?mode=429', HTML_ACCEPT)
    expect(r429.status).toBe(429)
    expect(await r429.text()).toContain('Slow down 429')

    // 4. Without _503.tsx, ctx.deny(503) falls back to _error.tsx with HTTP 503
    const r503 = await app.get('/protected?mode=503', HTML_ACCEPT)
    expect(r503.status).toBe(503)
    const b503 = await r503.text()
    expect(b503).toContain('data-error="root"')
    expect(b503).toContain('Error 503')
    expect(b503).toContain('Maintenance mode')

    // 5. Ancestor middleware on an unmatched URL under /protected/* also renders HTML status page
    const missingUnderProtected = await app.get('/protected/missing', HTML_ACCEPT)
    expect(missingUnderProtected.status).toBe(403)
    expect(await missingUnderProtected.text()).toContain('data-status="403"')

    // 6. API route calling ctx.deny() keeps JSON
    const apiRes = await app.get('/api/secret', HTML_ACCEPT)
    expect(apiRes.status).toBe(403)
    expect(await apiRes.json()).toEqual({ ok: false, status: 403, error: 'API forbidden' })
  })

  it('renders a clean minimal escaped HTML status page with CSP when neither _<status>.tsx nor _error.tsx exists', async () => {
    const root = makeApp('prunelle-minimal-deny-', {
      'src/routes/blocked.tsx': `
        import type { RequestContext } from 'prunelle/server'
        export function load(ctx: RequestContext) {
          return ctx.deny(403, '<script>alert(1)</script> forbidden')
        }
        export default function Blocked() { return <p>x</p> }
      `,
    })

    const app = await testApp({ root })
    const res = await app.get('/blocked', HTML_ACCEPT)
    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    const html = await res.text()
    expect(html).toContain('<h1>403</h1>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; forbidden')
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})

describe('Nested _404, _error, and status pages + static export + validation (#2)', () => {
  it('resolves nearest nested _404, _error, and _403 across subfolders, dynamic folders, and (group) folders with their layout chain', async () => {
    const root = makeApp('prunelle-nested-status-', {
      'src/routes/_layout.tsx': `
        export default function RootLayout({ children }: { children: unknown }) {
          return <div data-layout="root">{children}</div>
        }
      `,
      'src/routes/_404.tsx': `
        export default function Root404() { return <p>Root 404</p> }
      `,
      'src/routes/_error.tsx': `
        export default function RootError({ error }: { error: unknown }) {
          return <p>Root Error: {error instanceof Error ? error.message : String(error)}</p>
        }
      `,
      'src/routes/admin/_layout.tsx': `
        export default function AdminLayout({ children }: { children: unknown }) {
          return <section data-layout="admin">{children}</section>
        }
      `,
      'src/routes/admin/_404.tsx': `
        export default function Admin404() { return <p>Admin 404</p> }
      `,
      'src/routes/admin/_error.tsx': `
        export default function AdminError({ error }: { error: unknown }) {
          return <p>Admin Error: {error instanceof Error ? error.message : String(error)}</p>
        }
      `,
      'src/routes/admin/_503.tsx': `
        export default function Admin503({ message }: { message: string }) {
          return <p>Admin 503: {message}</p>
        }
      `,
      'src/routes/admin/index.tsx': `
        export default function AdminHome() { return <p>Admin Home</p> }
      `,
      'src/routes/admin/crash.tsx': `
        export default function AdminCrash() { throw new Error('admin boom') }
      `,
      'src/routes/admin/down.tsx': `
        import type { RequestContext } from 'prunelle/server'
        export function load(ctx: RequestContext) { return ctx.deny(503, 'DB migrating') }
        export default function Down() { return <p>never</p> }
      `,
      'src/routes/blog/[slug]/_error.tsx': `
        export default function BlogSlugError({ error, params }: { error: unknown, params: { slug?: string } }) {
          return <p>Blog Error ({params.slug}): {error instanceof Error ? error.message : String(error)}</p>
        }
      `,
      'src/routes/blog/[slug]/index.tsx': `
        export default function BlogPost() { throw new Error('post boom') }
      `,
      'src/routes/(panel)/_layout.tsx': `
        export default function PanelLayout({ children }: { children: unknown }) {
          return <aside data-layout="panel">{children}</aside>
        }
      `,
      'src/routes/(panel)/_403.tsx': `
        export default function Panel403({ message }: { message: string }) {
          return <p>Panel 403: {message}</p>
        }
      `,
      'src/routes/(panel)/_404.tsx': `
        export default function Panel404() { return <p>Panel 404</p> }
      `,
      'src/routes/(panel)/settings.tsx': `
        import type { RequestContext } from 'prunelle/server'
        import { notFound } from 'prunelle/server'
        export function load(ctx: RequestContext) {
          if (ctx.url.searchParams.get('miss') === '1')
            return notFound()
          return ctx.deny(403, 'Panel locked')
        }
        export default function Settings() { return <p>settings</p> }
      `,
    })

    const app = await testApp({ root })

    // Root 404 wins for root unmatched paths (does NOT leak `(panel)/_404.tsx`)
    const root404 = await app.get('/nowhere')
    expect(root404.status).toBe(404)
    const root404Html = await root404.text()
    expect(root404Html).toContain('Root 404')
    expect(root404Html).toContain('data-layout="root"')
    expect(root404Html).not.toContain('data-layout="panel"')

    // Nested admin/_404.tsx wins for /admin/* wrapped in root + admin layouts
    const admin404 = await app.get('/admin/unknown/page')
    expect(admin404.status).toBe(404)
    const admin404Html = await admin404.text()
    expect(admin404Html).toContain('Admin 404')
    expect(admin404Html).toContain('data-layout="root"')
    expect(admin404Html).toContain('data-layout="admin"')

    // Nested admin/_error.tsx wins for throwing route under /admin
    const adminErr = await app.get('/admin/crash')
    expect(adminErr.status).toBe(500)
    const adminErrHtml = await adminErr.text()
    expect(adminErrHtml).toContain('Admin Error: admin boom')
    expect(adminErrHtml).toContain('data-layout="admin"')

    // Nested admin/_503.tsx wins for ctx.deny(503)
    const admin503 = await app.get('/admin/down', HTML_ACCEPT)
    expect(admin503.status).toBe(503)
    const admin503Html = await admin503.text()
    expect(admin503Html).toContain('Admin 503: DB migrating')
    expect(admin503Html).toContain('data-layout="admin"')

    // Nested dynamic folder blog/[slug]/_error.tsx receives params.slug
    const blogErr = await app.get('/blog/my-post')
    expect(blogErr.status).toBe(500)
    expect(await blogErr.text()).toContain('Blog Error (my-post): post boom')

    // Group-scoped (panel)/_403.tsx and (panel)/_404.tsx win for matched routes inside (panel)/
    const panel403 = await app.get('/settings', HTML_ACCEPT)
    expect(panel403.status).toBe(403)
    const panel403Html = await panel403.text()
    expect(panel403Html).toContain('Panel 403: Panel locked')
    expect(panel403Html).toContain('data-layout="panel"')

    const panel404 = await app.get('/settings?miss=1')
    expect(panel404.status).toBe(404)
    const panel404Html = await panel404.text()
    expect(panel404Html).toContain('Panel 404')
    expect(panel404Html).toContain('data-layout="panel"')
  })

  it('falls back cleanly when a layout throws while wrapping an error page', async () => {
    const root = makeApp('prunelle-throwing-layout-', {
      'src/routes/_layout.tsx': `
        export default function BrokenLayout() {
          throw new Error('layout exploded')
        }
      `,
      'src/routes/_error.tsx': `
        export default function ErrorPage({ error }: { error: unknown }) {
          return <main>Recovered Error: {error instanceof Error ? error.message : String(error)}</main>
        }
      `,
      'src/routes/index.tsx': `
        export default function Home() { return <p>hi</p> }
      `,
    })

    const app = await testApp({ root })
    const res = await app.get('/')
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('Recovered Error: layout exploded')
    expect(app.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects unsupported _NNN.tsx status pages in both build and check', async () => {
    const root = makeApp('prunelle-bad-status-', {
      'src/routes/index.tsx': `export default function Home() { return <p>ok</p> }`,
      'src/routes/_418.tsx': `export default function Teapot() { return <p>teapot</p> }`,
    })

    await expect(build({ root })).rejects.toThrow(/unsupported status page.*_418\.tsx.*_401\.tsx.*_403\.tsx.*_404\.tsx.*_429\.tsx.*_503\.tsx.*_error\.tsx/)
    const checked = await checkProject(root, { skipTypecheck: true })
    expect(checked.ok).toBe(false)
    expect(checked.errors.some(e => e.includes('unsupported status page') && e.includes('_418.tsx'))).toBe(true)

    const root500 = makeApp('prunelle-bad-500-', {
      'src/routes/index.tsx': `export default function Home() { return <p>ok</p> }`,
      'src/routes/admin/_500.tsx': `export default function Bad500() { return <p>500</p> }`,
    })
    await expect(build({ root: root500 })).rejects.toThrow(/unsupported status page.*_500\.tsx/)
  })

  it('emits root 404.html and nested subfolder 404.html with meta CSP on --static, skipping dynamic and group folders', async () => {
    const root = makeApp('prunelle-static-404s-', {
      'src/routes/_layout.tsx': `export default function Root({ children }: { children: unknown }) { return <div data-root="1">{children}</div> }`,
      'src/routes/_404.tsx': `export default function Root404() { return <h1>Root Not Found</h1> }`,
      'src/routes/index.tsx': `export default function Home() { return <h1>Home</h1> }`,
      'src/routes/admin/_layout.tsx': `export default function AdminLayout({ children }: { children: unknown }) { return <section data-admin="1">{children}</section> }`,
      'src/routes/admin/_404.tsx': `export default function Admin404() { return <h1>Admin Not Found</h1> }`,
      'src/routes/admin/index.tsx': `export default function AdminHome() { return <h1>Admin</h1> }`,
      'src/routes/blog/[slug]/_404.tsx': `export default function Dynamic404() { return <h1>Dynamic 404</h1> }`,
      'src/routes/blog/[slug]/index.tsx': `export function paths() { return ['/blog/one'] }\nexport default function Post() { return <h1>Post</h1> }`,
      'src/routes/(marketing)/_404.tsx': `export default function Group404() { return <h1>Group 404</h1> }`,
    })

    await build({ root, static: true })
    const root404Path = join(root, 'dist/404.html')
    const admin404Path = join(root, 'dist/admin/404.html')
    expect(existsSync(root404Path)).toBe(true)
    expect(existsSync(admin404Path)).toBe(true)
    expect(existsSync(join(root, 'dist/blog/[slug]/404.html'))).toBe(false)
    expect(existsSync(join(root, 'dist/(marketing)/404.html'))).toBe(false)

    const rootHtml = readFileSync(root404Path, 'utf8')
    expect(rootHtml).toContain('Root Not Found')
    expect(rootHtml).toContain('http-equiv="Content-Security-Policy"')

    const adminHtml = readFileSync(admin404Path, 'utf8')
    expect(adminHtml).toContain('Admin Not Found')
    expect(adminHtml).toContain('data-admin="1"')
    expect(adminHtml).toContain('http-equiv="Content-Security-Policy"')
  })
})
