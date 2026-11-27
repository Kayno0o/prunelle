// Broken internal link checker for `prunelle check`: validates JSX href/action/formAction, ctx.redirect(), and Markdown links.

import type { Node, Program } from 'oxc-parser'
import type { RouteManifestEntry } from '../build/manifest'
import type { ModuleAnalysis } from '../compiler/analyze'
import type { ActiveI18nConfig, AppRuntimeContext, BuildPluginContext, PrunelleConfig, PrunellePlugin, ServerPluginAPI } from '../plugins/index'
import type { ParamMatcher, ParamMatcherMap, ParsedPatternSegment } from '../server/param-matchers'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isInNodeModules, relPosix, walkAllFiles, walkFiles } from '../build/files'
import { isInside } from '../build/is-inside'
import { discoverRouteMatchers, fileToRoutePath, hasRouteHandlerExport, SPECIAL_ROUTE_FILES } from '../build/routes'
import { walk } from '../compiler/ast'
import { calleeName, formatDiagnostic, formatLoc, offsetToLineCol, unwrapTsExpr } from '../compiler/shared'
import { createAppContext, I18N_CONFIG_SERVICE, pickRuntimeConfig, runWithAppContext } from '../plugins/index'
import { BUILTIN_PARAM_MATCHERS, extractMatcherFn, parsePatternSegment } from '../server/param-matchers'
import { decodeRequestPath } from '../server/request-path'
import { Router } from '../server/router'

export interface LinkCheckInput {
  root: string
  routesDir: string
  publicDir: string
  assetPrefix: string
  site?: string | undefined
  config: PrunelleConfig
  plugins: readonly PrunellePlugin[]
  routeFiles: readonly string[]
  analyses: ReadonlyMap<string, ModuleAnalysis>
  sources: ReadonlyMap<string, string>
}

interface RouteEntry { pattern: string, fileRel?: string | undefined, isDynamic: boolean, knownPaths?: ReadonlySet<string> | undefined, knownPathList?: readonly string[] | undefined }
interface DynamicSegment { kind: 'static' | 'param' | 'catchall', value: string, matcherName?: string | undefined, matcher?: ParamMatcher | undefined }
interface LinkTarget { kind: 'exact' | 'prefix', value: string, offset: number, parentOffset: number }
interface LinkResolver { checkExact: (raw: string) => string | undefined, checkPrefix: (raw: string) => string | undefined }
interface PluginProbeResult { pluginRoutes: string[], emittedPublic: string[], locales: string[] }

