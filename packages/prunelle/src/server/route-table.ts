// The page routes of a build, compiled once at startup: each route's modules, middlewares and document options, and the handler of a page nothing can intercept.

import type { BuildManifest, RouteManifestEntry } from '../build/index'
import type { Html, HydrateStrategy } from '../jsx-runtime'
import type { AppRuntimeContext } from '../plugins/index'
import type { DocumentOptions } from '../ssr/index'
import type { ActionRegistry } from './action-registry'
import type { ServedFile } from './assets'
import type { CompressionCache } from './compress'
import type { NormalizedConsentConfig } from './consent'
import type { CookieStore } from './cookies'
import type { DocumentHooks, HtmlHeaders } from './document'
import type { NotifyError } from './errors'
import type { DevTiming, RequestIdResolver } from './health'
import type { Middleware, RequestContext } from './http'
import type { LoadedLayoutModule, LoadedMiddlewareModule, LoadedPageModule } from './page'
import type { ParamMatcherMap } from './param-matchers'
import type { RequestKind } from './plugin-host'
import type { RouteCache, RouteCacheSpec } from './route-cache'
import type { FastHandler, FastStaticPageOptions } from './routing'
import type { TrustProxy } from './security'
import { runWithAppContext } from '../plugins/index'
import { createRenderContext, runWithRenderContext } from '../ssr/context'
import { raw, renderDocument, ssrChild, ssrIsland } from '../ssr/index'
import { ACTION_ERROR_COOKIE, hydrateActionErrorFlash } from './action'
import { compressedHtmlResponse, compressedHtmlStream, markCompressionHandled } from './compress'
import { addedInlineStyleHashes, headTagStyleHashes, mergeStyleHashes, resolveRenderedIslands, revivePreload } from './document'
import { endTimer, startTimer } from './health'
import { isNotFound, makeRequestContext } from './http'
import { allowedMethodsHeader, mergedHeadTags, pickPageIslandProps, stripHeadBody } from './page'
import { BUILTIN_PARAM_MATCHERS } from './param-matchers'
import { hasRegionHeader, invalidRegionResponse, requestedRegion, respondRegion, withRegionVary } from './region'
import { serveCachedHit, withCacheControl } from './route-cache'
import { Router } from './router'
import { createFastStaticPageHandler, methodNotAllowed } from './routing'
import { styleHashesOf } from './security'
import { hasActionErrorCookie, isRead } from './serve-handlers'
import { STREAM_TAIL_MARK, streamDocument } from './stream'

export interface CompiledRoute {
  entry: RouteManifestEntry
  mod: LoadedPageModule
  layouts: LoadedLayoutModule[]
  dirMiddlewares: Middleware[]
  /** Precomputed plugin + directory middlewares for non-rewritten static paths. */
  middlewares: Middleware[]
  /** Dynamic segments (`:param` / `*rest`), so the path names no single URL. */
  dynamic: boolean
  /** Options every document of this route shares; a request adds its body, head and islands. */
  doc: DocumentOptions
  headStyleHashes: string[]
}

function routeDocument(manifest: BuildManifest, entry: RouteManifestEntry, lang: string, alwaysLoadRuntime: boolean, navigation: DocumentOptions['navigation']): DocumentOptions {
  return {
    body: '',
    headTags: mergedHeadTags(manifest, entry),
    lang,
    runtimeScript: manifest.runtimeScript,
    chunkImports: manifest.chunkImports,
    alwaysLoadRuntime,
    navigation,
    regionScript: entry.usesRegion === true ? manifest.regionScript : undefined,
    styles: entry.styles ?? manifest.styles,
  }
}

type SharedFastOptions = Omit<FastStaticPageOptions, 'entry' | 'mod' | 'layouts' | 'doc' | 'reviveScript' | 'hasIslands' | 'hasLoad'>

