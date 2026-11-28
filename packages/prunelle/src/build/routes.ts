// Route files: their URL patterns, groups, param matchers, conflicts, and the `_layout`/`_middleware` chain that wraps them.

import type { ModuleAnalysis } from '../compiler/index'
import { existsSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { parseCacheExport } from '../compiler/cacheability'
import { BUILTIN_PARAM_MATCHER_NAMES, extractPatternMatchers, isBuiltinMatcher, parsePatternSegment } from '../server/param-matchers'
import { relPosix } from './files'

export const SPECIAL_ROUTE_FILES = new Set([
  '_layout.tsx',
  '_middleware.ts',
  '_middleware.tsx',
  '_error.tsx',
  '_404.tsx',
  '_401.tsx',
  '_403.tsx',
  '_429.tsx',
  '_503.tsx',
])
export const MIDDLEWARE_NAMES = ['_middleware.ts', '_middleware.tsx']
const ROUTE_EXPORTS = new Set(['default', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const TS_EXT_RE = /\.(?:tsx|ts)$/
const ROUTE_GROUP_RE = /^\(([^/()]+)\)$/
const OPTIONAL_PARAM_SEG_RE = /^\[\[([^\[\]]+)\]\]$/
const CATCH_ALL_SEG_RE = /^\[\.\.\.([^\[\]]+)\]$/
const PARAM_SEG_RE = /^\[([^\[\]]+)\]$/
const CATCH_ALL_RE = /\[\.\.\.([^\]]+)\]/g
const PARAM_RE = /\[([^\]]+)\]/g
const PATH_SEPARATOR_RE = /[/\\]/

/** True when a route folder segment is a route group such as `(marketing)` or `(admin)`. */
export function isRouteGroupSegment(segment: string): boolean {
  return ROUTE_GROUP_RE.test(segment)
}

/** True when a relative POSIX directory path contains any `(group)` segment. */
export function hasRouteGroupInRel(relDir: string): boolean {
  if (relDir === '' || relDir === '.')
    return false
  return relDir.split('/').some(isRouteGroupSegment)
}

/** Returns the `(group)` folder names wrapping `file` under `routesDir`, outermost first. */
export function routeGroupsOf(routesDir: string, file: string): string[] {
  const relDir = relPosix(routesDir, dirname(file))
  if (relDir === '' || relDir === '.')
    return []
  const groups: string[] = []
  for (const part of relDir.split('/')) {
    const match = ROUTE_GROUP_RE.exec(part)
    if (match !== null)
      groups.push(match[1]!)
  }
  return groups
}

/** Converts one file-system route segment (`about`, `[id=integer]`, `[[lang]]`, `[...path=slug]`) into a router pattern segment. */
export function convertRouteSegment(segment: string): string {
  const opt = OPTIONAL_PARAM_SEG_RE.exec(segment)
  if (opt !== null)
    return `:${opt[1]}?`
  const catchAll = CATCH_ALL_SEG_RE.exec(segment)
  if (catchAll !== null)
    return `*${catchAll[1]}`
  const param = PARAM_SEG_RE.exec(segment)
  if (param !== null)
    return `:${param[1]}`
  return segment.replace(CATCH_ALL_RE, '*$1').replace(PARAM_RE, ':$1')
}

/** Converts a relative POSIX directory path under `routesDir` into a URL folder pattern, stripping `(group)` folders. */
export function dirToRoutePatternFromRel(relDir: string): string {
  if (relDir === '' || relDir === '.')
    return '/'
  const parts = relDir.split('/').filter(p => p !== '' && !isRouteGroupSegment(p))
  if (parts.length === 0)
    return '/'
  return `/${parts.map(convertRouteSegment).join('/')}`
}

/** A file in routes/ is a route when it exports a default component or an HTTP method handler, directly or through `export { ... }`. */
export function hasRouteHandlerExport(analysis: ModuleAnalysis): boolean {
  return analysis.exportedNames.some(name => ROUTE_EXPORTS.has(name))
}

const SPECIAL_FILE_DEFAULTS = new Map([
  ['_layout', 'layout component'],
  ['_middleware', 'middleware function'],
  ['_error', 'error page component'],
  ['_404', 'not-found page component'],
  ['_401', '401 status page component'],
  ['_403', '403 status page component'],
  ['_429', '429 status page component'],
  ['_503', '503 status page component'],
])

/** For a route file or a special route file (`_layout`, `_middleware`, `_error`, `_404`, `_401`, `_403`, `_429`, `_503`), reports missing default export or non-route files. */
export function routeFileProblem(analysis: ModuleAnalysis, file: string, routesRel: string): string | undefined {
  const name = basename(file)
  if (SPECIAL_ROUTE_FILES.has(name))
    return analysis.exportedNames.includes('default') ? undefined : `${file} has no default export: export default its ${SPECIAL_FILE_DEFAULTS.get(name.replace(TS_EXT_RE, ''))}.`
  return hasRouteHandlerExport(analysis) || analysis.exportedActions.length > 0 ? undefined : `${file} exports no route; move it out of ${routesRel} or prefix it with _.`
}

const LOAD_FIX = 'prunelle never calls it; export async function load() and read its data with the page\'s load prop'
const PATHS_FIX = 'prunelle never calls it; export function paths() returning URL strings such as "/posts/a"'
const HEAD_FIX = 'prunelle never reads it; render <Head> in the page'
// Exports other frameworks read from a route file, and what prunelle wants instead.
const FOREIGN_ROUTE_EXPORTS = new Map([
  ['getStaticProps', LOAD_FIX],
  ['getServerSideProps', LOAD_FIX],
  ['getInitialProps', LOAD_FIX],
  ['loader', LOAD_FIX],
  ['clientLoader', LOAD_FIX],
  ['getStaticPaths', PATHS_FIX],
  ['generateStaticParams', PATHS_FIX],
  ['metadata', HEAD_FIX],
  ['generateMetadata', HEAD_FIX],
  ['meta', HEAD_FIX],
  ...['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'].map(m => [m, `prunelle never calls it; export function ${m === 'all' ? 'GET(), POST() or another method' : `${m.toUpperCase()}()`}`] as const),
])

function findExportOffset(analysis: ModuleAnalysis, exportName: string): number {
  for (const stmt of analysis.program.body) {
    if (stmt.type !== 'ExportNamedDeclaration')
      continue
    if (stmt.declaration?.type === 'FunctionDeclaration' && stmt.declaration.id?.name === exportName)
      return stmt.start
    if (stmt.declaration?.type === 'ClassDeclaration' && stmt.declaration.id?.name === exportName)
      return stmt.start
    if (stmt.declaration?.type === 'VariableDeclaration') {
      for (const d of stmt.declaration.declarations) {
        if (d.id.type === 'Identifier' && d.id.name === exportName)
          return d.start
      }
    }
    for (const spec of stmt.specifiers) {
      const exp = spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value
      if (exp === exportName)
        return spec.start
    }
  }
  return 0
}

/** Returns the first route export problem together with its byte offset in the module source. */
export function routeExportProblemLocation(analysis: ModuleAnalysis, file: string): { message: string, offset: number } | undefined {
  for (const name of analysis.exportedNames) {
    const fix = FOREIGN_ROUTE_EXPORTS.get(name)
    if (fix !== undefined)
      return { message: `export ${name} in ${file}: ${fix}.`, offset: findExportOffset(analysis, name) }
  }
  for (const stmt of analysis.program.body) {
    if (stmt.type !== 'ExportNamedDeclaration' || stmt.declaration?.type !== 'VariableDeclaration')
      continue
    for (const d of stmt.declaration.declarations) {
      const name = d.id.type === 'Identifier' ? d.id.name : undefined
      const init = d.init
      if (name === 'paths' && init !== null && init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression')
        return { message: `export const paths in ${file}: export function paths() returning the URLs, such as () => ['/posts/a'].`, offset: d.start }
      if (name === 'prerender' && !(init?.type === 'Literal' && typeof init.value === 'boolean'))
        return { message: `${init?.type === 'Literal' ? `prerender = ${init.raw ?? String(init.value)}` : 'prerender set at runtime'} in ${file}: write prerender = true or prerender = false.`, offset: d.start }
    }
  }
  const cacheExport = parseCacheExport(analysis.program)
  if (cacheExport.problem !== undefined)
    return { message: `${cacheExport.problem.replace(':', ` in ${file}:`)}.`, offset: cacheExport.offset }
  return undefined
}

/** The first route export prunelle never reads (Next, Remix and Astro names), `paths` that is not a function, or `prerender` that is not literally `true` or `false`, worded for `prunelle build` and `prunelle check` to prefix. */
export function routeExportProblem(analysis: ModuleAnalysis, file: string): string | undefined {
  return routeExportProblemLocation(analysis, file)?.message
}

/** Throws unless a route's `paths()` gave an array of URL paths starting with `/`. */
function exportedConstOffset(analysis: ModuleAnalysis, name: string): number {
  for (const stmt of analysis.program.body) {
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration') {
      for (const d of stmt.declaration.declarations) {
        if (d.id.type === 'Identifier' && d.id.name === name)
          return d.start
      }
    }
  }
  return 0
}

/** A dynamic route (`pattern` holds `:` or `*`) that is prerendered, by `prerender = true` or by `--static` for a page, yet exports no `paths()`, so its pages would silently not exist. */
export function missingPathsProblem(analysis: ModuleAnalysis, pattern: string, isStatic: boolean): { offset: number, message: string } | undefined {
  if (analysis.hasPaths || (!pattern.includes(':') && !pattern.includes('*')))
    return undefined
  if (analysis.hasPrerender)
    return { offset: exportedConstOffset(analysis, 'prerender'), message: 'dynamic route exports `prerender = true` without exporting `paths()`: export `paths()` returning the URLs to prerender, or drop `prerender`.' }
  if (isStatic && analysis.exportedNames.includes('default'))
    return { offset: 0, message: 'dynamic route has no `paths()`, so `prunelle build --static` cannot export it: export `paths()` returning its URLs.' }
  return undefined
}

export function assertPathUrls(urls: unknown, file: string): asserts urls is string[] {
  if (!Array.isArray(urls))
    throw new Error(`prunelle build: paths() in ${file} returned ${JSON.stringify(urls)}: return an array of URL paths such as ["/posts/a"].`)
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith('/'))
      throw new Error(`prunelle build: paths() in ${file} returned ${JSON.stringify(url)}: return URL paths such as "/posts/a".`)
  }
}

