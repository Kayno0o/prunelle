// Static cacheability detection, `export const cache` AST parsing, and private-read validation for cached routes.

import type { ArrowFunctionExpression, Function as OxcFunction, Node, Program } from 'oxc-parser'
import type { RouteCacheSpec } from '../server/route-cache'
import type { ModuleAnalysis } from './analyze'
import { visitorKeys } from 'oxc-parser'
import { buildRouteCacheSpec, parseCacheDuration } from '../server/route-cache'
import { walk } from './ast'
import { collectPatternNames, EVENT_ATTR, jsxTagName, resolvePrunelleTag, staticLiteral, unwrapTsExpr } from './shared'

const CACHE_HELP = 'write a duration such as \'30s\', \'5m\', \'1h\', \'1d\', a positive number of seconds, or { maxAge: \'1h\', staleWhileRevalidate?: \'1d\' }'
const DYNAMIC_PROPS = new Set(['params', 'url', 'locals', 'cookies', 'headers', 'request', 'consent', 'ip'])
const PRIVATE_CTX_PROPS = new Set(['cookies', 'locals', 'consent'])
const PRIVATE_PAGE_PROPS = new Set(['locals', 'cookies', 'consent'])
const PRIVATE_SERVER_IMPORTS = new Set(['getActionError', 'currentRequest'])
const DYNAMIC_TAGS = new Set(['ConsentGate', 'Suspense'])
const PRIVATE_TAGS = new Set(['ConsentGate'])
const CLIENT_CALLBACK_CALLEES = new Set(['onMount', 'effect', 'onCleanup'])
const TS_EXPR_WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSInstantiationExpression'])

export interface CacheExportResult {
  hasExport: boolean
  spec?: RouteCacheSpec | undefined
  problem?: string | undefined
  offset: number
}

export interface PrivateReadProblem {
  file: string
  offset: number
  message: string
}

interface PrivateReadHit {
  what: string
  offset: number
}

interface GraphView {
  readonly analyses: ReadonlyMap<string, ModuleAnalysis>
  localDeps(file: string): readonly string[]
}

interface IslandView {
  readonly targets: ReadonlyMap<string, unknown>
}

function staticStringOrNumber(node: Node): { ok: true, value: string | number } | { ok: false, isLiteral: boolean } {
  const inner = unwrapTsExpr(node)
  if (inner.type === 'TemplateLiteral' && inner.expressions.length === 0 && inner.quasis.length === 1)
    return { ok: true, value: inner.quasis[0]!.value.cooked ?? inner.quasis[0]!.value.raw }
  const lit = staticLiteral(inner)
  if (!lit.ok)
    return { ok: false, isLiteral: false }
  return typeof lit.value === 'string' || typeof lit.value === 'number'
    ? { ok: true, value: lit.value }
    : { ok: false, isLiteral: true }
}

function propKeyName(prop: Node): string | undefined {
  if (prop.type !== 'Property')
    return undefined
  if (!prop.computed && prop.key.type === 'Identifier')
    return prop.key.name
  return prop.key.type === 'Literal' && typeof prop.key.value === 'string' ? prop.key.value : undefined
}

function memberPropName(node: Extract<Node, { type: 'MemberExpression' }>): string | undefined {
  if (!node.computed && node.property.type === 'Identifier')
    return node.property.name
  return node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : undefined
}

function parseCacheObjectNode(node: Extract<Node, { type: 'ObjectExpression' }>): { spec: RouteCacheSpec } | { problem: string } {
  let maxAgeMs: number | undefined
  let swrMs: number | undefined
  let swrKeyCount = 0
  for (const prop of node.properties) {
    if (prop.type !== 'Property' || prop.kind !== 'init')
      return { problem: `cache object must use static properties: ${CACHE_HELP}` }
    const key = propKeyName(prop)
    if (key === undefined)
      return { problem: `cache object has a dynamic key: ${CACHE_HELP}` }
    if (key !== 'maxAge' && key !== 'staleWhileRevalidate' && key !== 'swr')
      return { problem: `unknown cache option "${key}": ${CACHE_HELP}` }
    const parsed = staticStringOrNumber(prop.value)
    if (!parsed.ok)
      return { problem: parsed.isLiteral ? `cache.${key} must be a duration string or number of seconds: ${CACHE_HELP}` : `cache.${key} set at runtime: ${CACHE_HELP}` }
    const ms = parseCacheDuration(parsed.value, key !== 'maxAge')
    if (ms === undefined)
      return { problem: `invalid cache.${key} value ${JSON.stringify(parsed.value)}: ${CACHE_HELP}` }
    if (key === 'maxAge') {
      maxAgeMs = ms
    }
    else {
      swrKeyCount++
      swrMs = ms
    }
  }
  if (maxAgeMs === undefined)
    return { problem: `cache object is missing "maxAge": ${CACHE_HELP}` }
  if (swrKeyCount > 1)
    return { problem: `specify either "staleWhileRevalidate" or "swr", not both: ${CACHE_HELP}` }
  return { spec: buildRouteCacheSpec(maxAgeMs, swrMs ?? maxAgeMs) }
}

