// French web law compliance checks (RGAA, RGPD, LCEN): static TSX/CSS warnings and route-level checks with explicit silencing.

import type { JSXAttribute, JSXElement, Node, Program } from 'oxc-parser'
import type { ModuleAnalysis } from './analyze'
import type { RgaaJsxRule, RgaaScope } from './compliance-rgaa'
import type { CompilerWarning } from './mistakes'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { visitorKeys } from 'oxc-parser'
import { relPosix, walkFiles } from '../build/files'
import { fileToRoutePath } from '../build/routes'
import {
  attrTargetKey,
  checkRgaaElement,
  cloneRgaaScope,
  createRgaaScope,
  findAttr,
  hasNonEmptyAttr,
  INTERACTIVE_ANCESTORS,
  mergeRgaaScope,
  RGAA_JSX_RULES,
  staticStringValueOf,
} from './compliance-rgaa'
import { formatDiagnostic, formatLoc, isComponentTag, jsxTagName } from './shared'

export type ComplianceRule =
  | RgaaJsxRule
  | 'rgpd/third-party-url'
  | 'lcen/legal-notice'
  | 'rgaa/accessibility-statement'

export interface ComplianceConfig {
  /** Compliance rules to silence across the app. */
  ignore?: readonly ComplianceRule[] | undefined
  /** Set `true` for French public-sector sites (RGAA requires an accessibility statement page). */
  publicBody?: boolean | undefined
  /** Custom route path for the legal notice page, or `false` to silence `lcen/legal-notice`. */
  legalNotice?: string | false | undefined
}

const COMPLIANCE_RULES = new Set<ComplianceRule>([
  ...RGAA_JSX_RULES,
  'rgpd/third-party-url',
  'lcen/legal-notice',
  'rgaa/accessibility-statement',
])

const THIRD_PARTY_LINK_RELS = new Set(['stylesheet', 'preload', 'preconnect', 'dns-prefetch'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])
const DEFAULT_LEGAL_PATHS = new Set(['/mentions-legales', '/legal', '/legal-notice', '/imprint', '/impressum', '/cgu', '/cgv'])
const ACCESSIBILITY_PATHS = new Set(['/accessibilite', '/accessibility', '/declaration-accessibilite', '/accessibility-statement'])

const LINE_IGNORE_RE = /(?:^|[\s{;(,])\/\/\s*prunelle-ignore(-file)?[ \t]+([^\r\n]+)/g
const BLOCK_IGNORE_RE = /\/\*\s*prunelle-ignore(-file)?\s+([\s\S]*?)\*\//g
const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s);]+))/gi
const CSS_URL_RE = /url\(\s*(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)/gi

interface IgnoreMap {
  lineStarts: number[]
  fileRules: Set<ComplianceRule>
  lineRules: Map<number, Set<ComplianceRule>>
}

function buildLineStarts(code: string): number[] {
  const starts = [0]
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10)
      starts.push(i + 1)
  }
  return starts
}

function offsetToLine(lineStarts: readonly number[], offset: number): number {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid]! <= offset)
      lo = mid
    else
      hi = mid - 1
  }
  return lo + 1
}

function extractRules(text: string): ComplianceRule[] {
  const out: ComplianceRule[] = []
  for (const token of text.trim().split(/[\s,]+/)) {
    if (COMPLIANCE_RULES.has(token as ComplianceRule))
      out.push(token as ComplianceRule)
  }
  return out
}

export function parsePrunelleIgnores(code: string): IgnoreMap {
  const lineStarts = buildLineStarts(code)
  const fileRules = new Set<ComplianceRule>()
  const lineRules = new Map<number, Set<ComplianceRule>>()

  const record = (isFile: boolean, start: number, end: number, rawRules: string): void => {
    const rules = extractRules(rawRules)
    if (rules.length === 0)
      return
    if (isFile) {
      for (const r of rules)
        fileRules.add(r)
      return
    }
    const startLine = offsetToLine(lineStarts, start)
    const endLine = offsetToLine(lineStarts, end)
    for (const line of [startLine, endLine, endLine + 1]) {
      let set = lineRules.get(line)
      if (set === undefined) {
        set = new Set()
        lineRules.set(line, set)
      }
      for (const r of rules)
        set.add(r)
    }
  }

  for (const re of [LINE_IGNORE_RE, BLOCK_IGNORE_RE]) {
    re.lastIndex = 0
    for (let m = re.exec(code); m !== null; m = re.exec(code))
      record(m[1] === '-file', m.index, m.index + m[0].length, m[2]!)
  }
  return { lineStarts, fileRules, lineRules }
}

