// Built-in spam & abuse protection for public server actions: honeypot field + HMAC-signed render timestamp.

import type { ActionContext } from './action'
import type { RateLimit } from './rate-limit'
import { assertRateLimit } from './rate-limit'

function constantTimeEqual(a: string, b: string): boolean {
  const x = new Bun.CryptoHasher('sha256').update(a).digest()
  const y = new Bun.CryptoHasher('sha256').update(b).digest()
  let diff = 0
  for (let i = 0; i < x.length; i++)
    diff |= x[i]! ^ y[i]!
  return diff === 0
}

export const DEFAULT_HONEYPOT_FIELD = '_pru_hp'
export const FORM_TIMESTAMP_FIELD = '_pru_ts'
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000

export interface ActionProtectOptions {
  /** Sliding-window rate limit for submissions to this action. */
  rateLimit?: RateLimit<ActionContext> | undefined
  /** Hidden trap input name (`true` uses `_pru_hp`, or pass a custom field name). Non-empty values are rejected. */
  honeypot?: boolean | string | undefined
  /** Minimum elapsed milliseconds between SSR render and submit; enforced with an HMAC-signed `_pru_ts` token. */
  minTime?: number | undefined
}

const EPHEMERAL_SECRET_KEY = Symbol.for('pru.form.secret')
const DIGITS_RE = /^\d+$/

function formSecret(): string {
  const configured = process.env.PRUNELLE_FORM_SECRET || process.env.AUTH_SECRET
  if (configured)
    return configured
  const g = globalThis as Record<symbol, string | undefined>
  let secret = g[EPHEMERAL_SECRET_KEY]
  if (secret === undefined) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    secret = Buffer.from(bytes).toString('hex')
    g[EPHEMERAL_SECRET_KEY] = secret
  }
  return secret
}

function escapeAttrValue(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Returns the configured honeypot field name, or `undefined` when honeypot is disabled. */
export function honeypotFieldName(protect: ActionProtectOptions | undefined): string | undefined {
  if (protect?.honeypot === true)
    return DEFAULT_HONEYPOT_FIELD
  if (typeof protect?.honeypot === 'string') {
    const trimmed = protect.honeypot.trim()
    return trimmed !== '' ? trimmed : undefined
  }
  return undefined
}

/** Whether `protect` requires reading the request body (honeypot or minTime). */
export function needsProtectBody(protect: ActionProtectOptions | undefined): boolean {
  return honeypotFieldName(protect) !== undefined || protect?.minTime !== undefined
}

/** Validates `ActionProtectOptions` eagerly when `action()` is defined. */
export function assertActionProtect(protect: ActionProtectOptions): void {
  if (protect.rateLimit !== undefined)
    assertRateLimit(protect.rateLimit, 'an action')
  if (protect.minTime !== undefined && (!Number.isFinite(protect.minTime) || protect.minTime < 0))
    throw new Error(`prunelle: protect.minTime of an action is ${String(protect.minTime)}; give a non-negative number of milliseconds.`)
  if (typeof protect.honeypot === 'string' && protect.honeypot.trim() === '')
    throw new Error('prunelle: protect.honeypot of an action must be a non-empty field name.')
}

/** Creates an HMAC-SHA256 signed timestamp token (`<timestampMs>.<signatureHex>`). */
export function signFormTimestamp(timestampMs = Date.now()): string {
  const ts = String(Math.trunc(timestampMs))
  const sig = new Bun.CryptoHasher('sha256', formSecret()).update(ts).digest('hex')
  return `${ts}.${sig}`
}

/** Verifies an HMAC-signed `_pru_ts` token against `minTimeMs` and the 24-hour expiry window. */
export function verifyFormTimestamp(
  token: unknown,
  minTimeMs: number,
  now = Date.now(),
): { ok: true } | { ok: false, reason: string } {
  if (typeof token !== 'string')
    return { ok: false, reason: 'Missing form timestamp' }
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1)
    return { ok: false, reason: 'Invalid form timestamp' }
  const tsStr = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!DIGITS_RE.test(tsStr))
    return { ok: false, reason: 'Invalid form timestamp' }
  const expected = new Bun.CryptoHasher('sha256', formSecret()).update(tsStr).digest('hex')
  if (!constantTimeEqual(sig, expected))
    return { ok: false, reason: 'Invalid form timestamp' }
  const ts = Number(tsStr)
  if (!Number.isFinite(ts))
    return { ok: false, reason: 'Invalid form timestamp' }
  const elapsed = now - ts
  if (elapsed < minTimeMs)
    return { ok: false, reason: 'Form submitted too quickly' }
  if (elapsed > MAX_FORM_AGE_MS)
    return { ok: false, reason: 'Form submission expired' }
  return { ok: true }
}