/** Parses and validates `export const cache = ...` (or `const cache = ...; export { cache }`) from a module AST. */
export function parseCacheExport(program: Program): CacheExportResult {
  const localInits = new Map<string, Node>()
  let exportedLocal: string | undefined
  let exportInit: Node | undefined
  let offset = 0
  let hasExport = false

  for (const stmt of program.body) {
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        if (d.id.type === 'Identifier' && d.init !== null)
          localInits.set(d.id.name, d.init)
      }
      continue
    }
    if (stmt.type !== 'ExportNamedDeclaration' || stmt.exportKind === 'type')
      continue
    if (stmt.declaration?.type === 'VariableDeclaration') {
      for (const d of stmt.declaration.declarations) {
        if (d.id.type === 'Identifier' && d.id.name === 'cache') {
          hasExport = true
          offset = d.start
          exportInit = d.init ?? undefined
        }
      }
    }
    else if (stmt.declaration !== null && 'id' in stmt.declaration && stmt.declaration.id?.type === 'Identifier' && stmt.declaration.id.name === 'cache') {
      return { hasExport: true, offset: stmt.declaration.start, problem: `invalid cache export: ${CACHE_HELP}` }
    }
    for (const spec of stmt.specifiers) {
      const exp = spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value
      if (exp === 'cache' && spec.exportKind !== 'type') {
        hasExport = true
        offset = spec.start
        if (stmt.source === null && spec.local.type === 'Identifier')
          exportedLocal = spec.local.name
      }
    }
  }

  if (!hasExport)
    return { hasExport: false, offset: 0 }
  const init = exportInit ?? (exportedLocal !== undefined ? localInits.get(exportedLocal) : undefined)
  if (init === undefined)
    return { hasExport: true, offset, problem: `cache set at runtime: ${CACHE_HELP}` }

  const inner = unwrapTsExpr(init)
  if (inner.type === 'ObjectExpression') {
    const res = parseCacheObjectNode(inner)
    return 'spec' in res ? { hasExport: true, offset, spec: res.spec } : { hasExport: true, offset, problem: res.problem }
  }
  const scalar = staticStringOrNumber(inner)
  if (!scalar.ok)
    return { hasExport: true, offset, problem: scalar.isLiteral ? `invalid cache export: ${CACHE_HELP}` : `cache set at runtime: ${CACHE_HELP}` }
  const ms = parseCacheDuration(scalar.value)
  if (ms === undefined)
    return { hasExport: true, offset, problem: `invalid cache duration ${JSON.stringify(scalar.value)}: ${CACHE_HELP}` }
  return { hasExport: true, offset, spec: buildRouteCacheSpec(ms) }
}

function collectTopLevelFns(program: Program): { fns: Map<string, OxcFunction>, inits: Map<string, Node> } {
  const fns = new Map<string, OxcFunction>()
  const inits = new Map<string, Node>()
  const add = (node: Node): void => {
    if (node.type === 'FunctionDeclaration' && node.id !== null)
      fns.set(node.id.name, node)
    else if (node.type === 'VariableDeclaration')
      for (const d of node.declarations) if (d.id.type === 'Identifier' && d.init !== null) inits.set(d.id.name, d.init)
  }
  for (const stmt of program.body)
    add(stmt.type === 'ExportNamedDeclaration' && stmt.declaration !== null ? stmt.declaration : stmt)
  return { fns, inits }
}

