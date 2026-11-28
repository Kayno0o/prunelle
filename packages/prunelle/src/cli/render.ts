// `prunelle render <url>`: render a route or API endpoint in-process via `testApp()` without binding a port or touching `dist/`.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isNotSourceDir, relPosix, walkFiles } from '../build/files'
import { ensureCacheGitignore } from '../build/precompress'
import { SERVER_ENTRY_FILE } from '../build/server-entry'
import { testApp } from '../test/index'

const ABSOLUTE_URL_RE = /^https?:\/\//i
const CONFIG_FILES = ['prunelle.config.ts', 'prunelle.config.js', 'prunelle.config.mjs'] as const
const CUSTOM_ROUTES_DIR_RE = /\broutesDir\s*:\s*['"]([^'"]+)['"]/
const CUSTOM_PUBLIC_DIR_RE = /\bpublicDir\s*:\s*['"]([^'"]+)['"]/
const SAFE_ORIGIN_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

export interface RenderUrlOptions {
  root: string
  url: string
  method?: string | undefined
  body?: string | undefined
  headers?: readonly string[] | undefined
  cookies?: readonly string[] | undefined
  includeHeaders?: boolean | undefined
  fresh?: boolean | undefined
}

export interface RenderUrlResult {
  status: number
  statusText: string
  headers: Record<string, string>
  setCookies: string[]
  body: string
  ok: boolean
  reusedBuild: boolean
  errors: string[]
}

function normalizeTargetUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0)
    throw new Error('prunelle render: URL cannot be empty')

  if (ABSOLUTE_URL_RE.test(trimmed)) {
    try {
      return new URL(trimmed).href
    }
    catch {
      throw new Error(`prunelle render: invalid URL "${rawUrl}"`)
    }
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  try {
    void new URL(normalized, 'http://localhost')
  }
  catch {
    throw new Error(`prunelle render: invalid URL "${rawUrl}"`)
  }
  return normalized
}

function buildRequestHeaders(
  rawHeaders: readonly string[] | undefined,
  rawCookies: readonly string[] | undefined,
  method: string,
  targetUrl: string,
): Headers {
  const headers = new Headers()

  for (const raw of rawHeaders ?? []) {
    const colon = raw.indexOf(':')
    if (colon <= 0)
      throw new Error(`prunelle render: invalid header "${raw}" (expected "Name: Value")`)
    const name = raw.slice(0, colon).trim()
    if (name.length === 0)
      throw new Error(`prunelle render: invalid header "${raw}" (expected "Name: Value")`)
    const value = raw.slice(colon + 1).trim()
    headers.append(name, value)
  }

  if (rawCookies !== undefined && rawCookies.length > 0) {
    const joined = rawCookies.join('; ')
    const existing = headers.get('cookie')
    headers.set('cookie', existing !== null && existing.length > 0 ? `${existing}; ${joined}` : joined)
  }

  if (!SAFE_ORIGIN_METHODS.has(method) && !headers.has('origin')) {
    const origin = ABSOLUTE_URL_RE.test(targetUrl) ? new URL(targetUrl).origin : 'http://localhost'
    headers.set('origin', origin)
  }

  return headers
}

function collectConfiguredDirs(root: string): string[] {
  const dirs = new Set<string>([resolve(root, 'src'), resolve(root, 'public')])
  for (const file of CONFIG_FILES) {
    const full = join(root, file)
    if (!existsSync(full))
      continue
    const text = readFileSync(full, 'utf8')
    const routesMatch = CUSTOM_ROUTES_DIR_RE.exec(text)
    if (routesMatch?.[1] !== undefined)
      dirs.add(resolve(root, routesMatch[1]))
    const publicMatch = CUSTOM_PUBLIC_DIR_RE.exec(text)
    if (publicMatch?.[1] !== undefined)
      dirs.add(resolve(root, publicMatch[1]))
  }
  return [...dirs]
}

