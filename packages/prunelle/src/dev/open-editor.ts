// Opens a project source file at `line:col` in `$PRUNELLE_EDITOR` or `$VISUAL` on Alt-click in `prunelle dev`.

import { existsSync, realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { isInside } from '../build/is-inside'

export const OPEN_EDITOR_SUBPATH = 'open-editor'

export interface ParsedSourceLoc {
  file: string
  relFile: string
  line: number
  col: number
}

const POSITIVE_INT_RE = /^\d+$/
const BIN_EXT_RE = /\.(?:exe|cmd|bat)$/i
const MISSING_EDITOR_ERROR = 'Set PRUNELLE_EDITOR or VISUAL to open files on Alt-click.'

const VSCODE_EDITORS = new Set(['code', 'code-insiders', 'codium', 'vscodium', 'cursor', 'windsurf'])
const ZED_EDITORS = new Set(['zed', 'zeditor'])
const JETBRAINS_EDITORS = new Set(['idea', 'webstorm', 'phpstorm', 'pycharm', 'goland', 'rubymine', 'rider', 'clion', 'datagrip', 'fleet', 'studio'])
const SUBLIME_HELIX_EDITORS = new Set(['subl', 'sublime_text', 'hx'])
const TERMINAL_EDITORS = new Set(['vim', 'nvim', 'vi', 'nano', 'emacs', 'emacsclient'])

/** Splits an editor command string into argv tokens, honoring single/double quotes without invoking a shell. */
function splitEditorSpec(spec: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '\'' | '"' | undefined
  let hasToken = false

  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i]!
    if (quote !== undefined) {
      if (ch === '\\' && quote === '"' && i + 1 < spec.length && (spec[i + 1] === '"' || spec[i + 1] === '\\')) {
        current += spec[++i]!
      }
      else if (ch === quote) {
        quote = undefined
      }
      else {
        current += ch
      }
      continue
    }

    if (ch === '\'' || ch === '"') {
      quote = ch
      hasToken = true
      continue
    }
    if (ch === '\\' && i + 1 < spec.length && /\s/.test(spec[i + 1]!)) {
      current += spec[++i]!
      hasToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    current += ch
    hasToken = true
  }

  if (hasToken)
    tokens.push(current)
  return tokens
}

/** Parses and validates a `relPath:line:col` location, confining it strictly inside `root`. */
export function parseSourceLoc(raw: string, root: string): ParsedSourceLoc | { error: string, status: 400 | 403 | 404 } {
  const trimmed = raw.trim()
  const lastColon = trimmed.lastIndexOf(':')
  const prevColon = lastColon > 0 ? trimmed.lastIndexOf(':', lastColon - 1) : -1
  if (lastColon <= 0 || prevColon <= 0)
    return { error: 'Invalid source location; expected file:line:col.', status: 400 }

  const relPart = trimmed.slice(0, prevColon)
  const lineStr = trimmed.slice(prevColon + 1, lastColon)
  const colStr = trimmed.slice(lastColon + 1)
  if (relPart === '' || relPart.includes('\0') || !POSITIVE_INT_RE.test(lineStr) || !POSITIVE_INT_RE.test(colStr))
    return { error: 'Invalid source location; expected file:line:col.', status: 400 }

  const line = Number.parseInt(lineStr, 10)
  const col = Number.parseInt(colStr, 10)
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(col) || col < 1)
    return { error: 'Line and column must be positive integers.', status: 400 }

  const resolvedRoot = resolve(root)
  const file = resolve(resolvedRoot, relPart)
  if (!isInside(resolvedRoot, file))
    return { error: 'Source file is outside the project root.', status: 403 }
  if (!existsSync(file))
    return { error: 'Source file does not exist.', status: 404 }

  const realRoot = realpathSync(resolvedRoot)
  const realFile = realpathSync(file)
  if (!isInside(realRoot, realFile))
    return { error: 'Source file is outside the project root.', status: 403 }

  return { file, relFile: relative(resolvedRoot, file).replaceAll('\\', '/'), line, col }
}

