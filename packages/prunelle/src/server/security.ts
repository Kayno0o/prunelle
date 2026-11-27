// Built-in security basics: CSRF/Origin verification on state-changing requests + safe default headers + strict CSP hashes.


import { PRUNELLE_STREAM_SCRIPT } from '../ssr/context'
import { PRUNELLE_ISLAND_STYLE, PRUNELLE_SUSPENSE_STYLE } from '../ssr/index'
import { cspSha256 } from '../ssr/navigation'

export const PRUNELLE_ISLAND_STYLE_HASH = cspSha256(PRUNELLE_ISLAND_STYLE)
export const PRUNELLE_SUSPENSE_STYLE_HASH = cspSha256(PRUNELLE_SUSPENSE_STYLE)
export const PRUNELLE_STREAM_SCRIPT_HASH = cspSha256(PRUNELLE_STREAM_SCRIPT)

const STYLE_HASH_CACHE_SIZE = 256
const styleHashCache = new Map<string, string>()

// Hashes stay cached by content with LRU eviction so a layout's fixed block costs one SHA-256 per process.
function styleHash(content: string): string {
  let hash = styleHashCache.get(content)
  if (hash !== undefined) {
    styleHashCache.delete(content)
    styleHashCache.set(content, hash)
    return hash
  }
  hash = cspSha256(content)
  if (styleHashCache.size >= STYLE_HASH_CACHE_SIZE)
    styleHashCache.delete(styleHashCache.keys().next().value!)
  styleHashCache.set(content, hash)
  return hash
}

/** Deduplicated CSP SHA-256 hashes of trusted inline `<style>` contents, leaving out prunelle's island and Suspense styles. */
export function styleHashesOf(styles: Iterable<string> | undefined): string[] {
  if (styles === undefined)
    return []
  const hashes: string[] = []
  for (const content of styles) {
    if (content === PRUNELLE_ISLAND_STYLE || content === PRUNELLE_SUSPENSE_STYLE)
      continue
    const hash = styleHash(content)
    if (!hashes.includes(hash))
      hashes.push(hash)
  }
  return hashes
}

// A regex finds the next tag ~10x faster than `indexOf('<style')`, which stalls on every `<span` and `<strong` of a large page.
const STYLE_OPEN_RE = /<style(?=[\s>/])/gi
const STYLE_CLOSE_RE = /<\/style(?=[\s>])/gi

/** CSP hashes of the app's own `<style>` blocks in `html`, leaving out prunelle's island and Suspense styles (hashed apart). */
export function inlineStyleHashes(html: string): string[] {
  const hashes: string[] = []
  STYLE_OPEN_RE.lastIndex = 0
  let open = STYLE_OPEN_RE.exec(html)
  while (open !== null) {
    const tagEnd = html.indexOf('>', open.index + 6)
    if (tagEnd === -1)
      break
    STYLE_CLOSE_RE.lastIndex = tagEnd + 1
    const close = STYLE_CLOSE_RE.exec(html)
    if (close === null)
      break
    const content = html.slice(tagEnd + 1, close.index)
    if (content !== PRUNELLE_ISLAND_STYLE && content !== PRUNELLE_SUSPENSE_STYLE) {
      const hash = styleHash(content)
      if (!hashes.includes(hash))
        hashes.push(hash)
    }
    STYLE_OPEN_RE.lastIndex = close.index + 7
    open = STYLE_OPEN_RE.exec(html)
  }
  return hashes
}

interface ParsedCsp {
  order: string[]
  directives: Map<string, string[]>
}

function parseCsp(csp: string): ParsedCsp {
  const directives = new Map<string, string[]>()
  const order: string[] = []
  for (const part of csp.split(';')) {
    const trimmed = part.trim()
    if (!trimmed)
      continue
    const tokens = trimmed.split(/\s+/)
    const name = tokens[0]!.toLowerCase()
    if (!directives.has(name)) {
      order.push(name)
      directives.set(name, tokens.slice(1))
    }
  }
  return { order, directives }
}

function serializeCsp(parsed: ParsedCsp): string {
  return parsed.order.map((name) => {
    const tokens = parsed.directives.get(name)!
    return tokens.length > 0 ? `${name} ${tokens.join(' ')}` : name
  }).join('; ')
}