export interface RouteTableOptions {
  manifest: BuildManifest
  modules: Record<string, unknown>
  paramMatchers?: ParamMatcherMap | undefined
  lang: string
  alwaysLoadRuntime: boolean
  navigation: DocumentOptions['navigation']
  middlewaresFor: (path: string, kind?: RequestKind) => readonly Middleware[]
  /** Whether a plugin rewrite, head hook, HTML transform or route may change what `path` answers. */
  pluginIntercepts: (path: string) => boolean
  fast: SharedFastOptions
}

export function compileRouteTable(options: RouteTableOptions): { router: Router<CompiledRoute>, fastStaticPages: Map<string, FastHandler> } {
  const { manifest, modules, paramMatchers, lang, alwaysLoadRuntime, navigation, middlewaresFor, pluginIntercepts, fast } = options
  const router = new Router<CompiledRoute>(paramMatchers ?? BUILTIN_PARAM_MATCHERS)
  const fastStaticPages = new Map<string, FastHandler>()
  for (const entry of manifest.routes) {
    const mod = modules[entry.file] as LoadedPageModule
    const layouts = entry.layouts.map(l => modules[l] as LoadedLayoutModule)
    const dirMiddlewares = entry.middlewares.map(m => (modules[m] as LoadedMiddlewareModule).default)
    const hasLoad = Boolean(entry.hasLoad && typeof mod.load === 'function')
    const dynamic = entry.path.includes(':') || entry.path.includes('*')
    const doc = routeDocument(manifest, entry, lang, alwaysLoadRuntime, navigation)

    // Zero-overhead path for a static route with no middleware, no <Head>/<Suspense>, and no intercepting plugin hook
    const canFastPath = middlewaresFor(entry.path, hasLoad ? 'dynamic' : 'static').length === 0
      && !pluginIntercepts(entry.path) && !dynamic
      && dirMiddlewares.length === 0 && !entry.usesRenderContext
      && typeof mod.default === 'function' && mod.GET === undefined
    if (canFastPath)
      fastStaticPages.set(entry.path, createFastStaticPageHandler({ ...fast, entry, mod, layouts, doc, reviveScript: manifest.reviveScript, hasIslands: entry.islandChunks.length > 0, hasLoad }))

    router.add(entry.path, { entry, mod, layouts, dirMiddlewares, middlewares: [...middlewaresFor(entry.path), ...dirMiddlewares], dynamic, doc, headStyleHashes: headTagStyleHashes(doc.headTags) })
  }
  return { router, fastStaticPages }
}

function lookupPrerendered<T>(map: ReadonlyMap<string, T>, staticPath: string | undefined): T | undefined {
  if (staticPath === undefined)
    return undefined
  const normPath = staticPath.length > 1 && staticPath.endsWith('/') ? staticPath.slice(0, -1) : staticPath
  return map.get(staticPath) ?? map.get(normPath)
}

async function renderRouteBody(route: CompiledRoute, data: unknown, pageProps: Record<string, unknown>, ctx: RequestContext): Promise<string> {
  const { entry, mod, layouts } = route
  let inner: string
  if (entry.isIsland && entry.islandChunk !== undefined) {
    inner = ssrIsland(
      entry.islandChunk,
      () => ssrChild(mod.default!(pageProps) as Html),
      pickPageIslandProps(data, entry, mod),
      entry.islandHydrate as HydrateStrategy | undefined,
      true,
      mod.default!.name,
    )
  }
  else {
    inner = ssrChild(await mod.default!(pageProps) as Html)
  }
  for (let i = layouts.length - 1; i >= 0; i--)
    inner = ssrChild(await layouts[i]!.default({ children: raw(inner), url: ctx.url, params: ctx.params, locals: ctx.locals }) as Html)
  return inner
}

