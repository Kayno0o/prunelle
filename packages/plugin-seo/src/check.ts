// Static & prerendered SEO diagnostics for `@prunellejs/seo`'s `prunelle check` hook.

import type { CheckPluginContext } from 'prunelle/config'
import type { SeoPluginOptions } from './index'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { getAppContext } from 'prunelle/internal/server'

const MAX_TITLE = 60
const MAX_DESC = 160
const TS_EXT_RE = /\.(?:tsx|ts)$/
const TEST_FILE_RE = /\.(?:test|spec)\.(?:tsx|ts)$/
const HEAD_BLOCK_RE = /<Head(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?(?<!\/)>([\s\S]*?)<\/Head>/g
const TITLE_TAG_RE = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/g
const HTML_HEAD_RE = /<head\b[^>]*>([\s\S]*?)<\/head>/i
const HTML_TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/i
const HTML_META_RE = /<meta\b[^>]*>/gi
const HTML_ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
const NOINDEX_RE = /\bnoindex\b/i
const PRERENDER_TRUE_RE = /\bexport\s+(?:const|let|var)\s+prerender\s*=\s*true\b/
const ENTITY_RE = /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g
const SKIP_PRERENDER_DIRS = new Set(['_pru', 'client', 'server', 'public', 'node_modules'])
const CONFIG_FILES = ['prunelle.config.ts', 'prunelle.config.js', 'prunelle.config.mjs']
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: '\u00A0', ndash: '\u2013',
  mdash: '\u2014', hellip: '\u2026', laquo: '\u00AB', raquo: '\u00BB', copy: '\u00A9', reg: '\u00AE', trade: '\u2122',
}
const TS_SCANNER = new Bun.Transpiler({ loader: 'ts' })
const TSX_SCANNER = new Bun.Transpiler({ loader: 'tsx' })

interface TextEntry { value: string | undefined, offset: number }
interface RouteHeadInfo {
  titles: TextEntry[]
  emptyTitleOffset?: number | undefined
  descriptions: TextEntry[]
  emptyDescriptionOffset?: number | undefined
  hasOgImage: boolean
  noindexOffset?: number | undefined
}
interface OwnedEntry { value: string | undefined, file: string, code: string, offset: number, fromLayout: boolean }
interface StaticState {
  longTitleUrls: Set<string>
  longDescUrls: Set<string>
  noindexUrls: Set<string>
  dupTitles: Set<string>
  dupDescs: Set<string>
  warnedLayouts: Set<string>
  seenTitles: Map<string, { relFile: string, routePath: string }>
  seenDescs: Map<string, { relFile: string, routePath: string }>
}
interface ParsedAttr { staticValue?: string | undefined, isDynamic: boolean }

const relPosix = (root: string, file: string): string => relative(root, file).replaceAll('\\', '/')

function normalizePath(p: string): string {
  const s = p.startsWith('/') ? p : `/${p}`
  return s.length > 1 ? s.replace(/\/+$/, '') || '/' : s
}

function isSkippedPath(p: string): boolean {
  const n = normalizePath(p)
  return n === '/api' || n.startsWith('/api/') || n === '/404' || n === '/500' || n === '/__pru_404__'
}

function fileToRoutePath(routesDir: string, file: string): string {
  const rel = relPosix(routesDir, file).replace(TS_EXT_RE, '')
  if (rel === 'index') return '/'
  const clean = rel.endsWith('/index') ? rel.slice(0, -6) : rel
  return `/${clean.replace(/\[\.\.\.([^\]]+)\]/g, '*$1').replace(/\[([^\]]+)\]/g, ':$1')}`
}

function formatWarn(relFile: string, code: string | undefined, offset: number, rule: string, detail: string, fix: string): string {
  let line = 1
  let col = 1
  if (code !== undefined) {
    for (let i = 0, end = Math.min(Math.max(0, offset), code.length); i < end; i++) {
      if (code.charCodeAt(i) === 10) { line++; col = 1 }
      else { col++ }
    }
  }
  return `${relFile}:${line}:${col}: warning: [seo/${rule}] ${detail}: ${fix}.`
}