export function fileToRoutePath(routesDir: string, file: string): string {
  const rel = relPosix(routesDir, file).replace(TS_EXT_RE, '')
  const rawParts = rel.split('/')
  const filePart = rawParts.pop()!
  const urlParts = rawParts.filter(part => !isRouteGroupSegment(part))
  if (filePart !== 'index')
    urlParts.push(filePart)
  if (urlParts.length === 0)
    return '/'
  return `/${urlParts.map(convertRouteSegment).join('/')}`
}

/** The shape two route paths conflict on: parameter names do not matter, but optionality and matcher names do. */
export function normalizeRoutePattern(routePath: string): string {
  return routePath
    .split('/')
    .map((seg) => {
      if (seg === '')
        return ''
      const parsed = parsePatternSegment(seg)
      const matcher = parsed.matcherName !== undefined ? `=${parsed.matcherName}` : ''
      if (parsed.kind === 'catchall')
        return `*${matcher}`
      if (parsed.kind === 'optional')
        return `:${matcher}?`
      if (parsed.kind === 'param')
        return `:${matcher}`
      return parsed.value
    })
    .join('/')
}

/** Throws on two route files that serve one pattern (about.tsx vs about/index.tsx, (a)/about.tsx vs (b)/about.tsx, [id].tsx vs [slug].tsx). */
export function assertNoRouteConflicts(root: string, routesDir: string, pageFiles: string[]): void {
  const seen = new Map<string, { file: string, path: string }>()
  for (const file of pageFiles) {
    const routePath = fileToRoutePath(routesDir, file)
    const normalized = normalizeRoutePattern(routePath)
    const existing = seen.get(normalized)
    if (existing !== undefined)
      throw new Error(`prunelle build: conflicting routes for pattern "${routePath}": "${relPosix(root, existing.file)}" (${existing.path}) and "${relPosix(root, file)}" (${routePath})`)
    seen.set(normalized, { file, path: routePath })
  }
}

