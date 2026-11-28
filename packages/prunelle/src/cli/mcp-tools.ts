// Tool and resource definitions & handlers for the built-in `prunelle mcp` server.

import type { BundleReport } from '../build/report'
import { existsSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { relPosix } from '../build/files'
import { build } from '../build/index'
import { isInside } from '../build/is-inside'
import { processSuffix } from '../build/output'
import { readDevErrorLog } from '../dev/error-log'
import { checkProject, diagnosticData } from './check'
import { discoverLlmsDocs, searchLlmsDocs } from './docs'
import { inspectProject } from './inspect'
import { renderUrl } from './render'

export interface McpToolAnnotations {
  title?: string | undefined
  readOnlyHint?: boolean | undefined
  destructiveHint?: boolean | undefined
  idempotentHint?: boolean | undefined
  openWorldHint?: boolean | undefined
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[] | undefined
    additionalProperties?: boolean | undefined
  }
  annotations: McpToolAnnotations
}

export interface McpToolCallResult {
  content: { type: 'text', text: string }[]
  isError?: boolean | undefined
}

export interface McpResource {
  uri: string
  name: string
  description: string
  mimeType: string
}

export interface McpResourceContent {
  uri: string
  mimeType: string
  text: string
}

export interface PrunelleMcpContext {
  root: string
  allowWrite: boolean
}

const WRITE_GATE_MESSAGE = 'Writing build output requires starting `prunelle mcp --allow-write`.'
const LLMS_URI_PREFIX = 'prunelle://llms/'

function safeRealpath(target: string): string | undefined {
  try {
    return realpathSync(target)
  }
  catch {
    return undefined
  }
}

function nearestExistingRealpath(target: string): string | undefined {
  let cursor = target
  while (true) {
    if (existsSync(cursor))
      return safeRealpath(cursor)
    const parent = dirname(cursor)
    if (parent === cursor)
      return undefined
    cursor = parent
  }
}

/** Resolves a user-supplied relative path against `baseDir` (default `root`) and refuses any path or symlink escaping `root`. */
export function resolveProjectPath(root: string, maybeRel: unknown, label: string, baseDir?: string): string {
  const absRoot = resolve(root)
  const absBase = baseDir !== undefined ? resolve(baseDir) : absRoot
  if (maybeRel === undefined || maybeRel === '')
    return absBase
  if (typeof maybeRel !== 'string')
    throw new Error(`prunelle mcp: ${label} must be a string`)

  const resolved = resolve(absBase, maybeRel)
  if (!isInside(absRoot, resolved, { orSame: true }))
    throw new Error(`prunelle mcp: ${label} "${maybeRel}" escapes the project root`)

  const realRoot = safeRealpath(absRoot)
  const realTarget = nearestExistingRealpath(resolved)
  if (realRoot !== undefined && realTarget !== undefined && !isInside(realRoot, realTarget, { orSame: true }))
    throw new Error(`prunelle mcp: ${label} "${maybeRel}" escapes the project root via symlink`)

  return resolved
}

function asArgsRecord(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null)
    return {}
  if (typeof args !== 'object' || Array.isArray(args))
    throw new Error('prunelle mcp: tool arguments must be a JSON object')
  return args as Record<string, unknown>
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key]
  if (value === undefined)
    return undefined
  if (typeof value !== 'boolean')
    throw new Error(`prunelle mcp: "${key}" must be a boolean`)
  return value
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined)
    return undefined
  if (typeof value !== 'string')
    throw new Error(`prunelle mcp: "${key}" must be a string`)
  return value
}