function unwrapFn(node: Node | undefined, fns: ReadonlyMap<string, OxcFunction>, inits: ReadonlyMap<string, Node>, depth = 0): OxcFunction | ArrowFunctionExpression | undefined {
  if (node === undefined || depth > 4)
    return undefined
  const inner = unwrapTsExpr(node)
  if (inner.type === 'FunctionDeclaration' || inner.type === 'FunctionExpression' || inner.type === 'ArrowFunctionExpression')
    return inner
  return inner.type === 'Identifier' ? fns.get(inner.name) ?? unwrapFn(inits.get(inner.name), fns, inits, depth + 1) : undefined
}

function findExportedFunction(program: Program, exportName: 'default' | 'load'): OxcFunction | ArrowFunctionExpression | undefined {
  const { fns, inits } = collectTopLevelFns(program)
  for (const stmt of program.body) {
    if (exportName === 'default' && stmt.type === 'ExportDefaultDeclaration')
      return unwrapFn(stmt.declaration, fns, inits)
    if (stmt.type !== 'ExportNamedDeclaration' || stmt.exportKind === 'type')
      continue
    if (stmt.declaration?.type === 'FunctionDeclaration' && stmt.declaration.id?.name === exportName)
      return stmt.declaration
    if (stmt.declaration?.type === 'VariableDeclaration') {
      for (const d of stmt.declaration.declarations) {
        if (d.id.type === 'Identifier' && d.id.name === exportName)
          return unwrapFn(d.init ?? undefined, fns, inits)
      }
    }
    for (const spec of stmt.specifiers) {
      const exp = spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value
      if (exp === exportName && stmt.source === null && spec.local.type === 'Identifier')
        return fns.get(spec.local.name) ?? unwrapFn(inits.get(spec.local.name), fns, inits)
    }
  }
  return undefined
}

const unwrapParam = (param: Node): Node => (param.type === 'AssignmentPattern' ? param.left : param)

function isCookieHeaderCall(node: Extract<Node, { type: 'CallExpression' }>, headersAliases?: ReadonlySet<string>): string | undefined {
  const callee = unwrapTsExpr(node.callee)
  if (callee.type !== 'MemberExpression')
    return undefined
  const method = memberPropName(callee)
  const firstArg = node.arguments[0]
  if ((method !== 'get' && method !== 'has') || firstArg === undefined || firstArg.type === 'SpreadElement')
    return undefined
  const arg = staticStringOrNumber(firstArg)
  if (!arg.ok || typeof arg.value !== 'string' || arg.value.toLowerCase() !== 'cookie')
    return undefined
  const obj = unwrapTsExpr(callee.object)
  const isHeadersObj = (obj.type === 'MemberExpression' && memberPropName(obj) === 'headers')
    || (obj.type === 'Identifier' && (obj.name === 'headers' || headersAliases?.has(obj.name) === true))
  return isHeadersObj ? `request.headers.${method}('cookie')` : undefined
}

interface TrackedContext {
  paramName: string | undefined
  trackedProps: ReadonlySet<string>
  prefix: string
  checkHeaders: boolean
  requestAliases: Set<string>
  headersAliases: Set<string>
  onHit: (hit: PrivateReadHit) => void
}

function collectHeaderAlias(pattern: Extract<Node, { type: 'ObjectPattern' }>, headersAliases: Set<string>): void {
  for (const prop of pattern.properties) {
    if (prop.type === 'Property' && propKeyName(prop) === 'headers') {
      const hv = unwrapParam(prop.value)
      if (hv.type === 'Identifier')
        headersAliases.add(hv.name)
    }
  }
}

function scanObjectPattern(pattern: Extract<Node, { type: 'ObjectPattern' }>, ctx: TrackedContext, prefix: string): void {
  for (const prop of pattern.properties) {
    if (prop.type !== 'Property')
      continue
    const key = propKeyName(prop)
    if (key !== undefined && ctx.trackedProps.has(key))
      ctx.onHit({ what: `${prefix}${key}`, offset: prop.start })
    if (!ctx.checkHeaders || key !== 'request')
      continue
    const val = unwrapParam(prop.value)
    if (val.type === 'Identifier')
      ctx.requestAliases.add(val.name)
    else if (val.type === 'ObjectPattern')
      collectHeaderAlias(val, ctx.headersAliases)
  }
}

