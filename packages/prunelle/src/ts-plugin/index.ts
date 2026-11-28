// TypeScript Language Service plugin surfacing Prunelle compiler errors, compliance warnings, and quick fixes in editors.

import type ts from 'typescript'
import type { ComplianceConfig } from '../compiler/compliance'
import type { PrunelleDiagnosticItem, PrunellePluginOptions } from './diagnostics'
import { collectPrunelleDiagnostics, isCheckableFile, PRUNELLE_DIAG_SOURCE, toTsDiagnostic } from './diagnostics'
import { PRUNELLE_CODE, PRUNELLE_FIXABLE_CODES, toCodeFixAction } from './fixes'

const MAX_CACHE_ENTRIES = 200

interface CachedFileDiagnostics {
  text: string
  projectVersion: string
  items: PrunelleDiagnosticItem[]
}

function readPluginConfig(raw: unknown): Pick<PrunellePluginOptions, 'compliance' | 'site'> {
  if (raw === null || typeof raw !== 'object')
    return {}
  const rec = raw as Record<string, unknown>
  const site = typeof rec.site === 'string' ? rec.site : undefined
  const compliance = rec.compliance !== null && typeof rec.compliance === 'object'
    ? (rec.compliance as ComplianceConfig)
    : undefined
  return { site, compliance }
}

// Advertises Prunelle's custom fixable diagnostic codes to tsserver/VS Code when TypeScript's supported-codes array is extensible.
function registerSupportedCodeFixes(tsLib: typeof ts): void {
  if (typeof tsLib.getSupportedCodeFixes !== 'function')
    return
  try {
    const supported = tsLib.getSupportedCodeFixes() as string[]
    if (!Array.isArray(supported) || Object.isFrozen(supported))
      return
    const existing = new Set(supported)
    for (const code of PRUNELLE_FIXABLE_CODES) {
      const str = String(code)
      if (!existing.has(str))
        supported.push(str)
    }
  }
  catch {
    // Some TypeScript builds freeze the supported-codes array; editors still invoke getCodeFixesAtPosition directly.
    return
  }
}

function readFileSource(
  prior: ts.LanguageService,
  host: ts.LanguageServiceHost,
  fileName: string,
): { sourceFile: ts.SourceFile | undefined, text: string | undefined } {
  const sourceFile = prior.getProgram()?.getSourceFile(fileName)
  if (sourceFile !== undefined)
    return { sourceFile, text: sourceFile.text }
  const snapshot = host.getScriptSnapshot(fileName)
  if (snapshot !== undefined)
    return { sourceFile: undefined, text: snapshot.getText(0, snapshot.getLength()) }
  return { sourceFile: undefined, text: undefined }
}

/** Direct helper for retrieving TypeScript `ts.Diagnostic`s for a single file. */
export function getPrunelleDiagnostics(
  tsLib: typeof ts,
  fileName: string,
  code: string,
  options: PrunellePluginOptions = {},
  sourceFile?: ts.SourceFile,
): ts.Diagnostic[] {
  return collectPrunelleDiagnostics(fileName, code, options).map(item => toTsDiagnostic(tsLib, item, sourceFile))
}

/** Direct helper for retrieving TypeScript `ts.CodeFixAction`s overlapping `[start, end]`. */
export function getPrunelleCodeFixes(
  fileName: string,
  code: string,
  start: number,
  end: number,
  errorCodes: readonly number[],
  options: PrunellePluginOptions = {},
): ts.CodeFixAction[] {
  const items = collectPrunelleDiagnostics(fileName, code, options)
  return selectCodeFixes(fileName, items, start, end, errorCodes)
}

function selectCodeFixes(
  fileName: string,
  items: readonly PrunelleDiagnosticItem[],
  start: number,
  end: number,
  errorCodes: readonly number[],
): ts.CodeFixAction[] {
  const out: ts.CodeFixAction[] = []
  for (const item of items) {
    if (item.fix === undefined)
      continue
    if (errorCodes.length > 0 && !errorCodes.includes(item.code))
      continue
    const itemEnd = item.start + item.length
    if (item.start <= end && start <= itemEnd)
      out.push(toCodeFixAction(fileName, item.fix))
  }
  return out
}

