// Built-in `a11y()` plugin, axe-core + Chromium route auditor, RGAA 4.1 reporting, and accessibility declaration drafter.

import type { RouteManifestEntry } from '../build/manifest'
import type { PrunellePlugin } from '../plugins/types'
import type { BrowserTest, BrowserTestOptions } from '../test/browser'
import type { ComplianceStatus } from './declaration'
import type { RgaaCriterion } from './rgaa-map'
import { resolve } from 'node:path'
import { definePlugin } from '../plugins/config'
import { DEFAULT_DECLARATION_PATH, draftAccessibilityStatement } from './declaration'
import { rgaaCriteriaForAxeRule } from './rgaa-map'

export { DEFAULT_DECLARATION_PATH, draftAccessibilityStatement, inferComplianceStatus } from './declaration'
export type { AccessibilityDeclarationOptions, AccessibilityDeclarationResult, ComplianceStatus } from './declaration'
export { AXE_TO_RGAA, RGAA_CRITERIA, rgaaCriteriaForAxeRule } from './rgaa-map'
export type { RgaaCriterion } from './rgaa-map'

export type A11yImpact = 'minor' | 'moderate' | 'serious' | 'critical'

export interface A11yViolationNode {
  target: string[]
  html: string
  failureSummary?: string | undefined
}

export interface A11yViolation {
  id: string
  impact: A11yImpact
  description: string
  help: string
  helpUrl: string
  tags: string[]
  rgaa: RgaaCriterion[]
  nodes: A11yViolationNode[]
}

export interface A11yRouteReport {
  route: string
  url: string
  violations: A11yViolation[]
  passes: number
  incomplete: number
  pageErrors: string[]
}

export interface A11yAuditReport {
  root: string
  auditedAt: string
  axeVersion?: string | undefined
  tags: string[]
  routes: A11yRouteReport[]
  totalViolations: number
  totalNodes: number
  ok: boolean
}

export interface A11yAuditOptions {
  /** Application root directory. */
  root: string
  /** Explicit route paths to audit (overrides manifest discovery). */
  routes?: readonly string[] | undefined
  /** Include static non-dynamic HTML routes even when prerendered routes exist. */
  includeAllStatic?: boolean | undefined
  /** Axe WCAG tags to evaluate (default: `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']`). */
  tags?: readonly string[] | undefined
  /** Chrome or Chromium executable path (forwarded to `testBrowser`). */
  browserPath?: string | undefined
  /** Per-page navigation/evaluation timeout in milliseconds (default: 10000). */
  timeout?: number | undefined
  /** Optional custom `routesDir` (forwarded to `testBrowser`). */
  routesDir?: string | undefined
  /** Optional custom `outDir` (forwarded to `testBrowser`). */
  outDir?: string | undefined
  /** Optional plugin override (forwarded to `testBrowser`). */
  plugins?: PrunellePlugin[] | undefined
}

export interface A11yPluginOptions {
  /** Default routes to audit when `--routes` is not given on the CLI. */
  routes?: readonly string[] | undefined
  /** Include static non-dynamic HTML routes alongside prerendered routes (default: `false`). */
  includeAllStatic?: boolean | undefined
  /** Axe WCAG tags to evaluate (default: `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']`). */
  tags?: readonly string[] | undefined
  /** Default destination path for `prunelle a11y --draft` (default: `'src/routes/accessibilite.tsx'`). */
  declarationPath?: string | undefined
  /** Organization name pre-filled in `--draft` declarations. */
  organization?: string | undefined
  /** Contact email pre-filled in `--draft` declarations. */
  contactEmail?: string | undefined
  /** Chrome or Chromium executable path. */
  browserPath?: string | undefined
  /** Per-page timeout in milliseconds. */
  timeout?: number | undefined
}

export const DEFAULT_AXE_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const AXE_SPECIFIER = 'axe-core'
const CLI_KIT_SPECIFIER = '@kaynooo/cli-kit'
const COMPLIANCE_STATUSES = ['full', 'partial', 'none'] as const

interface LoadedAxe {
  source: string
  version?: string | undefined
}

interface RawAxeNode {
  target?: unknown[] | undefined
  html?: string | undefined
  failureSummary?: string | undefined
}

interface RawAxeViolation {
  id: string
  impact?: string | null | undefined
  description: string
  help: string
  helpUrl: string
  tags: string[]
  nodes: RawAxeNode[]
}