function trackDeclarator(ast: Extract<Node, { type: 'VariableDeclarator' }>, ctx: TrackedContext, paramActive: boolean): void {
  if (ast.init === null)
    return
  const init = unwrapTsExpr(ast.init)
  if (paramActive && init.type === 'Identifier' && init.name === ctx.paramName && ast.id.type === 'ObjectPattern')
    scanObjectPattern(ast.id, ctx, ctx.prefix)
  if (!ctx.checkHeaders)
    return
  if (init.type === 'MemberExpression' && ast.id.type === 'Identifier') {
    const key = memberPropName(init)
    const obj = unwrapTsExpr(init.object)
    if (key === 'request' && paramActive && obj.type === 'Identifier' && obj.name === ctx.paramName)
      ctx.requestAliases.add(ast.id.name)
    if (key === 'headers')
      ctx.headersAliases.add(ast.id.name)
  }
  else if (init.type === 'Identifier' && ctx.requestAliases.has(init.name) && ast.id.type === 'ObjectPattern') {
    collectHeaderAlias(ast.id, ctx.headersAliases)
  }
}

function blockScopeNames(block: Extract<Node, { type: 'BlockStatement' }>): Set<string> {
  const scope = new Set<string>()
  for (const stmt of block.body) {
    if (stmt.type === 'VariableDeclaration')
      for (const d of stmt.declarations) collectPatternNames(d.id, scope)
    else if (stmt.type === 'FunctionDeclaration' && stmt.id !== null)
      scope.add(stmt.id.name)
  }
  return scope
}

function walkTrackedFunction(
  fn: OxcFunction | ArrowFunctionExpression,
  trackedProps: ReadonlySet<string>,
  prefix: string,
  checkHeaders: boolean,
  onHit: (hit: PrivateReadHit) => void,
): void {
  if (fn.body === null || fn.params.length === 0)
    return
  const first = unwrapParam(fn.params[0]!)
  const ctx: TrackedContext = {
    paramName: first.type === 'Identifier' ? first.name : undefined,
    trackedProps,
    prefix,
    checkHeaders,
    requestAliases: new Set(),
    headersAliases: new Set(),
    onHit,
  }
  if (first.type === 'ObjectPattern')
    scanObjectPattern(first, ctx, '')

  const scopes: Set<string>[] = [new Set()]
  const isParamActive = (): boolean => ctx.paramName !== undefined && !scopes.some(s => s.has(ctx.paramName!))

  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object')
      return
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) visit(node[i])
      return
    }
    const ast = node as Node
    if (typeof ast.type !== 'string')
      return
    if (ast.type.startsWith('TS')) {
      if (TS_EXPR_WRAPPERS.has(ast.type)) visit((ast as { expression?: unknown }).expression)
      return
    }
    if (ast !== fn && (ast.type === 'FunctionDeclaration' || ast.type === 'FunctionExpression' || ast.type === 'ArrowFunctionExpression')) {
      const inner = ast as OxcFunction | ArrowFunctionExpression
      const scope = new Set<string>()
      if (inner.type !== 'ArrowFunctionExpression' && inner.id !== null) scope.add(inner.id.name)
      for (const p of inner.params) collectPatternNames(p, scope)
      scopes.push(scope)
      if (inner.body !== null) visit(inner.body)
      scopes.pop()
      return
    }
    if (ast.type === 'BlockStatement' && ast !== fn.body) {
      scopes.push(blockScopeNames(ast))
      for (const stmt of ast.body) visit(stmt)
      scopes.pop()
      return
    }

    const active = isParamActive()
    if (ast.type === 'VariableDeclarator') {
      trackDeclarator(ast, ctx, active)
    }
    else if (ast.type === 'MemberExpression' && active) {
      const obj = unwrapTsExpr(ast.object)
      const key = obj.type === 'Identifier' && obj.name === ctx.paramName ? memberPropName(ast) : undefined
      if (key !== undefined && ctx.trackedProps.has(key))
        ctx.onHit({ what: `${ctx.prefix}${key}`, offset: ast.start })
    }
    else if (ast.type === 'CallExpression' && ctx.checkHeaders) {
      const cookieCall = isCookieHeaderCall(ast, ctx.headersAliases)
      if (cookieCall !== undefined)
        ctx.onHit({ what: cookieCall, offset: ast.start })
    }

    const keys = visitorKeys[ast.type]
    if (keys === undefined)
      return
    const rec = ast as unknown as Record<string, unknown>
    for (let i = 0; i < keys.length; i++) {
      const val = rec[keys[i]!]
      if (val !== null && typeof val === 'object') visit(val)
    }
  }

  visit(fn.body)
}

