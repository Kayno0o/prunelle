// Bounded in-memory route response cache with stale-while-revalidate (SWR) and per-encoding compression reuse.

import type { CompressionCache, CompressionEncoding } from './compress'
import { ACTION_ERROR_COOKIE } from './action'
import { markCompressionHandled, mergeVaryValue, pickEncoding } from './compress'
import { hasRegionHeader } from './region'

export interface RouteCacheSpec {
  /** Fresh lifetime in milliseconds. */
  maxAgeMs: number
  /** Stale-while-revalidate window in milliseconds (defaults to `maxAgeMs`). */
  swrMs: number
  /** Normalized `Cache-Control` header value (`public, s-maxage=..., stale-while-revalidate=...`). */
  cacheControl: string
}

export interface RouteCacheOptions {
  /** Maximum cached responses kept in memory (default: 500). */
  maxEntries?: number | undefined
  /** Maximum total bytes across cached responses and their compressed variants (default: 32 MiB). */
  maxBytes?: number | undefined
}

export interface CachedRouteEntry {
  html: string
  bytes: number
  headers: Record<string, string>
  createdAt: number
  freshUntil: number
  staleUntil: number
  spec: RouteCacheSpec
  compressed: Partial<Record<CompressionEncoding, Uint8Array<ArrayBuffer> | null>>
}

export type RouteCacheLookup =
  | { status: 'fresh', entry: CachedRouteEntry }
  | { status: 'stale', entry: CachedRouteEntry }

const DEFAULT_MAX_ENTRIES = 500
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024
const MIN_COMPRESS_BYTES = 256
const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/** Parses a duration string (`'500ms'`, `'30s'`, `'5m'`, `'1h'`, `'1d'`) or number of seconds into milliseconds. */
export function parseCacheDuration(value: unknown, allowZero = false): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))
      return undefined
    return Math.round(value * 1000)
  }
  if (typeof value !== 'string')
    return undefined
  const match = DURATION_RE.exec(value.trim())
  if (match === null)
    return undefined
  const amount = Number(match[1])
  const unit = UNIT_MS[match[2]!.toLowerCase()]
  if (!Number.isFinite(amount) || unit === undefined)
    return undefined
  const ms = Math.round(amount * unit)
  if (!Number.isFinite(ms) || (allowZero ? ms < 0 : ms <= 0))
    return undefined
  return ms
}

/** Formats milliseconds into the cleanest short duration token (`1h`, `30s`, `500ms`). */
export function formatCacheDuration(ms: number): string {
  if (ms === 0)
    return '0s'
  if (ms % 86_400_000 === 0)
    return `${ms / 86_400_000}d`
  if (ms % 3_600_000 === 0)
    return `${ms / 3_600_000}h`
  if (ms % 60_000 === 0)
    return `${ms / 60_000}m`
  if (ms % 1000 === 0)
    return `${ms / 1000}s`
  return `${ms}ms`
}

/** Builds a normalized `RouteCacheSpec` with its `Cache-Control` header value. */
export function buildRouteCacheSpec(maxAgeMs: number, swrMs: number = maxAgeMs): RouteCacheSpec {
  const maxAgeSec = Math.max(1, Math.round(maxAgeMs / 1000))
  const swrSec = swrMs === 0 ? 0 : Math.max(1, Math.round(swrMs / 1000))
  return {
    maxAgeMs,
    swrMs,
    cacheControl: `public, s-maxage=${maxAgeSec}, stale-while-revalidate=${swrSec}`,
  }
}

/** Formats a `RouteCacheSpec` concisely for `prunelle inspect`. */
export function formatCacheSpec(spec: RouteCacheSpec): string {
  const maxAge = formatCacheDuration(spec.maxAgeMs)
  if (spec.swrMs === spec.maxAgeMs)
    return maxAge
  return `${maxAge},swr=${formatCacheDuration(spec.swrMs)}`
}

/** Returns a copy of `headers` with `cache-control` set to `cacheControl`. */
export function withCacheControl(headers: Record<string, string>, cacheControl: string): Record<string, string> {
  return { ...headers, 'cache-control': cacheControl }
}