interface RawAxeRunResult {
  violations: RawAxeViolation[]
  passes: number
  incomplete: number
}

interface TestBrowserModule {
  testBrowser: (options: BrowserTestOptions) => Promise<BrowserTest>
}

// Keep axe-core and testBrowser dynamically resolved so neither axe-core nor playwright-core enters any client or server bundle.
async function loadAxe(): Promise<LoadedAxe> {
  try {
    const mod = await import(AXE_SPECIFIER) as { source?: unknown, version?: unknown, default?: { source?: unknown, version?: unknown } }
    const source = typeof mod.source === 'string' ? mod.source : mod.default?.source
    const version = typeof mod.version === 'string' ? mod.version : typeof mod.default?.version === 'string' ? mod.default.version : undefined
    if (typeof source !== 'string' || source.length === 0)
      throw new Error('axe-core did not expose a `source` script string')
    return { source, version }
  }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('axe-core did not'))
      throw new Error(`prunelle: ${error.message}.`, { cause: error })
    throw new Error('prunelle: a11y audit needs axe-core, and it is not installed: run `bun add -d axe-core`.', { cause: error })
  }
}

async function loadTestBrowser(): Promise<TestBrowserModule['testBrowser']> {
  const url = new URL('../test/browser.ts', import.meta.url).href
  const mod = await import(url) as TestBrowserModule
  return mod.testBrowser
}

function normalizeRoutePath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '/')
    return '/'
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash
}

function sortRoutes(routes: Iterable<string>): string[] {
  return [...new Set([...routes].map(normalizeRoutePath))].sort((a, b) => {
    if (a === '/')
      return -1
    if (b === '/')
      return 1
    return a.localeCompare(b)
  })
}

function collectPrerenderedHtmlRoutes(routes: readonly RouteManifestEntry[]): string[] {
  const urls: string[] = []
  for (const route of routes) {
    if (route.prerendered === undefined)
      continue
    for (const [url, relFile] of Object.entries(route.prerendered)) {
      if (relFile.endsWith('.html') || relFile.endsWith('.htm'))
        urls.push(url)
    }
  }
  return sortRoutes(urls)
}

async function discoverRoutesToAudit(
  browser: BrowserTest,
  explicitRoutes: readonly string[] | undefined,
  includeAllStatic: boolean,
): Promise<string[]> {
  if (explicitRoutes !== undefined && explicitRoutes.length > 0)
    return sortRoutes(explicitRoutes)

  const manifestRoutes = browser.app.manifest?.routes ?? []
  const prerendered = collectPrerenderedHtmlRoutes(manifestRoutes)
  if (prerendered.length > 0 && !includeAllStatic)
    return prerendered

  const discovered = new Set<string>(prerendered)
  for (const route of manifestRoutes) {
    if (route.path.includes(':') || route.path.includes('*'))
      continue
    const normalized = normalizeRoutePath(route.path)
    if (discovered.has(normalized))
      continue
    const probe = await browser.app.get(normalized)
    const contentType = (probe.headers.get('content-type') ?? '').toLowerCase()
    if (probe.status < 400 && contentType.includes('text/html'))
      discovered.add(normalized)
  }
  return sortRoutes(discovered)
}

function normalizeImpact(raw: string | null | undefined): A11yImpact {
  if (raw === 'minor' || raw === 'moderate' || raw === 'serious' || raw === 'critical')
    return raw
  return 'moderate'
}

function mapAxeViolations(rawViolations: readonly RawAxeViolation[]): A11yViolation[] {
  return rawViolations.map(v => ({
    id: v.id,
    impact: normalizeImpact(v.impact),
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    tags: Array.isArray(v.tags) ? v.tags.map(String) : [],
    rgaa: rgaaCriteriaForAxeRule(v.id),
    nodes: (Array.isArray(v.nodes) ? v.nodes : []).map(n => ({
      target: Array.isArray(n.target) ? n.target.map(String) : [],
      html: typeof n.html === 'string' ? n.html : '',
      failureSummary: typeof n.failureSummary === 'string' && n.failureSummary.length > 0 ? n.failureSummary : undefined,
    })),
  }))
}

