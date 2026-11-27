// Tests for issue #1: route groups `(name)/`, optional segments `[[param]]`, and param matchers `[id=integer]`.

import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../src/build/index'
import { checkProject } from '../src/cli/check'
import { formatInspectReport, inspectProject } from '../src/cli/inspect'
import { Router } from '../src/server/router'
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

describe('Router precedence with matchers, optionals, and catch-alls (#1)', () => {
  it('enforces static > matched param > param > optional > catch-all and falls through on matcher rejection', () => {
    const router = new Router<string>({
      integer: v => /^\d+$/.test(v),
      uuid: v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
      slug: v => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v),
      hex: v => /^[0-9a-f]+$/i.test(v),
    })
    router.add('/items/*rest', 'catchall')
    router.add('/items/*path=slug', 'matched-catchall')
    router.add('/items/:opt?', 'optional')
    router.add('/items/:any', 'param')
    router.add('/items/:slug=slug', 'slug-param')
    router.add('/items/:id=integer', 'int-param')
    router.add('/items/featured', 'static')

    expect(router.match('/items/featured')).toEqual({ data: 'static', params: {} })
    expect(router.match('/items/42')).toEqual({ data: 'int-param', params: { id: '42' } })
    expect(router.match('/items/hello-world')).toEqual({ data: 'slug-param', params: { slug: 'hello-world' } })
    expect(router.match('/items/Hello_World')).toEqual({ data: 'param', params: { any: 'Hello_World' } })
    expect(router.match('/items')).toEqual({ data: 'optional', params: {} })
    expect(router.match('/items/a/b-c')).toEqual({ data: 'matched-catchall', params: { path: 'a/b-c' } })
    expect(router.match('/items/a/BAD_SEG')).toEqual({ data: 'catchall', params: { rest: 'a/BAD_SEG' } })
  })

  it('matches optional segments in the middle, at the end, and with trailing slashes', () => {
    const router = new Router<string>()
    router.add('/:lang?/about', 'about')
    router.add('/:slug', 'slug')
    router.add('/blog/:page=integer?', 'blog')

    expect(router.match('/about')).toEqual({ data: 'about', params: {} })
    expect(router.match('/about/')).toEqual({ data: 'about', params: {} })
    expect(router.match('/fr/about')).toEqual({ data: 'about', params: { lang: 'fr' } })
    expect(router.match('/fr/about/')).toEqual({ data: 'about', params: { lang: 'fr' } })
    expect(router.match('/other')).toEqual({ data: 'slug', params: { slug: 'other' } })
    expect(router.match('/blog')).toEqual({ data: 'blog', params: {} })
    expect(router.match('/blog/')).toEqual({ data: 'blog', params: {} })
    expect(router.match('/blog/3')).toEqual({ data: 'blog', params: { page: '3' } })
    expect(router.match('/blog/not-a-number')).toBeUndefined()
  })
})

