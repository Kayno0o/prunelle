// Request pathname decoding, manifest prefix/ancestor middleware lookup, 405 helper, and fast static page handler.

import type { ActionManifestEntry, BuildManifest, RouteManifestEntry } from '../build/index'
import type { Html, HydrateStrategy } from '../jsx-runtime'
import type { DocumentOptions } from '../ssr/index'
import type { RenderContext } from '../ssr/context'
import type { ActionRegistry } from './action-registry'
import type { CompressionCache } from './compress'
import type { NormalizedConsentConfig } from './consent'
import type { CookieStore } from './cookies'
import type { HtmlHeaders } from './document'
import type { NotifyError } from './errors'
import type { DevTiming, RequestIdResolver } from './health'
import type { DeniedInfo, Middleware, RequestContext } from './http'
import type { PrunelleLocals } from './index'
import type { LoadedLayoutModule, LoadedMiddlewareModule, LoadedPageModule } from './page'
import type { ParamMatcherMap } from './param-matchers'
import type { RequestPath } from './request-path'
import type { RouteCache, RouteCacheSpec } from './route-cache'
import type { TrustProxy } from './security'
import { createRenderContext, runWithRenderContext } from '../ssr/context'
import { raw, renderDocument, ssrChild, ssrIsland } from '../ssr/index'
import { keepScrollTag } from '../ssr/navigation'
import { compressedHtmlResponse, maybeCompressResponse } from './compress'
import { headTagStyleHashes, mergeStyleHashes } from './document'
import { createTiming, endTimer, finishRenderTiming, formatServerTiming, resolveFallbackRequestId, startTimer } from './health'
import { acceptsHtml, getDeniedInfo, isNotFound, makeRequestContext } from './http'
import { pickPageIslandProps } from './page'
import { BUILTIN_PARAM_MATCHERS } from './param-matchers'
import { withRegionVary } from './region'
import { pathPrefix } from './request-path'
import { isCacheableRequest, serveCachedHit, withCacheControl } from './route-cache'
import { Router } from './router'
import { styleHashesOf } from './security'

const MIDDLEWARE_BASENAME_RE = /(?:^|\/)_middleware\.js$/
const ROUTE_GROUP_RE = /^\([^/()]+\)$/
const OPTIONAL_PARAM_SEG_RE = /^\[\[([^\[\]]+)\]\]$/
const CATCH_ALL_SEG_RE = /^\[\.\.\.([^\[\]]+)\]$/
const PARAM_SEG_RE = /^\[([^\[\]]+)\]$/
const CATCH_ALL_BRACKET_RE = /\[\.\.\.([^\]]+)\]/g
const PARAM_BRACKET_RE = /\[([^\]]+)\]/g

export type FastHandler = (req: Request, remoteIp?: string, url?: URL, requestId?: string) => Response | Promise<Response>


export function methodNotAllowed(allow: string): Response {
  return new Response('Method Not Allowed', allow ? { status: 405, headers: { allow } } : { status: 405 })
}

/** Encodes a static route/asset path for Bun.serve's `routes` table (which requires ASCII keys and treats `*` as a wildcard). */
export function toBunRouteKey(path: string): string | undefined {
  if (path.includes('*'))
    return undefined
  return path.split('/').map(encodeURIComponent).join('/')
}

function dirnamePrefix(file: string): string {
  const slash = file.lastIndexOf('/')
  return slash === -1 ? '' : file.slice(0, slash + 1)
}

function convertDirSegment(seg: string): string {
  const opt = OPTIONAL_PARAM_SEG_RE.exec(seg)
  if (opt !== null)
    return `:${opt[1]}?`
  const catchAll = CATCH_ALL_SEG_RE.exec(seg)
  if (catchAll !== null)
    return `*${catchAll[1]}`
  const param = PARAM_SEG_RE.exec(seg)
  if (param !== null)
    return `:${param[1]}`
  return seg.replace(CATCH_ALL_BRACKET_RE, '*$1').replace(PARAM_BRACKET_RE, ':$1')
}

