// Runs Prunelle's single-file compiler & compliance checks and maps them to TypeScript diagnostics.

import type { Node, Program } from 'oxc-parser'
import type ts from 'typescript'
import type { ComplianceConfig, ComplianceRule } from '../compiler/compliance'
import type { PrunelleFixDescriptor } from './fixes'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseSync } from 'oxc-parser'
import { isInNodeModules, relPosix } from '../build/files'
import { analyzeModule, parseTsx } from '../compiler/analyze'
import { walk } from '../compiler/ast'
import { shouldEmitWarning } from '../compiler/compliance'
import { collectMistakes, PrunelleMistake } from '../compiler/mistakes'
import { unwrapTsExpr } from '../compiler/shared'
import { checkBareSignals } from '../compiler/signal-reads'
import { classifyMistakeFix, classifyWarningFix, PRUNELLE_CODE } from './fixes'

export const PRUNELLE_DIAG_SOURCE = 'prunelle'

const TS_EXT_RE = /\.[cm]?tsx?$/i
const DTS_EXT_RE = /\.d\.[cm]?ts$/i
const SIGNAL_HINT_RE = /\b(?:signal|computed)\b/
const EMPTY_SET: ReadonlySet<string> = new Set()
const REL_EXTS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
const TOKEN_RE = /^[A-Za-z_$][\w$-]*(?::[A-Za-z_$][\w$-]*)?|^'[^'\r\n]*'|^"[^"\r\n]*"|^<[A-Za-z_$][\w$.-]*/

export interface PrunellePluginOptions {
  projectRoot?: string | undefined
  compliance?: ComplianceConfig | undefined
  site?: string | undefined
  /** Optional file reader (e.g. from ts.LanguageServiceHost) used to resolve imported signal exports. */
  readFile?: ((path: string) => string | undefined) | undefined
}

export interface PrunelleDiagnosticItem {
  code: number
  category: 'error' | 'warning'
  start: number
  length: number
  message: string
  fix?: PrunelleFixDescriptor | undefined
}

interface StaticConfigCache {
  mtimeMs: number
  site?: string | undefined
  compliance?: ComplianceConfig | undefined
}

const configCache = new Map<string, StaticConfigCache>()

/** True when `fileName` is a project `.ts`/`.tsx` source file eligible for Prunelle analysis. */
export function isCheckableFile(fileName: string): boolean {
  return TS_EXT_RE.test(fileName) && !DTS_EXT_RE.test(fileName) && !isInNodeModules(fileName)
}

function propKeyName(node: Node): string | undefined {
  if (node.type === 'Identifier')
    return node.name
  if (node.type === 'Literal' && typeof node.value === 'string')
    return node.value
  return undefined
}

function staticString(node: Node): string | undefined {
  const inner = unwrapTsExpr(node)
  if (inner.type === 'Literal' && typeof inner.value === 'string')
    return inner.value
  return undefined
}

function extractConfigObject(program: Program): Extract<Node, { type: 'ObjectExpression' }> | undefined {
  for (const stmt of program.body) {
    if (stmt.type !== 'ExportDefaultDeclaration')
      continue
    const decl = unwrapTsExpr(stmt.declaration)
    if (decl.type === 'ObjectExpression')
      return decl
    if (decl.type === 'CallExpression' && decl.arguments[0] !== undefined) {
      const arg = unwrapTsExpr(decl.arguments[0])
      if (arg.type === 'ObjectExpression')
        return arg
    }
  }
  return undefined
}

function parseStaticCompliance(node: Node): ComplianceConfig | undefined {
  const obj = unwrapTsExpr(node)
  if (obj.type !== 'ObjectExpression')
    return undefined
  const out: ComplianceConfig = {}
  for (const prop of obj.properties) {
    if (prop.type !== 'Property')
      continue
    const key = propKeyName(prop.key)
    const val = unwrapTsExpr(prop.value)
    if (key === 'publicBody' && val.type === 'Literal' && typeof val.value === 'boolean') {
      out.publicBody = val.value
    }
    else if (key === 'legalNotice' && val.type === 'Literal' && (val.value === false || typeof val.value === 'string')) {
      out.legalNotice = val.value
    }
    else if (key === 'ignore' && val.type === 'ArrayExpression') {
      const rules: ComplianceRule[] = []
      for (const el of val.elements) {
        if (el !== null && el.type !== 'SpreadElement') {
          const s = staticString(el)
          if (s !== undefined)
            rules.push(s as ComplianceRule)
        }
      }
      out.ignore = rules
    }
  }
  return out
}