export interface CompiledRouteRendererDeps {
  manifest: BuildManifest
  prerenderedMap: ReadonlyMap<string, ServedFile>
  serveFile: (request: Request, file: ServedFile) => Promise<Response>
  buildNotFoundResponse: (url?: URL, req?: Request, ctx?: RequestContext, routeFile?: string) => Promise<Response>
  htmlHeaders: HtmlHeaders
  resolveDocumentHead: DocumentHooks['resolveDocumentHead']
  applyHtmlTransforms: DocumentHooks['applyHtmlTransforms']
  hasHtmlTransformers: boolean
  streamTimeout: number
  compressCache: CompressionCache | undefined
  routeCache: RouteCache | undefined
  notifyError: NotifyError
  actions: ActionRegistry
  rewrites: readonly ((pathname: string, ctx: RequestContext) => string | undefined)[]
  trustProxy: TrustProxy
  consent: NormalizedConsentConfig | undefined
  resolveRequestId: RequestIdResolver
  serverAppCtx: AppRuntimeContext
}

type RenderedPageOutput =
  | { kind: 'stream', response: Response }
  | { kind: 'html', html: string, headers: Record<string, string> }

async function renderPageDocument(
  deps: CompiledRouteRendererDeps,
  route: CompiledRoute,
  data: unknown,
  pageProps: Record<string, unknown>,
  ctx: RequestContext,
  hasFlash: boolean,
  disableTimeout?: () => void,
  timing?: DevTiming,
): Promise<RenderedPageOutput> {
  const { entry, doc } = route
  const renderStart = startTimer(timing)
  const rctx = createRenderContext(undefined, undefined, ctx.consent, error => deps.notifyError(error, ctx.request, 'route', ctx.requestId))
  const body = await runWithRenderContext(rctx, () => renderRouteBody(route, data, pageProps, ctx))
  if (hasFlash)
    ctx.cookies.delete(ACTION_ERROR_COOKIE)
  const docHead = await deps.resolveDocumentHead(rctx, doc.headTags as readonly string[] | undefined, ctx.url, ctx.request, ctx)
  const renderedIslands = resolveRenderedIslands(rctx, body)
  const isStreamed = rctx.pending.length > 0
  const hasIslands = renderedIslands.hasIslands || (isStreamed && entry.islandChunks.length > 0)
  const preloadChunks = [...isStreamed ? entry.eagerIslandChunks ?? entry.islandChunks : renderedIslands.eagerChunks, ...revivePreload(rctx, deps.manifest.reviveScript)]
  const hasRegions = rctx.regionNames.size > 0
  const trustedStyleHashes = mergeStyleHashes(route.headStyleHashes, docHead.styleHashes, styleHashesOf(rctx.inlineStyles))

  if (isStreamed) {
    endTimer(timing, 'render', renderStart)
    const streamStart = startTimer(timing)
    if (ctx.request.method === 'HEAD') {
      endTimer(timing, 'stream', streamStart)
      return { kind: 'stream', response: markCompressionHandled(new Response(null, { status: 200, headers: withRegionVary(deps.htmlHeaders(hasIslands, true, true, trustedStyleHashes), hasRegions) })) }
    }
    disableTimeout?.()
    const docShell = renderDocument({ ...doc, body: body + STREAM_TAIL_MARK, head: docHead.head, lang: docHead.lang, htmlAttrs: docHead.htmlAttrs, preloadChunks, hasIslands, hasSuspense: true })
    const shell = deps.hasHtmlTransformers ? await deps.applyHtmlTransforms(docShell, ctx.url, ctx.request, ctx) : docShell
    const streamStyleHashes = mergeStyleHashes(trustedStyleHashes, addedInlineStyleHashes(docShell, shell))
    endTimer(timing, 'stream', streamStart)
    const response = await compressedHtmlStream(streamDocument(shell, rctx, deps.streamTimeout, error => deps.notifyError(error, ctx.request, 'route', ctx.requestId)), 200, withRegionVary(deps.htmlHeaders(hasIslands, true, true, streamStyleHashes), hasRegions), ctx.request, deps.compressCache)
    return { kind: 'stream', response }
  }

  const docHtml = renderDocument({ ...doc, body, head: docHead.head, lang: docHead.lang, htmlAttrs: docHead.htmlAttrs, preloadChunks, hasIslands })
  const html = deps.hasHtmlTransformers ? await deps.applyHtmlTransforms(docHtml, ctx.url, ctx.request, ctx) : docHtml
  const finalStyleHashes = mergeStyleHashes(trustedStyleHashes, addedInlineStyleHashes(docHtml, html))
  endTimer(timing, 'render', renderStart)
  return { kind: 'html', html, headers: withRegionVary(deps.htmlHeaders(hasIslands, false, true, finalStyleHashes), hasRegions) }
}