function findModulePrivateHits(analysis: ModuleAnalysis, includeLoad: boolean): PrivateReadHit[] {
  const hits: PrivateReadHit[] = []
  const seenOffsets = new Set<number>()
  const push = (hit: PrivateReadHit): void => {
    if (!seenOffsets.has(hit.offset)) {
      seenOffsets.add(hit.offset)
      hits.push(hit)
    }
  }
  for (const imp of analysis.imports) {
    if (imp.source === 'prunelle/server') {
      for (const spec of imp.specifiers) {
        if (PRIVATE_SERVER_IMPORTS.has(spec.imported))
          push({ what: `${spec.imported}()`, offset: imp.start })
      }
    }
  }
  walk(analysis.program, (node) => {
    if (node.type === 'JSXOpeningElement') {
      const tag = resolvePrunelleTag(jsxTagName(node.name), analysis.imports)
      if (tag !== undefined && PRIVATE_TAGS.has(tag))
        push({ what: `<${tag}>`, offset: node.start })
    }
  })
  if (includeLoad) {
    const loadFn = findExportedFunction(analysis.program, 'load')
    if (loadFn !== undefined)
      walkTrackedFunction(loadFn, PRIVATE_CTX_PROPS, 'ctx.', true, push)
  }
  const defaultFn = findExportedFunction(analysis.program, 'default')
  if (defaultFn !== undefined)
    walkTrackedFunction(defaultFn, PRIVATE_PAGE_PROPS, '', true, push)
  return hits
}

/** Validates every route exporting `export const cache = ...` against private per-visitor reads in `load()`, the page, or ancestor `_layout.tsx` files. */
export function findCachedRoutePrivateReads(options: {
  graph: GraphView
  pageFiles: readonly string[]
  layoutsFor: (pageFile: string) => readonly string[]
  toRel: (file: string) => string
  tool: 'prunelle check' | 'prunelle build'
}): PrivateReadProblem[] {
  const { graph, pageFiles, layoutsFor, toRel, tool } = options
  const problems: PrivateReadProblem[] = []

  for (const pageFile of pageFiles) {
    const analysis = graph.analyses.get(pageFile)
    if (analysis?.cache === undefined)
      continue
    const pageRel = toRel(pageFile)
    for (const hit of findModulePrivateHits(analysis, true)) {
      problems.push({
        file: pageFile,
        offset: hit.offset,
        message: `${tool}: cached route reads ${hit.what}: cached responses are shared across visitors, so per-visitor data would leak. Remove \`export const cache\` or stop reading ${hit.what}.`,
      })
    }
    for (const layoutFile of layoutsFor(pageFile)) {
      const layoutAnalysis = graph.analyses.get(layoutFile)
      if (layoutAnalysis === undefined)
        continue
      for (const hit of findModulePrivateHits(layoutAnalysis, false)) {
        problems.push({
          file: layoutFile,
          offset: hit.offset,
          message: `${tool}: cached route "${pageRel}" inherits layout reading ${hit.what}: cached responses are shared across visitors, so per-visitor data would leak. Remove \`export const cache\` from ${pageRel}, move it into a route group with a public layout, or stop reading ${hit.what}.`,
        })
      }
    }
  }
  return problems
}

function isClockRead(node: Node): boolean {
  if (node.type === 'NewExpression' && node.arguments.length === 0) {
    const callee = unwrapTsExpr(node.callee)
    return (callee.type === 'Identifier' && callee.name === 'Date')
      || (callee.type === 'MemberExpression' && memberPropName(callee) === 'Date' && callee.object.type === 'Identifier' && callee.object.name === 'globalThis')
  }
  if (node.type !== 'CallExpression')
    return false
  const callee = unwrapTsExpr(node.callee)
  if (callee.type === 'Identifier')
    return callee.name === 'Date' && node.arguments.length === 0
  if (callee.type !== 'MemberExpression')
    return false
  const prop = memberPropName(callee)
  const obj = unwrapTsExpr(callee.object)
  if (prop === 'nanoseconds' && obj.type === 'Identifier' && obj.name === 'Bun')
    return true
  if (prop !== 'now')
    return false
  if (obj.type === 'Identifier')
    return obj.name === 'Date' || obj.name === 'performance'
  if (obj.type === 'MemberExpression' && obj.object.type === 'Identifier' && obj.object.name === 'globalThis') {
    const inner = memberPropName(obj)
    return inner === 'Date' || inner === 'performance'
  }
  return false
}

