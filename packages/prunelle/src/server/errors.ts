// Errors and status pages: `onError` hooks, nested `_404`/`_error`/`_401`/`_403`/`_429`/`_503` lookup, and HTML `ctx.deny()` rendering.

import type { BuildManifest, StatusPageKind, StatusPageManifestEntry } from '../build/index'
import type { Html } from '../jsx-runtime'
import type { PrunellePlugin, ServerErrorInfo } from '../plugins/index'
import type { DocumentOptions } from '../ssr/index'
import type { CookieStore } from './cookies'
import type { DocumentHooks, HtmlHeaders } from './document'
import type { DeniedInfo, RequestContext } from './http'
import type { ParamMatcherMap } from './param-matchers'
import { createRenderContext, runWithRenderContext } from '../ssr/context'
import { raw, renderDocument, ssrChild } from '../ssr/index'
import { addedInlineStyleHashes, headTagStyleHashes, mergeStyleHashes, resolveRenderedIslands, revivePreload } from './document'
import { wantsJson } from './http'
import { BUILTIN_PARAM_MATCHERS } from './param-matchers'
import { decodeRequestPath, pathPrefix } from './request-path'
import { Router } from './router'
import { styleHashesOf } from './security'

export type NotifyError = (error: unknown, request: Request, source: ServerErrorInfo['source'], requestId?: string) => void

/** The text of an error a dev response shows: its stack, which starts with its message. */
export const errorDetail = (error: unknown): string => error instanceof Error ? error.stack ?? error.message : String(error)

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