function isNonEmptyFieldValue(value: unknown): boolean {
  if (Array.isArray(value))
    return value.some(v => v !== '' && v != null)
  return value !== '' && value != null
}

/** Returns a shallow copy of `rawBody` with internal Prunelle protection fields removed. */
export function stripProtectFields(protect: ActionProtectOptions | undefined, rawBody: unknown): unknown {
  if (protect === undefined || rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody))
    return rawBody
  const hpField = honeypotFieldName(protect)
  const hasMinTime = protect.minTime !== undefined
  if (hpField === undefined && !hasMinTime)
    return rawBody
  const obj = rawBody as Record<string, unknown>
  const dropHp = hpField !== undefined && Object.hasOwn(obj, hpField)
  const dropTs = hasMinTime && Object.hasOwn(obj, FORM_TIMESTAMP_FIELD)
  if (!dropHp && !dropTs)
    return rawBody
  const entries: [string, unknown][] = []
  for (const [k, v] of Object.entries(obj)) {
    if ((dropHp && k === hpField) || (dropTs && k === FORM_TIMESTAMP_FIELD))
      continue
    entries.push([k, v])
  }
  return Object.fromEntries(entries)
}

/** Verifies honeypot and signed timestamp protections and returns the body with internal fields stripped. */
export function verifyActionProtection(
  protect: ActionProtectOptions | undefined,
  rawBody: unknown,
  now = Date.now(),
): { ok: true, cleanedBody: unknown } | { ok: false, error: string, cleanedBody: unknown } {
  if (protect === undefined)
    return { ok: true, cleanedBody: rawBody }
  const hpField = honeypotFieldName(protect)
  const minTime = protect.minTime
  if (hpField === undefined && minTime === undefined)
    return { ok: true, cleanedBody: rawBody }

  const cleanedBody = stripProtectFields(protect, rawBody)
  const obj = rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody)
    ? rawBody as Record<string, unknown>
    : undefined

  if (hpField !== undefined && obj !== undefined && Object.hasOwn(obj, hpField)) {
    if (isNonEmptyFieldValue(obj[hpField]))
      return { ok: false, error: 'Submission rejected', cleanedBody }
  }

  if (minTime !== undefined) {
    const rawTs = obj !== undefined && Object.hasOwn(obj, FORM_TIMESTAMP_FIELD) ? obj[FORM_TIMESTAMP_FIELD] : undefined
    const token = Array.isArray(rawTs) ? rawTs[0] : rawTs
    const tsResult = verifyFormTimestamp(token, minTime, now)
    if (!tsResult.ok)
      return { ok: false, error: tsResult.reason, cleanedBody }
  }

  return { ok: true, cleanedBody }
}

/** Renders the SSR hidden protection inputs (visually hidden honeypot + signed timestamp) for `<form action={fn}>`. */
export function renderProtectFields(protect: ActionProtectOptions | undefined): string {
  if (protect === undefined)
    return ''
  let html = ''
  const hp = honeypotFieldName(protect)
  if (hp !== undefined)
    html += `<input type="text" name="${escapeAttrValue(hp)}" value="" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">`
  if (protect.minTime !== undefined)
    html += `<input type="hidden" name="${FORM_TIMESTAMP_FIELD}" value="${signFormTimestamp()}">`
  return html
}