describe('Route groups (name)/, optional segments [[param]], and param matchers (#1)', () => {
  it('groups routes under (name)/ layouts and middlewares without adding URL segments', async () => {
    const root = makeApp('prunelle-groups-', {
      'src/routes/_layout.tsx': `
        export default function RootLayout({ children }: { children: unknown }) {
          return <div data-layout="root">{children}</div>
        }
      `,
      'src/routes/(marketing)/_layout.tsx': `
        export default function MarketingLayout({ children }: { children: unknown }) {
          return <section data-layout="marketing">{children}</section>
        }
      `,
      'src/routes/(marketing)/_middleware.ts': `
        import type { Middleware } from 'prunelle/server'
        const mw: Middleware = async (ctx, next) => {
          const res = await next()
          res.headers.set('x-group', 'marketing')
          return res
        }
        export default mw
      `,
      'src/routes/(marketing)/index.tsx': `
        export default function Home() {
          return <h1>Marketing Home</h1>
        }
      `,
      'src/routes/(a)/(b)/_layout.tsx': `
        export default function NestedLayout({ children }: { children: unknown }) {
          return <article data-layout="nested-b">{children}</article>
        }
      `,
      'src/routes/(a)/_middleware.ts': `
        import type { Middleware } from 'prunelle/server'
        const mw: Middleware = async (ctx, next) => {
          ctx.locals.trace = 'a'
          return next()
        }
        export default mw
      `,
      'src/routes/(a)/(b)/_middleware.ts': `
        import type { Middleware } from 'prunelle/server'
        const mw: Middleware = async (ctx, next) => {
          ctx.locals.trace = String(ctx.locals.trace ?? '') + '>b'
          return next()
        }
        export default mw
      `,
      'src/routes/(a)/(b)/page.tsx': `
        export default function NestedPage({ locals }: { locals: { trace?: string } }) {
          return <p>Nested trace={locals.trace}</p>
        }
      `,
      'src/routes/plain.tsx': `
        export default function Plain() {
          return <p>Plain page</p>
        }
      `,
    })

    const app = await testApp({ root })
    const home = await app.get('/')
    expect(home.status).toBe(200)
    expect(home.headers.get('x-group')).toBe('marketing')
    const homeHtml = await home.text()
    expect(homeHtml).toContain('data-layout="root"')
    expect(homeHtml).toContain('data-layout="marketing"')
    expect(homeHtml).toContain('Marketing Home')

    const nested = await app.get('/page')
    expect(nested.status).toBe(200)
    expect(nested.headers.get('x-group')).toBeNull()
    const nestedHtml = await nested.text()
    expect(nestedHtml).toContain('data-layout="root"')
    expect(nestedHtml).toContain('data-layout="nested-b"')
    expect(nestedHtml).toContain('Nested trace=a&gt;b')

    const plain = await app.get('/plain')
    expect(plain.status).toBe(200)
    expect(plain.headers.get('x-group')).toBeNull()
    expect(await plain.text()).not.toContain('data-layout="marketing"')

    // Unmatched URL must NOT execute `(marketing)` or `(a)` group middleware.
    const missing = await app.get('/does-not-exist')
    expect(missing.status).toBe(404)
    expect(missing.headers.get('x-group')).toBeNull()
  })

  it('serves optional segments, built-in matchers (integer, uuid, slug), catch-all matchers, and custom app matchers', async () => {
    const root = makeApp('prunelle-matchers-', {
      'src/params/hex.ts': `
        export function match(value: string): boolean {
          return /^[0-9a-f]{4}$/i.test(value)
        }
      `,
      'src/params/code.ts': `
        export default function isCode(value: string): boolean {
          return /^SKU-\\d+$/.test(value)
        }
      `,
      'src/routes/[[lang]]/about.tsx': `
        import type { PageProps } from 'prunelle/server'
        export default function About({ params }: PageProps<'/[[lang]]/about'>) {
          return <p>About lang={params.lang ?? 'default'}</p>
        }
      `,
      'src/routes/blog/[[page=integer]].tsx': `
        import type { PageProps } from 'prunelle/server'
        export default function Blog({ params }: PageProps<'/blog/[[page=integer]]'>) {
          return <p>Blog page={params.page ?? '1'}</p>
        }
      `,
      'src/routes/users/[id=integer].tsx': `
        import type { PageProps } from 'prunelle/server'
        export default function UserById({ params }: PageProps<'/users/[id=integer]'>) {
          return <p>User int={params.id}</p>
        }
      `,
      'src/routes/users/[id=uuid].tsx': `
        import type { PageProps } from 'prunelle/server'
        export default function UserByUuid({ params }: PageProps<'/users/[id=uuid]'>) {
          return <p>User uuid={params.id}</p>
        }
      `,
      'src/routes/users/[slug=slug].tsx': `
        import type { PageProps } from 'prunelle/server'
        export default function UserBySlug({ params }: PageProps<'/users/[slug=slug]'>) {
          return <p>User slug={params.slug}</p>
        }
      `,
      'src/routes/colors/[color=hex].tsx': `
        export default function Color({ params }: { params: { color: string } }) {
          return <p>Hex={params.color}</p>
        }
      `,
      'src/routes/products/[sku=code].tsx': `
        export default function Product({ params }: { params: { sku: string } }) {
          return <p>SKU={params.sku}</p>
        }
      `,
      'src/routes/docs/[...path=slug].tsx': `
        export default function Docs({ params }: { params: { path: string } }) {
          return <p>Docs={params.path}</p>
        }
      `,
    })

    const app = await testApp({ root })

    // Optional middle segment + trailing slash
    expect(await (await app.get('/about')).text()).toContain('About lang=default')
    expect(await (await app.get('/about/')).text()).toContain('About lang=default')
    expect(await (await app.get('/fr/about')).text()).toContain('About lang=fr')
    expect(await (await app.get('/fr/about/')).text()).toContain('About lang=fr')

    // Optional matched segment at end
    expect(await (await app.get('/blog')).text()).toContain('Blog page=1')
    expect(await (await app.get('/blog/7')).text()).toContain('Blog page=7')
    expect((await app.get('/blog/not-int')).status).toBe(404)

    // Built-in integer > uuid > slug fallthrough and 404
    expect(await (await app.get('/users/42')).text()).toContain('User int=42')
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(await (await app.get(`/users/${uuid}`)).text()).toContain(`User uuid=${uuid}`)
    expect(await (await app.get('/users/alice-smith')).text()).toContain('User slug=alice-smith')
    expect((await app.get('/users/Bad_Name!')).status).toBe(404)

    // Custom app matchers (both `export function match` and `export default`)
    expect(await (await app.get('/colors/ff0a')).text()).toContain('Hex=ff0a')
    expect((await app.get('/colors/zzzz')).status).toBe(404)
    expect(await (await app.get('/products/SKU-99')).text()).toContain('SKU=SKU-99')
    expect((await app.get('/products/NOPE')).status).toBe(404)

    // Catch-all with matcher (each segment validated)
    expect(await (await app.get('/docs/getting-started/routing')).text()).toContain('Docs=getting-started/routing')
    expect((await app.get('/docs/getting-started/BAD_SEGMENT')).status).toBe(404)
  })

  it('rejects unknown matchers, matchers without export, and route conflicts in both build and check', async () => {
    const unknownRoot = makeApp('prunelle-bad-matcher-', {
      'src/routes/items/[id=nonexistent].tsx': `export default function Item() { return <p>x</p> }`,
    })
    await expect(build({ root: unknownRoot })).rejects.toThrow(/unknown param matcher "nonexistent"/)
    const unknownCheck = await checkProject(unknownRoot, { skipTypecheck: true })
    expect(unknownCheck.ok).toBe(false)
    expect(unknownCheck.errors.some(e => e.includes('unknown param matcher "nonexistent"'))).toBe(true)

    const badExportRoot = makeApp('prunelle-empty-matcher-', {
      'src/params/broken.ts': `export const helper = 123`,
      'src/routes/items/[id=broken].tsx': `export default function Item() { return <p>x</p> }`,
    })
    await expect(build({ root: badExportRoot })).rejects.toThrow(/exports no param matcher/)
    const badExportCheck = await checkProject(badExportRoot, { skipTypecheck: true })
    expect(badExportCheck.ok).toBe(false)
    expect(badExportCheck.errors.some(e => e.includes('exports no param matcher'))).toBe(true)

    const groupConflictRoot = makeApp('prunelle-group-conflict-', {
      'src/routes/(a)/about.tsx': `export default function A() { return <p>A</p> }`,
      'src/routes/(b)/about.tsx': `export default function B() { return <p>B</p> }`,
    })
    await expect(build({ root: groupConflictRoot })).rejects.toThrow(/conflicting routes.*\(a\)\/about\.tsx.*\(b\)\/about\.tsx/)
    const groupConflictCheck = await checkProject(groupConflictRoot, { skipTypecheck: true })
    expect(groupConflictCheck.ok).toBe(false)
    expect(groupConflictCheck.errors.some(e => e.includes('(a)/about.tsx') && e.includes('(b)/about.tsx'))).toBe(true)

    const matcherConflictRoot = makeApp('prunelle-matcher-conflict-', {
      'src/routes/items/[id=integer].tsx': `export default function A() { return <p>A</p> }`,
      'src/routes/items/[num=integer].tsx': `export default function B() { return <p>B</p> }`,
    })
    await expect(build({ root: matcherConflictRoot })).rejects.toThrow(/conflicting routes/)
    const matcherConflictCheck = await checkProject(matcherConflictRoot, { skipTypecheck: true })
    expect(matcherConflictCheck.ok).toBe(false)
    expect(matcherConflictCheck.errors.some(e => e.includes('conflicting routes'))).toBe(true)
  })

  it('supports static export (--static) for optional and matched routes and reports groups/matchers/optionals in inspect', async () => {
    const root = makeApp('prunelle-static-opt-', {
      'src/routes/(marketing)/[[lang]]/about.tsx': `
        export function paths() { return ['/about', '/fr/about'] }
        export default function About({ params }: { params: { lang?: string } }) {
          return <h1>About {params.lang ?? 'en'}</h1>
        }
      `,
      'src/routes/(marketing)/posts/[id=integer].tsx': `
        export function paths() { return ['/posts/1', '/posts/2'] }
        export default function Post({ params }: { params: { id: string } }) {
          return <h1>Post {params.id}</h1>
        }
      `,
    })

    const report = await inspectProject(root)
    const aboutRoute = report.routes.find(r => r.path === '/:lang?/about')
    expect(aboutRoute?.groups).toEqual(['marketing'])
    expect(aboutRoute?.optionalParams).toEqual(['lang'])
    const postRoute = report.routes.find(r => r.path === '/posts/:id=integer')
    expect(postRoute?.groups).toEqual(['marketing'])
    expect(postRoute?.matchers).toEqual({ id: 'integer' })

    const text = formatInspectReport(report)
    expect(text).toContain('groups=[marketing]')
    expect(text).toContain('matchers=[id=integer]')
    expect(text).toContain('optional=[lang]')

    await build({ root, static: true })
    expect(existsSync(join(root, 'dist/about/index.html'))).toBe(true)
    expect(existsSync(join(root, 'dist/fr/about/index.html'))).toBe(true)
    expect(existsSync(join(root, 'dist/posts/1/index.html'))).toBe(true)
    expect(readFileSync(join(root, 'dist/about/index.html'), 'utf8')).toContain('About en')
    expect(readFileSync(join(root, 'dist/fr/about/index.html'), 'utf8')).toContain('About fr')
  })
})