function dirToRoutePattern(relDir: string): string {
  if (relDir === '')
    return '/'
  const parts = relDir.split('/').filter(p => p !== '' && !ROUTE_GROUP_RE.test(p))
  if (parts.length === 0)
    return '/'
  return `/${parts.map(convertDirSegment).join('/')}`
}

/** Infers the compiled module prefix for files under `routesDir` (e.g. `'server/'` or `'server/src/routes/'`). */
export function inferRoutesServerPrefix(manifest: BuildManifest): string {
  const rootSpecial = manifest.rootLayoutFile ?? manifest.errorFile ?? manifest.notFoundFile
  if (rootSpecial !== undefined)
    return dirnamePrefix(rootSpecial)

  for (const route of manifest.routes) {
    const fileParts = route.file.split('/')
    const pathSegs = route.path === '/' ? [] : route.path.replace(/^\/|\/$/g, '').split('/')
    const isIndex = fileParts[fileParts.length - 1] === 'index.js'
    let remaining = pathSegs.length + (isIndex ? 1 : 0)
    let idx = fileParts.length
    while (idx > 0 && remaining > 0) {
      idx--
      if (!ROUTE_GROUP_RE.test(fileParts[idx]!))
        remaining--
    }
    while (idx > 0 && ROUTE_GROUP_RE.test(fileParts[idx - 1]!))
      idx--
    if (remaining === 0) {
      const prefixParts = fileParts.slice(0, idx)
      return prefixParts.length === 0 ? '' : `${prefixParts.join('/')}/`
    }
  }

  for (const entry of manifest.actions) {
    if (entry.file.startsWith('server/src/routes/'))
      return 'server/src/routes/'
  }
  return 'server/'
}

/** Derives an action's route directory prefix (e.g. `'/admin'`) when declared under `routesDir`. */
export function actionRoutePrefix(
  entry: ActionManifestEntry,
  routesPrefix: string,
  routePathByFile: ReadonlyMap<string, string>,
): string | undefined {
  const exactRoutePath = routePathByFile.get(entry.file)
  if (exactRoutePath !== undefined)
    return exactRoutePath
  if (!entry.file.startsWith(routesPrefix))
    return undefined
  const rel = entry.file.slice(routesPrefix.length)
  const slash = rel.lastIndexOf('/')
  const relDir = slash === -1 ? '' : rel.slice(0, slash)
  return dirToRoutePattern(relDir)
}

export interface AncestorMiddlewareMatch {
  middlewares: Middleware[]
  params: Record<string, string>
}

/** Builds a lookup returning the outermost-to-innermost `_middleware.ts` chain for any unmatched pathname. */
export function createAncestorMiddlewareLookup(
  manifest: BuildManifest,
  modules: Record<string, unknown>,
  routesPrefix: string,
  paramMatchers: ParamMatcherMap = BUILTIN_PARAM_MATCHERS,
): (path: RequestPath) => AncestorMiddlewareMatch | undefined {
  const byPattern = new Map<string, Middleware[]>()
  const seenModules = new Set<string>()

  const addMiddlewareModule = (modKey: string): void => {
    if (seenModules.has(modKey))
      return
    seenModules.add(modKey)
    if (!modKey.startsWith(routesPrefix) || !MIDDLEWARE_BASENAME_RE.test(modKey))
      return
    const mod = modules[modKey] as LoadedMiddlewareModule | undefined
    if (typeof mod?.default !== 'function')
      return
    const rel = modKey.slice(routesPrefix.length)
    const relDir = rel.replace(MIDDLEWARE_BASENAME_RE, '')
    // A `(group)` middleware only applies to routes/actions inside that group, never to unrelated unmatched URLs.
    if (relDir !== '' && relDir.split('/').some(p => ROUTE_GROUP_RE.test(p)))
      return
    const pattern = dirToRoutePattern(relDir)
    let list = byPattern.get(pattern)
    if (list === undefined) {
      list = []
      byPattern.set(pattern, list)
    }
    list.push(mod.default)
  }

  for (const route of manifest.routes) {
    for (const mwKey of route.middlewares)
      addMiddlewareModule(mwKey)
  }
  for (const act of manifest.actions) {
    for (const mwKey of act.middlewares)
      addMiddlewareModule(mwKey)
  }
  for (const modKey of Object.keys(modules)) {
    if (modKey.startsWith(routesPrefix) && MIDDLEWARE_BASENAME_RE.test(modKey))
      addMiddlewareModule(modKey)
  }

  if (byPattern.size === 0)
    return () => undefined

  const dirRouter = new Router<Middleware[]>(paramMatchers)
  for (const [pattern, list] of byPattern)
    dirRouter.add(pattern, list)

  return (path: RequestPath): AncestorMiddlewareMatch | undefined => {
    const middlewares: Middleware[] = []
    const params: Record<string, string> = {}

    for (let i = 0; i <= path.segments.length; i++) {
      const matched = dirRouter.match(pathPrefix(path, i))
      if (matched !== undefined) {
        for (const mw of matched.data)
          middlewares.push(mw)
        Object.assign(params, matched.params)
      }
    }

    return middlewares.length > 0 ? { middlewares, params } : undefined
  }
}

