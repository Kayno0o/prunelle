// Consolidates per-route stylesheets into at most one site-wide sheet (cached across pages) plus one per-route sheet,
// both content-hashed and immutable, preserving cascade order (layers, @import/@charset, plugin CSS before app CSS).

import type { RouteManifestEntry, StatusPageManifestEntry } from './manifest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, posix } from 'node:path'

const CHARSET_RE = /@charset\s+["'][^"']+["']\s*;/gi
const IMPORT_RE = /^@import\s+(?:url\([^)]*\)|["'][^"']+["'])[^;]*;/gm
const CSS_URL_RE = /url\(\s*(["']?)([^)"']+)\1\s*\)/g
const ABS_OR_DATA_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i

/** Safe lossless CSS minifier: strips comments and redundant whitespace while preserving strings, calc() operators, and data URIs. */
export function minifyCss(css: string): string {
  const out: string[] = []
  let i = 0
  const n = css.length
  let pendingSpace = false

  while (i < n) {
    const ch = css[i]!
    // Quoted string
    if (ch === '"' || ch === '\'') {
      if (pendingSpace && out.length > 0 && needsSpaceBetween(out[out.length - 1]!, ch))
        out.push(' ')
      pendingSpace = false
      const quote = ch
      const start = i
      i++
      while (i < n) {
        if (css[i] === '\\') {
          i += 2
          continue
        }
        if (css[i] === quote) {
          i++
          break
        }
        i++
      }
      out.push(css.slice(start, i))
      continue
    }
    // Comment
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    // Unquoted url(...) — keep verbatim inside parens
    if ((ch === 'u' || ch === 'U') && css.slice(i, i + 4).toLowerCase() === 'url(') {
      if (pendingSpace && out.length > 0 && needsSpaceBefore(out[out.length - 1]!, 'u'))
        out.push(' ')
      pendingSpace = false
      const start = i
      i += 4
      while (i < n && /\s/.test(css[i]!))
        i++
      if (css[i] !== '"' && css[i] !== '\'') {
        while (i < n && css[i] !== ')')
          i++
        if (i < n)
          i++
        out.push(css.slice(start, i))
        continue
      }
      out.push('url(')
      continue
    }
    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
      pendingSpace = true
      i++
      continue
    }
    if (pendingSpace && out.length > 0) {
      const prev = out[out.length - 1]!
      if (needsSpaceBetween(prev, ch))
        out.push(' ')
    }
    pendingSpace = false
    // Drop trailing semicolon right before `}`
    if (ch === '}' && out.length > 0 && out[out.length - 1] === ';')
      out.pop()
    out.push(ch)
    i++
  }
  return out.join('').trim()
}

function needsSpaceBefore(prev: string, nextChar: string): boolean {
  const p = prev[prev.length - 1]!
  return !'{};:,>~+('.includes(p) && !'{}'.includes(nextChar)
}

function needsSpaceBetween(prev: string, nextChar: string): boolean {
  const p = prev[prev.length - 1]!
  // Preserve spaces around `+` and `-` (required inside CSS calc()/min()/max()/clamp()).
  if (p === '+' || nextChar === '+' || p === '-' || nextChar === '-') {
    if (p === ';' || p === '{' || p === '}' || p === ':' || p === ',' || p === '(')
      return false
    return true
  }
  if ('{};,>~'.includes(p) || '{};,>~)'.includes(nextChar))
    return false
  if (p === ':' && nextChar !== ':')
    return false
  if (p === '(')
    return false
  return true
}

function rebaseRelativeUrls(css: string, relFile: string): string {
  const dir = posix.dirname(relFile)
  if (dir === '.' || dir === '')
    return css
  return css.replace(CSS_URL_RE, (full, quote: string, target: string) => {
    const trimmed = target.trim()
    if (trimmed === '' || ABS_OR_DATA_URL_RE.test(trimmed))
      return full
    const rebased = posix.normalize(posix.join(dir, trimmed))
    return `url(${quote}${rebased}${quote})`
  })
}

function combineCssFiles(clientDir: string, relFiles: readonly string[], minify: boolean): string {
  let hasCharset = false
  const imports: string[] = []
  const bodies: string[] = []

  for (const rel of relFiles) {
    let text = readFileSync(join(clientDir, rel), 'utf8')
    text = text.replace(CHARSET_RE, () => {
      hasCharset = true
      return ''
    })
    text = text.replace(IMPORT_RE, (stmt) => {
      imports.push(stmt.trim())
      return ''
    })
    text = rebaseRelativeUrls(text.trim(), rel)
    if (text !== '')
      bodies.push(text)
  }

  const parts: string[] = []
  if (hasCharset)
    parts.push('@charset "UTF-8";')
  if (imports.length > 0)
    parts.push(imports.join('\n'))
  parts.push(bodies.join('\n'))
  const joined = parts.join('\n')
  return minify ? minifyCss(joined) : joined
}

function shortHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8)
}

export interface ConsolidateStylesheetsOptions {
  clientDir: string
  assetPrefix: string
  minify: boolean
  routes: RouteManifestEntry[]
  statusPages: StatusPageManifestEntry[]
  globalStyles: string[]
  assets: string[]
  styleUrls: string[]
}

/**
 * Merges local stylesheets so each page links at most one site-wide sheet (cached across navigations)
 * plus at most one per-route sheet (deduped by content hash), keeping cascade order unchanged.
 */