async function auditRoute(browser: BrowserTest, route: string, axeSource: string, tags: readonly string[]): Promise<A11yRouteReport> {
  const page = await browser.open(route)
  try {
    await page.evaluate(`${axeSource};\nvoid 0`)
    const runExpr = `(() => {
      if (!window.axe || typeof window.axe.run !== 'function')
        throw new Error('axe-core failed to initialize in page');
      return window.axe.run(document, ${JSON.stringify({ runOnly: { type: 'tag', values: tags } })}).then((res) => ({
        violations: res.violations.map((v) => ({
          id: v.id,
          impact: v.impact || 'moderate',
          description: v.description,
          help: v.help,
          helpUrl: v.helpUrl,
          tags: v.tags,
          nodes: v.nodes.map((n) => ({
            target: Array.isArray(n.target) ? n.target.map(String) : [],
            html: n.html || '',
            failureSummary: n.failureSummary || undefined,
          })),
        })),
        passes: res.passes.length,
        incomplete: res.incomplete.length,
      }));
    })()`
    const raw = await page.evaluate<RawAxeRunResult>(runExpr)
    return {
      route,
      url: page.url,
      violations: mapAxeViolations(raw.violations),
      passes: raw.passes,
      incomplete: raw.incomplete,
      pageErrors: [...page.errors],
    }
  }
  finally {
    await page.close()
  }
}

/** Builds the app, serves it in Chromium via `testBrowser`, and runs `axe-core` on every discovered route. */
export async function auditAccessibility(options: A11yAuditOptions): Promise<A11yAuditReport> {
  const root = resolve(options.root)
  const tags = options.tags !== undefined && options.tags.length > 0 ? [...options.tags] : [...DEFAULT_AXE_TAGS]
  const axe = await loadAxe()
  const runBrowser = await loadTestBrowser()

  const browser = await runBrowser({
    root,
    routesDir: options.routesDir,
    outDir: options.outDir,
    plugins: options.plugins,
    browserPath: options.browserPath,
    timeout: options.timeout,
  })

  try {
    const routes = await discoverRoutesToAudit(browser, options.routes, options.includeAllStatic === true)
    const results: A11yRouteReport[] = []
    for (const route of routes)
      results.push(await auditRoute(browser, route, axe.source, tags))

    let totalViolations = 0
    let totalNodes = 0
    for (const r of results) {
      totalViolations += r.violations.length
      for (const v of r.violations)
        totalNodes += v.nodes.length
    }

    return {
      root,
      auditedAt: new Date().toISOString(),
      axeVersion: axe.version,
      tags,
      routes: results,
      totalViolations,
      totalNodes,
      ok: totalViolations === 0,
    }
  }
  finally {
    await browser.close()
  }
}

/** Formats an `A11yAuditReport` into a human-readable CLI report grouped by route with RGAA 4.1 criteria. */
export function formatA11yReport(report: A11yAuditReport): string {
  const lines: string[] = []
  const routeWord = report.routes.length === 1 ? 'route' : 'routes'
  lines.push(`prunelle a11y: audited ${report.routes.length} ${routeWord} (${report.tags.join(', ')})`)

  if (report.routes.length === 0) {
    lines.push('  No prerendered or static HTML routes were found to audit. Pass --routes /path to target specific routes.')
    return lines.join('\n')
  }

  for (const r of report.routes) {
    if (r.violations.length === 0) {
      lines.push(`  ✓ ${r.route} (0 violations, ${r.passes} passes)`)
      continue
    }
    const routeNodes = r.violations.reduce((sum, v) => sum + v.nodes.length, 0)
    const vWord = r.violations.length === 1 ? 'violation' : 'violations'
    const eWord = routeNodes === 1 ? 'element' : 'elements'
    lines.push(`  ✗ ${r.route} (${r.violations.length} ${vWord}, ${routeNodes} ${eWord})`)
    for (const v of r.violations) {
      const rgaaSuffix = v.rgaa.length > 0 ? ` (RGAA ${v.rgaa.map(c => c.id).join(', ')})` : ''
      const count = v.nodes.length
      const elemWord = count === 1 ? 'element' : 'elements'
      lines.push(`    [${v.impact}] ${v.id}${rgaaSuffix} — ${count} ${elemWord}`)
      lines.push(`      ${v.help}`)
      const firstSelector = v.nodes[0]?.target.join(' > ')
      if (firstSelector)
        lines.push(`      Selector: ${firstSelector}`)
      lines.push(`      Help: ${v.helpUrl}`)
    }
  }

  if (report.ok) {
    lines.push(`✓ 0 accessibility violations across ${report.routes.length} ${routeWord}.`)
  }
  else {
    const failedRoutes = report.routes.filter(r => r.violations.length > 0).length
    lines.push(`✗ ${report.totalViolations} violation${report.totalViolations === 1 ? '' : 's'} across ${report.totalNodes} element${report.totalNodes === 1 ? '' : 's'} on ${failedRoutes} ${failedRoutes === 1 ? 'route' : 'routes'}.`)
  }
  return lines.join('\n')
}