/** Resolves an app-defined param matcher file (`src/params/<name>.ts` or `.tsx`, or `<routesDir>/../params/<name>.ts`). */
export function findCustomMatcherFile(root: string, routesDir: string, matcherName: string): string | undefined {
  const candidates = [
    join(root, 'src/params', `${matcherName}.ts`),
    join(root, 'src/params', `${matcherName}.tsx`),
    join(dirname(routesDir), 'params', `${matcherName}.ts`),
    join(dirname(routesDir), 'params', `${matcherName}.tsx`),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate))
      return candidate
  }
  return undefined
}

export interface MatcherDiscoveryResult {
  /** Custom (non-built-in) matcher name -> absolute source file path. */
  customFiles: Map<string, string>
  /** Missing or invalid matcher diagnostics. */
  problems: { file: string, message: string }[]
}

/** Discovers and validates every param matcher referenced by route patterns (and directory patterns of middleware/status pages). */
export function discoverRouteMatchers(options: {
  root: string
  routesDir: string
  routeFiles: readonly string[]
  loadAnalysis: (file: string) => ModuleAnalysis | undefined
}): MatcherDiscoveryResult {
  const { root, routesDir, routeFiles, loadAnalysis } = options
  const customFiles = new Map<string, string>()
  const problems: { file: string, message: string }[] = []
  const validatedCustom = new Set<string>()
  const builtinList = BUILTIN_PARAM_MATCHER_NAMES.join(', ')

  for (const file of routeFiles) {
    const pattern = basename(file).startsWith('_')
      ? dirToRoutePatternFromRel(relPosix(routesDir, dirname(file)))
      : fileToRoutePath(routesDir, file)
    const refs = extractPatternMatchers(pattern)
    if (refs.length === 0)
      continue
    const rel = relPosix(root, file)
    for (const { matcher } of refs) {
      if (isBuiltinMatcher(matcher))
        continue
      const found = findCustomMatcherFile(root, routesDir, matcher)
      if (found === undefined) {
        problems.push({
          file,
          message: `unknown param matcher "${matcher}" in ${rel}: use a built-in matcher (${builtinList}) or create src/params/${matcher}.ts exporting match(value: string): boolean (or a default function).`,
        })
        continue
      }
      customFiles.set(matcher, found)
      if (!validatedCustom.has(found)) {
        validatedCustom.add(found)
        const analysis = loadAnalysis(found)
        if (analysis !== undefined && !analysis.exportedNames.includes('match') && !analysis.exportedNames.includes('default')) {
          problems.push({
            file: found,
            message: `${relPosix(root, found)} exports no param matcher: export function match(value: string): boolean (or export default).`,
          })
        }
      }
    }
  }

  return { customFiles, problems }
}

/** Finds all ancestor files named one of `names` from routesDir down to dirname(routeFile), outermost first. */
export function ancestorFiles(routesDir: string, routeFile: string, names: string[]): string[] {
  const result: string[] = []
  const relDir = relative(routesDir, dirname(routeFile))
  const parts = relDir === '' ? [] : relDir.split(PATH_SEPARATOR_RE)
  let cur = routesDir
  for (let i = 0; i <= parts.length; i++) {
    if (i > 0)
      cur = join(cur, parts[i - 1]!)
    for (const name of names) {
      const candidate = join(cur, name)
      if (existsSync(candidate))
        result.push(candidate)
    }
  }
  return result
}