function defaultReadsDynamicProps(fn: OxcFunction | ArrowFunctionExpression): boolean {
  if (fn.params.length === 0 || fn.body === null)
    return false
  const first = unwrapParam(fn.params[0]!)
  if (first.type === 'ObjectPattern')
    return first.properties.some(prop => prop.type === 'RestElement' || !propKeyName(prop) || DYNAMIC_PROPS.has(propKeyName(prop)!))
  if (first.type !== 'Identifier')
    return true
  let readsDynamic = false
  walkTrackedFunction(fn, DYNAMIC_PROPS, '', true, () => { readsDynamic = true })
  if (readsDynamic)
    return true
  walk(fn.body, (node) => {
    if (readsDynamic)
      return false
    if ((node.type === 'JSXSpreadAttribute' || node.type === 'SpreadElement') && node.argument.type === 'Identifier' && node.argument.name === first.name) {
      readsDynamic = true
      return false
    }
    return undefined
  })
  return readsDynamic
}

function moduleReadsDynamicData(analysis: ModuleAnalysis, isRouteOrLayout: boolean): boolean {
  if (analysis.imports.some(imp => imp.source === 'prunelle/server' && imp.specifiers.some(s => PRIVATE_SERVER_IMPORTS.has(s.imported))))
    return true
  let dynamic = false
  walk(analysis.program, (node) => {
    if (dynamic)
      return false
    if (node.type === 'JSXAttribute' && node.name.type === 'JSXIdentifier' && EVENT_ATTR.test(node.name.name))
      return false
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && CLIENT_CALLBACK_CALLEES.has(node.callee.name))
      return false
    if (node.type === 'JSXOpeningElement') {
      const tag = resolvePrunelleTag(jsxTagName(node.name), analysis.imports)
      if (tag !== undefined && DYNAMIC_TAGS.has(tag)) {
        dynamic = true
        return false
      }
    }
    if (isClockRead(node) || (node.type === 'CallExpression' && isCookieHeaderCall(node) !== undefined)) {
      dynamic = true
      return false
    }
    return undefined
  })
  if (dynamic)
    return true
  if (isRouteOrLayout) {
    const defaultFn = findExportedFunction(analysis.program, 'default')
    if (defaultFn !== undefined && defaultReadsDynamicProps(defaultFn))
      return true
  }
  return false
}

function isPureIslandFile(file: string, analysis: ModuleAnalysis, islands: IslandView): boolean {
  if (analysis.isInteractive && analysis.staticJsxTags.size === 0)
    return true
  const exported = [...analysis.exports.keys()]
  return exported.length > 0 && exported.every(name => islands.targets.has(`${file}#${name}`))
}

/**
 * Statically checks whether a page route renders identically on every request:
 * static URL, non-async default component, no `load()`, no `_middleware.ts`, not `prerender = false`,
 * and no request/clock reads across the page, its `_layout.tsx` chain, or local non-island modules they import.
 */
export function isRouteCacheable(options: {
  graph: GraphView
  islands: IslandView
  file: string
  layoutSrcs: readonly string[]
  middlewareCount: number
  routePath: string
}): boolean {
  const { graph, islands, file, layoutSrcs, middlewareCount, routePath } = options
  if (middlewareCount > 0 || routePath.includes(':') || routePath.includes('*'))
    return false
  const analysis = graph.analyses.get(file)
  if (analysis === undefined || !analysis.exportedNames.includes('default') || analysis.exportedNames.includes('GET'))
    return false
  if (analysis.hasLoadExport || analysis.hasAsyncDefault || analysis.prerenderFalse)
    return false

  const seen = new Set<string>()
  const walkFile = (cur: string, isRouteOrLayout: boolean): boolean => {
    if (seen.has(cur))
      return true
    seen.add(cur)
    const mod = graph.analyses.get(cur)
    if (mod === undefined)
      return true
    if (!isRouteOrLayout && isPureIslandFile(cur, mod, islands))
      return true
    if ((isRouteOrLayout && mod.hasAsyncDefault) || moduleReadsDynamicData(mod, isRouteOrLayout))
      return false
    return graph.localDeps(cur).every(dep => walkFile(dep, false))
  }
  return layoutSrcs.every(layout => walkFile(layout, true)) && walkFile(file, true)
}
