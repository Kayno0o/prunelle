// Prunelle native Bun.serve server:
// - Static + dynamic ([param], [...catchall]) Router
// - Composable directory-scoped _middleware.ts chains + ctx.cookies + ctx.locals
// - Unified Standard-Schema action() endpoint handling with CSRF verification
// - <Head> collection + cancel-safe streaming <Suspense> (0-overhead fast path when unused)
// - Hybrid prerendered HTML serving + embedded single-executable mode

import type { ActionRegistry, RegisteredAction } from './action-registry'
import type { ServedFile } from './assets'
import type { NormalizedConsentConfig } from './consent'
import type { CookieStore } from './cookies'
import type { NotifyError } from './errors'
import type { DevTiming } from './health'
import type { DeniedInfo, EmbeddedServerConfig, PrunelleApp, PrunelleServer, Middleware, RequestContext } from './http'
import type { RateLimiter, RateLimitStore } from './rate-limit'
import type { LoadedMiddlewareModule } from './page'
import type { ServerPluginHost } from './plugin-host'
import type { RequestPath } from './request-path'
import type { CompiledRoute } from './route-table'
import type { FastHandler } from './routing'
import type { TrustProxy } from './security'
import { join } from 'node:path'
import { createAppContext, getAppContext, resolvePlugins, runWithAppContext } from '../plugins/index'
import { createNavigation } from '../ssr/navigation'
import { executeAction, finishActionRedirect, isServerAction } from './action'
import { createActionRegistry } from './action-registry'
import { createAssets } from './assets'
import { CompressionCache, maybeCompressResponse } from './compress'
import { normalizeConsentConfig } from './consent'
import { createDocumentHooks, createHtmlHeaders, withPluginHtmlCsp } from './document'
import { createErrorNotifier, createFallbackPages, devErrorResponse } from './errors'
import { collectHealthChecks, createHealthHandler, createRequestIdResolver, createTiming, formatServerTiming, runTimedChain, withRequestId } from './health'
import { acceptsHtml, applyHstsHeader, DEFAULT_MAX_REQUEST_BODY_SIZE, enforceRequestBodyLimit, finalizeResponse, getDeniedInfo, makeRequestContext, runChain, wantsJson } from './http'
import { stripHeadBody } from './page'
import { resolveParamMatchers } from './param-matchers'
import { allowedPluginMethodsHeader, createServerPluginHost, takesEncoded } from './plugin-host'

import { withRegionVary } from './region'
import { decodeRequestPath, literalPath } from './request-path'
import { nativePrerenderedCheck } from './prerendered'
import { createRouteCache } from './route-cache'
import { compileRouteTable, createCompiledRouteRenderer } from './route-table'
import { actionRoutePrefix, createAncestorMiddlewareLookup, inferRoutesServerPrefix, methodNotAllowed } from './routing'
import { isPlainRead, isRead, serveHandlers } from './serve-handlers'
import { buildSecurityHeaderEntries, resolveHstsValue, verifyOrigin } from './security'
import { createStreamTracker } from './stream'

/**
 * Request-scoped locals bag shared across middlewares, plugins, actions, layouts, and pages.
 * Augment via `declare module 'prunelle/server' { interface PrunelleLocals { ... } }`.
 */
export interface PrunelleLocals {}