/** Augments a Content-Security-Policy header with exact SHA-256 hashes (no `'unsafe-inline'` required). */
export function withCspHashes(
  csp: string,
  opts: { styleHashes?: readonly string[], scriptHashes?: readonly string[] },
): string {
  const styleHashes = opts.styleHashes ?? []
  const scriptHashes = opts.scriptHashes ?? []
  if (styleHashes.length === 0 && scriptHashes.length === 0)
    return csp

  const parsed = parseCsp(csp)
  const { order, directives } = parsed
  const defaultSrc = directives.get('default-src') ?? ["'self'"]
  const addHashes = (dirName: string, hashes: readonly string[]) => {
    if (hashes.length === 0)
      return
    let tokens = directives.get(dirName)
    if (tokens === undefined) {
      tokens = [...defaultSrc]
      directives.set(dirName, tokens)
      order.push(dirName)
    }
    if (tokens.includes("'unsafe-inline'"))
      return
    const noneIdx = tokens.indexOf("'none'")
    if (noneIdx !== -1)
      tokens.splice(noneIdx, 1)
    for (const h of hashes) {
      if (!tokens.includes(h))
        tokens.push(h)
    }
  }

  addHashes('style-src', styleHashes)
  if (directives.has('style-src-elem'))
    addHashes('style-src-elem', styleHashes)
  addHashes('script-src', scriptHashes)
  if (directives.has('script-src-elem'))
    addHashes('script-src-elem', scriptHashes)

  return serializeCsp(parsed)
}

export const DEFAULT_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
export const DEFAULT_HSTS = 'max-age=31536000; includeSubDomains'
export const DEFAULT_PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()'

export type CspDirectiveValue = string | readonly string[]

export interface KnownCspDirectives {
  'default-src'?: CspDirectiveValue | undefined
  'script-src'?: CspDirectiveValue | undefined
  'script-src-elem'?: CspDirectiveValue | undefined
  'script-src-attr'?: CspDirectiveValue | undefined
  'style-src'?: CspDirectiveValue | undefined
  'style-src-elem'?: CspDirectiveValue | undefined
  'style-src-attr'?: CspDirectiveValue | undefined
  'img-src'?: CspDirectiveValue | undefined
  'font-src'?: CspDirectiveValue | undefined
  'connect-src'?: CspDirectiveValue | undefined
  'media-src'?: CspDirectiveValue | undefined
  'object-src'?: CspDirectiveValue | undefined
  'frame-src'?: CspDirectiveValue | undefined
  'child-src'?: CspDirectiveValue | undefined
  'worker-src'?: CspDirectiveValue | undefined
  'manifest-src'?: CspDirectiveValue | undefined
  'base-uri'?: CspDirectiveValue | undefined
  'form-action'?: CspDirectiveValue | undefined
  'frame-ancestors'?: CspDirectiveValue | undefined
  'sandbox'?: CspDirectiveValue | undefined
  'report-to'?: CspDirectiveValue | undefined
  'report-uri'?: CspDirectiveValue | undefined
  'upgrade-insecure-requests'?: CspDirectiveValue | undefined
}

export type CspDirectives = Readonly<KnownCspDirectives & Record<string, CspDirectiveValue | undefined>>

const isFetchDirective = (name: string): boolean =>
  name.endsWith('-src') || name.endsWith('-src-elem') || name.endsWith('-src-attr')

function splitCspTokens(value: CspDirectiveValue): string[] {
  const parts = typeof value === 'string' ? [value] : value
  const tokens: string[] = []
  for (const part of parts) {
    for (const token of part.split(/\s+/)) {
      if (token.length > 0 && !tokens.includes(token))
        tokens.push(token)
    }
  }
  return tokens
}

function mergeCspDirective(parsed: ParsedCsp, name: string, tokens: readonly string[]): void {
  const { order, directives } = parsed
  const existing = directives.get(name)
  if (existing === undefined) {
    order.push(name)
    if (tokens.length === 0) {
      directives.set(name, [])
    }
    else if (tokens.includes("'none'")) {
      directives.set(name, ["'none'"])
    }
    else if (isFetchDirective(name)) {
      const seeded = (directives.get('default-src') ?? ["'self'"]).filter(t => t !== "'none'")
      for (const token of tokens) {
        if (!seeded.includes(token))
          seeded.push(token)
      }
      directives.set(name, seeded)
    }
    else {
      directives.set(name, [...tokens])
    }
    return
  }
  if (tokens.length === 0)
    return
  if (tokens.includes("'none'")) {
    directives.set(name, ["'none'"])
    return
  }
  const noneIdx = existing.indexOf("'none'")
  if (noneIdx !== -1)
    existing.splice(noneIdx, 1)
  for (const token of tokens) {
    if (!existing.includes(token))
      existing.push(token)
  }
}

/** Extends a Content-Security-Policy (default: `DEFAULT_CSP`) by merging additional sources into one or more directives. */
export function extendCsp(extra: CspDirectives, base = DEFAULT_CSP): string {
  const parsed = parseCsp(base)
  for (const [rawName, rawValue] of Object.entries(extra)) {
    if (rawValue === undefined)
      continue
    const name = rawName.trim().toLowerCase()
    if (name.length === 0)
      continue
    mergeCspDirective(parsed, name, splitCspTokens(rawValue))
  }
  return serializeCsp(parsed)
}