async function revalidateCompiledRoute(
  deps: CompiledRouteRendererDeps,
  route: CompiledRoute,
  url: URL,
  params: Record<string, string>,
  cacheKey: string,
  cacheSpec: RouteCacheSpec,
): Promise<void> {
  const routeCache = deps.routeCache
  if (routeCache === undefined)
    return
  await runWithAppContext(deps.serverAppCtx, async () => {
    const bgReq = new Request(url.href, { method: 'GET' })
    const bgReqId = deps.resolveRequestId(bgReq)
    const { ctx, cookieStore } = makeRequestContext(bgReq, { ...params }, { trustProxy: deps.trustProxy, url, consent: deps.consent, requestId: bgReqId })
    for (const rewrite of deps.rewrites)
      rewrite(url.pathname, ctx)
    await deps.actions.run(ctx, async () => {
      let data: unknown
      if (route.entry.hasLoad && typeof route.mod.load === 'function') {
        try {
          data = await route.mod.load(ctx)
        }
        catch (error) {
          if (isNotFound(error)) {
            routeCache.delete(cacheKey)
            return
          }
          throw error
        }
        if (isNotFound(data) || data instanceof Response) {
          routeCache.delete(cacheKey)
          return
        }
      }
      const pageProps: Record<string, unknown> = { params: ctx.params, locals: ctx.locals, url: ctx.url, ...(data !== undefined ? { data } : {}) }
      const rendered = await renderPageDocument(deps, route, data, pageProps, ctx, false)
      if (rendered.kind === 'html' && !cookieStore.hasChanges)
        routeCache.set(cacheKey, rendered.html, withCacheControl(rendered.headers, cacheSpec.cacheControl), cacheSpec)
      else
        routeCache.delete(cacheKey)
    })
  })
}

async function runCompiledRouteLoad(
  deps: CompiledRouteRendererDeps,
  route: CompiledRoute,
  ctx: RequestContext,
  timing?: DevTiming,
): Promise<{ kind: 'response', response: Response } | { kind: 'data', data: unknown }> {
  const { entry, mod } = route
  let data: unknown
  if (entry.hasLoad && typeof mod.load === 'function') {
    const loadStart = startTimer(timing)
    try {
      data = await mod.load(ctx)
    }
    catch (error) {
      if (isNotFound(error))
        return { kind: 'response', response: await deps.buildNotFoundResponse(ctx.url, ctx.request, ctx, entry.file) }
      throw error
    }
    endTimer(timing, 'load', loadStart)
  }
  if (isNotFound(data))
    return { kind: 'response', response: await deps.buildNotFoundResponse(ctx.url, ctx.request, ctx, entry.file) }
  if (data instanceof Response)
    return { kind: 'response', response: data }
  return { kind: 'data', data }
}