function decodeEntities(str: string): string {
  if (!str.includes('&')) return str
  return str.replace(ENTITY_RE, (m, dec?: string, hex?: string, named?: string) => {
    const cp = dec !== undefined ? Number.parseInt(dec, 10) : hex !== undefined ? Number.parseInt(hex, 16) : -1
    if (cp > 0 && cp <= 0x10FFFF) return String.fromCodePoint(cp)
    return named !== undefined && Object.hasOwn(NAMED_ENTITIES, named) ? NAMED_ENTITIES[named]! : m
  })
}

function skipQuoted(src: string, start: number): number {
  const q = src[start]!
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') i++
    else if (src[i] === q) return i
  }
  return src.length - 1
}

function stripCommentsPreserveOffsets(code: string): string {
  const chars = code.split('')
  let i = 0
  let quote = ''
  let braceDepth = 0
  const tplDepths: number[] = []
  while (i < chars.length) {
    const ch = chars[i]!
    const next = chars[i + 1]
    if (quote !== '') {
      if (ch === '\\') { i += 2; continue }
      if (quote === '`' && ch === '$' && next === '{') { tplDepths.push(braceDepth++); quote = ''; i += 2; continue }
      if (ch === quote) quote = ''
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < chars.length && chars[i] !== '\n' && chars[i] !== '\r') chars[i++] = ' '
      continue
    }
    if (ch === '/' && next === '*') {
      chars[i++] = ' '; chars[i++] = ' '
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '
        i++
      }
      if (i + 1 < chars.length) { chars[i++] = ' '; chars[i++] = ' ' }
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') quote = ch
    else if (ch === '{') braceDepth++
    else if (ch === '}' && tplDepths[tplDepths.length - 1] === --braceDepth) { tplDepths.pop(); quote = '`' }
    i++
  }
  return chars.join('')
}

function unquoteStringLiteral(expr: string): string | undefined {
  const t = expr.trim()
  const q = t[0]
  if (t.length < 2 || t[t.length - 1] !== q) return undefined
  const body = t.slice(1, -1)
  if (q === '`') return /(?<!\\)\$\{|(?<!\\)`/.test(body) ? undefined : body.replace(/\\(.)/g, '$1')
  if (q !== '"' && q !== '\'') return undefined
  if (new RegExp(`(?<!\\\\)${q}`).test(body)) return undefined
  return body.replace(/\\([nrt"'\\])/g, (_, e: string) => (e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e))
}

function readBalancedBrace(src: string, openIndex: number): number {
  let depth = 1
  for (let i = openIndex + 1; i < src.length; i++) {
    const ch = src[i]!
    if (ch === '\'' || ch === '"' || ch === '`') i = skipQuoted(src, i)
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

function analyzeTitleChildren(raw: string): { kind: 'empty' } | { kind: 'static', value: string } | { kind: 'dynamic' } {
  let out = ''
  let i = 0
  while (i < raw.length) {
    const open = raw.indexOf('{', i)
    if (open === -1) { out += decodeEntities(raw.slice(i)); break }
    out += decodeEntities(raw.slice(i, open))
    const close = readBalancedBrace(raw, open)
    if (close === -1) return { kind: 'dynamic' }
    const expr = raw.slice(open + 1, close).trim()
    if (expr !== '' && expr !== 'null' && expr !== 'undefined' && expr !== 'false') {
      const lit = unquoteStringLiteral(expr)
      if (lit === undefined) return { kind: 'dynamic' }
      out += lit
    }
    i = close + 1
  }
  const normalized = out.replace(/\s+/g, ' ').trim()
  return normalized.length === 0 ? { kind: 'empty' } : { kind: 'static', value: normalized }
}

function scanMetaTags(headBody: string, bodyOffset: number): Array<{ attrs: string, offset: number }> {
  const tags: Array<{ attrs: string, offset: number }> = []
  let i = 0
  while (i < headBody.length) {
    const start = headBody.indexOf('<meta', i)
    if (start === -1) break
    const after = headBody[start + 5]
    if (after !== undefined && !/[\s/>]/.test(after)) { i = start + 5; continue }
    let j = start + 5
    let depth = 0
    while (j < headBody.length) {
      const ch = headBody[j]!
      if (ch === '\'' || ch === '"' || ch === '`') j = skipQuoted(headBody, j)
      else if (ch === '{') depth++
      else if (ch === '}' && depth > 0) depth--
      else if (ch === '>' && depth === 0) break
      j++
    }
    if (j >= headBody.length) break
    tags.push({ attrs: headBody.slice(start + 5, j).replace(/\/\s*$/, ''), offset: bodyOffset + start })
    i = j + 1
  }
  return tags
}

function parseJsxAttrs(src: string): { attrs: Map<string, ParsedAttr>, hasSpread: boolean } {
  const attrs = new Map<string, ParsedAttr>()
  let hasSpread = false
  let i = 0
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i]!)) i++
    if (i >= src.length) break
    if (src[i] === '{') {
      const close = readBalancedBrace(src, i)
      if (close === -1) break
      if (src.slice(i + 1, close).trim().startsWith('...')) hasSpread = true
      i = close + 1
      continue
    }
    const start = i
    while (i < src.length && /[a-zA-Z0-9_:-]/.test(src[i]!)) i++
    const name = src.slice(start, i).toLowerCase()
    if (name === '') { i++; continue }
    while (i < src.length && /\s/.test(src[i]!)) i++
    if (src[i] !== '=') { attrs.set(name, { staticValue: '', isDynamic: false }); continue }
    i++
    while (i < src.length && /\s/.test(src[i]!)) i++
    const ch = src[i]
    if (ch === '"' || ch === '\'') {
      const end = skipQuoted(src, i)
      attrs.set(name, { staticValue: decodeEntities(src.slice(i + 1, end)), isDynamic: false })
      i = end + 1
    }
    else if (ch === '{') {
      const close = readBalancedBrace(src, i)
      if (close === -1) break
      const expr = src.slice(i + 1, close).trim()
      const lit = unquoteStringLiteral(expr)
      if (lit !== undefined) attrs.set(name, { staticValue: lit, isDynamic: false })
      else if (expr === '' || expr === 'undefined' || expr === 'null' || expr === 'false') attrs.set(name, { staticValue: '', isDynamic: false })
      else attrs.set(name, { isDynamic: true })
      i = close + 1
    }
  }
  return { attrs, hasSpread }
}