function isIgnoredAt(ignores: IgnoreMap, rule: ComplianceRule, offset: number): boolean {
  if (ignores.fileRules.has(rule))
    return true
  const line = offsetToLine(ignores.lineStarts, offset)
  return ignores.lineRules.get(line)?.has(rule) === true
}

export function isRuleIgnored(rule: ComplianceRule, compliance?: ComplianceConfig | undefined): boolean {
  if (rule === 'lcen/legal-notice' && compliance?.legalNotice === false)
    return true
  return compliance?.ignore?.includes(rule) === true
}

export function parseOrigin(url: string | undefined): string | undefined {
  if (url === undefined || url.trim() === '')
    return undefined
  try {
    return new URL(url.trim()).origin
  }
  catch {
    return undefined
  }
}

/** Returns the external origin when `rawUrl` points to a non-localhost third-party URL, or `undefined` otherwise. */
export function thirdPartyOrigin(rawUrl: string): string | undefined {
  const trimmed = rawUrl.trim()
  if (!/^(?:https?:)?\/\//i.test(trimmed))
    return undefined
  try {
    const parsed = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return undefined
    const host = parsed.hostname.toLowerCase()
    if (LOCAL_HOSTS.has(host) || host.endsWith('.localhost'))
      return undefined
    return parsed.origin
  }
  catch {
    return undefined
  }
}

/** Whether a compiler warning should be surfaced given `compliance` and `site` config. */
export function shouldEmitWarning(warning: CompilerWarning, compliance?: ComplianceConfig | undefined, site?: string | undefined): boolean {
  if (warning.rule !== undefined && isRuleIgnored(warning.rule, compliance))
    return false
  if (warning.rule === 'rgpd/third-party-url' && warning.urlOrigin !== undefined) {
    const siteOrigin = parseOrigin(site)
    if (siteOrigin !== undefined && warning.urlOrigin === siteOrigin)
      return false
  }
  return true
}

interface AncestorState {
  labelDepth: number
  consentGateDepth: number
  interactiveAncestor: string | undefined
}

function walkAst(value: unknown, enter: (node: Node) => void): void {
  if (value === null || typeof value !== 'object')
    return
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++)
      walkAst(value[i], enter)
    return
  }
  const node = value as Node
  if (typeof node.type !== 'string')
    return
  enter(node)
  const keys = visitorKeys[node.type]
  if (keys !== undefined) {
    for (let i = 0; i < keys.length; i++)
      walkAst((node as unknown as Record<string, unknown>)[keys[i]!], enter)
  }
}

function collectLabelTargets(program: Program): Set<string> {
  const targets = new Set<string>()
  walkAst(program, (node) => {
    if (node.type !== 'JSXElement')
      return
    const tag = jsxTagName(node.openingElement.name)
    if (tag !== 'label')
      return
    const attrs = node.openingElement.attributes
    const key = attrTargetKey(findAttr(attrs, 'for') ?? findAttr(attrs, 'htmlFor'))
    if (key !== undefined)
      targets.add(key)
  })
  return targets
}

function checkThirdPartyElement(
  element: JSXElement,
  tag: string,
  filename: string,
  ignores: IgnoreMap,
  warnings: CompilerWarning[],
): void {
  const attrs = element.openingElement.attributes
  let attr: JSXAttribute | undefined
  let attrName = ''
  if (tag === 'script' || tag === 'iframe') {
    attr = findAttr(attrs, 'src')
    attrName = 'src'
  }
  else if (tag === 'link') {
    const relVal = staticStringValueOf(findAttr(attrs, 'rel')?.value ?? null)
    if (relVal === undefined)
      return
    const rels = relVal.toLowerCase().split(/\s+/)
    if (!rels.some(r => THIRD_PARTY_LINK_RELS.has(r)))
      return
    attr = findAttr(attrs, 'href')
    attrName = 'href'
  }
  if (attr === undefined)
    return
  const url = staticStringValueOf(attr.value)
  if (url === undefined)
    return
  const origin = thirdPartyOrigin(url)
  if (origin === undefined || isIgnoredAt(ignores, 'rgpd/third-party-url', attr.start))
    return
  warnings.push({
    rule: 'rgpd/third-party-url',
    urlOrigin: origin,
    start: attr.start,
    message: `[rgpd/third-party-url] <${tag} ${attrName}="${url}"> in ${filename} loads a third-party resource without consent: self-host it (e.g. @prunellejs/seo fonts or public/) or wrap it in <ConsentGate category="...">.`,
  })
}

function definitelyExits(stmt: Node): boolean {
  if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement')
    return true
  if (stmt.type === 'BlockStatement')
    return stmt.body.length > 0 && definitelyExits(stmt.body[stmt.body.length - 1]!)
  if (stmt.type === 'IfStatement')
    return stmt.alternate !== null && definitelyExits(stmt.consequent) && definitelyExits(stmt.alternate)
  return false
}

