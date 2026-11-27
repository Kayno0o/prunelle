// Server observability helpers: `/_pru/health` probes, fast request IDs (`x-request-id`), and dev-only `Server-Timing`.

import type { Middleware, RequestContext } from './http'
import type { TrustProxy } from './security'

export type HealthCheckResult = boolean | void | { ok: boolean, message?: string | undefined }
export type HealthCheckFn = () => HealthCheckResult | Promise<HealthCheckResult>
export type HealthCheckConfig = HealthCheckFn | Record<string, HealthCheckFn>

export interface HealthCheckEntry {
  name: string
  fn: HealthCheckFn
}

export interface HealthCheckOutcome {
  ok: boolean
  message?: string | undefined
  error?: string | undefined
}

export interface DevTiming {
  middleware?: number | undefined
  load?: number | undefined
  render?: number | undefined
  stream?: number | undefined
}

export type RequestIdResolver = (request: Request) => string

const MAX_REQUEST_ID_LEN = 128

function randomBootPrefix(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  let hex = ''
  for (let i = 0; i < 4; i++)
    hex += bytes[i]!.toString(16).padStart(2, '0')
  return hex
}

/** Validates an incoming proxy `x-request-id`: non-empty, <= 128 chars, restricted to `[A-Za-z0-9._:/-]`. */
export function isSafeRequestId(id: string): boolean {
  const len = id.length
  if (len === 0 || len > MAX_REQUEST_ID_LEN)
    return false
  for (let i = 0; i < len; i++) {
    const c = id.charCodeAt(i)
    const ok = (c >= 48 && c <= 57)
      || (c >= 65 && c <= 90)
      || (c >= 97 && c <= 122)
      || c === 45 || c === 46 || c === 47 || c === 58 || c === 95
    if (!ok)
      return false
  }
  return true
}

const trustsProxyHeader = (trustProxy: TrustProxy): boolean =>
  trustProxy === true || (typeof trustProxy === 'number' && trustProxy > 0)

/** Fast per-server request ID resolver: 8-char random boot prefix + base36 counter (zero `randomUUID` / regex per request). */
export function createRequestIdResolver(trustProxy: TrustProxy): RequestIdResolver {
  const bootId = randomBootPrefix()
  let seq = 0
  if (!trustsProxyHeader(trustProxy))
    return () => `${bootId}-${(++seq).toString(36)}`
  return (request: Request): string => {
    const incoming = request.headers.get('x-request-id')
    if (incoming !== null && isSafeRequestId(incoming))
      return incoming
    return `${bootId}-${(++seq).toString(36)}`
  }
}

const fallbackBootId = randomBootPrefix()
let fallbackSeq = 0

/** Fallback request ID for direct `makeRequestContext()` calls outside a running server. */
export function resolveFallbackRequestId(request: Request, trustProxy: TrustProxy): string {
  if (trustsProxyHeader(trustProxy)) {
    const incoming = request.headers.get('x-request-id')
    if (incoming !== null && isSafeRequestId(incoming))
      return incoming
  }
  return `${fallbackBootId}-${(++fallbackSeq).toString(36)}`
}