export function consolidateStylesheets(options: ConsolidateStylesheetsOptions): void {
  const { clientDir, assetPrefix, minify, routes, statusPages, globalStyles, assets, styleUrls } = options
  const prefix = `${assetPrefix.replace(/\/$/, '')}/`

  const toLocalRel = (url: string): string | undefined => {
    if (!url.startsWith(prefix) || !url.endsWith('.css'))
      return undefined
    const rel = url.slice(prefix.length)
    return existsSync(join(clientDir, rel)) ? rel : undefined
  }

  const emittedBundles = new Map<string, string>()
  const emitBundle = (kind: 'site' | 'route', relFiles: readonly string[]): string => {
    const key = `${kind}:${relFiles.join('\0')}`
    const existing = emittedBundles.get(key)
    if (existing !== undefined)
      return existing
    const css = combineCssFiles(clientDir, relFiles, minify)
    const relOut = `${kind}-${shortHash(css)}.css`
    writeFileSync(join(clientDir, relOut), css)
    if (!assets.includes(relOut))
      assets.push(relOut)
    const url = `${prefix}${relOut}`
    emittedBundles.set(key, url)
    return url
  }

  const originalLocalCss = new Set<string>()
  for (const url of [...globalStyles, ...styleUrls]) {
    const rel = toLocalRel(url)
    if (rel !== undefined)
      originalLocalCss.add(rel)
  }
  for (const r of routes) {
    for (const url of r.styles ?? []) {
      const rel = toLocalRel(url)
      if (rel !== undefined)
        originalLocalCss.add(rel)
    }
  }
  for (const sp of statusPages) {
    for (const url of sp.styles) {
      const rel = toLocalRel(url)
      if (rel !== undefined)
        originalLocalCss.add(rel)
    }
  }

  // 1. Consolidate global site-wide local sheets into at most one hashed immutable sheet.
  const siteLocalUrls: string[] = []
  const siteLocalRels: string[] = []
  for (const url of globalStyles) {
    const rel = toLocalRel(url)
    if (rel !== undefined) {
      siteLocalUrls.push(url)
      siteLocalRels.push(rel)
    }
  }
  const siteLocalSet = new Set(siteLocalUrls)
  const siteBundleUrl = siteLocalRels.length >= 2
    ? emitBundle('site', siteLocalRels)
    : siteLocalUrls[0]

  if (siteBundleUrl !== undefined && siteLocalUrls.length > 0) {
    const nextGlobal: string[] = []
    let inserted = false
    for (const url of globalStyles) {
      if (siteLocalSet.has(url)) {
        if (!inserted) {
          nextGlobal.push(siteBundleUrl)
          inserted = true
        }
      }
      else {
        nextGlobal.push(url)
      }
    }
    globalStyles.splice(0, globalStyles.length, ...nextGlobal)
  }

  // 2. Rewrite each route & status page to at most [siteBundle, routeBundle] (plus any external URLs in order).
  const rewriteList = (list: string[]): string[] => {
    if (list.length === 0)
      return list
    const hasAllSite = siteBundleUrl !== undefined
      && siteLocalUrls.length > 0
      && siteLocalUrls.every(u => list.includes(u))

    // Separate site-wide local sheets from route-specific local sheets while preserving external URLs.
    const routeLocalUrls: string[] = []
    const routeLocalRels: string[] = []
    for (const url of list) {
      if (hasAllSite && siteLocalSet.has(url))
        continue
      const rel = toLocalRel(url)
      if (rel !== undefined) {
        routeLocalUrls.push(url)
        routeLocalRels.push(rel)
      }
    }

    const routeLocalSet = new Set(routeLocalUrls)
    const routeBundleUrl = routeLocalRels.length >= 2
      ? emitBundle('route', routeLocalRels)
      : routeLocalUrls[0]

    const out: string[] = []
    let siteInserted = false
    let routeInserted = false
    for (const url of list) {
      if (hasAllSite && siteLocalSet.has(url)) {
        if (!siteInserted) {
          out.push(siteBundleUrl!)
          siteInserted = true
        }
        continue
      }
      if (routeLocalSet.has(url)) {
        if (!routeInserted && routeBundleUrl !== undefined) {
          out.push(routeBundleUrl)
          routeInserted = true
        }
        continue
      }
      out.push(url)
    }
    return out
  }

  for (const route of routes) {
    if (route.styles !== undefined)
      route.styles = rewriteList(route.styles)
  }
  for (const sp of statusPages)
    sp.styles = rewriteList(sp.styles)

  // 3. Collect live referenced stylesheets and prune superseded intermediate CSS files.
  const referencedUrls = new Set<string>(globalStyles)
  for (const route of routes) {
    for (const u of route.styles ?? [])
      referencedUrls.add(u)
  }
  for (const sp of statusPages) {
    for (const u of sp.styles)
      referencedUrls.add(u)
  }
  const referencedRels = new Set<string>()
  for (const u of referencedUrls) {
    if (u.startsWith(prefix))
      referencedRels.add(u.slice(prefix.length))
  }

  for (const rel of originalLocalCss) {
    if (referencedRels.has(rel))
      continue
    rmSync(join(clientDir, rel), { force: true })
    const idx = assets.indexOf(rel)
    if (idx !== -1)
      assets.splice(idx, 1)
  }

  styleUrls.splice(0, styleUrls.length, ...referencedUrls)
}