function extractRouteHead(stripped: string): RouteHeadInfo {
  const info: RouteHeadInfo = { titles: [], descriptions: [], hasOgImage: false }
  HEAD_BLOCK_RE.lastIndex = 0
  for (let hm = HEAD_BLOCK_RE.exec(stripped); hm !== null; hm = HEAD_BLOCK_RE.exec(stripped)) {
    const body = hm[1]!
    const bodyOffset = hm.index + hm[0].indexOf('>') + 1
    TITLE_TAG_RE.lastIndex = 0
    for (let tm = TITLE_TAG_RE.exec(body); tm !== null; tm = TITLE_TAG_RE.exec(body)) {
      const res = analyzeTitleChildren(tm[1]!)
      if (res.kind === 'empty') info.emptyTitleOffset ??= bodyOffset + tm.index
      else info.titles.push({ value: res.kind === 'static' ? res.value : undefined, offset: bodyOffset + tm.index })
    }
    for (const meta of scanMetaTags(body, bodyOffset)) {
      const { attrs, hasSpread } = parseJsxAttrs(meta.attrs)
      const nameVal = attrs.get('name')?.staticValue?.trim().toLowerCase()
      const propVal = attrs.get('property')?.staticValue?.trim().toLowerCase()
      const content = attrs.get('content')
      const contentVal = content?.staticValue?.trim()
      if (nameVal === 'description') {
        if (content?.isDynamic || hasSpread) info.descriptions.push({ value: undefined, offset: meta.offset })
        else if (contentVal) info.descriptions.push({ value: contentVal, offset: meta.offset })
        else info.emptyDescriptionOffset ??= meta.offset
      }
      else if (nameVal === 'robots' && contentVal && NOINDEX_RE.test(contentVal)) {
        info.noindexOffset ??= meta.offset
      }
      else if ((propVal === 'og:image' || nameVal === 'og:image') && (hasSpread || content?.isDynamic || Boolean(contentVal))) {
        info.hasOgImage = true
      }
    }
  }
  return info
}