/** Builds the argv array to open `loc` in `editorSpec` (supporting `{file}`/`{line}`/`{col}` templates and common editors). */
export function buildEditorCommand(editorSpec: string, loc: { file: string, line: number, col: number }): string[] {
  const parts = splitEditorSpec(editorSpec.trim())
  if (parts.length === 0)
    return []

  const lineStr = String(loc.line)
  const colStr = String(loc.col)
  if (parts.some(p => p.includes('{file}') || p.includes('{line}') || p.includes('{col}')))
    return parts.map(p => p.replaceAll('{file}', loc.file).replaceAll('{line}', lineStr).replaceAll('{col}', colStr))

  const rawBin = parts[0]!.split(/[\\/]/).pop() ?? ''
  const bin = rawBin.toLowerCase().replace(BIN_EXT_RE, '')
  const fileLineCol = `${loc.file}:${lineStr}:${colStr}`

  if (VSCODE_EDITORS.has(bin))
    return [...parts, '--goto', fileLineCol]
  if (ZED_EDITORS.has(bin) || SUBLIME_HELIX_EDITORS.has(bin))
    return [...parts, fileLineCol]
  if (JETBRAINS_EDITORS.has(bin))
    return [...parts, '--line', lineStr, '--column', colStr, loc.file]
  if (TERMINAL_EDITORS.has(bin))
    return [...parts, `+${lineStr}`, loc.file]
  return [...parts, fileLineCol]
}

export interface OpenEditorOptions {
  env?: Record<string, string | undefined> | undefined
  spawn?: ((cmd: string[]) => void) | undefined
}

export function openInEditor(
  rawSrc: string,
  root: string,
  options?: OpenEditorOptions,
): { ok: true, command: string[] } | { ok: false, status: number, error: string } {
  const env = options?.env ?? process.env
  const editor = env.PRUNELLE_EDITOR?.trim() || env.VISUAL?.trim()
  if (!editor)
    return { ok: false, status: 400, error: MISSING_EDITOR_ERROR }

  const parsed = parseSourceLoc(rawSrc, root)
  if ('error' in parsed)
    return { ok: false, status: parsed.status, error: parsed.error }

  const command = buildEditorCommand(editor, parsed)
  if (command.length === 0)
    return { ok: false, status: 400, error: MISSING_EDITOR_ERROR }

  try {
    if (options?.spawn !== undefined) {
      options.spawn(command)
    }
    else {
      const proc = Bun.spawn(command, { cwd: root, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
      proc.unref()
    }
  }
  catch (err) {
    return {
      ok: false,
      status: 500,
      error: `Failed to launch editor "${command[0]}": ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return { ok: true, command }
}

/** Handles `POST /_pru/open-editor` from the dev server's Alt-click listener. */
export async function handleOpenEditorRequest(
  request: Request,
  root: string,
  options?: OpenEditorOptions,
): Promise<Response> {
  if (request.method !== 'POST')
    return Response.json({ ok: false, error: 'Method Not Allowed' }, { status: 405, headers: { allow: 'POST' } })

  let rawSrc = new URL(request.url).searchParams.get('src') ?? ''
  if (rawSrc === '') {
    try {
      const body = await request.json() as unknown
      if (body !== null && typeof body === 'object' && typeof (body as { src?: unknown }).src === 'string')
        rawSrc = (body as { src: string }).src
    }
    catch {
      return Response.json({ ok: false, error: 'Invalid JSON body; expected { "src": "file:line:col" }.' }, { status: 400 })
    }
  }

  if (rawSrc.trim() === '')
    return Response.json({ ok: false, error: 'Missing "src" location.' }, { status: 400 })

  const result = openInEditor(rawSrc, root, options)
  return Response.json(result, { status: result.ok ? 200 : result.status })
}
