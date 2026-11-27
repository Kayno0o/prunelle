import type { PublicUser } from '@prunellejs/auth'
import type { ExtractRouteParams, PrunelleLocals, LayoutProps, LoaderData, PageProps, RouteContext } from 'prunelle'
import type { ActionErrorFlash, RequestContext } from 'prunelle/server'
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getActionError, notFound } from 'prunelle/server'
import { testApp } from '../src/test/index'

const tempDirs: string[] = []

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const d of tempDirs)
    rmSync(d, { recursive: true, force: true })
})

// Compile-time type assertions for #3544 (checked by `bun check`)
type Expect<T extends true> = T
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

describe('Route params, loader data, PrunelleLocals, and notFound() (#3544)', () => {
  it('types ctx.params from route patterns, PageProps from load, and augmented PrunelleLocals without casts', () => {
    // 1. ExtractRouteParams covers static, [param], [...catchall], :param, *catchall, route groups, optional segments, and param matchers
    type _StaticParams = Expect<Equal<ExtractRouteParams<'/about'>, {}>>
    type _SingleParam = Expect<Equal<ExtractRouteParams<'/notices/[id]'>, { id: string }>>
    type _CatchAllParam = Expect<Equal<ExtractRouteParams<'/docs/[...rest]'>, { rest: string }>>
    type _MixedParams = Expect<Equal<ExtractRouteParams<'/orgs/[org]/files/[...path]'>, { org: string, path: string }>>
    type _ColonParams = Expect<Equal<ExtractRouteParams<'/users/:id/posts/:postId'>, { id: string, postId: string }>>
    type _WildcardParam = Expect<Equal<ExtractRouteParams<'/files/*'>, { rest: string }>>
    type _GenericString = Expect<Equal<ExtractRouteParams<string>, Record<string, string>>>
    type _GroupIgnored = Expect<Equal<ExtractRouteParams<'/(marketing)/(nested)/about'>, {}>>
    type _GroupWithParam = Expect<Equal<ExtractRouteParams<'/(admin)/users/[id=integer]'>, { id: `${number}` }>>
    type _OptionalMiddle = Expect<Equal<ExtractRouteParams<'/[[lang]]/about'>, { lang?: string | undefined }>>
    type _OptionalMatched = Expect<Equal<ExtractRouteParams<'/blog/[[page=integer]]'>, { page?: `${number}` | undefined }>>
    type _UuidMatcher = Expect<Equal<ExtractRouteParams<'/items/[id=uuid]'>, { id: `${string}-${string}-${string}-${string}-${string}` }>>
    type _SlugMatcher = Expect<Equal<ExtractRouteParams<'/posts/[slug=slug]'>, { slug: string }>>
    type _CatchAllMatcher = Expect<Equal<ExtractRouteParams<'/docs/[...path=slug]'>, { path: string }>>
    type _ColonOptionalMatched = Expect<Equal<ExtractRouteParams<'/:lang?/items/:id=integer'>, { lang?: string | undefined, id: `${number}` }>>

    const _checkTypes: [
      _StaticParams,
      _SingleParam,
      _CatchAllParam,
      _MixedParams,
      _ColonParams,
      _WildcardParam,
      _GenericString,
      _GroupIgnored,
      _GroupWithParam,
      _OptionalMiddle,
      _OptionalMatched,
      _UuidMatcher,
      _SlugMatcher,
      _CatchAllMatcher,
      _ColonOptionalMatched,
    ] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true]
    expect(_checkTypes.length).toBe(15)

    // 2. RouteContext<'/notices/[id]'> types ctx.params.id as string (not string | undefined) and rejects typos
    function loadNotice(ctx: RouteContext<'/notices/[id]'>) {
      const id: string = ctx.params.id
      // @ts-expect-error unknown route param must fail typecheck
      const _bad = ctx.params.slug
      if (id === '0')
        return notFound()
      if (id === 'redir')
        return ctx.redirect('/')
      return { id: Number(id), title: 'Hello' }
    }

    // 3. LoaderData & PageProps<typeof load> infer data (excluding Response | NotFoundResult) AND params from load
    type _InferredData = Expect<Equal<LoaderData<typeof loadNotice>, { id: number, title: string }>>
    const _dataOk: _InferredData = true
    expect(_dataOk).toBe(true)

    function NoticePage({ data, params, locals, url }: PageProps<typeof loadNotice>) {
      const _title: string = data.title
      const _id: string = params.id
      const _user: PublicUser | undefined = locals.user
      const _locale: string | undefined = locals.locale
      const _t: ((key: string) => string) | undefined = locals.t
      const _flash: ActionErrorFlash | undefined = getActionError(locals)
      const _href: string = url.href
      // @ts-expect-error unknown data property
      const _badData = data.nonexistent
      // @ts-expect-error unknown param inferred from load
      const _badParam = params.other
      // @ts-expect-error unknown locals key not augmented on PrunelleLocals
      const _badLocal = locals.notAugmented
      return <h1>{_title} {_id} {_user?.email} {_locale} {_t?.('hi')} {_flash?.error} {_href}</h1>
    }
    expect(typeof NoticePage).toBe('function')

    // 4. PageProps with a route path string (no load) and LayoutProps
    function DocsCatchAll({ params, locals }: PageProps<'/docs/[...rest]'>) {
      const _rest: string = params.rest
      // @ts-expect-error wrong catch-all param name
      const _wrong = params.slug
      return <article>{_rest} {locals.locale}</article>
    }
    expect(typeof DocsCatchAll).toBe('function')

    function RootLayout({ children, locals }: LayoutProps) {
      const _email: string | undefined = locals.user?.email
      return <main data-user={_email}>{children}</main>
    }
    expect(typeof RootLayout).toBe('function')

    // 5. Async load + RequestContext locals
    async function loadAsync(ctx: RequestContext) {
      const _flash: ActionErrorFlash | undefined = getActionError(ctx.locals)
      return { ok: true as const, hasFlash: Boolean(_flash) }
    }
    type _AsyncData = Expect<Equal<LoaderData<typeof loadAsync>, { ok: true, hasFlash: boolean }>>
    const _asyncOk: _AsyncData = true
    expect(_asyncOk).toBe(true)

    const emptyLocals: PrunelleLocals = {}
    expect(getActionError(emptyLocals)).toBeUndefined()
    const flash: ActionErrorFlash = { action: '/_pru/action/test', error: 'Validation failed' }
    expect(getActionError({ actionError: flash })).toEqual(flash)
  })

  it('renders _404.tsx with status 404 when load() returns or throws notFound() on dynamic and static routes', async () => {
    const root = makeTemp('prunelle-notfound-')
    mkdirSync(join(root, 'src/routes/items'), { recursive: true })

    writeFileSync(join(root, 'src/routes/_layout.tsx'), `
import type { LayoutProps } from 'prunelle'
export default function Layout({ children }: LayoutProps) {
  return <div class="shell">{children}</div>
}
`)
    writeFileSync(join(root, 'src/routes/_404.tsx'), `
export default function Custom404() {
  return <h1>Custom Missing Page</h1>
}
`)
    // Dynamic route returning or throwing notFound()
    writeFileSync(join(root, 'src/routes/items/[id].tsx'), `
import type { PageProps, RouteContext } from 'prunelle/server'
import { notFound } from 'prunelle/server'

export function load(ctx: RouteContext<'/items/[id]'>) {
  if (ctx.params.id === 'missing')
    return notFound()
  if (ctx.params.id === 'thrown')
    throw notFound()
  return { name: 'Item ' + ctx.params.id }
}

export default function ItemPage({ data, params }: PageProps<typeof load>) {
  return <p>{data.name} ({params.id})</p>
}
`)
    // Static route (fastStaticPages path — no middleware, no <Head>, no dynamic segment) returning/throwing notFound()
    writeFileSync(join(root, 'src/routes/gone.tsx'), `
import type { RequestContext } from 'prunelle/server'
import { notFound } from 'prunelle/server'

export function load(ctx: RequestContext) {
  if (ctx.url.searchParams.get('throw') === '1')
    throw notFound()
  return notFound()
}

export default function GonePage() {
  return <p>Should never render</p>
}
`)

    const app = await testApp({ root })
    const okRes = await app.get('/items/42')
    expect(okRes.status).toBe(200)
    expect(await okRes.text()).toContain('Item 42 (42)')

    const returned404 = await app.get('/items/missing')
    expect(returned404.status).toBe(404)
    const returnedHtml = await returned404.text()
    expect(returnedHtml).toContain('Custom Missing Page')
    expect(returnedHtml).toContain('class="shell"')

    const thrown404 = await app.get('/items/thrown')
    expect(thrown404.status).toBe(404)
    expect(await thrown404.text()).toContain('Custom Missing Page')

    const staticReturned404 = await app.get('/gone')
    expect(staticReturned404.status).toBe(404)
    const staticHtml = await staticReturned404.text()
    expect(staticHtml).toContain('Custom Missing Page')
    expect(staticHtml).toContain('class="shell"')

    const staticThrown404 = await app.get('/gone?throw=1')
    expect(staticThrown404.status).toBe(404)
    expect(await staticThrown404.text()).toContain('Custom Missing Page')
  })
})