function normalizeRenderHeaders(raw: unknown): string[] | undefined {
  if (raw === undefined)
    return undefined
  if (Array.isArray(raw)) {
    if (!raw.every(item => typeof item === 'string'))
      throw new Error('prunelle mcp: "headers" array entries must be strings')
    return raw
  }
  if (typeof raw === 'object' && raw !== null) {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`)
  }
  throw new Error('prunelle mcp: "headers" must be an object or string array')
}

function normalizeStringArray(raw: unknown, key: string): string[] | undefined {
  if (raw === undefined)
    return undefined
  if (!Array.isArray(raw) || !raw.every(item => typeof item === 'string'))
    throw new Error(`prunelle mcp: "${key}" must be an array of strings`)
  return raw
}

function jsonResult(data: unknown): McpToolCallResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function errorResult(message: string): McpToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Returns the list of MCP tools exposed by `prunelle mcp`. */
export function listPrunelleTools(): McpToolDefinition[] {
  return [
    {
      name: 'check',
      description: 'Run `prunelle check` and return structured JSON diagnostics (errors, warnings, checkedFiles, typecheck).',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Optional sub-directory inside the project root.' },
          skipTypecheck: { type: 'boolean', description: 'Skip the TypeScript typecheck step.' },
          strict: { type: 'boolean', description: 'Fail (ok: false) when warnings are present.' },
        },
        additionalProperties: false,
      },
      annotations: { title: 'Check Prunelle project', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'inspect',
      description: 'Statically inspect routes, islands, server actions, and active plugins without bundling.',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Optional sub-directory inside the project root.' },
        },
        additionalProperties: false,
      },
      annotations: { title: 'Inspect Prunelle project', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'build_analyze',
      description: 'Analyze per-route JS/CSS bundle weights and islands. Read-only by default (uses a temporary cache folder and cleans up); passing write=true or outDir requires `--allow-write`.',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Optional sub-directory inside the project root.' },
          static: { type: 'boolean', description: 'Analyze as a static export.' },
          autoPrerender: { type: 'boolean', description: 'Enable auto-prerender for static pages.' },
          write: { type: 'boolean', description: 'Keep the built output on disk (requires `--allow-write`).' },
          outDir: { type: 'string', description: 'Custom output directory inside the project root (requires `--allow-write`).' },
        },
        additionalProperties: false,
      },
      annotations: { title: 'Analyze bundle weights', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'build',
      description: 'Build the Prunelle app to disk (`dist/` or `outDir`). Requires starting `prunelle mcp --allow-write`.',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Optional sub-directory inside the project root.' },
          static: { type: 'boolean', description: 'Export a static site instead of a server build.' },
          autoPrerender: { type: 'boolean', description: 'Enable auto-prerender for static pages.' },
          outDir: { type: 'string', description: 'Output directory inside the project root.' },
          analyze: { type: 'boolean', description: 'Also include the bundle weight report in the response.' },
        },
        additionalProperties: false,
      },
      annotations: { title: 'Build Prunelle project', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'render',
      description: 'Render a route or API endpoint in-process without binding a port or touching `dist/`.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL path (e.g. "/" or "/api/items?page=2") or full URL to render.' },
          method: { type: 'string', description: 'HTTP method (defaults to GET, or POST when body is set).' },
          body: { type: 'string', description: 'Request body string.' },
          headers: { description: 'Request headers as an object ({ name: value }) or array of "Name: Value" strings.' },
          cookies: { type: 'array', items: { type: 'string' }, description: 'Cookie entries ("name=value").' },
          dir: { type: 'string', description: 'Optional sub-directory inside the project root.' },
          fresh: { type: 'boolean', description: 'Force a fresh build instead of reusing `.prunelle-cache/render-build`.' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      annotations: { title: 'Render a URL', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: 'docs',
      description: 'Search `llms.txt` documentation across `prunelle` and every installed `@prunellejs/*` package.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Whitespace-separated search keywords (case-insensitive AND).' },
          limit: { type: 'number', description: 'Maximum number of matching sections to return (default 20).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { title: 'Search Prunelle docs', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'dev_errors',
      description: 'Read the last build error, child crash, and recent runtime errors recorded by `prunelle dev`.',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Optional sub-directory inside the project root.' },
        },
        additionalProperties: false,
      },
      annotations: { title: 'Read last dev errors', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ]
}

async function runCheckTool(ctx: PrunelleMcpContext, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const targetDir = resolveProjectPath(ctx.root, args.dir, 'dir')
  const skipTypecheck = optionalBoolean(args, 'skipTypecheck') === true
  const strict = optionalBoolean(args, 'strict') === true
  const res = await checkProject(targetDir, { skipTypecheck })
  const errors = res.errors.map(e => diagnosticData(e, 'error'))
  const warnings = res.warnings.map(w => diagnosticData(w, 'warning'))
  const ok = res.ok && (!strict || warnings.length === 0)
  return jsonResult({ ok, checkedFiles: res.checkedFiles, typecheck: res.typecheck, errors, warnings })
}

async function runInspectTool(ctx: PrunelleMcpContext, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const targetDir = resolveProjectPath(ctx.root, args.dir, 'dir')
  const report = await inspectProject(targetDir)
  return jsonResult({
    routes: report.routes,
    islands: report.islands,
    actions: report.actions,
    plugins: report.plugins,
  })
}

async function runBuildAnalyzeTool(ctx: PrunelleMcpContext, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const targetDir = resolveProjectPath(ctx.root, args.dir, 'dir')
  const isStatic = optionalBoolean(args, 'static') === true
  const autoPrerender = optionalBoolean(args, 'autoPrerender') === true ? true : undefined
  const wantsWrite = optionalBoolean(args, 'write') === true || args.outDir !== undefined
  const explicitOutDir = args.outDir !== undefined ? resolveProjectPath(ctx.root, args.outDir, 'outDir', targetDir) : undefined

  if (wantsWrite && !ctx.allowWrite)
    return errorResult(WRITE_GATE_MESSAGE)

  let report: BundleReport | undefined
  if (wantsWrite) {
    await build({
      root: targetDir,
      outDir: explicitOutDir,
      static: isStatic,
      autoPrerender,
      onAnalyze: (r) => {
        report = r
      },
    })
    return jsonResult(report ?? { routes: [], totalJsGzip: 0, totalCssGzip: 0, topModules: [] })
  }

  const cacheDir = join(targetDir, '.prunelle-cache')
  const cacheExisted = existsSync(cacheDir)
  const tempOutDir = join(cacheDir, `mcp-analyze-${processSuffix()}`)
  try {
    await build({
      root: targetDir,
      outDir: tempOutDir,
      static: isStatic,
      autoPrerender,
      onAnalyze: (r) => {
        report = r
      },
    })
    return jsonResult(report ?? { routes: [], totalJsGzip: 0, totalCssGzip: 0, topModules: [] })
  }
  finally {
    rmSync(tempOutDir, { recursive: true, force: true })
    if (!cacheExisted && existsSync(cacheDir) && readdirSync(cacheDir).length === 0)
      rmSync(cacheDir, { recursive: true, force: true })
  }
}

async function runBuildTool(ctx: PrunelleMcpContext, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const targetDir = resolveProjectPath(ctx.root, args.dir, 'dir')
  const explicitOutDir = args.outDir !== undefined ? resolveProjectPath(ctx.root, args.outDir, 'outDir', targetDir) : undefined
  if (!ctx.allowWrite)
    return errorResult(WRITE_GATE_MESSAGE)

  const isStatic = optionalBoolean(args, 'static') === true
  const autoPrerender = optionalBoolean(args, 'autoPrerender') === true ? true : undefined
  const wantReport = optionalBoolean(args, 'analyze') === true
  let report: BundleReport | undefined
  const manifest = await build({
    root: targetDir,
    outDir: explicitOutDir,
    static: isStatic,
    autoPrerender,
    ...(wantReport ? { onAnalyze: (r: BundleReport) => { report = r } } : {}),
  })
  return jsonResult({
    ok: true,
    outDir: explicitOutDir !== undefined ? relPosix(targetDir, explicitOutDir) : 'dist',
    routes: manifest.routes.map(r => r.path),
    routeCount: manifest.routes.length,
    assetCount: manifest.assets.length,
    actionCount: manifest.actions.length,
    islandCount: Object.keys(manifest.islands).length,
    ...(report !== undefined ? { report } : {}),
  })
}

async function runRenderTool(ctx: PrunelleMcpContext, args: Record<string, unknown>): Promise<McpToolCallResult> {
  const url = optionalString(args, 'url')
  if (url === undefined || url.trim().length === 0)
    throw new Error('prunelle mcp: "url" is required and must be a non-empty string')
  const targetDir = resolveProjectPath(ctx.root, args.dir, 'dir')
  const method = optionalString(args, 'method')
  const body = optionalString(args, 'body')
  const headers = normalizeRenderHeaders(args.headers)
  const cookies = normalizeStringArray(args.cookies, 'cookies')
  const fresh = optionalBoolean(args, 'fresh') === true
  const result = await renderUrl({ root: targetDir, url, method, body, headers, cookies, fresh })
  return jsonResult({
    status: result.status,
    statusText: result.statusText,
    ok: result.ok,
    headers: result.headers,
    setCookies: result.setCookies,
    body: result.body,
    reusedBuild: result.reusedBuild,
    errors: result.errors,
  })
}

function runDocsTool(ctx: PrunelleMcpContext, args: Record<string, unknown>): McpToolCallResult {
  const query = optionalString(args, 'query')
  if (query === undefined)
    throw new Error('prunelle mcp: "query" is required and must be a string')
  let limit: number | undefined
  if (args.limit !== undefined) {
    if (typeof args.limit !== 'number' || !Number.isFinite(args.limit))
      throw new Error('prunelle mcp: "limit" must be a finite number')
    limit = args.limit
  }
  const result = searchLlmsDocs(ctx.root, query, { limit })
  return jsonResult({
    query: result.query,
    words: result.words,
    packages: result.packages,
    matches: result.matches,
  })
}

function runDevErrorsTool(ctx: PrunelleMcpContext, args: Record<string, unknown>): McpToolCallResult {
  const targetDir = resolveProjectPath(ctx.root, args.dir, 'dir')
  const log = readDevErrorLog(targetDir)
  if (log === undefined) {
    return jsonResult({
      hasErrors: false,
      runtimeErrors: [],
      note: 'No dev errors recorded (start `prunelle dev` or no errors have occurred).',
    })
  }
  const hasErrors = log.buildError !== undefined || log.crashError !== undefined || log.runtimeErrors.length > 0
  return jsonResult({
    hasErrors,
    updatedAt: log.updatedAt,
    ...(log.buildError !== undefined ? { buildError: log.buildError } : {}),
    ...(log.crashError !== undefined ? { crashError: log.crashError } : {}),
    runtimeErrors: log.runtimeErrors,
  })
}

export type ToolHandler = (ctx: PrunelleMcpContext, args: Record<string, unknown>) => McpToolCallResult | Promise<McpToolCallResult>

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  check: runCheckTool,
  inspect: runInspectTool,
  build_analyze: runBuildAnalyzeTool,
  build: runBuildTool,
  render: runRenderTool,
  docs: runDocsTool,
  dev_errors: runDevErrorsTool,
}

export function hasPrunelleTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name)
}

export async function callPrunelleTool(ctx: PrunelleMcpContext, name: string, rawArgs: unknown): Promise<McpToolCallResult> {
  const handler = TOOL_HANDLERS[name]
  if (handler === undefined)
    throw new Error(`Unknown tool: ${name}`)
  try {
    const args = asArgsRecord(rawArgs)
    return await handler(ctx, args)
  }
  catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err))
  }
}

/** Lists every discovered `llms.txt` (`prunelle` and installed `@prunellejs/*` packages) as an MCP resource. */
export function listPrunelleResources(root: string): McpResource[] {
  return discoverLlmsDocs(root).map(doc => ({
    uri: `${LLMS_URI_PREFIX}${doc.packageName}`,
    name: `${doc.packageName} llms.txt`,
    description: `${doc.packageName}${doc.version !== undefined ? `@${doc.version}` : ''} reference (${doc.relFile})`,
    mimeType: 'text/markdown',
  }))
}

/** Reads a `prunelle://llms/<package>` MCP resource fresh from disk, returning `undefined` when unknown. */
export function readPrunelleResource(root: string, uri: string): McpResourceContent | undefined {
  if (!uri.startsWith(LLMS_URI_PREFIX))
    return undefined
  const targetPkg = uri.slice(LLMS_URI_PREFIX.length)
  const doc = discoverLlmsDocs(root).find(d => d.packageName === targetPkg)
  if (doc === undefined)
    return undefined
  return {
    uri,
    mimeType: 'text/markdown',
    text: doc.content,
  }
}