async function resolvePrerenderedOrApi(
  deps: CompiledRouteRendererDeps,
  route: CompiledRoute,
  ctx: RequestContext,
  isRegion: boolean,
  staticPath?: string,
): Promise<Response | undefined> {
  const { entry, mod } = route
  if (isRead(ctx.request)) {
    const pre = lookupPrerendered(deps.prerenderedMap, staticPath)
    if (pre !== undefined && !isRegion && (ctx.request.method === 'HEAD' || !hasActionErrorCookie(ctx.request)))
      return deps.serveFile(ctx.request, pre)
    if (pre === undefined && entry.prerender === true && entry.prerendered !== undefined && route.dynamic)
      return deps.buildNotFoundResponse(ctx.url, ctx.request, ctx, entry.file)
  }
  const method = ctx.request.method.toUpperCase()
  const methodHandler = mod[method]
  if (typeof methodHandler === 'function')
    return await (methodHandler as (c: RequestContext) => Response | Promise<Response>)(ctx)
  if (method === 'HEAD' && typeof mod.GET === 'function')
    return stripHeadBody(await mod.GET(ctx))
  return undefined
}

export function createCompiledRouteRenderer(deps: CompiledRouteRendererDeps) {
  return async function renderCompiledRoute(
    route: CompiledRoute,
    ctx: RequestContext,
    cookieStore: CookieStore,
    disableTimeout?: () => void,
    staticPath?: string,
    timing?: DevTiming,
  ): Promise<Response> {
    const { entry, mod, doc } = route
    const isRegion = hasRegionHeader(ctx.request)

    const early = await resolvePrerenderedOrApi(deps, route, ctx, isRegion, staticPath)
    if (early !== undefined)
      return early

    if (typeof mod.default !== 'function' || !isRead(ctx.request))
      return methodNotAllowed(allowedMethodsHeader(mod))
    if (isRegion && requestedRegion(ctx.request) === undefined)
      return invalidRegionResponse(ctx.request)

    const hasFlash = ctx.request.method === 'GET' && !isRegion && hasActionErrorCookie(ctx.request) && hydrateActionErrorFlash(ctx)
    const cacheSpec = deps.routeCache !== undefined && !isRegion && !hasFlash ? entry.cache : undefined
    const cacheKey = cacheSpec !== undefined ? ctx.url.pathname + ctx.url.search : undefined
    if (cacheSpec !== undefined && cacheKey !== undefined && deps.routeCache !== undefined) {
      const cached = serveCachedHit(
        deps.routeCache,
        cacheKey,
        ctx.request,
        ctx.requestId,
        deps.compressCache,
        () => revalidateCompiledRoute(deps, route, ctx.url, ctx.params, cacheKey, cacheSpec),
        error => deps.notifyError(error, ctx.request, 'route', ctx.requestId),
      )
      if (cached !== undefined)
        return cached
    }

    const loaded = await runCompiledRouteLoad(deps, route, ctx, timing)
    if (loaded.kind === 'response')
      return loaded.response
    const pageProps: Record<string, unknown> = { params: ctx.params, locals: ctx.locals, url: ctx.url, ...(loaded.data !== undefined ? { data: loaded.data } : {}) }

    if (isRegion) {
      return respondRegion(
        ctx.request, mod, pageProps, entry.path, deps.htmlHeaders,
        rctx => deps.resolveDocumentHead(rctx, doc.headTags as readonly string[] | undefined, ctx.url, ctx.request, ctx),
        deps.streamTimeout, error => deps.notifyError(error, ctx.request, 'route', ctx.requestId),
        deps.hasHtmlTransformers ? html => deps.applyHtmlTransforms(html, ctx.url, ctx.request, ctx) : undefined,
      )
    }

    const rendered = await renderPageDocument(deps, route, loaded.data, pageProps, ctx, hasFlash, disableTimeout, timing)
    if (rendered.kind === 'stream')
      return rendered.response
    if (cacheSpec !== undefined && cacheKey !== undefined && deps.routeCache !== undefined && !cookieStore.hasChanges) {
      const cachedHeaders = withCacheControl(rendered.headers, cacheSpec.cacheControl)
      return deps.routeCache.respondMiss(deps.routeCache.set(cacheKey, rendered.html, cachedHeaders, cacheSpec), rendered.html, cachedHeaders, ctx.request, ctx.requestId, deps.compressCache)
    }
    return compressedHtmlResponse(rendered.html, 200, rendered.headers, ctx.request, deps.compressCache)
  }
}