const LINK_ATTRS = new Set(['href', 'action', 'formaction', 'formAction'])
const LINK_IGNORE_TOKENS = new Set(['link', 'broken-link', 'link/broken'])
const CODE_IGNORE_RES = [/(?:^|[\s{;(,])\/\/\s*prunelle-ignore(-file)?(?:[ \t]+([^\r\n]*))?/g, /\/\*\s*prunelle-ignore(-file)?(?:\s+([\s\S]*?))?\*\//g]
const MD_IGNORE_RE = /<!--\s*prunelle-ignore(-file)?(?:\s+([\s\S]*?))?-->/g
const MD_INLINE_CODE_RE = /(`+)(?!`)(?:(?!\1)[\s\S])*?\1(?!`)/g
const MD_FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const MD_LINK_RE = /\[(?:[^\]\\]|\\.|\[[^\]]*\])*\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g
const MD_HTML_A_RE = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const PROBE_ROUTE: RouteManifestEntry = { path: '/__pru_probe__', file: '__pru_probe__.ts', layouts: [], middlewares: [], islandChunks: [] }

function normalizePathname(raw: string): string {
  const cut = raw.search(/[?#]/)
  const p = cut === -1 ? raw : raw.slice(0, cut)
  return p.length > 1 && p.endsWith('/') ? (p.replace(/\/+$/, '') || '/') : p
}

const isInternalLink = (raw: string): boolean => raw.startsWith('/') && !raw.startsWith('//')
const matchesLinkIgnore = (raw?: string): boolean => { const t = (raw ?? '').trim(); return t === '' || t.split(/[\s,]+/).some(tok => LINK_IGNORE_TOKENS.has(tok)) }
const spaces = (n: number): string => ' '.repeat(Math.max(0, n))

async function silently<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
  try { return await fn() }
  catch (err) { void err; return undefined }
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0 || b.length === 0)
    return a.length + b.length
  let prev = Int32Array.from({ length: b.length + 1 }, (_, j) => j)
  let curr = new Int32Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j++)
      curr[j] = Math.min(prev[j - 1]! + (ca === b.charCodeAt(j - 1) ? 0 : 1), curr[j - 1]! + 1, prev[j]! + 1)
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]!
}

function closestPath(target: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDist = Infinity
  for (const cand of candidates) {
    const maxAllowed = Math.max(2, Math.floor(Math.max(target.length, cand.length) * 0.45))
    if (Math.abs(target.length - cand.length) > maxAllowed)
      continue
    const dist = levenshtein(target, cand)
    if (dist <= maxAllowed && (dist < bestDist || (dist === bestDist && best !== undefined && cand < best))) {
      best = cand
      bestDist = dist
    }
  }
  return best
}

function parseCodeIgnores(code: string): { ignoreFile: boolean, ignoredLines: Set<number> } {
  let ignoreFile = false
  const ignoredLines = new Set<number>()
  for (const re of CODE_IGNORE_RES) {
    re.lastIndex = 0
    for (let m = re.exec(code); m !== null; m = re.exec(code)) {
      if (!matchesLinkIgnore(m[2]))
        continue
      if (m[1] === '-file') { ignoreFile = true; continue }
      const s = offsetToLineCol(code, m.index).line
      const e = offsetToLineCol(code, m.index + m[0].length).line
      for (let line = s; line <= e + 1; line++)
        ignoredLines.add(line)
    }
  }
  return { ignoreFile, ignoredLines }
}

function staticStringExpr(node: Node | null | undefined): string | undefined {
  if (node === null || node === undefined)
    return undefined
  const inner = unwrapTsExpr(node)
  if (inner.type === 'Literal' && typeof inner.value === 'string')
    return inner.value
  if (inner.type === 'TemplateLiteral' && inner.expressions.length === 0 && inner.quasis.length === 1)
    return inner.quasis[0]!.value.cooked ?? inner.quasis[0]!.value.raw
  return undefined
}

function extractStaticPathsArray(program: Program): string[] | undefined {
  let fn: Node | undefined
  for (const stmt of program.body) {
    if (stmt.type !== 'ExportNamedDeclaration' || stmt.declaration === null)
      continue
    const d = stmt.declaration
    if (d.type === 'FunctionDeclaration' && d.id?.name === 'paths')
      fn = d
    else if (d.type === 'VariableDeclaration')
      fn = d.declarations.find(v => v.id.type === 'Identifier' && v.id.name === 'paths' && v.init !== null)?.init ?? fn
  }
  const target = fn !== undefined ? unwrapTsExpr(fn) : undefined
  const expr = target?.type === 'ArrowFunctionExpression' && target.body.type !== 'BlockStatement'
    ? target.body
    : (target !== undefined && (target.type === 'FunctionDeclaration' || target.type === 'FunctionExpression' || target.type === 'ArrowFunctionExpression') && target.body?.type === 'BlockStatement' && target.body.body.length === 1 && target.body.body[0]!.type === 'ReturnStatement')
        ? target.body.body[0]!.argument ?? undefined
        : undefined
  const arr = expr !== undefined ? unwrapTsExpr(expr) : undefined
  if (arr?.type !== 'ArrayExpression')
    return undefined
  const urls: string[] = []
  for (const el of arr.elements) {
    const val = el !== null && el.type !== 'SpreadElement' ? staticStringExpr(el) : undefined
    if (val === undefined || !val.startsWith('/')) return undefined
    urls.push(normalizePathname(val))
  }
  return urls
}

async function evaluateRoutePaths(file: string, analysis: ModuleAnalysis, appCtx: AppRuntimeContext): Promise<readonly string[] | undefined> {
  const staticUrls = extractStaticPathsArray(analysis.program)
  if (staticUrls !== undefined) return staticUrls
  const urls = await silently(() => runWithAppContext(appCtx, async () => {
    const mod = await import(pathToFileURL(file).href) as { paths?: unknown }
    return typeof mod.paths === 'function' ? await (mod.paths as () => unknown)() : undefined
  }))
  return Array.isArray(urls) && urls.every((u): u is string => typeof u === 'string' && u.startsWith('/')) ? urls.map(normalizePathname) : undefined
}

async function loadParamMatchers(root: string, routesDir: string, routeFiles: readonly string[], analyses: ReadonlyMap<string, ModuleAnalysis>): Promise<ParamMatcherMap> {
  const merged: Record<string, ParamMatcher> = { ...BUILTIN_PARAM_MATCHERS }
  const { customFiles } = discoverRouteMatchers({ root, routesDir, routeFiles, loadAnalysis: f => analyses.get(f) })
  for (const [name, absFile] of customFiles) {
    const mod = await silently(() => import(pathToFileURL(absFile).href) as Promise<unknown>)
    if (mod === undefined) { merged[name] = () => true; continue }
    const fn = extractMatcherFn(mod)
    if (fn !== undefined) merged[name] = (v: string) => { try { return Boolean(fn(v)) } catch (e) { void e; return false } }
  }
  return merged
}

async function probeSinglePlugin(
  plugin: PrunellePlugin,
  config: PrunelleConfig,
  paths: { root: string, outDir: string, assetPrefix: string, site: string | undefined },
  state: { routes: string[], emitted: string[], services: Map<string, unknown>, shutdowns: (() => void | Promise<void>)[], provide: <T>(k: { readonly name: string }, v: T) => void },
): Promise<void> {
  const { root, outDir, assetPrefix, site } = paths
  const inject = <T>(key: { readonly name: string }) => state.services.get(key.name) as T | undefined
  if (plugin.server !== undefined) {
    const api: ServerPluginAPI = {
      root, outDir, assetPrefix, site, dev: false,
      trustProxy: config.trustProxy ?? false, trustedOrigins: config.trustedOrigins ?? [],
      config: pickRuntimeConfig(config) as Readonly<Record<string, unknown>>,
      use: (_mw, opts) => { if (plugin.name === '@prunellejs/seo' && typeof opts?.scope === 'string' && opts.scope.startsWith('/')) state.routes.push(opts.scope) },
      route: (_method, path) => { state.routes.push(path) },
      rateLimiter: () => ({ hit: () => 0 }), rewrite: () => {}, provide: state.provide,
      inject: key => inject(key) as never, getBuildData: () => undefined, healthCheck: () => {},
      onShutdown: fn => { state.shutdowns.push(fn) },
    }
    await silently(() => plugin.server!(api))
  }
  // Skip @prunellejs/images build(): it tracks module-global build phase state and does not emit static public routes.
  if (plugin.name === '@prunellejs/images')
    return
  const buildCtx: BuildPluginContext = {
    root, outDir, assetPrefix, site, minify: false, isStatic: false, dev: true, routes: [],
    emitAsset: rel => `${assetPrefix}/${rel.replace(/^\/+/, '')}`,
    emitPublic: (rel) => { const c = rel.replace(/^\/+/, ''); state.emitted.push(c); return `/${c}` },
    addStyle: () => {}, addRouteStyle: () => {}, addHead: () => {}, addRouteHead: () => {},
    provide: state.provide, inject: key => inject(key) as never, setData: () => {},
  }
  if (plugin.build !== undefined)
    await silently(() => plugin.build!(buildCtx))
  if (plugin.afterPrerender !== undefined)
    await silently(() => plugin.afterPrerender!({ ...buildCtx, publicFiles: state.emitted }))
}

async function probePlugins(
  plugins: readonly PrunellePlugin[],
  config: PrunelleConfig,
  paths: { root: string, outDir: string, assetPrefix: string, site: string | undefined },
  appCtx: AppRuntimeContext,
): Promise<PluginProbeResult> {
  const services = new Map<string, unknown>()
  const shutdowns: (() => void | Promise<void>)[] = []
  const routes: string[] = []
  const emitted: string[] = []
  const provide = <T>(key: { readonly name: string }, value: T): void => { services.set(key.name, value); appCtx.provide(key, value) }
  try {
    await runWithAppContext(appCtx, async () => {
      for (const plugin of plugins)
        await probeSinglePlugin(plugin, config, paths, { routes, emitted, services, shutdowns, provide })
    })
  }
  finally {
    for (let i = shutdowns.length - 1; i >= 0; i--)
      await silently(() => shutdowns[i]!())
  }
  const locales = new Set<string>()
  const i18n = services.get(I18N_CONFIG_SERVICE.name) as ActiveI18nConfig | undefined
  if (i18n !== undefined) {
    i18n.locales.forEach(loc => locales.add(loc))
  }
  else {
    for (const plugin of plugins) {
      if (plugin.prerenderPaths === undefined) continue
      for (const p of (await silently(() => plugin.prerenderPaths!(['/__pru_probe__'], PROBE_ROUTE))) ?? []) {
        const m = /^\/([^/]+)\/__pru_probe__$/.exec(p)
        if (m !== null) locales.add(m[1]!)
      }
    }
  }
  return { pluginRoutes: routes, emittedPublic: emitted, locales: [...locales] }
}

function collectPublicPaths(publicDir: string, emittedPublic: readonly string[]): Set<string> {
  const out = new Set<string>()
  const add = (rel: string): void => {
    const clean = rel.replace(/^\/+/, '').replaceAll('\\', '/')
    if (clean === '') return
    out.add(`/${clean}`)
    if (!clean.endsWith('.html')) return
    out.add(clean === 'index.html' ? '/' : `/${clean.slice(0, -5)}`)
    if (clean.endsWith('/index.html')) out.add(`/${clean.slice(0, -'/index.html'.length)}`)
  }
  if (existsSync(publicDir)) walkAllFiles(publicDir).forEach(abs => add(relPosix(publicDir, abs)))
  emittedPublic.forEach(add)
  return out
}

function compileDynamicPatterns(pattern: string, matchers: ParamMatcherMap): DynamicSegment[][] {
  const norm = normalizePathname(pattern)
  const parsed: ParsedPatternSegment[] = norm === '/' ? [] : norm.slice(1).split('/').map(parsePatternSegment)
  const optIdx = parsed.flatMap((s, i) => s.kind === 'optional' ? [i] : [])
  if (optIdx.length > 6)
    return []
  const toSeg = (s: ParsedPatternSegment): DynamicSegment => ({
    kind: s.kind === 'optional' ? 'param' : s.kind, value: s.value, matcherName: s.matcherName,
    matcher: s.matcherName !== undefined ? matchers[s.matcherName] : undefined,
  })
  const variants: DynamicSegment[][] = []
  const expand = (k: number, omitted: Set<number>): void => {
    if (k === optIdx.length) { variants.push(parsed.filter((_, i) => !omitted.has(i)).map(toSeg)); return }
    expand(k + 1, omitted)
    omitted.add(optIdx[k]!)
    expand(k + 1, omitted)
    omitted.delete(optIdx[k]!)
  }
  expand(0, new Set())
  return variants
}

const paramAccepts = (seg: DynamicSegment, value: string): boolean => seg.matcherName === undefined || (seg.matcher !== undefined && seg.matcher(value))

function patternMatchesPrefix(segs: readonly DynamicSegment[], complete: readonly string[], partial: string | undefined): boolean {
  let catchAll: DynamicSegment | undefined
  for (let i = 0; i < complete.length; i++) {
    const part = complete[i]!
    if (catchAll !== undefined) {
      if (!paramAccepts(catchAll, part))
        return false
      continue
    }
    const seg = segs[i]
    if (seg === undefined)
      return false
    if (seg.kind === 'catchall') {
      catchAll = seg
      if (!paramAccepts(seg, part))
        return false
    }
    else if (seg.kind === 'static' ? seg.value !== part : !paramAccepts(seg, part)) {
      return false
    }
  }
  if (catchAll !== undefined)
    return true
  const next = segs[complete.length]
  return next !== undefined && (partial === undefined || next.kind !== 'static' || next.value.startsWith(partial))
}

function staticPrefixOfPattern(pattern: string): string | undefined {
  const norm = normalizePathname(pattern)
  if (norm === '/')
    return undefined
  const kept: string[] = []
  for (const seg of norm.slice(1).split('/')) {
    if (parsePatternSegment(seg).kind !== 'static')
      break
    kept.push(seg)
  }
  return kept.length > 0 ? `/${kept.join('/')}` : undefined
}

function stripLocale(pathname: string, locales: readonly string[]): string | undefined {
  const first = locales.length > 0 ? pathname.slice(1).split('/', 1)[0] : undefined
  return first !== undefined && locales.includes(first) ? (pathname.slice(first.length + 1) || '/') : undefined
}

function createLinkResolver(opts: {
  router: Router<RouteEntry>
  publicPaths: ReadonlySet<string>
  dynamicPatterns: readonly (readonly DynamicSegment[])[]
  staticPaths: readonly string[]
  suggestionPool: readonly string[]
  prefixSuggestionPool: readonly string[]
  assetPrefix: string
  locales: readonly string[]
}): LinkResolver {
  const { router, publicPaths, dynamicPatterns, staticPaths, suggestionPool, prefixSuggestionPool, locales } = opts
  const assetPrefix = opts.assetPrefix.replace(/\/+$/, '')
  const isAsset = (p: string): boolean => assetPrefix !== '' && (p === assetPrefix || p.startsWith(`${assetPrefix}/`))
  const hasPublic = (p: string): boolean => {
    if (publicPaths.has(p))
      return true
    const decoded = decodeRequestPath(p)?.staticPath
    return decoded !== undefined && publicPaths.has(normalizePathname(decoded))
  }
  const matchExact = (p: string): { ok: true } | { ok: false, miss?: RouteEntry } => {
    if (hasPublic(p))
      return { ok: true }
    const hit = router.match(p)
    if (hit === undefined)
      return { ok: false }
    return hit.data.knownPaths !== undefined && !hit.data.knownPaths.has(p) ? { ok: false, miss: hit.data } : { ok: true }
  }
  const checkExact = (raw: string): string | undefined => {
    const trimmed = raw.trim()
    if (!isInternalLink(trimmed)) return undefined
    const pathname = normalizePathname(trimmed)
    if (isAsset(pathname)) return undefined
    const first = matchExact(pathname)
    if (first.ok) return undefined
    const stripped = stripLocale(pathname, locales)
    let miss = first.miss
    if (stripped !== undefined) {
      const second = matchExact(stripped)
      if (second.ok) return undefined
      miss ??= second.miss
    }
    if (miss !== undefined) {
      const near = closestPath(stripped !== undefined && first.miss === undefined ? stripped : pathname, miss.knownPathList ?? [])
      return `[link/broken] link "${pathname}" is not returned by paths() in ${miss.fileRel ?? miss.pattern}${near !== undefined ? `; did you mean "${near}"?` : '.'}`
    }
    const near = closestPath(stripped ?? pathname, suggestionPool)
    return `[link/broken] broken link "${pathname}" matches no route or public file${near !== undefined ? `; did you mean "${near}"?` : '.'}`
  }
  const matchPrefix = (prefix: string): boolean => {
    if (prefix === '/' || isAsset(prefix) || staticPaths.some(p => p.startsWith(prefix))) return true
    const parts = prefix.slice(1).split('/')
    return dynamicPatterns.some(pat => patternMatchesPrefix(pat, parts.slice(0, -1), prefix.endsWith('/') ? undefined : parts[parts.length - 1]))
  }
  const checkPrefix = (raw: string): string | undefined => {
    if (!isInternalLink(raw)) return undefined
    const cut = raw.search(/[?#]/)
    if (cut !== -1) return checkExact(raw.slice(0, cut))
    if (raw === '/' || isAsset(raw) || matchPrefix(raw)) return undefined
    const stripped = stripLocale(raw, locales)
    if (stripped !== undefined && matchPrefix(stripped)) return undefined
    const near = closestPath(normalizePathname(stripped ?? raw), prefixSuggestionPool)
    return `[link/broken] broken link prefix "${raw}..." matches no route or public file${near !== undefined ? `; did you mean "${near}"?` : '.'}`
  }
  return { checkExact, checkPrefix }
}

function extractLinkTargets(node: Node | null | undefined, parentOffset: number, out: LinkTarget[]): void {
  if (node === null || node === undefined)
    return
  const inner = unwrapTsExpr(node)
  if (inner.type === 'Literal' && typeof inner.value === 'string') {
    out.push({ kind: 'exact', value: inner.value, offset: inner.start, parentOffset })
  }
  else if (inner.type === 'TemplateLiteral') {
    const head = inner.quasis[0]?.value.cooked ?? inner.quasis[0]?.value.raw ?? ''
    if (inner.expressions.length === 0)
      out.push({ kind: 'exact', value: head, offset: inner.start, parentOffset })
    else if (head.length > 0)
      out.push({ kind: 'prefix', value: head, offset: inner.start, parentOffset })
  }
  else if (inner.type === 'ConditionalExpression') {
    extractLinkTargets(inner.consequent, parentOffset, out)
    extractLinkTargets(inner.alternate, parentOffset, out)
  }
  else if (inner.type === 'BinaryExpression' && inner.operator === '+') {
    const left = staticStringExpr(inner.left)
    if (left !== undefined) {
      const right = staticStringExpr(inner.right)
      out.push({ kind: right !== undefined ? 'exact' : 'prefix', value: right !== undefined ? left + right : left, offset: inner.start, parentOffset })
    }
  }
}

function scanModuleLinks(relFile: string, analysis: ModuleAnalysis, code: string, resolver: LinkResolver, warnings: string[]): void {
  const { ignoreFile, ignoredLines } = parseCodeIgnores(code)
  if (ignoreFile)
    return
  const targets: LinkTarget[] = []
  walk(analysis.program, (node): boolean | void => {
    if (node.type === 'JSXOpeningElement') {
      for (const attr of node.attributes) {
        if (attr.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier' || !LINK_ATTRS.has(attr.name.name))
          continue
        if (attr.value?.type === 'Literal' && typeof attr.value.value === 'string')
          targets.push({ kind: 'exact', value: attr.value.value, offset: attr.value.start, parentOffset: node.start })
        else if (attr.value?.type === 'JSXExpressionContainer' && attr.value.expression.type !== 'JSXEmptyExpression')
          extractLinkTargets(attr.value.expression, node.start, targets)
      }
      return
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.property.type === 'Identifier' && node.callee.property.name === 'redirect' && node.arguments.length >= 1 && node.arguments[0]!.type !== 'SpreadElement')
      extractLinkTargets(node.arguments[0]!, node.start, targets)
  })
  for (const t of targets) {
    if (ignoredLines.has(offsetToLineCol(code, t.offset).line) || ignoredLines.has(offsetToLineCol(code, t.parentOffset).line))
      continue
    const msg = t.kind === 'exact' ? resolver.checkExact(t.value) : resolver.checkPrefix(t.value)
    if (msg !== undefined)
      warnings.push(formatDiagnostic(formatLoc(relFile, code, t.offset), msg, 'warning'))
  }
}

function discoverCollectionDirs(root: string, plugins: readonly PrunellePlugin[], analyses: ReadonlyMap<string, ModuleAnalysis>): string[] {
  const dirs = new Set<string>()
  const addDir = (raw: string): void => {
    const abs = resolve(root, raw)
    if (existsSync(abs) && isInside(root, abs, { orSame: true }) && statSync(abs).isDirectory())
      dirs.add(abs)
  }
  for (const plugin of plugins) {
    if (plugin.name !== '@prunellejs/content' || plugin.watchPaths === undefined)
      continue
    try { (typeof plugin.watchPaths === 'function' ? plugin.watchPaths(root) : plugin.watchPaths).forEach(addDir) }
    catch (err) { void err }
  }
  for (const [file, analysis] of analyses) {
    if (isInNodeModules(file) || !isInside(root, file))
      continue
    walk(analysis.program, (node) => {
      if (node.type !== 'CallExpression' || node.arguments[0]?.type !== 'ObjectExpression')
        return
      const name = calleeName(node.callee)
      if (name !== 'defineCollection' && !name.endsWith('.defineCollection'))
        return
      for (const prop of node.arguments[0]!.properties) {
        if (prop.type === 'Property' && !prop.computed && ((prop.key.type === 'Identifier' && prop.key.name === 'dir') || (prop.key.type === 'Literal' && prop.key.value === 'dir'))) {
          const dirVal = staticStringExpr(prop.value)
          if (dirVal !== undefined)
            addDir(dirVal)
        }
      }
    })
  }
  addDir('content')
  return [...dirs].sort()
}

function blankHtmlComments(line: string, inComment: boolean): { text: string, inComment: boolean } {
  let text = line
  let active = inComment
  if (active) {
    const end = text.indexOf('-->')
    if (end === -1)
      return { text: spaces(text.length), inComment: true }
    text = spaces(end + 3) + text.slice(end + 3)
    active = false
  }
  text = text.replace(/<!--[\s\S]*?-->/g, m => spaces(m.length))
  const open = text.indexOf('<!--')
  return open === -1 ? { text, inComment: active } : { text: text.slice(0, open) + spaces(text.length - open), inComment: true }
}

function scanMarkdownFile(relFile: string, content: string, resolver: LinkResolver, warnings: string[]): void {
  const lines = content.split(/\r?\n/)
  const ignoredLines = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    MD_IGNORE_RE.lastIndex = 0
    for (let m = MD_IGNORE_RE.exec(lines[i]!); m !== null; m = MD_IGNORE_RE.exec(lines[i]!)) {
      if (!matchesLinkIgnore(m[2]))
        continue
      if (m[1] === '-file')
        return
      ignoredLines.add(i + 1)
      ignoredLines.add(i + 2)
    }
  }
  const endFm = lines[0]?.trim() === '---' ? lines.findIndex((l, idx) => idx > 0 && (l.trim() === '---' || l.trim() === '...')) : -1
  let fence: { char: string, len: number } | undefined
  let inComment = false
  for (let i = endFm !== -1 ? endFm + 1 : 0; i < lines.length; i++) {
    const rawLine = lines[i]!
    if (fence !== undefined) {
      const t = rawLine.trim()
      if (t.length >= fence.len && t.split('').every(ch => ch === fence!.char))
        fence = undefined
      continue
    }
    const open = MD_FENCE_OPEN_RE.exec(rawLine)
    if (open !== null && (open[1]![0] !== '`' || !(open[2] ?? '').includes('`'))) { fence = { char: open[1]![0]!, len: open[1]!.length }; continue }
    const stripped = blankHtmlComments(rawLine, inComment)
    inComment = stripped.inComment
    if (ignoredLines.has(i + 1))
      continue
    const scanLine = stripped.text.replace(MD_INLINE_CODE_RE, m => spaces(m.length))
    for (const [re, isMd] of [[MD_LINK_RE, true], [MD_HTML_A_RE, false]] as const) {
      re.lastIndex = 0
      for (let m = re.exec(scanLine); m !== null; m = re.exec(scanLine)) {
        if (isMd && m.index > 0 && scanLine[m.index - 1] === '!')
          continue
        const url = m[1] ?? m[2] ?? ''
        const msg = resolver.checkExact(url)
        if (msg !== undefined)
          warnings.push(formatDiagnostic(`${relFile}:${i + 1}:${m.index + Math.max(0, isMd ? m[0].indexOf(url) : m[0].lastIndexOf(url)) + 1}`, msg, 'warning'))
      }
    }
  }
}

export async function checkAppLinks(input: LinkCheckInput): Promise<string[]> {
  const { root, routesDir, publicDir, assetPrefix, site, config, plugins, routeFiles, analyses, sources } = input
  const cleanAssetPrefix = assetPrefix.replace(/\/+$/, '')
  const outDir = resolve(root, config.outDir ?? 'dist')
  const appCtx = createAppContext({ root, outDir, publicDir, assetPrefix: cleanAssetPrefix, site, dev: false })
  const specialFiles = routeFiles.filter(f => SPECIAL_ROUTE_FILES.has(basename(f)))
  const pageFiles = routeFiles.filter(f => !basename(f).startsWith('_') && analyses.has(f) && hasRouteHandlerExport(analyses.get(f)!))
  const [matchers, probe] = await Promise.all([
    loadParamMatchers(root, routesDir, [...specialFiles, ...pageFiles], analyses),
    probePlugins(plugins, config, { root, outDir, assetPrefix: cleanAssetPrefix, site }, appCtx),
  ])

  const router = new Router<RouteEntry>(matchers)
  const dynamicPatterns: DynamicSegment[][] = []
  const staticPathSet = new Set<string>()
  const suggestionSet = new Set<string>()
  const prefixSuggestionSet = new Set<string>()
  const addStatic = (p: string): void => { staticPathSet.add(p); suggestionSet.add(p); prefixSuggestionSet.add(p) }
  const register = (pattern: string, entry: RouteEntry): void => {
    router.add(pattern, entry)
    if (!entry.isDynamic) { addStatic(normalizePathname(pattern)); return }
    dynamicPatterns.push(...compileDynamicPatterns(pattern, matchers))
    const prefix = staticPrefixOfPattern(pattern)
    if (prefix !== undefined)
      prefixSuggestionSet.add(prefix)
    if (entry.knownPathList !== undefined)
      entry.knownPathList.forEach((p) => { staticPathSet.add(p); suggestionSet.add(p) })
    else
      suggestionSet.add(pattern)
  }

  for (const file of pageFiles) {
    const analysis = analyses.get(file)!
    const pattern = fileToRoutePath(routesDir, file)
    const isDynamic = pattern.includes(':') || pattern.includes('*')
    const knownPathList = isDynamic && analysis.hasPaths ? await evaluateRoutePaths(file, analysis, appCtx) : undefined
    register(pattern, { pattern, fileRel: relPosix(root, file), isDynamic, knownPaths: knownPathList !== undefined ? new Set(knownPathList) : undefined, knownPathList })
  }
  probe.pluginRoutes.forEach(p => register(p, { pattern: p, isDynamic: p.includes(':') || p.includes('*') }))
  if (config.consent !== undefined) {
    const rawEp = (config.consent.endpoint ?? '/_pru/consent').trim()
    const ep = rawEp.startsWith('/') ? rawEp : `/${rawEp}`
    register(ep, { pattern: ep, isDynamic: false })
  }
  const publicPaths = collectPublicPaths(publicDir, probe.emittedPublic)
  publicPaths.forEach(addStatic)

  const resolver = createLinkResolver({
    router, publicPaths, dynamicPatterns,
    staticPaths: [...staticPathSet], suggestionPool: [...suggestionSet].sort(),
    prefixSuggestionPool: [...prefixSuggestionSet].sort(), assetPrefix: cleanAssetPrefix, locales: probe.locales,
  })

  const warnings: string[] = []
  for (const file of [...analyses.keys()].sort()) {
    if (!isInNodeModules(file) && (isInside(root, file) || isInside(routesDir, file)))
      scanModuleLinks(relPosix(root, file), analyses.get(file)!, sources.get(file) ?? readFileSync(file, 'utf8'), resolver, warnings)
  }
  const mdFiles = new Set<string>()
  for (const dir of discoverCollectionDirs(root, plugins, analyses)) {
    for (const f of walkFiles(dir, { skipDir: n => n === 'node_modules' || n.startsWith('.'), keep: e => e.name.endsWith('.md') || e.name.endsWith('.markdown') }))
      mdFiles.add(f)
  }
  for (const mdFile of [...mdFiles].sort())
    await silently(() => scanMarkdownFile(relPosix(root, mdFile), readFileSync(mdFile, 'utf8'), resolver, warnings))
  return warnings
}