/** Statically parses `site` and `compliance` literals from `prunelle.config.ts` without executing user code. */
export function readStaticProjectConfig(projectRoot: string | undefined): { site?: string | undefined, compliance?: ComplianceConfig | undefined } {
  if (projectRoot === undefined || projectRoot === '')
    return {}
  const cfgPath = join(projectRoot, 'prunelle.config.ts')
  if (!existsSync(cfgPath))
    return {}
  let mtimeMs: number
  try {
    mtimeMs = statSync(cfgPath).mtimeMs
  }
  catch {
    return {}
  }
  const cached = configCache.get(cfgPath)
  if (cached !== undefined && cached.mtimeMs === mtimeMs)
    return { site: cached.site, compliance: cached.compliance }

  let site: string | undefined
  let compliance: ComplianceConfig | undefined
  try {
    const code = readFileSync(cfgPath, 'utf8')
    const parsed = parseSync(cfgPath, code, { lang: 'ts', sourceType: 'module' })
    const obj = parsed.errors.length === 0 ? extractConfigObject(parsed.program) : undefined
    if (obj !== undefined) {
      for (const prop of obj.properties) {
        if (prop.type !== 'Property')
          continue
        const key = propKeyName(prop.key)
        if (key === 'site')
          site = staticString(prop.value)
        else if (key === 'compliance')
          compliance = parseStaticCompliance(prop.value)
      }
    }
  }
  catch {
    return {}
  }
  configCache.set(cfgPath, { mtimeMs, site, compliance })
  return { site, compliance }
}

function indexNodesAtOffsets(program: Program, offsets: ReadonlySet<number>): Map<number, Node[]> {
  const byOffset = new Map<number, Node[]>()
  if (offsets.size === 0)
    return byOffset
  walk(program, (node) => {
    if (!offsets.has(node.start))
      return
    let list = byOffset.get(node.start)
    if (list === undefined) {
      list = []
      byOffset.set(node.start, list)
    }
    list.push(node)
  })
  return byOffset
}

function clampSingleLine(code: string, start: number, end: number): { start: number, length: number } {
  const safeStart = Math.max(0, Math.min(start, code.length))
  const safeEnd = Math.max(safeStart, Math.min(end, code.length))
  const nl = code.indexOf('\n', safeStart)
  const effectiveEnd = nl !== -1 && nl < safeEnd ? nl : safeEnd
  return { start: safeStart, length: Math.max(1, effectiveEnd - safeStart) }
}

function spanFromNodes(nodes: readonly Node[], code: string, start: number): { start: number, length: number } {
  for (const node of nodes) {
    if (node.type === 'JSXAttribute')
      return clampSingleLine(code, node.start, node.end)
    if (node.type === 'JSXElement') {
      const opening = node.openingElement
      const hasNewline = code.slice(opening.start, opening.end).includes('\n')
      return clampSingleLine(code, opening.start, hasNewline ? opening.name.end : opening.end)
    }
    if (node.type === 'JSXOpeningElement') {
      const hasNewline = code.slice(node.start, node.end).includes('\n')
      return clampSingleLine(code, node.start, hasNewline ? node.name.end : node.end)
    }
    if (node.type === 'ImportSpecifier' || node.type === 'ExpressionStatement' || node.type === 'Literal' || node.type === 'MemberExpression' || node.type === 'Identifier' || node.type === 'CallExpression' || node.type === 'VariableDeclarator')
      return clampSingleLine(code, node.start, node.end)
    if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression')
      return clampSingleLine(code, node.start, node.end)
  }
  const safeStart = Math.max(0, Math.min(start, Math.max(0, code.length - 1)))
  const match = TOKEN_RE.exec(code.slice(safeStart))
  const length = match !== null ? match[0].length : Math.min(1, Math.max(0, code.length - safeStart))
  return { start: safeStart, length: Math.max(1, length) }
}

function normalizeDisplayPath(fileName: string, projectRoot: string | undefined): string {
  if (projectRoot === undefined || projectRoot === '')
    return fileName
  const rel = relPosix(projectRoot, fileName)
  return rel !== '' ? rel : fileName
}

function mergeCompliance(base: ComplianceConfig | undefined, override: ComplianceConfig | undefined): ComplianceConfig | undefined {
  if (base === undefined)
    return override
  if (override === undefined)
    return base
  return {
    ignore: override.ignore ?? base.ignore,
    publicBody: override.publicBody ?? base.publicBody,
    legalNotice: override.legalNotice ?? base.legalNotice,
  }
}

function resolveRelativeSource(fromFile: string, specifier: string, readFile: (path: string) => string | undefined): { path: string, code: string } | undefined {
  const base = resolve(dirname(fromFile), specifier)
  const stripped = base.replace(/\.[cm]?js$/i, '')
  for (const ext of REL_EXTS) {
    const candidate = `${stripped}${ext}`
    if (!TS_EXT_RE.test(candidate))
      continue
    const code = readFile(candidate)
    if (code !== undefined)
      return { path: candidate, code }
  }
  return undefined
}