/** Whether a request is eligible to read from or populate the shared route cache. */
export function isCacheableRequest(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return false
  if (hasRegionHeader(request))
    return false
  const cookie = request.headers.get('cookie')
  if (cookie !== null && cookie.includes(`${ACTION_ERROR_COOKIE}=`))
    return false
  return true
}

function compressCachedHtml(html: string, encoding: CompressionEncoding): Uint8Array<ArrayBuffer> | null {
  const rawSize = Buffer.byteLength(html, 'utf8')
  if (rawSize < MIN_COMPRESS_BYTES)
    return null
  const buf = (encoding === 'zstd' ? Bun.zstdCompressSync(html, { level: 3 }) : Bun.gzipSync(html, { level: 6 })) as Uint8Array<ArrayBuffer>
  return buf.byteLength < rawSize ? buf : null
}

/** Bounded LRU cache for rendered HTML routes with stale-while-revalidate deduplication. */
export class RouteCache {
  readonly #map = new Map<string, CachedRouteEntry>()
  readonly #revalidating = new Set<string>()
  readonly #maxEntries: number
  readonly #maxBytes: number
  #totalBytes = 0

  constructor(options?: RouteCacheOptions) {
    const entries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES
    const bytes = options?.maxBytes ?? DEFAULT_MAX_BYTES
    this.#maxEntries = Number.isFinite(entries) && entries > 0 ? Math.floor(entries) : 0
    this.#maxBytes = Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0
  }

  get size(): number {
    return this.#map.size
  }

  get bytes(): number {
    return this.#totalBytes
  }

  hasInflight(key: string): boolean {
    return this.#revalidating.has(key)
  }

  clear(): void {
    this.#map.clear()
    this.#totalBytes = 0
  }

  delete(key: string): void {
    const prev = this.#map.get(key)
    if (prev === undefined)
      return
    this.#map.delete(key)
    this.#totalBytes -= prev.bytes
  }

  /** Looks up `key`, refreshing LRU recency on fresh/stale hits and deleting expired entries. */
  lookup(key: string, now = Date.now()): RouteCacheLookup | undefined {
    const entry = this.#map.get(key)
    if (entry === undefined)
      return undefined
    if (now >= entry.staleUntil) {
      this.#map.delete(key)
      this.#totalBytes -= entry.bytes
      return undefined
    }
    this.#map.delete(key)
    this.#map.set(key, entry)
    return now < entry.freshUntil
      ? { status: 'fresh', entry }
      : { status: 'stale', entry }
  }

  /** Stores rendered HTML and headers under `key`, evicting LRU entries to enforce both caps. */
  set(key: string, html: string, headers: Record<string, string>, spec: RouteCacheSpec, now = Date.now()): CachedRouteEntry | undefined {
    const rawBytes = Buffer.byteLength(html, 'utf8')
    if (this.#maxEntries <= 0 || this.#maxBytes <= 0 || rawBytes > this.#maxBytes)
      return undefined
    const prev = this.#map.get(key)
    if (prev !== undefined) {
      this.#totalBytes -= prev.bytes
      this.#map.delete(key)
    }
    const entry: CachedRouteEntry = {
      html,
      bytes: rawBytes,
      headers,
      createdAt: now,
      freshUntil: now + spec.maxAgeMs,
      staleUntil: now + spec.maxAgeMs + spec.swrMs,
      spec,
      compressed: {},
    }
    this.#map.set(key, entry)
    this.#totalBytes += rawBytes
    this.#evict(key)
    return entry
  }

  /** Schedules a deduplicated background revalidation for `key`, reporting failures via `onError`. */
  revalidate(key: string, task: () => Promise<void>, onError: (error: unknown) => void): boolean {
    if (this.#revalidating.has(key))
      return false
    this.#revalidating.add(key)
    void Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        onError(error)
      })
      .finally(() => {
        this.#revalidating.delete(key)
      })
    return true
  }

  /** Builds a 200 HTML response for a cache hit (`age` included, precompressed variant reused). */
  respondHit(
    entry: CachedRouteEntry,
    request: Request,
    requestId: string,
    compressCache: CompressionCache | undefined,
    now = Date.now(),
  ): Response {
    const age = String(Math.max(0, Math.floor((now - entry.createdAt) / 1000)))
    return this.#buildResponse(entry, entry.html, entry.headers, request, requestId, compressCache, age)
  }