export interface FastStaticPageOptions {
  entry: RouteManifestEntry
  mod: LoadedPageModule
  layouts: LoadedLayoutModule[]
  doc: DocumentOptions
  /** The prop revivers, preloaded by the responses whose island props need them. */
  reviveScript: string | undefined
  hasIslands: boolean
  hasLoad: boolean
  trustProxy: TrustProxy
  consent?: NormalizedConsentConfig | undefined
  htmlHeaders: HtmlHeaders
  compressCache: CompressionCache | undefined
  routeCache?: RouteCache | undefined
  actions: ActionRegistry
  buildNotFoundResponse: (url?: URL, req?: Request, ctx?: RequestContext, routeFile?: string) => Promise<Response>
  renderError: (error: unknown, cookieStore: CookieStore | undefined, url: URL, request: Request, ctx?: RequestContext, routeFile?: string) => Promise<Response>
  renderDenied?: ((denied: DeniedInfo, url: URL, req: Request, ctx?: RequestContext, routeFile?: string) => Promise<Response>) | undefined
  notifyError: NotifyError
  finish: (res: Response, request: Request, cookieStore?: CookieStore, requestId?: string, serverTiming?: string) => Response
  withHsts: (res: Response, request: Request) => Response
  dev?: boolean | undefined
  resolveRequestId?: RequestIdResolver | undefined
}

interface FastRevalidateContext {
  entry: RouteManifestEntry
  mod: LoadedPageModule
  layouts: LoadedLayoutModule[]
  hasLoad: boolean
  hasIslands: boolean
  trustProxy: TrustProxy
  consent: NormalizedConsentConfig | undefined
  htmlHeaders: HtmlHeaders
  routeCache: RouteCache
  actions: ActionRegistry
  notifyError: NotifyError
  getRequestId: RequestIdResolver
  docPrefix: string
  revivingPrefix: string
  docSuffix: string
  headStyleHashes: string[]
}