// Directives browsers ignore (and log an error for) when delivered via <meta http-equiv="Content-Security-Policy"> (W3C CSP3 §4.2.1).
const META_CSP_IGNORED = new Set(['frame-ancestors', 'report-uri', 'sandbox'])
const EXISTING_META_CSP_RE = /<meta\b[^>]*\bhttp-equiv\s*=\s*(?:"content-security-policy"|'content-security-policy'|content-security-policy\b)/i
const META_CHARSET_RE = /<meta\b[^>]*\bcharset\s*=\s*[^>]*>/i
const HEAD_OPEN_RE = /<head\b[^>]*>/i
const ESC_DOUBLE_ATTR_RE = /[&"<>]/g
const DOUBLE_ATTR_MAP: Record<string, string> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }

/** Strips directives browsers reject in a `<meta http-equiv="Content-Security-Policy">` element. */
export function toMetaCsp(csp: string): string {
  const parsed = parseCsp(csp)
  parsed.order = parsed.order.filter(name => !META_CSP_IGNORED.has(name))
  return serializeCsp(parsed)
}

/** Injects `<meta http-equiv="Content-Security-Policy">` at the top of `<head>` for static HTML exports. */
export function injectMetaCsp(html: string, csp: string | null | undefined): string {
  if (!csp || EXISTING_META_CSP_RE.test(html))
    return html
  const metaCsp = toMetaCsp(csp)
  if (metaCsp.length === 0)
    return html
  const headMatch = HEAD_OPEN_RE.exec(html)
  if (headMatch === null)
    return html
  const headEnd = headMatch.index + headMatch[0].length
  const headCloseIdx = html.toLowerCase().indexOf('</head>', headEnd)
  const headSlice = headCloseIdx === -1 ? html.slice(headEnd) : html.slice(headEnd, headCloseIdx)
  const charsetMatch = META_CHARSET_RE.exec(headSlice)
  const insertAt = charsetMatch !== null ? headEnd + charsetMatch.index + charsetMatch[0].length : headEnd
  const escaped = metaCsp.replace(ESC_DOUBLE_ATTR_RE, ch => DOUBLE_ATTR_MAP[ch]!)
  return `${html.slice(0, insertAt)}<meta http-equiv="Content-Security-Policy" content="${escaped}">${html.slice(insertAt)}`
}

export interface SecurityHeadersOptions {
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false | undefined
  referrerPolicy?: string | false | undefined
  contentTypeOptions?: boolean | undefined
  permissionsPolicy?: string | false | undefined
  csp?: string | CspDirectives | false | undefined
  hsts?: string | boolean | undefined
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** How many reverse proxies sit in front of the app: `true` is one, a number is that many, `false` trusts no forwarded header. */
export type TrustProxy = boolean | number

function proxyHops(trustProxy: TrustProxy): number {
  if (trustProxy === true)
    return 1
  if (trustProxy === false || !Number.isFinite(trustProxy))
    return 0
  return Math.max(0, Math.floor(trustProxy))
}

// Proxies append to X-Forwarded-*, so only the entries the trusted hops wrote count: the one `hops` from the right.
// When fewer than `hops` entries exist, return undefined rather than trusting a client-supplied leftmost entry.
function forwardedValue(request: Request, header: string, trustProxy: TrustProxy): string | undefined {
  const hops = proxyHops(trustProxy)
  if (hops === 0)
    return undefined
  const raw = request.headers.get(header)
  if (raw === null || raw.length === 0)
    return undefined
  let end = raw.length
  let seen = 0
  while (end > 0) {
    const comma = raw.lastIndexOf(',', end - 1)
    let start = comma + 1
    let stop = end
    while (start < stop && raw.charCodeAt(start) <= 32)
      start++
    while (stop > start && raw.charCodeAt(stop - 1) <= 32)
      stop--
    if (start < stop) {
      seen++
      if (seen === hops)
        return start === 0 && stop === raw.length ? raw : raw.slice(start, stop)
    }
    if (comma === -1)
      break
    end = comma
  }
  return undefined
}

function forwardedOrigin(request: Request, trustProxy: TrustProxy): string | undefined {
  const proto = forwardedValue(request, 'x-forwarded-proto', trustProxy)?.toLowerCase()
  if (proto !== 'http' && proto !== 'https')
    return undefined
  const host = forwardedValue(request, 'x-forwarded-host', trustProxy) || request.headers.get('host')?.trim()
  if (!host)
    return undefined
  try {
    const origin = new URL(`${proto}://${host}`).origin
    return origin === 'null' ? undefined : origin
  }
  catch {
    return undefined
  }
}

/** Returns true when the request arrived over HTTPS (directly, or via X-Forwarded-Proto when `trustProxy` is true). */
export function isHttpsRequest(request: Request, trustProxy: TrustProxy = false): boolean {
  if (request.url.startsWith('https:'))
    return true
  const proto = forwardedValue(request, 'x-forwarded-proto', trustProxy)
  if (proto === undefined || proto.length !== 5)
    return false
  return proto === 'https' || proto.toLowerCase() === 'https'
}

/** Extracts the client IP from the trusted proxies' X-Forwarded-For header, or falls back to the direct socket IP. */
export function getClientIp(request: Request, trustProxy: TrustProxy = false, remoteIp?: string): string | undefined {
  if (proxyHops(trustProxy) > 0) {
    const forwarded = forwardedValue(request, 'x-forwarded-for', trustProxy)
    if (forwarded)
      return forwarded
  }
  return remoteIp || undefined
}

const sha256 = (text: string): Buffer => new Bun.CryptoHasher('sha256').update(text).digest()

/**
 * Compares two secrets (tokens, MACs, OAuth states) in constant time: both are hashed first, so neither their content nor their length shows in the timing.
 * The digests are XORed byte by byte rather than passed to `node:crypto`, which would add 2 MB to the server's RSS.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = sha256(a)
  const y = sha256(b)
  let diff = 0
  for (let i = 0; i < x.length; i++)
    diff |= x[i]! ^ y[i]!
  return diff === 0
}

/** `target` trimmed when it is a path on this site, else `fallback`: an absolute or protocol-relative URL, a backslash or a control character is refused. */
export function safeRedirect(target: string | null | undefined, fallback = '/'): string {
  const path = target?.trim()
  if (path === undefined || !path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
    return fallback
  // CR, LF and NUL split the Location header, and a browser drops a tab or newline from a URL, which turns `/\t/host` into `//host`.
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i)
    if (code < 0x20 || code === 0x7F)
      return fallback
  }
  return path
}