const HTML_ESCAPE_RE = /[&<>"']/g
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (value: string): string => value.replace(HTML_ESCAPE_RE, ch => HTML_ESCAPES[ch]!)

const STATUS_KINDS = new Set<string>(['401', '403', '404', '429', '503'])

/** What a dev server answers with an unhandled error: its message and stack, as JSON when the request wants it. */
export function devErrorResponse(error: unknown, request: Request): Response {
  if (wantsJson(request))
    return Response.json({ ok: false, status: 500, error: errorMessage(error), stack: errorDetail(error) }, { status: 500 })
  return new Response(errorDetail(error), { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

export interface ErrorNotifierOptions {
  /** With no `onError` hook to hear an unhandled error, `console.error` does (unless a `sink` captures it outside dev, as `testApp` and prerender do). */
  dev?: boolean | undefined
  /** Hears every unhandled error, hooks or not: how `testApp().errors` fills. */
  sink?: ((info: ServerErrorInfo) => void) | undefined
}

export function createErrorNotifier(onError: ((info: ServerErrorInfo) => void) | undefined, plugins: readonly PrunellePlugin[], options: ErrorNotifierOptions = {}): NotifyError {
  const errorHooks: { owner: string, hook: (info: ServerErrorInfo) => void }[] = []
  if (onError !== undefined)
    errorHooks.push({ owner: 'prunelle.config.ts', hook: onError })
  for (const p of plugins) {
    if (p.onError !== undefined)
      errorHooks.push({ owner: p.name, hook: p.onError })
  }
  return (error, request, source, requestId) => {
    const info: ServerErrorInfo = requestId !== undefined ? { error, request, source, requestId } : { error, request, source }
    options.sink?.(info)
    if (errorHooks.length === 0 && (options.dev === true || options.sink === undefined)) {
      const idSuffix = requestId !== undefined ? ` [${requestId}]` : ''
      console.error(`prunelle: unhandled error in ${source} ${request.method} ${new URL(request.url).pathname}${idSuffix}`, error)
    }
    for (const { owner, hook } of errorHooks) {
      try {
        hook(info)
      }
      catch (hookError) {
        console.error(`prunelle: the onError hook of ${owner} threw; the other hooks still run.`, hookError)
      }
    }
  }
}

interface LayoutModule {
  default: (props: { children: Html, url?: URL, params?: Record<string, string>, locals?: object }) => Html | string | Promise<Html | string>
}

interface StatusPageModule {
  default?: (props: Record<string, unknown>) => Html | string | Promise<Html | string>
}

interface CompiledStatusPage {
  entry: StatusPageManifestEntry
  render: (props: Record<string, unknown>) => Html | string | Promise<Html | string>
  layouts: LayoutModule[]
  doc: DocumentOptions
}

interface StatusPageLookup {
  find: (kind: StatusPageKind, url?: URL, routeFile?: string) => { page: CompiledStatusPage, params?: Record<string, string> } | undefined
}

function dirnamePrefix(file: string): string {
  const slash = file.lastIndexOf('/')
  return slash === -1 ? '' : file.slice(0, slash + 1)
}

function parentDirPrefix(dir: string): string | undefined {
  if (dir === '')
    return undefined
  const trimmed = dir.endsWith('/') ? dir.slice(0, -1) : dir
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? '' : trimmed.slice(0, slash + 1)
}

function legacyStatusEntries(manifest: BuildManifest, routesPrefix: string): StatusPageManifestEntry[] {
  const layouts = manifest.rootLayoutFile !== undefined ? [manifest.rootLayoutFile] : []
  const styles = manifest.globalStyles ?? manifest.styles
  const entries: StatusPageManifestEntry[] = []
  if (manifest.errorFile !== undefined)
    entries.push({ kind: 'error', dirPattern: '/', dirPrefix: routesPrefix, file: manifest.errorFile, layouts, styles, islandChunks: [] })
  if (manifest.notFoundFile !== undefined)
    entries.push({ kind: '404', dirPattern: '/', dirPrefix: routesPrefix, file: manifest.notFoundFile, layouts, styles, islandChunks: [] })
  return entries
}

function buildStatusPageLookup(
  manifest: BuildManifest,
  modules: Record<string, unknown>,
  baseDoc: DocumentOptions,
  routesPrefix: string,
  paramMatchers: ParamMatcherMap,
): StatusPageLookup {
  const rawEntries = manifest.statusPages ?? legacyStatusEntries(manifest, routesPrefix)
  const byDirPrefix = new Map<StatusPageKind, Map<string, CompiledStatusPage>>()
  const byUrlRouter = new Map<StatusPageKind, Router<CompiledStatusPage>>()
  const groupCandidates = new Map<StatusPageKind, Map<string, CompiledStatusPage[]>>()

  for (const entry of rawEntries) {
    const mod = modules[entry.file] as StatusPageModule | undefined
    if (typeof mod?.default !== 'function')
      continue
    const layouts = entry.layouts
      .map(key => modules[key] as LayoutModule | undefined)
      .filter((l): l is LayoutModule => typeof l?.default === 'function')
    const compiled: CompiledStatusPage = {
      entry,
      render: mod.default,
      layouts,
      doc: { ...baseDoc, styles: entry.styles },
    }
    let dirMap = byDirPrefix.get(entry.kind)
    if (dirMap === undefined) {
      dirMap = new Map()
      byDirPrefix.set(entry.kind, dirMap)
    }
    dirMap.set(entry.dirPrefix, compiled)

    if (entry.inGroup === true) {
      let byPattern = groupCandidates.get(entry.kind)
      if (byPattern === undefined) {
        byPattern = new Map()
        groupCandidates.set(entry.kind, byPattern)
      }
      const list = byPattern.get(entry.dirPattern) ?? []
      list.push(compiled)
      byPattern.set(entry.dirPattern, list)
    }
    else {
      let router = byUrlRouter.get(entry.kind)
      if (router === undefined) {
        router = new Router<CompiledStatusPage>(paramMatchers)
        byUrlRouter.set(entry.kind, router)
      }
      router.add(entry.dirPattern, compiled)
    }
  }

  const groupUrlRouter = new Map<StatusPageKind, Router<CompiledStatusPage>>()
  for (const [kind, byPattern] of groupCandidates) {
    const router = new Router<CompiledStatusPage>(paramMatchers)
    let added = false
    for (const [pattern, list] of byPattern) {
      if (list.length === 1) {
        router.add(pattern, list[0]!)
        added = true
      }
    }
    if (added)
      groupUrlRouter.set(kind, router)
  }

  return {
    find(kind, url, routeFile) {
      if (routeFile !== undefined) {
        const dirMap = byDirPrefix.get(kind)
        if (dirMap !== undefined) {
          let dir: string | undefined = dirnamePrefix(routeFile)
          while (dir !== undefined) {
            const hit = dirMap.get(dir)
            if (hit !== undefined)
              return { page: hit }
            if (dir === routesPrefix || !dir.startsWith(routesPrefix))
              break
            dir = parentDirPrefix(dir)
          }
          const rootHit = dirMap.get(routesPrefix)
          if (rootHit !== undefined)
            return { page: rootHit }
        }
        return undefined
      }

      const decoded = decodeRequestPath(url?.pathname ?? '/')
      if (decoded === undefined)
        return undefined
      const urlRouter = byUrlRouter.get(kind)
      if (urlRouter !== undefined) {
        for (let i = decoded.segments.length; i >= 0; i--) {
          const matched = urlRouter.match(pathPrefix(decoded, i))
          if (matched !== undefined)
            return { page: matched.data, params: matched.params }
        }
      }
      const fallbackGroup = groupUrlRouter.get(kind)
      if (fallbackGroup !== undefined) {
        for (let i = decoded.segments.length; i >= 0; i--) {
          const matched = fallbackGroup.match(pathPrefix(decoded, i))
          if (matched !== undefined)
            return { page: matched.data, params: matched.params }
        }
      }
      return undefined
    },
  }
}

function minimalStatusHtml(status: number, message: string, lang: string): string {
  const safeLang = escapeHtml(lang)
  const safeMsg = escapeHtml(message)
  return `<!DOCTYPE html><html lang="${safeLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${status}</title></head><body><main><h1>${status}</h1><p>${safeMsg}</p></main></body></html>`
}

export interface FallbackPagesOptions {
  manifest: BuildManifest
  modules: Record<string, unknown>
  routesPrefix?: string | undefined
  paramMatchers?: ParamMatcherMap | undefined
  lang: string
  alwaysLoadRuntime: boolean
  navigation?: string | undefined
  dev: boolean
  document: DocumentHooks
  htmlHeaders: HtmlHeaders
  notifyError: NotifyError
  finish: (res: Response, request: Request, cookieStore?: CookieStore, requestId?: string, serverTiming?: string) => Response
}

export function createFallbackPages(options: FallbackPagesOptions) {
  const { manifest, modules, document, htmlHeaders, notifyError, finish } = options
  const routesPrefix = options.routesPrefix ?? (
    manifest.rootLayoutFile ?? manifest.errorFile ?? manifest.notFoundFile
      ? dirnamePrefix((manifest.rootLayoutFile ?? manifest.errorFile ?? manifest.notFoundFile)!)
      : 'server/'
  )
  const baseDoc: DocumentOptions = {
    body: '',
    headTags: manifest.headTags,
    styles: manifest.globalStyles ?? manifest.styles,
    runtimeScript: manifest.runtimeScript,
    chunkImports: manifest.chunkImports,
    alwaysLoadRuntime: options.alwaysLoadRuntime,
    navigation: options.navigation,
    lang: options.lang,
  }
  const fallbackHeadStyleHashes = headTagStyleHashes(baseDoc.headTags)
  const lookup = buildStatusPageLookup(manifest, modules, baseDoc, routesPrefix, options.paramMatchers ?? BUILTIN_PARAM_MATCHERS)

  async function renderCompiledStatusPage(
    page: CompiledStatusPage,
    status: number,
    props: Record<string, unknown>,
    effUrl: URL,
    params: Record<string, string>,
    req?: Request,
    ctx?: RequestContext,
  ): Promise<Response | undefined> {
    try {
      const locals = ctx?.locals ?? {}
      const rctx = createRenderContext(undefined, undefined, ctx?.consent, req !== undefined ? error => notifyError(error, req, 'route', ctx?.requestId) : undefined)
      const body = await runWithRenderContext(rctx, async () => {
        const inner = ssrChild(await page.render(props) as Html)
        let wrapped = inner
        try {
          for (let i = page.layouts.length - 1; i >= 0; i--)
            wrapped = ssrChild(await page.layouts[i]!.default({ children: raw(wrapped), url: effUrl, params, locals }) as Html)
        }
        catch (layoutErr) {
          if (req !== undefined)
            notifyError(layoutErr, req, 'route', ctx?.requestId)
          return inner
        }
        return wrapped
      })
      const { hasIslands, eagerChunks } = resolveRenderedIslands(rctx, body)
      const docHead = await document.resolveDocumentHead(rctx, manifest.headTags, effUrl, req, ctx)
      const docHtml = renderDocument({
        ...page.doc,
        body,
        head: docHead.head,
        lang: docHead.lang,
        htmlAttrs: docHead.htmlAttrs,
        preloadChunks: [...eagerChunks, ...revivePreload(rctx, manifest.reviveScript)],
        hasIslands,
      })
      const html = await document.applyHtmlTransforms(docHtml, effUrl, req, ctx)
      const styleHashes = mergeStyleHashes(fallbackHeadStyleHashes, docHead.styleHashes, styleHashesOf(rctx.inlineStyles), addedInlineStyleHashes(docHtml, html))
      return new Response(html, { status, headers: htmlHeaders(hasIslands, false, true, styleHashes) })
    }
    catch (err) {
      if (req !== undefined)
        notifyError(err, req, 'route', ctx?.requestId)
      return undefined
    }
  }

  async function buildErrorResponse(error: unknown, url?: URL, req?: Request, ctx?: RequestContext, routeFile?: string): Promise<Response> {
    const effUrl = url ?? new URL('http://localhost/500')
    const found = lookup.find('error', effUrl, routeFile)
    if (found !== undefined) {
      const params = ctx !== undefined && Object.keys(ctx.params).length > 0 ? ctx.params : (found.params ?? {})
      const rendered = await renderCompiledStatusPage(
        found.page,
        500,
        { error, status: 500, message: errorMessage(error), url: effUrl, params, locals: ctx?.locals ?? {} },
        effUrl,
        params,
        req,
        ctx,
      )
      if (rendered !== undefined)
        return rendered
    }
    return new Response(options.dev ? errorDetail(error) : 'Internal Server Error', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }

  async function buildNotFoundResponse(url?: URL, req?: Request, ctx?: RequestContext, routeFile?: string): Promise<Response> {
    const effUrl = url ?? new URL('http://localhost/404')
    const found = lookup.find('404', effUrl, routeFile)
    if (found !== undefined) {
      const params = ctx !== undefined && Object.keys(ctx.params).length > 0 ? ctx.params : (found.params ?? {})
      const rendered = await renderCompiledStatusPage(
        found.page,
        404,
        { status: 404, message: 'Not Found', url: effUrl, params, locals: ctx?.locals ?? {} },
        effUrl,
        params,
        req,
        ctx,
      )
      if (rendered !== undefined)
        return rendered
    }
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }

  async function renderDenied(denied: DeniedInfo, url: URL, req: Request, ctx?: RequestContext, routeFile?: string): Promise<Response> {
    const statusKey = String(denied.status)
    const statusHit = STATUS_KINDS.has(statusKey) ? lookup.find(statusKey as StatusPageKind, url, routeFile) : undefined
    const found = statusHit ?? lookup.find('error', url, routeFile)
    if (found !== undefined) {
      const params = ctx !== undefined && Object.keys(ctx.params).length > 0 ? ctx.params : (found.params ?? {})
      const props = statusHit !== undefined
        ? { status: denied.status, message: denied.message, url, params, locals: ctx?.locals ?? {} }
        : { error: new Error(denied.message), status: denied.status, message: denied.message, url, params, locals: ctx?.locals ?? {} }
      const rendered = await renderCompiledStatusPage(found.page, denied.status, props, url, params, req, ctx)
      if (rendered !== undefined)
        return rendered
    }
    return new Response(minimalStatusHtml(denied.status, denied.message, options.lang), {
      status: denied.status,
      headers: htmlHeaders(false, false, true, fallbackHeadStyleHashes),
    })
  }

  async function renderError(error: unknown, cookieStore: CookieStore | undefined, url: URL, request: Request, ctx?: RequestContext, routeFile?: string): Promise<Response> {
    if (wantsJson(request))
      return finish(options.dev ? devErrorResponse(error, request) : Response.json({ ok: false, status: 500, error: 'Internal Server Error' }, { status: 500 }), request, cookieStore, ctx?.requestId)
    return finish(await buildErrorResponse(error, url, request, ctx, routeFile), request, cookieStore, ctx?.requestId)
  }

  return { buildNotFoundResponse, renderError, renderDenied }
}