async function runA11yCommand(args: string[], root: string, pluginOptions: A11yPluginOptions): Promise<void> {
  const { badUsage, Exit, parse } = await import(CLI_KIT_SPECIFIER) as typeof import('@kaynooo/cli-kit')
  const { values, positionals } = parse(args, 'prunelle a11y [options]: audits rendered routes with axe-core + RGAA 4.1 and drafts an accessibility declaration', {
    'routes': { type: 'string', description: 'comma-separated routes to audit (e.g. /,/about)' },
    'all-static': { type: 'boolean', description: 'include static non-dynamic HTML routes alongside prerendered routes' },
    'json': { type: 'boolean', description: 'print the audit report as JSON on stdout' },
    'draft': { type: 'string', optional: { bare: '' }, description: 'write an editable RGAA 4.1.2 accessibility declaration page (default: src/routes/accessibilite.tsx)' },
    'out': { type: 'string', description: 'destination path for --draft (default: src/routes/accessibilite.tsx)' },
    'status': { type: 'string', choices: COMPLIANCE_STATUSES, description: 'override declaration compliance status (full, partial, none)' },
    'org': { type: 'string', description: 'organization name written into --draft' },
    'contact': { type: 'string', description: 'contact email written into --draft' },
    'no-fail': { type: 'boolean', description: 'exit 0 even when accessibility violations are found' },
  }, {
    positionals: ['[dest]'],
    exits: [
      [0, 'no accessibility violations found (or --draft / --no-fail)'],
      [1, 'one or more accessibility violations found, or audit failed'],
      [2, 'a usage error'],
    ],
  })

  const rawRoutes = values.routes !== undefined
    ? values.routes.split(',').map(s => s.trim()).filter(Boolean)
    : pluginOptions.routes
  if (values.routes !== undefined && (rawRoutes === undefined || rawRoutes.length === 0))
    return badUsage('--routes requires at least one route path, e.g. --routes /,/about')

  const wantDraft = values.draft !== undefined
  const draftDest = values.out
    ?? (values.draft !== undefined && values.draft !== '' ? values.draft : undefined)
    ?? positionals[0]
    ?? pluginOptions.declarationPath
    ?? DEFAULT_DECLARATION_PATH

  const report = await auditAccessibility({
    root,
    routes: rawRoutes,
    includeAllStatic: values['all-static'] === true || pluginOptions.includeAllStatic === true,
    tags: pluginOptions.tags,
    browserPath: pluginOptions.browserPath,
    timeout: pluginOptions.timeout,
  })

  let drafted: ReturnType<typeof draftAccessibilityStatement> | undefined
  if (wantDraft) {
    drafted = draftAccessibilityStatement({
      root,
      outPath: draftDest,
      report,
      organization: values.org ?? pluginOptions.organization,
      contactEmail: values.contact ?? pluginOptions.contactEmail,
      status: values.status as ComplianceStatus | undefined,
    })
  }

  if (values.json === true) {
    console.log(JSON.stringify(drafted !== undefined ? { ...report, declaration: { path: drafted.relativePath, status: drafted.status } } : report, null, 2))
    if (!report.ok && !wantDraft && values['no-fail'] !== true)
      process.exitCode = 1
    return
  }

  console.log(formatA11yReport(report))
  if (drafted !== undefined)
    console.log(`prunelle a11y: drafted RGAA 4.1.2 accessibility declaration at ${drafted.relativePath} (${drafted.status})`)

  if (!report.ok && !wantDraft && values['no-fail'] !== true)
    throw new Exit(`found ${report.totalViolations} accessibility violation${report.totalViolations === 1 ? '' : 's'}`, 1)
}

/** Built-in accessibility plugin: registers `prunelle a11y` (axe-core Chromium audit + RGAA 4.1 mapping + declaration draft). */
export function a11y(options: A11yPluginOptions = {}): PrunellePlugin {
  return definePlugin({
    name: 'prunelle:a11y',
    commands: {
      a11y: (args, root) => runA11yCommand(args, root, options),
    },
  })
}
