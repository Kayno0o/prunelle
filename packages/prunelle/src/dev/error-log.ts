// Persists the last dev build error, child crash, and recent runtime errors under `.prunelle-dev/last-errors.json`
// so `prunelle mcp` (`dev_errors` tool) can inspect live dev failures without touching `dist/` or tracked files.

import type { ServerErrorInfo } from '../plugins/index'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface DevErrorEntry {
  kind: 'build' | 'runtime' | 'crash'
  timestamp: string
  message: string
  source?: string | undefined
  method?: string | undefined
  path?: string | undefined
}

export interface DevErrorLog {
  updatedAt: string
  buildError?: string | undefined
  crashError?: string | undefined
  runtimeErrors: DevErrorEntry[]
}

const MAX_RUNTIME_ERRORS = 20

function errorLogPath(root: string): string {
  return join(resolve(root), '.prunelle-dev', 'last-errors.json')
}

function isDevErrorEntry(value: unknown): value is DevErrorEntry {
  if (typeof value !== 'object' || value === null)
    return false
  const rec = value as Record<string, unknown>
  return (rec.kind === 'build' || rec.kind === 'runtime' || rec.kind === 'crash')
    && typeof rec.timestamp === 'string'
    && typeof rec.message === 'string'
}

/** Reads `.prunelle-dev/last-errors.json` safely, returning `undefined` when missing or unreadable. */
export function readDevErrorLog(root: string): DevErrorLog | undefined {
  const file = errorLogPath(root)
  if (!existsSync(file))
    return undefined
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null)
      return undefined
    const rec = parsed as Record<string, unknown>
    const updatedAt = typeof rec.updatedAt === 'string' ? rec.updatedAt : new Date(0).toISOString()
    const buildError = typeof rec.buildError === 'string' && rec.buildError.length > 0 ? rec.buildError : undefined
    const crashError = typeof rec.crashError === 'string' && rec.crashError.length > 0 ? rec.crashError : undefined
    const runtimeErrors = Array.isArray(rec.runtimeErrors) ? rec.runtimeErrors.filter(isDevErrorEntry) : []
    return {
      updatedAt,
      ...(buildError !== undefined ? { buildError } : {}),
      ...(crashError !== undefined ? { crashError } : {}),
      runtimeErrors,
    }
  }
  catch {
    return undefined
  }
}

function writeDevErrorLog(root: string, log: DevErrorLog): void {
  const file = errorLogPath(root)
  const payload = JSON.stringify(log, null, 2)
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, payload, 'utf8')
    renameSync(tmp, file)
  }
  catch {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, payload, 'utf8')
    }
    catch {
      return
    }
  }
}

function loadOrCreateLog(root: string, now: string): DevErrorLog {
  const existing = readDevErrorLog(root)
  if (existing !== undefined)
    return { ...existing, updatedAt: now, runtimeErrors: [...existing.runtimeErrors] }
  return { updatedAt: now, runtimeErrors: [] }
}

/** Records or clears the active dev build error (passing `undefined` clears it after a successful build). */
export function recordDevBuildError(root: string, message: string | undefined): void {
  const now = new Date().toISOString()
  const log = loadOrCreateLog(root, now)
  if (message !== undefined && message.length > 0)
    log.buildError = message
  else
    delete log.buildError
  writeDevErrorLog(root, log)
}

/** Records or clears the active dev child crash message (passing `undefined` clears it once the child is ready). */
export function recordDevCrashError(root: string, message: string | undefined): void {
  const now = new Date().toISOString()
  const log = loadOrCreateLog(root, now)
  if (message !== undefined && message.length > 0)
    log.crashError = message
  else
    delete log.crashError
  writeDevErrorLog(root, log)
}

/** Appends a runtime error to `.prunelle-dev/last-errors.json`, keeping the last 20 entries. */
export function recordDevRuntimeError(root: string, entry: Omit<DevErrorEntry, 'kind' | 'timestamp'>): void {
  const now = new Date().toISOString()
  const log = loadOrCreateLog(root, now)
  log.runtimeErrors.push({
    kind: 'runtime',
    timestamp: now,
    message: entry.message,
    ...(entry.source !== undefined ? { source: entry.source } : {}),
    ...(entry.method !== undefined ? { method: entry.method } : {}),
    ...(entry.path !== undefined ? { path: entry.path } : {}),
  })
  if (log.runtimeErrors.length > MAX_RUNTIME_ERRORS)
    log.runtimeErrors = log.runtimeErrors.slice(-MAX_RUNTIME_ERRORS)
  writeDevErrorLog(root, log)
}

function safePathname(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname
  }
  catch {
    return rawUrl
  }
}

/** Builds an `errorSink` callback for `devServer` that records unhandled runtime errors into `.prunelle-dev/last-errors.json`. */
export function createDevRuntimeErrorSink(root: string): (info: ServerErrorInfo) => void {
  return (info) => {
    const message = info.error instanceof Error ? info.error.stack ?? info.error.message : String(info.error)
    recordDevRuntimeError(root, {
      message,
      source: info.source,
      method: info.request.method,
      path: safePathname(info.request.url),
    })
  }
}