/** Runs RGAA & RGPD static JSX compliance checks on `program`, appending warnings (never throwing). */
export function checkCompliance(
  program: Program,
  filename: string,
  code: string,
  warnings: CompilerWarning[],
  resolveTag: (tag: string) => string | undefined,
): void {
  const ignores = parsePrunelleIgnores(code)
  const labelTargets = collectLabelTargets(program)
  const isIgnored = (rule: RgaaJsxRule, elementStart: number, attrStart?: number): boolean =>
    isIgnoredAt(ignores, rule, elementStart) || (attrStart !== undefined && isIgnoredAt(ignores, rule, attrStart))

  const visitChildren = (node: Node, ancestors: AncestorState, scope: RgaaScope): void => {
    const keys = visitorKeys[node.type]
    if (keys === undefined)
      return
    const rec = node as unknown as Record<string, unknown>
    for (let i = 0; i < keys.length; i++)
      visit(rec[keys[i]!], ancestors, scope)
  }

  const visit = (value: unknown, ancestors: AncestorState, scope: RgaaScope): void => {
    if (value === null || typeof value !== 'object')
      return
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++)
        visit(value[i], ancestors, scope)
      return
    }
    const node = value as Node
    if (typeof node.type !== 'string')
      return

    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      visitChildren(node, ancestors, createRgaaScope())
      return
    }

    if (node.type === 'ConditionalExpression') {
      visit(node.test, ancestors, scope)
      const branchA = cloneRgaaScope(scope)
      const branchB = cloneRgaaScope(scope)
      visit(node.consequent, ancestors, branchA)
      visit(node.alternate, ancestors, branchB)
      mergeRgaaScope(scope, branchA)
      mergeRgaaScope(scope, branchB)
      return
    }

    if (node.type === 'IfStatement') {
      visit(node.test, ancestors, scope)
      const branchA = cloneRgaaScope(scope)
      visit(node.consequent, ancestors, branchA)
      const branchB = cloneRgaaScope(scope)
      if (node.alternate !== null)
        visit(node.alternate, ancestors, branchB)
      if (!definitelyExits(node.consequent))
        mergeRgaaScope(scope, branchA)
      if (node.alternate !== null && !definitelyExits(node.alternate))
        mergeRgaaScope(scope, branchB)
      return
    }

    if (node.type === 'JSXElement') {
      const tag = jsxTagName(node.openingElement.name)
      const attrs = node.openingElement.attributes
      if (tag !== '' && !isComponentTag(tag)) {
        checkRgaaElement(node, tag, {
          filename,
          inLabel: ancestors.labelDepth > 0,
          interactiveAncestor: ancestors.interactiveAncestor,
          labelTargets,
          scope,
          isIgnored,
          warnings,
        })
        if (ancestors.consentGateDepth === 0)
          checkThirdPartyElement(node, tag, filename, ignores, warnings)
      }
      visit(attrs, ancestors, scope)
      const opensLabel = tag === 'label' || (isComponentTag(tag) && hasNonEmptyAttr(attrs, 'label'))
      const opensConsentGate = resolveTag(tag) === 'ConsentGate'
      const nextInteractive = INTERACTIVE_ANCESTORS.has(tag) ? tag : ancestors.interactiveAncestor
      const childAncestors = opensLabel || opensConsentGate || nextInteractive !== ancestors.interactiveAncestor
        ? {
            labelDepth: ancestors.labelDepth + (opensLabel ? 1 : 0),
            consentGateDepth: ancestors.consentGateDepth + (opensConsentGate ? 1 : 0),
            interactiveAncestor: nextInteractive,
          }
        : ancestors
      visit(node.children, childAncestors, scope)
      return
    }

    visitChildren(node, ancestors, scope)
  }

  visit(program, { labelDepth: 0, consentGateDepth: 0, interactiveAncestor: undefined }, createRgaaScope())
}