/** Creates the wrapped `ts.LanguageService` for a TypeScript plugin instance. */
export function createPrunellePlugin(tsLib: typeof ts, info: ts.server.PluginCreateInfo): ts.LanguageService {
  const prior = info.languageService
  const log = (msg: string): void => {
    info.project?.projectService?.logger?.info(`[prunelle/ts-plugin] ${msg}`)
  }

  registerSupportedCodeFixes(tsLib)

  const cache = new Map<string, CachedFileDiagnostics>()
  const pluginCfg = readPluginConfig(info.config)
  const readFile = (path: string): string | undefined => readFileSource(prior, info.languageServiceHost, path).text
  const getOptions = (): PrunellePluginOptions => ({
    projectRoot: typeof info.project?.getCurrentDirectory === 'function' ? info.project.getCurrentDirectory() : undefined,
    compliance: pluginCfg.compliance,
    site: pluginCfg.site,
    readFile,
  })

  const getItems = (fileName: string): { sourceFile: ts.SourceFile | undefined, items: PrunelleDiagnosticItem[] } => {
    if (!isCheckableFile(fileName))
      return { sourceFile: undefined, items: [] }
    const { sourceFile, text } = readFileSource(prior, info.languageServiceHost, fileName)
    if (text === undefined)
      return { sourceFile, items: [] }
    const projectVersion = typeof info.languageServiceHost.getProjectVersion === 'function'
      ? info.languageServiceHost.getProjectVersion()
      : ''
    const cached = cache.get(fileName)
    if (cached !== undefined && cached.text === text && cached.projectVersion === projectVersion)
      return { sourceFile, items: cached.items }
    try {
      const items = collectPrunelleDiagnostics(fileName, text, getOptions())
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined)
          cache.delete(oldest)
      }
      cache.set(fileName, { text, projectVersion, items })
      return { sourceFile, items }
    }
    catch (err) {
      log(`analysis failed for ${fileName}: ${err instanceof Error ? err.message : String(err)}`)
      return { sourceFile, items: [] }
    }
  }

  const proxy = Object.create(null) as ts.LanguageService
  for (const key of Object.keys(prior) as (keyof ts.LanguageService)[]) {
    const member = prior[key]
    if (typeof member === 'function') {
      ;(proxy as unknown as Record<string, unknown>)[key] = (...args: unknown[]) =>
        (member as (...a: unknown[]) => unknown).apply(prior, args)
    }
  }

  proxy.getSemanticDiagnostics = (fileName) => {
    const base = prior.getSemanticDiagnostics(fileName)
    const { sourceFile, items } = getItems(fileName)
    if (items.length === 0)
      return base
    return [...base, ...items.map(item => toTsDiagnostic(tsLib, item, sourceFile))]
  }

  proxy.getCodeFixesAtPosition = (fileName, start, end, errorCodes, formatOptions, preferences) => {
    const base = prior.getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions, preferences)
    const { items } = getItems(fileName)
    if (items.length === 0)
      return base
    const prunelleFixes = selectCodeFixes(fileName, items, start, end, errorCodes)
    return prunelleFixes.length === 0 ? base : [...base, ...prunelleFixes]
  }

  return proxy
}

function init(modules: { typescript: typeof ts }): ts.server.PluginModule {
  const tsLib = modules.typescript
  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      return createPrunellePlugin(tsLib, info)
    },
  }
}

export default init
export type { PrunelleDiagnosticItem, PrunellePluginOptions }
export { collectPrunelleDiagnostics, PRUNELLE_CODE, PRUNELLE_DIAG_SOURCE, PRUNELLE_FIXABLE_CODES }