/** Returns true when `origin` matches the request's direct (or trusted forwarded) origin or `trustedOrigins`. */
export function isTrustedOrigin(
  origin: string,
  request: Request,
  trustedOrigins?: ReadonlySet<string>,
  trustProxy: TrustProxy = false,
  requestUrl?: URL,
): boolean {
  if (!origin || origin === 'null')
    return false
  return origin === (requestUrl?.origin ?? new URL(request.url).origin)
    || origin === forwardedOrigin(request, trustProxy)
    || trustedOrigins?.has(origin) === true
}

/** Rejects cross-site state-changing requests based on Origin / Sec-Fetch-Site headers. */
export function verifyOrigin(
  request: Request,
  trustedOrigins?: ReadonlySet<string>,
  trustProxy: TrustProxy = false,
  requestUrl?: URL,
): { ok: true } | { ok: false, reason: string } {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase()))
    return { ok: true }

  const origin = request.headers.get('origin')
  if (origin !== null) {
    if (isTrustedOrigin(origin, request, trustedOrigins, trustProxy, requestUrl))
      return { ok: true }
    return { ok: false, reason: `Cross-site request blocked: untrusted origin ${origin}` }
  }

  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none')
    return { ok: false, reason: `Cross-site request blocked: sec-fetch-site=${fetchSite}` }

  return { ok: true }
}

export function resolveCspPolicy(options: SecurityHeadersOptions | false | undefined): string | undefined {
  if (options === false || options?.csp === false)
    return undefined
  if (typeof options?.csp === 'object')
    return extendCsp(options.csp)
  return options?.csp ?? DEFAULT_CSP
}

export function resolveHstsValue(options: SecurityHeadersOptions | false | undefined): string | undefined {
  if (options === false)
    return undefined
  if (options?.hsts === false)
    return undefined
  return typeof options?.hsts === 'string' ? options.hsts : DEFAULT_HSTS
}

export function buildSecurityHeaderEntries(options: SecurityHeadersOptions | false | undefined): readonly [string, string][] {
  if (options === false)
    return []
  const opts = options ?? {}
  const entries: [string, string][] = []
  if (opts.contentTypeOptions ?? true)
    entries.push(['x-content-type-options', 'nosniff'])
  if (opts.frameOptions !== false)
    entries.push(['x-frame-options', opts.frameOptions ?? 'SAMEORIGIN'])
  if (opts.referrerPolicy !== false)
    entries.push(['referrer-policy', opts.referrerPolicy ?? 'strict-origin-when-cross-origin'])
  if (opts.permissionsPolicy !== false)
    entries.push(['permissions-policy', opts.permissionsPolicy ?? DEFAULT_PERMISSIONS_POLICY])
  const csp = resolveCspPolicy(opts)
  if (csp !== undefined)
    entries.push(['content-security-policy', csp])
  return entries
}