async function revalidateFastStaticRoute(
  rc: FastRevalidateContext,
  url: URL,
  cacheKey: string,
  cacheSpec: RouteCacheSpec,
): Promise<void> {
  const bgReq = new Request(url.href, { method: 'GET' })
  const bgReqId = rc.getRequestId(bgReq)
  const { ctx, cookieStore } = makeRequestContext(bgReq, {}, { trustProxy: rc.trustProxy, url, consent: rc.consent, requestId: bgReqId })
  const rctx = createRenderContext(undefined, undefined, ctx.consent, error => rc.notifyError(error, bgReq, 'route', bgReqId))
  await rc.actions.run(ctx, async () => {
    let data: unknown
    if (rc.hasLoad) {
      try {
        data = await rc.mod.load!(ctx)
      }
      catch (error) {
        if (isNotFound(error)) {
          rc.routeCache.delete(cacheKey)
          return
        }
        throw error
      }
      if (isNotFound(data) || data instanceof Response) {
        rc.routeCache.delete(cacheKey)
        return
      }
    }
    const body = await runWithRenderContext(rctx, async () => {
      const pageProps: Record<string, unknown> = { params: {}, locals: ctx.locals, url, ...(data !== undefined ? { data } : {}) }
      let cur = rc.entry.isIsland && rc.entry.islandChunk !== undefined
        ? ssrIsland(rc.entry.islandChunk, () => ssrChild(rc.mod.default!(pageProps) as Html), pickPageIslandProps(data, rc.entry, rc.mod), rc.entry.islandHydrate as HydrateStrategy | undefined, true, rc.mod.default!.name)
        : ssrChild(await rc.mod.default!(pageProps) as Html)
      for (let i = rc.layouts.length - 1; i >= 0; i--)
        cur = ssrChild(await rc.layouts[i]!.default({ children: raw(cur), url, params: {}, locals: ctx.locals }) as Html)
      return cur
    })
    if (cookieStore.hasChanges) {
      rc.routeCache.delete(cacheKey)
      return
    }
    const html = (rctx.revives ? rc.revivingPrefix : rc.docPrefix) + body + keepScrollTag(body) + rc.docSuffix
    const styleHashes = mergeStyleHashes(rc.headStyleHashes, styleHashesOf(rctx.inlineStyles))
    const headers = withCacheControl(withRegionVary(rc.htmlHeaders(rc.hasIslands, false, true, styleHashes), rctx.regionNames.size > 0), cacheSpec.cacheControl)
    rc.routeCache.set(cacheKey, html, headers, cacheSpec)
  })
}

function buildFastDocShell(doc: DocumentOptions, eagerChunks: string[], reviveScript: string | undefined, hasIslands: boolean): { docPrefix: string, revivingPrefix: string, docSuffix: string } {
  const shellAround = (preloadChunks: string[]): [string, string] => {
    const shell = renderDocument({ ...doc, body: '\0', preloadChunks, hasIslands })
    const splitAt = shell.indexOf('\0')
    return [shell.slice(0, splitAt), shell.slice(splitAt + 1)]
  }
  const [docPrefix, docSuffix] = shellAround(eagerChunks)
  const revivingPrefix = reviveScript === undefined ? docPrefix : shellAround([...eagerChunks, reviveScript])[0]
  return { docPrefix, revivingPrefix, docSuffix }
}