export { CONTENT_IMAGE_RESOLVER_SERVICE, createAppContext, defineConfig, definePlugin, getAppContext, I18N_CONFIG_SERVICE, loadConfig, pickRuntimeConfig, resolvePlugins, resolveServerConfig, runWithAppContext } from '../plugins/index'
export type { ActiveI18nConfig, AppRuntimeContext, BuildPluginContext, BuildPluginTarget, CheckPluginContext, ComplianceConfig, ComplianceRule, ConsentConfig, ContentImageResolver, ContentImageResult, CreateAppContextOptions, DocumentHeadContext, FinalizeBuildContext, PrunelleConfig, PrunellePlugin, MiddlewareOptions, PluginRouteOptions, ServerErrorInfo, ServerPluginAPI, ServerRuntimeConfig } from '../plugins/index'
export { action, getActionError } from './action'
export type { ActionContext, ActionErrorFlash, ActionOptions, ActionResult, ServerAction } from './action'
export { CompressionCache, isCompressibleType, pickEncoding, pickPrecompressedEncoding, toWeakEtag } from './compress'
export type { CompressionEncoding, PrecompressedEncoding } from './compress'
export type { RequestConsent } from './consent'
export type { CookieOptions, Cookies } from './cookies'
export { defineEnv, nodeEnv } from './env'
export type { HealthCheckConfig, HealthCheckFn, HealthCheckResult } from './health'
export { DEFAULT_MAX_REQUEST_BODY_SIZE, notFound } from './http'
export type { EmbeddedServerConfig, ExtractRouteParams, PrunelleApp, LayoutProps, LoaderData, LoaderFn, Middleware, NotFoundResult, PageProps, ParamMatcherTypes, RequestContext, RouteContext, ServerOptions, StatusPageProps } from './http'
export { createServer } from './loader'
export { buildRouteCacheSpec, createRouteCache, formatCacheSpec, parseCacheDuration, RouteCache } from './route-cache'
export type { CachedRouteEntry, RouteCacheOptions, RouteCacheSpec } from './route-cache'
export { DEFAULT_CSP, DEFAULT_HSTS, DEFAULT_PERMISSIONS_POLICY, getClientIp, isHttpsRequest, isTrustedOrigin, PRUNELLE_ISLAND_STYLE_HASH, PRUNELLE_STREAM_SCRIPT_HASH, PRUNELLE_SUSPENSE_STYLE_HASH, verifyOrigin, withCspHashes } from './security'
export type { SecurityHeadersOptions, TrustProxy } from './security'
export { formatIssuePath, formatSchemaIssues, validateSchema, validateSchemaSync } from './standard-schema'
export type { InferInput, InferOutput, StandardSchemaIssue, StandardSchemaV1, ValidationFailure, ValidationResult, ValidationSuccess } from './standard-schema'

// Matches Bun.serve's 30 s idle timeout, which a streamed page turns off.
const DEFAULT_STREAM_TIMEOUT = 30_000


const isEventStream = (res: Response): boolean => (res.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')
const isApiHandler = (mod: CompiledRoute['mod'], method: string): boolean => typeof mod[method] === 'function' || (method === 'HEAD' && typeof mod.GET === 'function')

function maybeRenderDenied(
  res: Response,
  request: Request,
  url: URL,
  ctx: RequestContext,
  renderDenied: (denied: DeniedInfo, url: URL, req: Request, ctx?: RequestContext, routeFile?: string) => Promise<Response>,
  routeFile?: string,
  isApi = false,
): Response | Promise<Response> {
  if (isApi)
    return res
  const denied = getDeniedInfo(res)
  if (denied === undefined || !acceptsHtml(request))
    return res
  return renderDenied(denied, url, request, ctx, routeFile)
}

const makeServerError = (securityRecord: Record<string, string>) => (): Response => new Response('Internal Server Error', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8', ...securityRecord } })
// A file body Bun could not open: a build swapped in since this app loaded, or a file deleted by hand. Never cached.
const badRequest = (): Response => new Response('Bad Request', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })
const makeFileGone = (securityRecord: Record<string, string>) => (): Response => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...securityRecord } })

function matchPluginRoute(pluginRouter: ServerPluginHost['router'], requestPath: RequestPath, effective: RequestPath) {
  const rawMatch = effective !== requestPath ? takesEncoded(pluginRouter.match(requestPath), requestPath) : undefined
  return rawMatch ?? takesEncoded(pluginRouter.match(effective), effective)
}