/** Scans a CSS file for third-party `@import` or `url(...)` origins (RGPD), respecting `/* prunelle-ignore *\/` and config. */
export function checkCssCompliance(
  relFile: string,
  code: string,
  compliance?: ComplianceConfig | undefined,
  site?: string | undefined,
): string[] {
  if (isRuleIgnored('rgpd/third-party-url', compliance))
    return []
  const ignores = parsePrunelleIgnores(code)
  if (ignores.fileRules.has('rgpd/third-party-url'))
    return []
  const siteOrigin = parseOrigin(site)

  const commentSpans: [number, number][] = []
  CSS_COMMENT_RE.lastIndex = 0
  for (let m = CSS_COMMENT_RE.exec(code); m !== null; m = CSS_COMMENT_RE.exec(code))
    commentSpans.push([m.index, m.index + m[0].length])
  const inComment = (offset: number): boolean => commentSpans.some(([s, e]) => offset >= s && offset < e)

  const seenUrls = new Set<string>()
  const out: string[] = []
  const recordUrl = (offset: number, rawUrl: string): void => {
    if (inComment(offset))
      return
    const key = `${offset}:${rawUrl}`
    if (seenUrls.has(key))
      return
    const origin = thirdPartyOrigin(rawUrl)
    if (origin === undefined || (siteOrigin !== undefined && origin === siteOrigin))
      return
    if (isIgnoredAt(ignores, 'rgpd/third-party-url', offset))
      return
    seenUrls.add(key)
    const loc = formatLoc(relFile, code, offset)
    out.push(formatDiagnostic(loc, `[rgpd/third-party-url] "${rawUrl}" in ${relFile} loads a third-party resource without consent: self-host it (e.g. @prunellejs/seo fonts or public/) or gate it with <ConsentGate category="...">.`, 'warning'))
  }

  for (const re of [CSS_IMPORT_RE, CSS_URL_RE]) {
    re.lastIndex = 0
    for (let m = re.exec(code); m !== null; m = re.exec(code)) {
      const url = m[1] ?? m[2] ?? m[3]
      if (url !== undefined)
        recordUrl(m.index + m[0].indexOf(url), url)
    }
  }
  return out
}

function normalizePath(path: string): string {
  const trimmed = path.trim()
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1).toLowerCase() : withSlash.toLowerCase()
}

/** Checks project-level LCEN legal notice and RGAA accessibility statement routes. */
export function checkRouteCompliance(pageRoutePaths: readonly string[], compliance?: ComplianceConfig | undefined): string[] {
  if (pageRoutePaths.length === 0)
    return []
  const normalized = new Set(pageRoutePaths.map(normalizePath))
  const out: string[] = []

  if (!isRuleIgnored('lcen/legal-notice', compliance)) {
    const custom = typeof compliance?.legalNotice === 'string' ? normalizePath(compliance.legalNotice) : undefined
    const hasLegal = custom !== undefined
      ? normalized.has(custom)
      : [...normalized].some(p => DEFAULT_LEGAL_PATHS.has(p))
    if (!hasLegal) {
      const expected = custom ?? '/mentions-legales (or /legal)'
      out.push(formatDiagnostic('prunelle.config.ts:1:1', `[lcen/legal-notice] App has no legal notice route: add ${expected}, set compliance.legalNotice, or silence with compliance: { legalNotice: false }.`, 'warning'))
    }
  }

  if (compliance?.publicBody === true && !isRuleIgnored('rgaa/accessibility-statement', compliance)) {
    const hasA11y = [...normalized].some(p => ACCESSIBILITY_PATHS.has(p))
    if (!hasA11y) {
      out.push(formatDiagnostic('prunelle.config.ts:1:1', '[rgaa/accessibility-statement] Public-body site (compliance.publicBody: true) has no accessibility statement route: add /accessibilite (or /accessibility).', 'warning'))
    }
  }

  return out
}

export interface ProjectComplianceInput {
  root: string
  srcDir: string
  routesDir: string
  routeFiles: readonly string[]
  analyses: ReadonlyMap<string, ModuleAnalysis>
  compliance?: ComplianceConfig | undefined
  site?: string | undefined
}

/** Collects project-level CSS third-party URL warnings and LCEN/RGAA route warnings for `prunelle check` and production `prunelle build`. */
export function collectProjectComplianceWarnings(input: ProjectComplianceInput): string[] {
  const { root, srcDir, routesDir, routeFiles, analyses, compliance, site } = input
  const warnings: string[] = []

  if (existsSync(srcDir)) {
    const cssFiles = walkFiles(srcDir, {
      skipDir: name => name === 'node_modules' || name === 'dist' || name.startsWith('.'),
      keep: entry => entry.name.endsWith('.css'),
    }).sort()
    for (const cssFile of cssFiles) {
      const code = readFileSync(cssFile, 'utf8')
      warnings.push(...checkCssCompliance(relPosix(root, cssFile), code, compliance, site))
    }
  }

  const pagePaths: string[] = []
  for (const file of routeFiles) {
    if (basename(file).startsWith('_'))
      continue
    const analysis = analyses.get(file)
    if (analysis !== undefined && analysis.exportedNames.includes('default'))
      pagePaths.push(fileToRoutePath(routesDir, file))
  }
  warnings.push(...checkRouteCompliance(pagePaths, compliance))
  return warnings
}