function hasTopLevelSiteInObject(stripped: string, braceStart: number): boolean {
  let depth = 0
  for (let i = braceStart; i < stripped.length; i++) {
    const ch = stripped[i]!
    if (ch === '\'' || ch === '"' || ch === '`') { i = skipQuoted(stripped, i); continue }
    if (ch === '{') { depth++; continue }
    if (ch === '}') { if (--depth === 0) return false; continue }
    if (depth !== 1 || !stripped.startsWith('site', i)) continue
    const prev = stripped[i - 1]
    if (prev !== undefined && !/[\s,{]/.test(prev)) continue
    const rest = stripped.slice(i + 4)
    if (/^\s*[,}]/.test(rest)) return true
    const m = /^\s*:\s*([^,\n}]+)/.exec(rest)
    if (m !== null && !['undefined', 'null', '\'\'', '""', '``'].includes(m[1]!.trim())) return true
  }
  return false
}

function hasConfiguredSite(root: string, options: SeoPluginOptions, activeSite: string | undefined): boolean {
  if (options.site?.trim() || activeSite?.trim() || getAppContext()?.site?.trim()) return true
  for (const name of CONFIG_FILES) {
    const full = join(root, name)
    if (!existsSync(full)) continue
    const stripped = stripCommentsPreserveOffsets(readFileSync(full, 'utf8'))
    const m = /defineConfig\s*\(\s*\{|export\s+default\s*\{/.exec(stripped)
    if (m !== null && hasTopLevelSiteInObject(stripped, m.index + m[0].length - 1)) return true
  }
  return false
}

function applyTitleTemplate(title: string, options: SeoPluginOptions): string {
  return options.titleTemplate && (!options.name || !title.includes(options.name))
    ? options.titleTemplate.replace('%s', () => title)
    : title
}

function walkRouteFiles(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist')
        stack.push(join(cur, e.name))
      else if (e.isFile() && TS_EXT_RE.test(e.name) && !e.name.endsWith('.d.ts') && !TEST_FILE_RE.test(e.name))
        out.push(join(cur, e.name))
    }
  }
  return out.sort()
}

function scanExports(file: string, code: string): string[] | undefined {
  try { return (file.endsWith('.tsx') ? TSX_SCANNER : TS_SCANNER).scan(code).exports }
  catch { return undefined }
}

function ancestorLayouts(routesDir: string, routeFile: string): string[] {
  const result: string[] = []
  const relDir = relative(routesDir, dirname(routeFile))
  const parts = relDir === '' ? [] : relDir.split(/[/\\]/)
  let cur = routesDir
  for (let i = 0; i <= parts.length; i++) {
    if (i > 0) cur = join(cur, parts[i - 1]!)
    const candidate = join(cur, '_layout.tsx')
    if (existsSync(candidate)) result.push(candidate)
  }
  return result
}

function checkConfigOptions(options: SeoPluginOptions, siteConfigured: boolean, warn: (m: string) => void): void {
  if (!siteConfigured)
    warn(formatWarn('prunelle.config.ts', undefined, 0, 'missing-site', 'no `site` is configured, so canonical links, absolute `og:image` URLs, and `sitemap.xml` are disabled', 'set `site` in `prunelle.config.ts` or pass `seo({ site })`'))
  if (options.name !== undefined && options.name.trim().length > MAX_TITLE)
    warn(formatWarn('prunelle.config.ts', undefined, 0, 'long-title', `default seo({ name }) is ${options.name.trim().length} characters (recommended max ${MAX_TITLE})`, `shorten \`name\` to ${MAX_TITLE} characters or fewer`))
  if (typeof options.description === 'string') {
    const len = options.description.trim().length
    if (len > MAX_DESC)
      warn(formatWarn('prunelle.config.ts', undefined, 0, 'long-description', `default seo({ description }) is ${len} characters (recommended max ${MAX_DESC})`, `shorten \`description\` to ${MAX_DESC} characters or fewer`))
  }
  else if (options.description !== undefined) {
    for (const [locale, text] of Object.entries(options.description).sort(([a], [b]) => a.localeCompare(b))) {
      const len = text.trim().length
      if (len > MAX_DESC)
        warn(formatWarn('prunelle.config.ts', undefined, 0, 'long-description', `seo({ description }) for locale "${locale}" is ${len} characters (recommended max ${MAX_DESC})`, `shorten it to ${MAX_DESC} characters or fewer`))
    }
  }
}

function lastOwned(entries: readonly TextEntry[], file: string, code: string, fromLayout: boolean): OwnedEntry | undefined {
  const last = entries[entries.length - 1]
  return last === undefined ? undefined : { value: last.value, file, code, offset: last.offset, fromLayout }
}

function resolveEffectiveHead(
  file: string,
  code: string,
  pageInfo: RouteHeadInfo,
  layouts: readonly string[],
  cache: Map<string, { code: string, info: RouteHeadInfo }>,
): { title: OwnedEntry | undefined, description: OwnedEntry | undefined, hasOgImage: boolean, noindex: { file: string, offset: number } | undefined } {
  let title: OwnedEntry | undefined
  let description: OwnedEntry | undefined
  let hasOgImage = pageInfo.hasOgImage
  let noindex: { file: string, offset: number } | undefined

  for (const lf of layouts) {
    let c = cache.get(lf)
    if (c === undefined) {
      const lCode = readFileSync(lf, 'utf8')
      c = { code: lCode, info: extractRouteHead(stripCommentsPreserveOffsets(lCode)) }
      cache.set(lf, c)
    }
    title = lastOwned(c.info.titles, lf, c.code, true) ?? title
    description = lastOwned(c.info.descriptions, lf, c.code, true) ?? description
    if (c.info.hasOgImage) hasOgImage = true
    if (c.info.noindexOffset !== undefined) noindex = { file: lf, offset: c.info.noindexOffset }
  }
  title = lastOwned(pageInfo.titles, file, code, false) ?? title
  description = lastOwned(pageInfo.descriptions, file, code, false) ?? description
  if (pageInfo.noindexOffset !== undefined) noindex = { file, offset: pageInfo.noindexOffset }
  return { title, description, hasOgImage, noindex }
}

function checkRouteTitle(ctx: CheckPluginContext, options: SeoPluginOptions, state: StaticState, relFile: string, routePath: string, code: string, pageInfo: RouteHeadInfo, title: OwnedEntry | undefined): void {
  if (title === undefined) {
    ctx.warn(formatWarn(relFile, code, pageInfo.emptyTitleOffset ?? 0, 'missing-title', `route "${routePath}" has no <title> in <Head>`, `add <Head><title>...</title></Head> to ${relFile} or its _layout.tsx`))
    return
  }
  if (title.value === undefined) return
  const rendered = applyTitleTemplate(title.value, options)
  if (rendered.length > MAX_TITLE) {
    const ownerRel = relPosix(ctx.root, title.file)
    const key = `title:${ownerRel}:${title.offset}`
    if (!title.fromLayout || !state.warnedLayouts.has(key)) {
      state.warnedLayouts.add(key)
      ctx.warn(formatWarn(ownerRel, title.code, title.offset, 'long-title', `title "${rendered}" is ${rendered.length} characters (recommended max ${MAX_TITLE})`, `shorten the <title>${rendered !== title.value ? ' or titleTemplate' : ''} to ${MAX_TITLE} characters or fewer`))
    }
    state.longTitleUrls.add(routePath)
  }
  const prev = state.seenTitles.get(rendered)
  if (prev !== undefined) {
    ctx.warn(formatWarn(relFile, code, title.fromLayout ? 0 : title.offset, 'duplicate-title', `route "${routePath}" has the same <title> ("${rendered}") as "${prev.routePath}" (${prev.relFile})`, 'give each page a unique <title>'))
    state.dupTitles.add(rendered)
  }
  else {
    state.seenTitles.set(rendered, { relFile, routePath })
  }
}

function checkRouteDescription(ctx: CheckPluginContext, state: StaticState, fallbackDesc: boolean, relFile: string, routePath: string, code: string, pageInfo: RouteHeadInfo, description: OwnedEntry | undefined): void {
  if (description === undefined) {
    if (!fallbackDesc)
      ctx.warn(formatWarn(relFile, code, pageInfo.emptyDescriptionOffset ?? 0, 'missing-description', `route "${routePath}" has no meta description`, 'add <meta name="description" content="..." /> inside <Head> or set `description` in `seo()`'))
    return
  }
  if (description.value === undefined) return
  const desc = description.value
  if (desc.length > MAX_DESC) {
    const ownerRel = relPosix(ctx.root, description.file)
    const key = `desc:${ownerRel}:${description.offset}`
    if (!description.fromLayout || !state.warnedLayouts.has(key)) {
      state.warnedLayouts.add(key)
      ctx.warn(formatWarn(ownerRel, description.code, description.offset, 'long-description', `meta description is ${desc.length} characters (recommended max ${MAX_DESC})`, `shorten the description to ${MAX_DESC} characters or fewer`))
    }
    state.longDescUrls.add(routePath)
  }
  const prev = state.seenDescs.get(desc)
  if (prev !== undefined) {
    ctx.warn(formatWarn(relFile, code, description.fromLayout ? 0 : description.offset, 'duplicate-description', `route "${routePath}" has the same meta description as "${prev.routePath}" (${prev.relFile})`, 'give each page a unique meta description'))
    state.dupDescs.add(desc)
  }
  else {
    state.seenDescs.set(desc, { relFile, routePath })
  }
}

function checkStaticRoutes(ctx: CheckPluginContext, options: SeoPluginOptions, siteConfigured: boolean, excluded: ReadonlySet<string>): StaticState {
  const state: StaticState = {
    longTitleUrls: new Set(), longDescUrls: new Set(), noindexUrls: new Set(),
    dupTitles: new Set(), dupDescs: new Set(), warnedLayouts: new Set(),
    seenTitles: new Map(), seenDescs: new Map(),
  }
  const layoutCache = new Map<string, { code: string, info: RouteHeadInfo }>()
  const descOpt = options.description
  const fallbackDesc = typeof descOpt === 'string' ? descOpt.trim().length > 0 : descOpt !== undefined && Object.values(descOpt).some(v => v.trim().length > 0)
  const hasDefaultImage = Boolean(options.image?.trim())

  for (const file of walkRouteFiles(ctx.routesDir)) {
    if (basename(file).startsWith('_')) continue
    const code = readFileSync(file, 'utf8')
    const exports = scanExports(file, code)
    if (exports === undefined || !exports.includes('default') || exports.includes('GET')) continue
    const routePath = fileToRoutePath(ctx.routesDir, file)
    if (isSkippedPath(routePath)) continue

    const relFile = relPosix(ctx.root, file)
    const stripped = stripCommentsPreserveOffsets(code)
    const pageInfo = extractRouteHead(stripped)
    const effective = resolveEffectiveHead(file, code, pageInfo, ancestorLayouts(ctx.routesDir, file), layoutCache)

    checkRouteTitle(ctx, options, state, relFile, routePath, code, pageInfo, effective.title)
    checkRouteDescription(ctx, state, fallbackDesc, relFile, routePath, code, pageInfo, effective.description)

    const isDynamic = routePath.includes(':') || routePath.includes('*')
    const hasPrerender = exports.includes('prerender') && PRERENDER_TRUE_RE.test(stripped)
    if (effective.noindex !== undefined && options.sitemap !== false && (!isDynamic || hasPrerender) && !excluded.has(routePath)) {
      ctx.warn(formatWarn(relFile, code, effective.noindex.file === file ? effective.noindex.offset : 0, 'noindex-in-sitemap', `route "${routePath}" sets noindex but is included in sitemap.xml`, `add "${routePath}" to \`seo({ sitemapExclude })\` or remove \`noindex\``))
      state.noindexUrls.add(routePath)
    }
    if (siteConfigured && !hasDefaultImage && !effective.hasOgImage)
      ctx.warn(formatWarn(relFile, code, 0, 'missing-image', `route "${routePath}" has no share image while \`site\` is configured`, 'set `seo({ image: \'/og.png\' })` or add <meta property="og:image" content="..." /> in <Head>'))
  }
  return state
}

function collectHtmlFiles(dir: string, skipTopDirs: boolean): string[] {
  const out: string[] = []
  const walk = (cur: string, top: boolean): void => {
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && !(top && skipTopDirs && SKIP_PRERENDER_DIRS.has(e.name)))
        walk(join(cur, e.name), false)
      else if (e.isFile() && e.name.endsWith('.html'))
        out.push(join(cur, e.name))
    }
  }
  if (existsSync(dir)) walk(dir, true)
  return out.sort()
}