/** Builds the zero-overhead static-path page handler, keeping `actions.run()` active through load, render, and 404 fallback. */
export function createFastStaticPageHandler(options: FastStaticPageOptions): FastHandler {
  const { entry, mod, layouts, doc, reviveScript, hasIslands, hasLoad, trustProxy, consent, htmlHeaders, compressCache, routeCache, actions, buildNotFoundResponse, renderError, renderDenied, notifyError, finish, withHsts } = options
  const isDev = options.dev === true
  const getRequestId: RequestIdResolver = options.resolveRequestId ?? (req => resolveFallbackRequestId(req, trustProxy))
  const cacheSpec = routeCache !== undefined ? entry.cache : undefined
  const { docPrefix, revivingPrefix, docSuffix } = buildFastDocShell(doc, entry.eagerIslandChunks ?? entry.islandChunks, reviveScript, hasIslands)
  const headStyleHashes = headTagStyleHashes(doc.headTags)
  const singleLayout = layouts.length === 1 ? layouts[0]! : undefined
  const revalidateCtx: FastRevalidateContext | undefined = cacheSpec !== undefined && routeCache !== undefined
    ? { entry, mod, layouts, hasLoad, hasIslands, trustProxy, consent, htmlHeaders, routeCache, actions, notifyError, getRequestId, docPrefix, revivingPrefix, docSuffix, headStyleHashes }
    : undefined

  const fail = (error: unknown, request: Request, url: URL, cookieStore?: CookieStore, ctx?: RequestContext): Promise<Response> => {
    notifyError(error, request, 'route', ctx?.requestId)
    return renderError(error, cookieStore, url, request, ctx, entry.file)
  }
  const respondHtml = (body: string, request: Request, rctx: RenderContext, cookieStore: CookieStore, ctx: RequestContext, timing?: DevTiming): Response => {
    const html = (rctx.revives ? revivingPrefix : docPrefix) + body + keepScrollTag(body) + docSuffix
    const styleHashes = mergeStyleHashes(headStyleHashes, styleHashesOf(rctx.inlineStyles))
    const headers = withRegionVary(htmlHeaders(hasIslands, false, true, styleHashes), rctx.regionNames.size > 0)
    const st = timing !== undefined ? finishRenderTiming(timing) : undefined
    if (cacheSpec !== undefined && routeCache !== undefined && !cookieStore.hasChanges && isCacheableRequest(request)) {
      const cachedHeaders = withCacheControl(headers, cacheSpec.cacheControl)
      const stored = routeCache.set(ctx.url.pathname + ctx.url.search, html, cachedHeaders, cacheSpec)
      return withHsts(routeCache.respondMiss(stored, html, cachedHeaders, request, ctx.requestId, compressCache, st), request)
    }
    const res = compressedHtmlResponse(html, 200, headers, request, compressCache, !hasLoad)
    res.headers.set('x-request-id', ctx.requestId)
    if (st !== undefined)
      res.headers.set('server-timing', st)
    return cookieStore.hasChanges ? finish(res, request, cookieStore, ctx.requestId, st) : withHsts(res, request)
  }
  const layoutProps = (inner: string, url: URL, locals: PrunelleLocals) => ({ children: raw(inner), url, params: {}, locals })

  const finishSingleLayout = async (wrapped: Promise<Html | string>, request: Request, url: URL, rctx: RenderContext, cookieStore: CookieStore, ctx: RequestContext, timing?: DevTiming): Promise<Response> => {
    try {
      return respondHtml(ssrChild(await wrapped as Html), request, rctx, cookieStore, ctx, timing)
    }
    catch (error) {
      return fail(error, request, url, cookieStore, ctx)
    }
  }

  const wrapLayouts = (inner: string, request: Request, url: URL, locals: PrunelleLocals, rctx: RenderContext, cookieStore: CookieStore, ctx: RequestContext, timing?: DevTiming): Response | Promise<Response> => {
    if (layouts.length === 0)
      return respondHtml(inner, request, rctx, cookieStore, ctx, timing)
    if (singleLayout !== undefined) {
      const wrapped = singleLayout.default(layoutProps(inner, url, locals))
      if (wrapped instanceof Promise)
        return finishSingleLayout(wrapped, request, url, rctx, cookieStore, ctx, timing)
      return respondHtml(ssrChild(wrapped as Html), request, rctx, cookieStore, ctx, timing)
    }
    return (async () => {
      try {
        let cur = inner
        for (let i = layouts.length - 1; i >= 0; i--)
          cur = ssrChild(await layouts[i]!.default(layoutProps(cur, url, locals)) as Html)
        return respondHtml(cur, request, rctx, cookieStore, ctx, timing)
      }
      catch (error) {
        return fail(error, request, url, cookieStore, ctx)
      }
    })()
  }

  const finishAsyncPage = async (rendered: Promise<Html | string>, request: Request, url: URL, locals: PrunelleLocals, rctx: RenderContext, cookieStore: CookieStore, ctx: RequestContext, timing?: DevTiming): Promise<Response> => {
    try {
      return await wrapLayouts(ssrChild(await rendered as Html), request, url, locals, rctx, cookieStore, ctx, timing)
    }
    catch (error) {
      return fail(error, request, url, cookieStore, ctx)
    }
  }

  const renderPage = (data: unknown, request: Request, url: URL, locals: PrunelleLocals, rctx: RenderContext, cookieStore: CookieStore, ctx: RequestContext, timing?: DevTiming): Response | Promise<Response> => {
    if (timing !== undefined)
      timing.render = performance.now()
    const pageProps: Record<string, unknown> = { params: {}, locals, url, ...(data !== undefined ? { data } : {}) }
    if (entry.isIsland && entry.islandChunk !== undefined) {
      return wrapLayouts(ssrIsland(
        entry.islandChunk,
        () => ssrChild(mod.default!(pageProps) as Html),
        pickPageIslandProps(data, entry, mod),
        entry.islandHydrate as HydrateStrategy | undefined,
        true,
        mod.default!.name,
      ), request, url, locals, rctx, cookieStore, ctx, timing)
    }
    const rendered = mod.default!(pageProps)
    if (rendered instanceof Promise)
      return finishAsyncPage(rendered, request, url, locals, rctx, cookieStore, ctx, timing)
    return wrapLayouts(ssrChild(rendered as Html), request, url, locals, rctx, cookieStore, ctx, timing)
  }

  return (request, remoteIp, url = new URL(request.url), requestId?: string) => {
    const reqId = requestId ?? getRequestId(request)
    if (revalidateCtx !== undefined && cacheSpec !== undefined && routeCache !== undefined && !(request.method === 'HEAD' && typeof mod.HEAD === 'function') && isCacheableRequest(request)) {
      const cacheKey = url.pathname + url.search
      const cached = serveCachedHit(routeCache, cacheKey, request, reqId, compressCache, () => revalidateFastStaticRoute(revalidateCtx, url, cacheKey, cacheSpec), error => notifyError(error, request, 'route', reqId))
      if (cached !== undefined)
        return withHsts(cached, request)
    }
    const timing = createTiming(isDev)
    const { ctx, cookieStore } = makeRequestContext(request, {}, { trustProxy, remoteIp, url, consent, requestId: reqId })
    if (request.method === 'HEAD' && typeof mod.HEAD === 'function') {
      return actions.run(ctx, async () => {
        try {
          return finish(await mod.HEAD!(ctx), request, cookieStore, reqId, formatServerTiming(timing))
        }
        catch (error) {
          return fail(error, request, url, cookieStore, ctx)
        }
      })
    }
    const rctx = createRenderContext(undefined, undefined, ctx.consent, error => notifyError(error, request, 'route', reqId))
    try {
      if (!hasLoad)
        return actions.run(ctx, () => runWithRenderContext(rctx, () => renderPage(undefined, request, url, ctx.locals, rctx, cookieStore, ctx, timing)))

      return actions.run(ctx, async () => {
        let loaded: unknown
        const loadStart = startTimer(timing)
        try {
          loaded = await mod.load!(ctx)
        }
        catch (error) {
          if (isNotFound(error))
            return finish(await maybeCompressResponse(await buildNotFoundResponse(url, request, ctx, entry.file), request, compressCache), request, cookieStore, reqId, formatServerTiming(timing))
          return fail(error, request, url, cookieStore, ctx)
        }
        endTimer(timing, 'load', loadStart)
        if (isNotFound(loaded))
          return finish(await maybeCompressResponse(await buildNotFoundResponse(url, request, ctx, entry.file), request, compressCache), request, cookieStore, reqId, formatServerTiming(timing))
        if (loaded instanceof Response) {
          const denied = getDeniedInfo(loaded)
          const out = denied !== undefined && renderDenied !== undefined && acceptsHtml(request)
            ? await renderDenied(denied, url, request, ctx, entry.file)
            : loaded
          return finish(await maybeCompressResponse(out, request, compressCache), request, cookieStore, reqId, formatServerTiming(timing))
        }
        try {
          return await runWithRenderContext(rctx, () => renderPage(loaded, request, url, ctx.locals, rctx, cookieStore, ctx, timing))
        }
        catch (error) {
          return fail(error, request, url, cookieStore, ctx)
        }
      })
    }
    catch (error) {
      return fail(error, request, url, cookieStore, ctx)
    }
  }
}