function matchStaticOrPublic(
  request: Request,
  requestPath: RequestPath,
  assetMap: ReadonlyMap<string, ServedFile>,
  publicMap: ReadonlyMap<string, ServedFile>,
  pluginRouter: ServerPluginHost['router'],
): ServedFile | undefined {
  const { staticPath } = requestPath
  if (staticPath === undefined)
    return undefined
  const asset = assetMap.get(staticPath)
  if (asset !== undefined)
    return asset
  const pub = publicMap.get(staticPath)
  if (pub === undefined)
    return undefined
  const matchedPlugin = pluginRouter.match(requestPath)
  const reqMethod = request.method.toUpperCase()
  const shadowedByPlugin = matchedPlugin !== undefined
    && (matchedPlugin.data.has(reqMethod) || (reqMethod === 'HEAD' && matchedPlugin.data.has('GET')) || matchedPlugin.data.has('ALL'))
  return shadowedByPlugin ? undefined : pub
}

function createRequestGuards(
  maxRequestBodySize: number,
  finish: (res: Response, request: Request, cookieStore?: CookieStore, requestId?: string, serverTiming?: string) => Response,
) {
  const refuseCrossSite = (request: Request, reason: string, cookieStore?: CookieStore, requestId?: string): Response =>
    finish(Response.json({ ok: false, status: 403, error: reason }, { status: 403 }), request, cookieStore, requestId)

  const checkBodyLimit = async (request: Request, bodyLimited: boolean, cookieStore?: CookieStore, requestId?: string): Promise<Request | Response> => {
    if (bodyLimited)
      return request
    const bounded = await enforceRequestBodyLimit(request, maxRequestBodySize)
    if (bounded.ok)
      return bounded.request
    return finish(wantsJson(request)
      ? Response.json({ ok: false, status: 413, error: 'Payload Too Large' }, { status: 413 })
      : new Response('Payload Too Large', { status: 413, headers: { 'content-type': 'text/plain; charset=utf-8' } }), request, cookieStore, requestId)
  }
  return { refuseCrossSite, checkBodyLimit }
}

interface ActionDispatcherDeps {
  actions: ActionRegistry
  rewrites: readonly ((pathname: string, ctx: RequestContext) => string | undefined)[]
  trustedOrigins: Set<string> | undefined
  trustProxy: TrustProxy
  consent: NormalizedConsentConfig | undefined
  rateLimits: RateLimitStore
  isDev: boolean
  refuseCrossSite: (request: Request, reason: string, cookieStore?: CookieStore, requestId?: string) => Response
  checkBodyLimit: (request: Request, bodyLimited: boolean, cookieStore?: CookieStore, requestId?: string) => Promise<Request | Response>
  finish: (res: Response, request: Request, cookieStore?: CookieStore, requestId?: string, serverTiming?: string) => Response
  notifyError: NotifyError
  renderError: (error: unknown, cookieStore: CookieStore | undefined, url: URL, request: Request, ctx?: RequestContext) => Promise<Response>
}

function createActionDispatcher(deps: ActionDispatcherDeps) {
  const { actions, rewrites, trustedOrigins, trustProxy, consent, rateLimits, isDev, refuseCrossSite, checkBodyLimit, finish, notifyError, renderError } = deps
  const limiters = new WeakMap<RegisteredAction['act'], RateLimiter>()
  const limiterFor = (act: RegisteredAction['act']): RateLimiter | undefined => {
    if (act.rateLimit === undefined)
      return undefined
    let limiter = limiters.get(act)
    if (limiter === undefined) {
      limiter = rateLimits.limiter(act.rateLimit)
      limiters.set(act, limiter)
    }
    return limiter
  }
  return async (
    registeredAction: RegisteredAction,
    request: Request,
    url: URL,
    rawPathname: string,
    remoteIp: string | undefined,
    bodyLimited: boolean,
    requestId: string,
    existing?: { ctx: RequestContext, cookieStore: CookieStore },
  ): Promise<Response> => {
    const actionHandler = request.method === 'POST' ? registeredAction : undefined
    let req = request
    if (actionHandler !== undefined) {
      const originCheck = verifyOrigin(request, trustedOrigins, trustProxy, url)
      if (!originCheck.ok)
        return refuseCrossSite(request, originCheck.reason, existing?.cookieStore, requestId)
      const checked = await checkBodyLimit(request, bodyLimited, existing?.cookieStore, requestId)
      if (checked instanceof Response)
        return checked
      req = checked
    }
    const { act, middlewares } = registeredAction
    const { ctx, cookieStore } = existing ?? makeRequestContext(req, {}, { trustProxy, remoteIp, url, consent, requestId })
    ctx.request = req
    if (existing === undefined && rewrites.length > 0) {
      for (const rewrite of rewrites)
        rewrite(rawPathname, ctx)
    }
    const timing = createTiming(isDev)
    try {
      const res = await actions.run(ctx, () => runTimedChain(ctx, middlewares, () =>
        actionHandler !== undefined
          ? executeAction(act, req, ctx, trustedOrigins, trustProxy, limiterFor(act))
          : methodNotAllowed('POST'),
      timing, runChain))
      return finish(actionHandler !== undefined ? finishActionRedirect(res, req) : res, req, cookieStore, ctx.requestId, formatServerTiming(timing))
    }
    catch (error) {
      notifyError(error, req, 'action', ctx.requestId)
      return renderError(error, cookieStore, ctx.url, req, ctx)
    }
  }
}