function computeSourceStamp(root: string): string {
  const files = new Set<string>()

  for (const name of [...CONFIG_FILES, 'package.json']) {
    const full = join(root, name)
    const st = statSync(full, { throwIfNoEntry: false })
    if (st !== undefined && st.isFile())
      files.add(full)
  }

  for (const dir of collectConfiguredDirs(root)) {
    for (const file of walkFiles(dir, { skipDir: isNotSourceDir, keep: entry => entry.isFile() }))
      files.add(file)
  }

  const entries: string[] = []
  for (const file of files) {
    const st = statSync(file, { throwIfNoEntry: false })
    if (st !== undefined)
      entries.push(`${relPosix(root, file)}:${st.mtimeMs}:${st.size}`)
  }
  entries.sort()
  return entries.join('\n')
}

function readStamp(stampFile: string): string | undefined {
  if (!existsSync(stampFile))
    return undefined
  try {
    return readFileSync(stampFile, 'utf8')
  }
  catch {
    return undefined
  }
}

function extractResponseHeaders(res: Response): { headers: Record<string, string>, setCookies: string[] } {
  const setCookies = res.headers.getSetCookie?.() ?? []
  const headers: Record<string, string> = {}
  for (const [key, value] of res.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie')
      continue
    headers[key] = value
  }
  return { headers, setCookies }
}

/** Renders a URL against the Prunelle app under `options.root` in-process, reusing a cached build under `.prunelle-cache/render-build` when sources are unchanged. */
export async function renderUrl(options: RenderUrlOptions): Promise<RenderUrlResult> {
  const root = resolve(options.root)
  const targetUrl = normalizeTargetUrl(options.url)
  const method = options.method !== undefined && options.method.trim().length > 0
    ? options.method.trim().toUpperCase()
    : (options.body !== undefined ? 'POST' : 'GET')
  const headers = buildRequestHeaders(options.headers, options.cookies, method, targetUrl)

  const cacheRoot = join(root, '.prunelle-cache')
  const renderOutDir = join(cacheRoot, 'render-build')
  const stampFile = join(renderOutDir, '.render-stamp')
  const manifestFile = join(renderOutDir, 'manifest.json')
  const entryFile = join(renderOutDir, 'server', SERVER_ENTRY_FILE)

  const sourceStamp = computeSourceStamp(root)
  const canReuse = options.fresh !== true
    && existsSync(manifestFile)
    && existsSync(entryFile)
    && readStamp(stampFile) === sourceStamp

  if (!canReuse)
    ensureCacheGitignore(cacheRoot)

  const app = await testApp({
    root,
    outDir: renderOutDir,
    prebuilt: canReuse,
  })

  try {
    if (!canReuse)
      writeFileSync(stampFile, sourceStamp, 'utf8')

    const reqInit: RequestInit = method !== 'GET' && method !== 'HEAD' && options.body !== undefined
      ? { method, headers, body: options.body }
      : { method, headers }
    const res = await app.fetch(targetUrl, reqInit)
    const body = await res.text()
    const { headers: resHeaders, setCookies } = extractResponseHeaders(res)
    const statusText = res.statusText.length > 0 ? res.statusText : (STATUS_TEXT[res.status] ?? '')

    return {
      status: res.status,
      statusText,
      headers: resHeaders,
      setCookies,
      body,
      ok: res.status >= 200 && res.status < 400,
      reusedBuild: canReuse,
      errors: [...app.errors],
    }
  }
  finally {
    await app.app.dispose?.()
  }
}

/** Formats a `RenderUrlResult`, prepending the HTTP status line and headers when `includeHeaders` is true (`-i`). */
export function formatRenderResult(result: RenderUrlResult, includeHeaders: boolean): string {
  if (!includeHeaders)
    return result.body

  const statusLine = result.statusText.length > 0
    ? `HTTP/1.1 ${result.status} ${result.statusText}`
    : `HTTP/1.1 ${result.status}`
  const lines = [statusLine]

  for (const [name, value] of Object.entries(result.headers)) {
    if (name.toLowerCase() === 'set-cookie')
      continue
    lines.push(`${name}: ${value}`)
  }
  for (const cookie of result.setCookies)
    lines.push(`set-cookie: ${cookie}`)

  return `${lines.join('\n')}\n\n${result.body}`
}