/** Attaches `x-request-id` in place when mutable, rebuilding only for immutable responses. */
export function withRequestId(res: Response, requestId: string): Response {
  if (res.headers.has('x-request-id'))
    return res
  try {
    res.headers.set('x-request-id', requestId)
    return res
  }
  catch {
    const headers = new Headers(res.headers)
    headers.set('x-request-id', requestId)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}

export const createTiming = (isDev: boolean): DevTiming | undefined => (isDev ? {} : undefined)

export const startTimer = (timing: DevTiming | undefined): number => (timing !== undefined ? performance.now() : 0)

export function endTimer(timing: DevTiming | undefined, phase: keyof DevTiming, start: number): void {
  if (timing !== undefined)
    timing[phase] = performance.now() - start
}

/** Completes an in-progress `timing.render` start timestamp and formats the `Server-Timing` header value. */
export function finishRenderTiming(timing: DevTiming): string | undefined {
  if (timing.render !== undefined)
    timing.render = performance.now() - timing.render
  return formatServerTiming(timing)
}

/** Formats dev-only `Server-Timing` phases (returns `undefined` in production or when no phases ran). */
export function formatServerTiming(timing: DevTiming | undefined): string | undefined {
  if (timing === undefined)
    return undefined
  const parts: string[] = []
  if (timing.middleware !== undefined)
    parts.push(`middleware;dur=${timing.middleware.toFixed(2)}`)
  if (timing.load !== undefined)
    parts.push(`load;dur=${timing.load.toFixed(2)}`)
  if (timing.render !== undefined)
    parts.push(`render;dur=${timing.render.toFixed(2)}`)
  if (timing.stream !== undefined)
    parts.push(`stream;dur=${timing.stream.toFixed(2)}`)
  return parts.length > 0 ? parts.join(', ') : undefined
}

/** Runs a middleware chain, measuring only middleware time (excluding `last()`) when dev timing is active. */
export async function runTimedChain(
  ctx: RequestContext,
  middlewares: readonly Middleware[],
  last: () => Response | Promise<Response>,
  timing: DevTiming | undefined,
  runChain: (ctx: RequestContext, middlewares: readonly Middleware[], last: () => Response | Promise<Response>) => Promise<Response>,
): Promise<Response> {
  if (timing === undefined || middlewares.length === 0)
    return runChain(ctx, middlewares, last)
  let innerMs = 0
  const chainStart = performance.now()
  const res = await runChain(ctx, middlewares, async () => {
    const innerStart = performance.now()
    try {
      return await last()
    }
    finally {
      innerMs += performance.now() - innerStart
    }
  })
  timing.middleware = Math.max(0, performance.now() - chainStart - innerMs)
  return res
}

/** Merges app-configured and plugin-registered health checks into a flat ordered list. */
export function collectHealthChecks(
  appCheck: HealthCheckConfig | undefined,
  pluginChecks: readonly HealthCheckEntry[],
): HealthCheckEntry[] {
  const entries: HealthCheckEntry[] = []
  if (typeof appCheck === 'function') {
    entries.push({ name: 'app', fn: appCheck })
  }
  else if (typeof appCheck === 'object' && appCheck !== null) {
    for (const [name, fn] of Object.entries(appCheck)) {
      if (typeof fn === 'function')
        entries.push({ name, fn })
    }
  }
  for (const entry of pluginChecks)
    entries.push(entry)
  return entries
}

async function runSingleHealthCheck(entry: HealthCheckEntry): Promise<[string, HealthCheckOutcome]> {
  try {
    const result = await entry.fn()
    if (result === true || result === undefined)
      return [entry.name, { ok: true }]
    if (result === false)
      return [entry.name, { ok: false }]
    if (result.ok)
      return [entry.name, result.message !== undefined ? { ok: true, message: result.message } : { ok: true }]
    return [entry.name, result.message !== undefined ? { ok: false, error: result.message } : { ok: false }]
  }
  catch (err) {
    return [entry.name, { ok: false, error: err instanceof Error ? err.message : String(err) }]
  }
}

export interface HealthHandlerOptions {
  checks: readonly HealthCheckEntry[]
  securityRecord: Record<string, string>
  withHsts: (res: Response, request: Request) => Response
  resolveRequestId: RequestIdResolver
}

/** Handles `GET`/`HEAD` requests to `${assetPrefix}/health`, returning 200 when healthy and 503 if any check fails. */
export function createHealthHandler(options: HealthHandlerOptions): (request: Request, requestId?: string) => Response | Promise<Response> {
  const { checks, securityRecord, withHsts, resolveRequestId } = options
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...securityRecord,
  }
  const okPayload = '{"ok":true}'
  const okLength = String(okPayload.length)

  const jsonReply = (request: Request, status: number, payload: string, length: string, reqId: string): Response => {
    const body = request.method === 'HEAD' ? null : payload
    const res = new Response(body, { status, headers: { ...baseHeaders, 'content-length': length, 'x-request-id': reqId } })
    return withHsts(res, request)
  }

  return (request: Request, requestId?: string): Response | Promise<Response> => {
    const reqId = requestId ?? resolveRequestId(request)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const res = new Response('Method Not Allowed', {
        status: 405,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'allow': 'GET, HEAD', ...securityRecord, 'x-request-id': reqId },
      })
      return withHsts(res, request)
    }
    if (checks.length === 0)
      return jsonReply(request, 200, okPayload, okLength, reqId)

    return Promise.all(checks.map(runSingleHealthCheck)).then((results) => {
      const checkMap: Record<string, HealthCheckOutcome> = {}
      let allOk = true
      for (const [name, outcome] of results) {
        checkMap[name] = outcome
        if (!outcome.ok)
          allOk = false
      }
      const payload = JSON.stringify({ ok: allOk, checks: checkMap })
      return jsonReply(request, allOk ? 200 : 503, payload, String(Buffer.byteLength(payload, 'utf8')), reqId)
    })
  }
}