function htmlFileToUrl(htmlRoot: string, file: string): string {
  const rel = relPosix(htmlRoot, file)
  if (rel === 'index.html') return '/'
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -11)}`
  return rel === '404.html' || rel === '500.html' ? `/${rel.slice(0, -5)}` : `/${rel}`
}

function parsePrerenderedHead(html: string): { title: string | undefined, description: string | undefined, noindex: boolean } {
  const head = HTML_HEAD_RE.exec(html)?.[1] ?? html
  const rawTitle = HTML_TITLE_RE.exec(head)?.[1]
  const title = rawTitle !== undefined ? decodeEntities(rawTitle).replace(/\s+/g, ' ').trim() || undefined : undefined
  let description: string | undefined
  let noindex = false
  HTML_META_RE.lastIndex = 0
  for (let m = HTML_META_RE.exec(head); m !== null; m = HTML_META_RE.exec(head)) {
    const attrs = new Map<string, string>()
    HTML_ATTR_RE.lastIndex = 0
    for (let am = HTML_ATTR_RE.exec(m[0]); am !== null; am = HTML_ATTR_RE.exec(m[0]))
      attrs.set(am[1]!.toLowerCase(), decodeEntities(am[2] ?? am[3] ?? am[4] ?? ''))
    const name = attrs.get('name')?.trim().toLowerCase()
    const content = attrs.get('content')?.trim()
    if (name === 'description' && content) description = content
    else if (name === 'robots' && content && NOINDEX_RE.test(content)) noindex = true
  }
  return { title, description, noindex }
}

function checkPrerenderedHtml(ctx: CheckPluginContext, options: SeoPluginOptions, excluded: ReadonlySet<string>, state: StaticState): void {
  const outDir = getAppContext()?.outDir ?? join(ctx.root, 'dist')
  const prerenderDir = join(outDir, 'prerendered')
  const htmlRoot = existsSync(prerenderDir) ? prerenderDir : (existsSync(join(outDir, '.prunelle-output')) || existsSync(join(outDir, 'index.html'))) ? outDir : undefined
  if (htmlRoot === undefined) return

  const seenTitles = new Map<string, string>()
  const seenDescs = new Map<string, string>()
  for (const file of collectHtmlFiles(htmlRoot, htmlRoot === outDir)) {
    const url = htmlFileToUrl(htmlRoot, file)
    if (isSkippedPath(url)) continue
    const relFile = relPosix(ctx.root, file)
    const { title, description, noindex } = parsePrerenderedHead(readFileSync(file, 'utf8'))

    if (title !== undefined) {
      if (title.length > MAX_TITLE && !state.longTitleUrls.has(url))
        ctx.warn(formatWarn(relFile, undefined, 0, 'long-title', `prerendered page "${url}" has a ${title.length}-character <title> (recommended max ${MAX_TITLE})`, `shorten the title to ${MAX_TITLE} characters or fewer`))
      const prev = seenTitles.get(title)
      if (prev !== undefined && !state.dupTitles.has(title))
        ctx.warn(formatWarn(relFile, undefined, 0, 'duplicate-title', `prerendered page "${url}" has the same <title> ("${title}") as "${prev}"`, 'give each prerendered page a unique <title>'))
      else if (prev === undefined) seenTitles.set(title, url)
    }
    if (description !== undefined) {
      if (description.length > MAX_DESC && !state.longDescUrls.has(url))
        ctx.warn(formatWarn(relFile, undefined, 0, 'long-description', `prerendered page "${url}" has a ${description.length}-character meta description (recommended max ${MAX_DESC})`, `shorten the description to ${MAX_DESC} characters or fewer`))
      const prev = seenDescs.get(description)
      if (prev !== undefined && !state.dupDescs.has(description))
        ctx.warn(formatWarn(relFile, undefined, 0, 'duplicate-description', `prerendered page "${url}" has the same meta description as "${prev}"`, 'give each prerendered page a unique meta description'))
      else if (prev === undefined) seenDescs.set(description, url)
    }
    if (noindex && options.sitemap !== false && !excluded.has(url) && !state.noindexUrls.has(url))
      ctx.warn(formatWarn(relFile, undefined, 0, 'noindex-in-sitemap', `prerendered page "${url}" sets noindex but is included in sitemap.xml`, `add "${url}" to \`seo({ sitemapExclude })\` or remove \`noindex\``))
  }
}

export function checkSeo(ctx: CheckPluginContext, options: SeoPluginOptions, activeSite: string | undefined): void {
  const siteConfigured = hasConfiguredSite(ctx.root, options, activeSite)
  const excluded = new Set((options.sitemapExclude ?? []).map(normalizePath))
  checkConfigOptions(options, siteConfigured, ctx.warn)
  const state = checkStaticRoutes(ctx, options, siteConfigured, excluded)
  checkPrerenderedHtml(ctx, options, excluded, state)
}
