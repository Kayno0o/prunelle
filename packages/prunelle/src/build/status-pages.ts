// Status and error page discovery, validation, and manifest entry construction (`_401`, `_403`, `_404`, `_429`, `_503`, `_error`).

import { basename, dirname, relative } from 'node:path'
import { relPosix } from './files'
import { ancestorFiles, dirToRoutePatternFromRel, hasRouteGroupInRel } from './routes'

export type StatusPageKind = '401' | '403' | '404' | '429' | '503' | 'error'

export const SUPPORTED_STATUS_CODES = new Set(['401', '403', '404', '429', '503'])

export const STATUS_PAGE_FILES = new Set([
  '_401.tsx',
  '_403.tsx',
  '_404.tsx',
  '_429.tsx',
  '_503.tsx',
  '_error.tsx',
])

const NUMERIC_STATUS_FILE_RE = /^_(\d{3})\.tsx$/

/** Maps a supported status/error page filename to its kind, or undefined for other files. */
export function statusPageKindOf(file: string): StatusPageKind | undefined {
  const name = basename(file)
  if (name === '_error.tsx')
    return 'error'
  const match = NUMERIC_STATUS_FILE_RE.exec(name)
  if (match !== null && SUPPORTED_STATUS_CODES.has(match[1]!))
    return match[1] as StatusPageKind
  return undefined
}

/** Reports an unsupported `_NNN.tsx` file (e.g. `_418.tsx`, `_500.tsx`) in `routesDir`. */
export function unknownStatusPageProblem(fileRel: string): string | undefined {
  const match = NUMERIC_STATUS_FILE_RE.exec(basename(fileRel))
  if (match === null || SUPPORTED_STATUS_CODES.has(match[1]!))
    return undefined
  return `unsupported status page ${fileRel}: supported status pages are _401.tsx, _403.tsx, _404.tsx, _429.tsx, _503.tsx, and _error.tsx.`
}

export interface StatusPageManifestEntry {
  kind: StatusPageKind
  /** Route pattern of the folder holding this status page (`'/'`, `'/admin'`, `'/blog/:slug'`). */
  dirPattern: string
  /** Compiled server directory prefix holding this status page (`'server/'`, `'server/admin/'`, `'server/(admin)/'`). */
  dirPrefix: string
  /** True when the status page lives inside a `(group)/` folder. */
  inGroup?: boolean | undefined
  file: string
  layouts: string[]
  styles: string[]
  islandChunks: string[]
  eagerIslandChunks?: string[] | undefined
}

export interface FileReachLike {
  chunks: ReadonlySet<string>
  eager: ReadonlySet<string>
  styles: ReadonlySet<string>
}

function compiledDirPrefix(outRel: string): string {
  const slash = outRel.lastIndexOf('/')
  return slash === -1 ? '' : outRel.slice(0, slash + 1)
}

/** Builds manifest entries for every status/error page (`_404`, `_error`, `_401`, `_403`, `_429`, `_503`) across `routesDir`. */
export function buildStatusPageEntries(options: {
  routesDir: string
  specialFiles: readonly string[]
  globalPluginStyles: readonly string[]
  reachOf: (file: string) => FileReachLike
  toOutRel: (srcFile: string) => string
}): StatusPageManifestEntry[] {
  const { routesDir, specialFiles, globalPluginStyles, reachOf, toOutRel } = options
  const entries: StatusPageManifestEntry[] = []

  for (const file of specialFiles) {
    const kind = statusPageKindOf(file)
    if (kind === undefined)
      continue
    const relDir = relative(routesDir, dirname(file)).replace(/\\/g, '/')
    const dirPattern = dirToRoutePatternFromRel(relDir)
    const inGroup = hasRouteGroupInRel(relDir)
    const layoutSrcs = ancestorFiles(routesDir, file, ['_layout.tsx'])
    const chunks = new Set<string>()
    const eagerChunks = new Set<string>()
    const styles = new Set<string>(globalPluginStyles)

    for (const src of [...layoutSrcs, file]) {
      const reach = reachOf(src)
      for (const chunk of reach.chunks)
        chunks.add(chunk)
      for (const chunk of reach.eager)
        eagerChunks.add(chunk)
      for (const style of reach.styles)
        styles.add(style)
    }

    const outRel = toOutRel(file)
    entries.push({
      kind,
      dirPattern,
      dirPrefix: compiledDirPrefix(outRel),
      ...(inGroup ? { inGroup: true } : {}),
      file: outRel,
      layouts: layoutSrcs.map(toOutRel),
      styles: [...styles],
      islandChunks: [...chunks],
      eagerIslandChunks: [...eagerChunks],
    })
  }

  return entries
}

/** Finds every unsupported `_NNN.tsx` file under `routesDir` and returns its error messages. */
export function findUnknownStatusPages(root: string, routeFiles: readonly string[]): { file: string, message: string }[] {
  const problems: { file: string, message: string }[] = []
  for (const file of routeFiles) {
    const rel = relPosix(root, file)
    const message = unknownStatusPageProblem(rel)
    if (message !== undefined)
      problems.push({ file, message })
  }
  return problems
}