  /** Builds a 200 HTML response for a freshly rendered miss (stored in cache when it fits). */
  respondMiss(
    entry: CachedRouteEntry | undefined,
    html: string,
    headers: Record<string, string>,
    request: Request,
    requestId: string,
    compressCache: CompressionCache | undefined,
    serverTiming?: string,
  ): Response {
    return this.#buildResponse(entry, html, headers, request, requestId, compressCache, undefined, serverTiming)
  }

  #buildResponse(
    entry: CachedRouteEntry | undefined,
    html: string,
    baseHeaders: Record<string, string>,
    request: Request,
    requestId: string,
    compressCache: CompressionCache | undefined,
    age?: string,
    serverTiming?: string,
  ): Response {
    const headers: Record<string, string> = { ...baseHeaders, 'x-request-id': requestId }
    if (age !== undefined)
      headers.age = age
    if (serverTiming !== undefined)
      headers['server-timing'] = serverTiming

    if (compressCache !== undefined) {
      headers.vary = mergeVaryValue(headers.vary, 'Accept-Encoding')
      if (request.method !== 'HEAD') {
        const enc = pickEncoding(request.headers.get('accept-encoding'))
        if (enc !== undefined) {
          const compressed = this.#getOrCompress(entry, html, enc)
          if (compressed !== null) {
            headers['content-encoding'] = enc
            return markCompressionHandled(new Response(compressed, { status: 200, headers }))
          }
        }
      }
    }
    return markCompressionHandled(new Response(request.method === 'HEAD' ? null : html, { status: 200, headers }))
  }

  #getOrCompress(entry: CachedRouteEntry | undefined, html: string, enc: CompressionEncoding): Uint8Array<ArrayBuffer> | null {
    if (entry !== undefined) {
      const existing = entry.compressed[enc]
      if (existing !== undefined)
        return existing
    }
    const buf = compressCachedHtml(html, enc)
    if (entry !== undefined) {
      if (buf === null) {
        entry.compressed[enc] = null
      }
      else if (entry.bytes + buf.byteLength <= this.#maxBytes) {
        entry.compressed[enc] = buf
        entry.bytes += buf.byteLength
        this.#totalBytes += buf.byteLength
        this.#evictEntry(entry)
      }
    }
    return buf
  }

  #evict(keepKey?: string): void {
    while (this.#map.size > this.#maxEntries || this.#totalBytes > this.#maxBytes) {
      const oldest = this.#map.keys().next()
      if (oldest.done)
        break
      const key = oldest.value
      if (key === keepKey && this.#map.size === 1)
        break
      const evicted = this.#map.get(key)!
      this.#map.delete(key)
      this.#totalBytes -= evicted.bytes
    }
  }

  #evictEntry(keep: CachedRouteEntry): void {
    while (this.#totalBytes > this.#maxBytes) {
      let victimKey: string | undefined
      for (const [k, v] of this.#map) {
        if (v !== keep) {
          victimKey = k
          break
        }
      }
      if (victimKey === undefined)
        break
      const evicted = this.#map.get(victimKey)!
      this.#map.delete(victimKey)
      this.#totalBytes -= evicted.bytes
    }
  }
}

/** Looks up a cached hit and schedules background revalidation when stale. */
export function serveCachedHit(
  routeCache: RouteCache,
  key: string,
  request: Request,
  requestId: string,
  compressCache: CompressionCache | undefined,
  revalidate: () => Promise<void>,
  onError: (error: unknown) => void,
): Response | undefined {
  const hit = routeCache.lookup(key)
  if (hit === undefined)
    return undefined
  if (hit.status === 'stale')
    routeCache.revalidate(key, revalidate, onError)
  return routeCache.respondHit(hit.entry, request, requestId, compressCache)
}

/** Creates a `RouteCache` unless disabled (`dev`, build prerendering, or `routeCache: false`). */
export function createRouteCache(option: RouteCacheOptions | false | undefined, disabled = false): RouteCache | undefined {
  if (disabled || option === false)
    return undefined
  return new RouteCache(option)
}