interface ManifestActions {
  manifest: EmbeddedServerConfig['manifest']
  modules: EmbeddedServerConfig['modules']
  actions: ReturnType<typeof createActionRegistry>
  routesPrefix: ReturnType<typeof inferRoutesServerPrefix>
  routePathByFile: Map<string, string>
  middlewaresFor: (path: string) => readonly Middleware[]
  middlewaresForPaths: (paths: string[]) => readonly Middleware[]
}

// Server actions and their live URLs.
function registerManifestActions({ manifest, modules, actions, routesPrefix, routePathByFile, middlewaresFor, middlewaresForPaths }: ManifestActions): void {
  for (const entry of manifest.actions) {
    const mod = modules[entry.file] as Record<string, unknown> | undefined
    const act = mod?.[entry.exportName]
    if (isServerAction(act)) {
      const routePrefix = actionRoutePrefix(entry, routesPrefix, routePathByFile)
      const pluginMws = routePrefix !== undefined ? middlewaresForPaths([entry.url, routePrefix]) : middlewaresFor(entry.url)
      actions.register(act, entry.exportName, entry.url, entry.middlewares.map(m => (modules[m] as LoadedMiddlewareModule).default), pluginMws)
    }
  }
}

export async function createServerFromEmbedded(config: EmbeddedServerConfig): Promise<PrunelleApp> {
  const { manifest, modules, assets, publicAssets = {}, publicEtags = {}, prerendered = {}, prerenderedFiles = {}, prerenderedEtags = {}, lang = 'en', security } = config
  const plugins = resolvePlugins(config.plugins)
  const assetPrefix = (config.assetPrefix ?? '/_pru').replace(/\/$/, '')
  const site = config.site?.replace(/\/$/, '') || undefined
  const trustedOriginsList = config.trustedOrigins ?? []
  const trustedOrigins = trustedOriginsList.length > 0 ? new Set(trustedOriginsList) : undefined
  const trustProxy = config.trustProxy ?? false
  const consent = normalizeConsentConfig(config.consent)
  const maxRequestBodySize = config.maxRequestBodySize ?? DEFAULT_MAX_REQUEST_BODY_SIZE
  const streamTimeout = config.streamTimeout ?? DEFAULT_STREAM_TIMEOUT
  const isDev = config.dev ?? (process.env.PRUNELLE_DEV === '1')
  const serverRoot = config.root ?? process.cwd()
  const serverOutDir = config.outDir ?? join(serverRoot, 'dist')
  const serverPublicDir = config.publicDir ?? join(serverOutDir, 'public')
  const parentAppCtx = getAppContext()

  const alwaysLoadRuntime = plugins.some(p => Boolean(p.clientEntry))
  const notifyError = createErrorNotifier(config.onError, plugins, { dev: isDev, sink: config.errorSink })
  const document = createDocumentHooks({ plugins, lang, trustProxy, notifyError })
  const { hasHeadHooks, hasHtmlTransformers, resolveDocumentHead, applyHtmlTransforms } = document

  const securityEntries = buildSecurityHeaderEntries(security)
  const securityRecord: Record<string, string> = Object.fromEntries(securityEntries)
  const nosniffHeader: Record<string, string> = security !== false && (security?.contentTypeOptions ?? true) ? { 'x-content-type-options': 'nosniff' } : {}
  const hstsValue = resolveHstsValue(security)
  const withHsts = (res: Response, request: Request): Response => applyHstsHeader(res, request, hstsValue, trustProxy, isDev)
  // The one way out of every response not built with the security headers already in place.
  const finish = (res: Response, request: Request, cookieStore?: CookieStore, requestId?: string, serverTiming?: string): Response =>
    withHsts(finalizeResponse(res, cookieStore, securityEntries, requestId, serverTiming), request)
  const resolveRequestId = createRequestIdResolver(trustProxy)
  const serverError = makeServerError(securityRecord)
  const fileGone = makeFileGone(securityRecord)
  const navigation = createNavigation(config.navigation)
  const htmlHeaders = createHtmlHeaders(security, securityRecord, navigation, plugins)
  const streams = createStreamTracker()

  const compressEnabled = config.compress ?? !isDev
  const compressCache = compressEnabled ? new CompressionCache() : undefined
  const routeCache = createRouteCache(config.routeCache, isDev || config.prerender === true)

  const files = createAssets({ assets, assetPrefix, isDev, compressEnabled, compressCache, nosniffHeader, securityRecord, withHsts })
  const { assetMap, publicMap, serveFile } = files
  files.registerPublicFiles(publicAssets, publicEtags)

  const serverAppCtx = createAppContext({
    root: serverRoot,
    outDir: serverOutDir,
    publicDir: serverPublicDir,
    assetPrefix,
    site,
    dev: isDev, nodeEnv: config.nodeEnv ?? parentAppCtx?.nodeEnv,
    onRegisterPublicFile: (rel) => {
      parentAppCtx?.registerPublicFile(rel)
      files.registerPublicFromDisk(serverPublicDir, rel)
    },
  })

  const actions = createActionRegistry()
  const pluginHost = await createServerPluginHost({
    plugins,
    config,
    manifest,
    appCtx: serverAppCtx,
    root: serverRoot,
    outDir: serverOutDir,
    assetPrefix,
    site,
    dev: isDev,
    trustProxy,
    trustedOriginsList,
    trustedOrigins,
  })
  const { router: pluginRouter, middlewaresFor, middlewaresForPaths } = pluginHost
  const healthPath = `${assetPrefix}/health`
  const healthHandler = createHealthHandler({ checks: collectHealthChecks(config.healthCheck, pluginHost.healthChecks), securityRecord, withHsts, resolveRequestId })
  const hasPluginRewrites = pluginHost.rewrites.length > 0
  const routesPrefix = inferRoutesServerPrefix(manifest)
  const paramMatchers = resolveParamMatchers(manifest.paramMatchers, modules)
  const routePathByFile = new Map(manifest.routes.map(r => [r.file, r.path]))
  const ancestorMiddlewaresFor = createAncestorMiddlewareLookup(manifest, modules, routesPrefix, paramMatchers)
  const pluginMiddlewaresFor = (effectiveScopedPath: string, rawScopedPath: string): readonly Middleware[] =>
    effectiveScopedPath === rawScopedPath ? middlewaresFor(effectiveScopedPath) : middlewaresForPaths([effectiveScopedPath, rawScopedPath])

  registerManifestActions({ manifest, modules, actions, routesPrefix, routePathByFile, middlewaresFor, middlewaresForPaths })
  const { buildNotFoundResponse, renderError, renderDenied } = createFallbackPages({ manifest, modules, routesPrefix, paramMatchers, lang, alwaysLoadRuntime, navigation: navigation.html, dev: isDev, document, htmlHeaders, notifyError, finish })

  async function renderNotFound(
    cookieStore: CookieStore,
    url: URL,
    request: Request,
    ctx: RequestContext,
    effective: RequestPath,
    rawScopedPath: string,
    timing?: DevTiming,
  ): Promise<Response> {
    const pluginMws = pluginMiddlewaresFor(effective.scopedPath, rawScopedPath)
    const ancestor = ancestorMiddlewaresFor(effective)
    if (ancestor !== undefined)
      ctx.params = ancestor.params
    const chain = ancestor === undefined ? pluginMws : [...pluginMws, ...ancestor.middlewares]
    try {
      const rawRes = await actions.run(ctx, () => runTimedChain(ctx, chain, () => buildNotFoundResponse(url, request, ctx), timing, runChain))
      return finish(await maybeRenderDenied(rawRes, request, url, ctx, renderDenied), request, cookieStore, ctx.requestId, formatServerTiming(timing))
    }
    catch (error) {
      notifyError(error, request, 'route', ctx.requestId)
      return renderError(error, cookieStore, url, request, ctx)
    }
  }

  const { refuseCrossSite, checkBodyLimit } = createRequestGuards(maxRequestBodySize, finish)

  const { router, fastStaticPages } = compileRouteTable({
    manifest, modules, paramMatchers, lang, alwaysLoadRuntime, navigation: navigation.html, middlewaresFor,
    pluginIntercepts: path => hasPluginRewrites || hasHeadHooks || hasHtmlTransformers || pluginRouter.match(literalPath(path)) !== undefined,
    fast: { trustProxy, consent, htmlHeaders, compressCache, routeCache, actions, buildNotFoundResponse, renderError, renderDenied, notifyError, finish, withHsts, dev: isDev, resolveRequestId },
  })
  const { all: prerenderedMap, fast: fastPrerenderedMap } = files.collectPrerendered(manifest.routes, {
    prerendered,
    prerenderedFiles,
    prerenderedEtags,
    // The route's region script is what sends `x-pru-region`, so a page without one never varies on it.
    htmlHeaders: (route, urlPath) => withRegionVary(htmlHeaders(route.islandChunks.length > 0, false, false, route.prerenderedStyleHashes?.[urlPath]), route.usesRegion === true),
    isFast: nativePrerenderedCheck({ site, rewrites: pluginHost.rewrites, pluginRouter, router, actions, middlewaresForPaths, trustProxy, consent }),
  })

  const renderCompiledRoute = createCompiledRouteRenderer({
    manifest, prerenderedMap, serveFile, buildNotFoundResponse, htmlHeaders, resolveDocumentHead, applyHtmlTransforms, hasHtmlTransformers, streamTimeout, compressCache, routeCache, notifyError, actions, rewrites: pluginHost.rewrites, trustProxy, consent, resolveRequestId, serverAppCtx,
  })

  const dispatchAction = createActionDispatcher({
    actions, rewrites: pluginHost.rewrites, trustedOrigins, trustProxy, consent, rateLimits: pluginHost.rateLimits, isDev, refuseCrossSite, checkBodyLimit, finish, notifyError, renderError,
  })

  // `bodyLimited` is set under `serve()`, where Bun.serve already enforces maxRequestBodySize on every body, chunked ones included.
  async function handleInternal(request: Request, remoteIp?: string, disableTimeout?: () => void, bodyLimited = false): Promise<Response> {
    const requestId = resolveRequestId(request)
    try {
      const url = new URL(request.url)
      const rawPathname = url.pathname
      const requestPath = decodeRequestPath(rawPathname)
      if (requestPath === undefined)
        return finish(badRequest(), request, undefined, requestId)
      const { staticPath, scopedPath } = requestPath
      if (staticPath === healthPath)
        return healthHandler(request, requestId)
      const read = isRead(request)

      // 1. Static client assets, then public/ files (explicit plugin routes take precedence over public/ files)
      if (read) {
        const staticFile = matchStaticOrPublic(request, requestPath, assetMap, publicMap, pluginRouter)
        if (staticFile !== undefined)
          return withRequestId(await serveFile(request, staticFile), requestId)
      }

      // 2. Server actions (POST /_pru/action/<id>; non-POST runs applicable middlewares before 405)
      const registeredAction = staticPath !== undefined ? actions.byUrl(staticPath) : undefined
      if (registeredAction !== undefined)
        return dispatchAction(registeredAction, request, url, rawPathname, remoteIp, bodyLimited, requestId)

      // 3. Prerendered static HTML, then 4. the zero-overhead static route path
      const plainRead = isPlainRead(request)
      if (plainRead && staticPath !== undefined) {
        const pre = fastPrerenderedMap.get(staticPath)
        if (pre !== undefined)
          return withRequestId(await serveFile(request, pre), requestId)
        const fast = fastStaticPages.get(staticPath)
        if (fast !== undefined)
          return fast(request, remoteIp, url, requestId)
      }

      // 5. Full Router + Plugin Rewrites + Plugin Routes + Middleware + Streaming/Head/Error pipeline
      const { ctx, cookieStore } = makeRequestContext(request, {}, { trustProxy, remoteIp, url, consent, requestId })
      const timing = createTiming(isDev)

      // Apply plugin URL rewrites (e.g. @prunellejs/i18n stripping /fr prefix and setting ctx.locals.locale)
      let effectivePath = rawPathname
      for (const rewrite of pluginHost.rewrites) {
        const nextPath = rewrite(effectivePath, ctx)
        if (nextPath !== undefined)
          effectivePath = nextPath
      }
      let effective = requestPath
      if (effectivePath !== rawPathname) {
        const rewritten = decodeRequestPath(effectivePath)
        if (rewritten === undefined)
          return finish(badRequest(), request, cookieStore, requestId)
        effective = rewritten
        const rewrittenAction = rewritten.staticPath !== undefined ? actions.byUrl(rewritten.staticPath) : undefined
        if (rewrittenAction !== undefined)
          return dispatchAction(rewrittenAction, request, url, effectivePath, remoteIp, bodyLimited, requestId, { ctx, cookieStore })
      }
      const { scopedPath: effectiveScopedPath, staticPath: effectiveStaticPath } = effective

      // Custom plugin routes run behind path-matched plugin middlewares so ctx.locals is available without cross-scope leaks.
      const method = request.method.toUpperCase()
      const pluginMatch = matchPluginRoute(pluginRouter, requestPath, effective)
      const directPluginDef = pluginMatch?.data.get(method) ?? pluginMatch?.data.get('ALL')
      const headFallbackPluginDef = directPluginDef === undefined && method === 'HEAD' ? pluginMatch?.data.get('GET') : undefined
      const routeDef = directPluginDef ?? headFallbackPluginDef
      if (pluginMatch !== undefined && routeDef !== undefined) {
        if (routeDef.csrf) {
          const originCheck = verifyOrigin(request, routeDef.trustedOrigins, routeDef.trustProxy, url)
          if (!originCheck.ok)
            return refuseCrossSite(request, originCheck.reason, cookieStore, requestId)
        }
        const checked = await checkBodyLimit(request, bodyLimited, cookieStore, requestId)
        if (checked instanceof Response)
          return checked
        ctx.request = checked
        ctx.params = pluginMatch.params
        const pluginMws = pluginMiddlewaresFor(effectiveScopedPath, scopedPath)
        try {
          let res = await actions.run(ctx, () => runTimedChain(ctx, pluginMws, () => routeDef.handler(ctx), timing, runChain))
          if (headFallbackPluginDef !== undefined)
            res = stripHeadBody(res)
          else if (isEventStream(res))
            res = streams.track(res, disableTimeout)
          return finish(await maybeCompressResponse(await withPluginHtmlCsp(res, htmlHeaders), ctx.request, compressCache), ctx.request, cookieStore, requestId, formatServerTiming(timing))
        }
        catch (error) {
          notifyError(error, ctx.request, 'plugin', requestId)
          return renderError(error, cookieStore, ctx.url, ctx.request, ctx)
        }
      }

      // Localized/rewritten public/ links (e.g. /fr/logo.png -> /logo.png)
      if (read && effectivePath !== rawPathname && effectiveStaticPath !== undefined) {
        const pub = publicMap.get(effectiveStaticPath)
        if (pub !== undefined)
          return withRequestId(await serveFile(request, pub), requestId)
      }

      const matched = router.match(effective)
      if (matched === undefined) {
        if (pluginMatch !== undefined) {
          ctx.params = pluginMatch.params
          const allow = allowedPluginMethodsHeader(pluginMatch.data)
          const pluginMws = pluginMiddlewaresFor(effectiveScopedPath, scopedPath)
          try {
            const res = await actions.run(ctx, () => runTimedChain(ctx, pluginMws, () => methodNotAllowed(allow), timing, runChain))
            return finish(res, request, cookieStore, requestId, formatServerTiming(timing))
          }
          catch (error) {
            notifyError(error, request, 'plugin', requestId)
            return renderError(error, cookieStore, ctx.url, request, ctx)
          }
        }
        return renderNotFound(cookieStore, ctx.url, request, ctx, effective, scopedPath, timing)
      }

      ctx.params = matched.params
      const route = matched.data

      // CSRF verification & body limit for file-based API routes (opt out of CSRF via `export const csrf = false`)
      if (typeof route.mod[method] === 'function') {
        if (route.mod.csrf !== false) {
          const originCheck = verifyOrigin(request, trustedOrigins, trustProxy, url)
          if (!originCheck.ok)
            return refuseCrossSite(request, originCheck.reason, cookieStore, requestId)
        }
        const checked = await checkBodyLimit(request, bodyLimited, cookieStore, requestId)
        if (checked instanceof Response)
          return checked
        ctx.request = checked
      }

      const routeMiddlewares = pluginHost.hasPathScopedMiddlewares && (route.dynamic || effectiveScopedPath !== scopedPath)
        ? [...pluginMiddlewaresFor(effectiveScopedPath, scopedPath), ...route.dirMiddlewares]
        : route.middlewares

      try {
        const rawRes = await actions.run(ctx, () => runTimedChain(ctx, routeMiddlewares, () => renderCompiledRoute(route, ctx, cookieStore, disableTimeout, staticPath, timing), timing, runChain))
        const handledRes = await maybeRenderDenied(rawRes, ctx.request, ctx.url, ctx, renderDenied, route.entry.file, isApiHandler(route.mod, method))
        const res = isEventStream(handledRes) ? streams.track(handledRes, disableTimeout) : handledRes
        // Compress uncompressed API/middleware responses after the middleware chain unwinds.
        const finalRes = res.headers.has('content-encoding') ? res : await maybeCompressResponse(res, ctx.request, compressCache)
        return finish(finalRes, ctx.request, cookieStore, requestId, formatServerTiming(timing))
      }
      catch (error) {
        notifyError(error, ctx.request, 'route', requestId)
        return renderError(error, cookieStore, ctx.url, ctx.request, ctx, route.entry.file)
      }
    }
    catch (error) {
      notifyError(error, request, 'route', requestId)
      return withHsts(withRequestId(isDev ? devErrorResponse(error, request) : serverError(), requestId), request)
    }
  }

  function handle(request: Request, remoteIp?: string): Promise<Response> {
    return runWithAppContext(serverAppCtx, () => handleInternal(request, remoteIp))
  }

  const runRequest = (req: Request, remoteIp: string | undefined, disableTimeout: () => void): Promise<Response> => runWithAppContext(serverAppCtx, () => handleInternal(req, remoteIp, disableTimeout, true))
  const runFast = (handler: FastHandler, req: Request, remoteIp: string | undefined): Response | Promise<Response> => runWithAppContext(serverAppCtx, () => handler(req, remoteIp))
  const handlers = (server: () => PrunelleServer | undefined) => serveHandlers(server, { files, fastPrerenderedMap, fastStaticPages, pluginRouter, healthPath, healthHandler, resolveRequestId, runRequest, runFast, notifyError, serverError, fileGone })

  function serve(port = 3000, hostname = '127.0.0.1') {
    const server: PrunelleServer = Bun.serve({ port, hostname, idleTimeout: 30, maxRequestBodySize, development: false, ...handlers(() => server) })
    return server
  }

  const reloadInto = (server: PrunelleServer): void => {
    server.reload(handlers(() => server))
  }
  return { handle, serve, reloadInto, closeStreams: streams.closeAll, dispose: async () => { await streams.closeAll(); await pluginHost.dispose() } }
}