function collectImportedSignalMistakes(
  fileName: string,
  program: Program,
  imports: readonly { source: string, specifiers: readonly { local: string, imported: string }[] }[],
  readFile: ((path: string) => string | undefined) | undefined,
): PrunelleMistake[] {
  if (readFile === undefined)
    return []
  const importedSignals = new Set<string>()
  const importedSignalMembers = new Map<string, Set<string>>()
  for (const imp of imports) {
    if (!imp.source.startsWith('./') && !imp.source.startsWith('../'))
      continue
    const resolved = resolveRelativeSource(fileName, imp.source, readFile)
    if (resolved === undefined || !SIGNAL_HINT_RE.test(resolved.code))
      continue
    let depProgram: Program
    try {
      depProgram = parseTsx(resolved.path, resolved.code)
    }
    catch {
      continue
    }
    const { value: dep } = collectMistakes(() => analyzeModule(resolved.path, resolved.code, depProgram))
    if (dep === undefined || dep.signalExports.length === 0)
      continue
    const exported = new Set(dep.signalExports)
    for (const spec of imp.specifiers) {
      if (spec.imported === '*') {
        importedSignalMembers.set(spec.local, exported)
      }
      else if (exported.has(spec.imported)) {
        importedSignals.add(spec.local)
      }
    }
  }
  if (importedSignals.size === 0 && importedSignalMembers.size === 0)
    return []
  return collectMistakes(() => checkBareSignals(program, EMPTY_SET, fileName, importedSignals, importedSignalMembers)).mistakes
}

/** Runs Prunelle compiler & compliance checks on one TS/TSX file and returns positioned diagnostics + mechanical fixes. */
export function collectPrunelleDiagnostics(
  fileName: string,
  code: string,
  options: PrunellePluginOptions = {},
): PrunelleDiagnosticItem[] {
  if (!isCheckableFile(fileName))
    return []

  let program: Program
  try {
    program = parseTsx(fileName, code)
  }
  catch {
    // While the user is typing incomplete syntax, TypeScript's syntactic diagnostics report it already.
    return []
  }

  const { value, mistakes, error } = collectMistakes(() => analyzeModule(fileName, code, program))
  const allMistakes = [...mistakes]
  if (error instanceof PrunelleMistake)
    allMistakes.push(error)
  if (value !== undefined)
    allMistakes.push(...collectImportedSignalMistakes(fileName, program, value.imports, options.readFile))

  const staticCfg = options.compliance !== undefined && options.site !== undefined
    ? {}
    : readStaticProjectConfig(options.projectRoot)
  const compliance = mergeCompliance(staticCfg.compliance, options.compliance)
  const site = options.site ?? staticCfg.site

  const activeWarnings = (value?.warnings ?? []).filter(w => shouldEmitWarning(w, compliance, site))
  if (allMistakes.length === 0 && activeWarnings.length === 0)
    return []

  const offsets = new Set<number>()
  for (const m of allMistakes)
    offsets.add(m.start ?? 0)
  for (const w of activeWarnings)
    offsets.add(w.start)
  const nodesByOffset = indexNodesAtOffsets(program, offsets)

  const displayFile = normalizeDisplayPath(fileName, options.projectRoot)
  const items: PrunelleDiagnosticItem[] = []

  for (const m of allMistakes) {
    const start = m.start ?? 0
    const nodes = nodesByOffset.get(start) ?? []
    const classified = classifyMistakeFix(m.message, fileName, nodes, code)
    const span = classified?.diagSpan ?? spanFromNodes(nodes, code, start)
    items.push({
      code: classified?.code ?? PRUNELLE_CODE.ERROR,
      category: 'error',
      start: span.start,
      length: span.length,
      message: m.message.replaceAll(fileName, displayFile),
      ...(classified !== undefined ? { fix: classified.fix } : {}),
    })
  }

  for (const w of activeWarnings) {
    const nodes = nodesByOffset.get(w.start) ?? []
    const classified = classifyWarningFix(w.message, nodes)
    const span = classified?.diagSpan ?? spanFromNodes(nodes, code, w.start)
    items.push({
      code: classified?.code ?? PRUNELLE_CODE.WARNING,
      category: 'warning',
      start: span.start,
      length: span.length,
      message: w.message.replaceAll(fileName, displayFile),
      ...(classified !== undefined ? { fix: classified.fix } : {}),
    })
  }

  return items
}

/** Converts a `PrunelleDiagnosticItem` into a TypeScript `ts.Diagnostic`. */
export function toTsDiagnostic(
  tsLib: typeof ts,
  item: PrunelleDiagnosticItem,
  sourceFile: ts.SourceFile | undefined,
): ts.Diagnostic {
  return {
    file: sourceFile,
    start: item.start,
    length: item.length,
    messageText: item.message,
    category: item.category === 'warning' ? tsLib.DiagnosticCategory.Warning : tsLib.DiagnosticCategory.Error,
    code: item.code,
    source: PRUNELLE_DIAG_SOURCE,
  }
}
