// GreenIT EcoIndex score, grade (A–G), GHG emissions and water footprint for prerendered pages.

import type { Locate } from './first-load'
import type { RouteManifestEntry } from './manifest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { firstLoadUrls, measureFirstLoad } from './first-load'
import { appBrotliCacheDir, brotliSync } from './precompress'

export type EcoIndexGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export interface EcoIndexInputs {
  dom: number
  requests: number
  weightBytes: number
}

export interface RouteEcoIndex {
  grade: EcoIndexGrade
  score: number
  dom: number
  requests: number
  weightBytes: number
  ghgGrams: number
  waterCl: number
  url?: string | undefined
}

// Official GreenIT EcoIndex 20-quantile reference tables (DOM elements, HTTP requests, transfer size in KB).
const QUANTILES_DOM = [
  0, 47, 75, 159, 233, 298, 358, 417, 476, 537, 603,
  674, 753, 843, 949, 1076, 1237, 1459, 1801, 2479, 594601,
] as const

const QUANTILES_REQ = [
  0, 2, 15, 25, 34, 42, 49, 56, 63, 70, 78,
  86, 95, 105, 117, 130, 147, 170, 205, 281, 3920,
] as const

const QUANTILES_SIZE = [
  0, 1.37, 144.7, 319.53, 479.46, 631.97, 783.38, 937.91, 1098.62, 1265.47, 1448.32,
  1648.27, 1876.08, 2142.06, 2465.37, 2866.31, 3401.59, 4155.73, 5400.08, 8037.54, 223212.26,
] as const

const RAW_CLOSE_RE: Record<string, RegExp> = {
  script: /<\/script(?:\s[^>]*)?>/gi,
  style: /<\/style(?:\s[^>]*)?>/gi,
  textarea: /<\/textarea(?:\s[^>]*)?>/gi,
  title: /<\/title(?:\s[^>]*)?>/gi,
}

const isAsciiAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)

const isTagNameChar = (c: number): boolean =>
  isAsciiAlpha(c) || (c >= 48 && c <= 57) || c === 45 || c === 95 || c === 58 || c === 46

const isTagDelimiter = (c: number): boolean =>
  c === 62 || c === 47 || c === 32 || c === 9 || c === 10 || c === 13 || c === 12

function findTagEnd(html: string, start: number): number {
  let quote = 0
  for (let i = start; i < html.length; i++) {
    const c = html.charCodeAt(i)
    if (quote !== 0) {
      if (c === quote)
        quote = 0
    }
    else if (c === 34 || c === 39) {
      quote = c
    }
    else if (c === 62) {
      return i
    }
  }
  return -1
}

function skipBangConstruct(html: string, lt: number): number {
  if (html.startsWith('<!--', lt)) {
    const end = html.indexOf('-->', lt + 4)
    return end === -1 ? html.length : end + 3
  }
  if (html.startsWith('<![CDATA[', lt)) {
    const end = html.indexOf(']]>', lt + 9)
    return end === -1 ? html.length : end + 3
  }
  const end = html.indexOf('>', lt + 2)
  return end === -1 ? html.length : end + 1
}

/** Counts HTML element nodes by scanning opening tags, ignoring DOCTYPE, comments, closing tags and raw text inside script/style/textarea/title. */
export function countDomElements(html: string): number {
  let count = 0
  let i = 0
  const len = html.length
  while (i < len) {
    const lt = html.indexOf('<', i)
    if (lt === -1)
      break
    const next = html.charCodeAt(lt + 1)
    if (next === 33) {
      i = skipBangConstruct(html, lt)
      continue
    }
    if (next === 47 || next === 63) {
      const end = html.indexOf('>', lt + 2)
      i = end === -1 ? len : end + 1
      continue
    }
    if (!isAsciiAlpha(next)) {
      i = lt + 1
      continue
    }
    let nameEnd = lt + 2
    while (nameEnd < len && isTagNameChar(html.charCodeAt(nameEnd)))
      nameEnd++
    if (nameEnd >= len || !isTagDelimiter(html.charCodeAt(nameEnd))) {
      i = lt + 1
      continue
    }
    const tagEnd = findTagEnd(html, nameEnd)
    if (tagEnd === -1)
      break
    count++
    i = tagEnd + 1
    const closeRe = RAW_CLOSE_RE[html.slice(lt + 1, nameEnd).toLowerCase()]
    if (closeRe !== undefined) {
      closeRe.lastIndex = i
      const match = closeRe.exec(html)
      i = match === null ? len : closeRe.lastIndex
    }
  }
  return count
}

function computeQuantile(quantiles: readonly number[], value: number): number {
  if (value <= quantiles[0]!)
    return 0
  for (let i = 1; i < quantiles.length; i++) {
    const hi = quantiles[i]!
    if (value < hi) {
      const lo = quantiles[i - 1]!
      return (i - 1) + (value - lo) / (hi - lo)
    }
  }
  return quantiles.length - 1
}

function gradeForScore(score: number): EcoIndexGrade {
  if (score > 75)
    return 'A'
  if (score > 65)
    return 'B'
  if (score > 50)
    return 'C'
  if (score > 35)
    return 'D'
  if (score > 20)
    return 'E'
  if (score > 5)
    return 'F'
  return 'G'
}

/** Computes the GreenIT EcoIndex score (0–100), grade (A–G), GHG emissions (gCO2e) and water consumption (cl) per view. */
export function computeEcoIndex(inputs: EcoIndexInputs): Omit<RouteEcoIndex, 'url'> {
  const dom = Math.max(0, inputs.dom)
  const requests = Math.max(0, inputs.requests)
  const weightBytes = Math.max(0, inputs.weightBytes)
  const qDom = computeQuantile(QUANTILES_DOM, dom)
  const qReq = computeQuantile(QUANTILES_REQ, requests)
  const qSize = computeQuantile(QUANTILES_SIZE, weightBytes / 1024)
  const raw = 100 - (5 * (3 * qDom + 2 * qReq + qSize)) / 6
  const score = Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10
  const ghgGrams = Math.round((2 + (2 * (50 - score)) / 100) * 100) / 100
  const waterCl = Math.round((3 + (3 * (50 - score)) / 100) * 100) / 100
  return { grade: gradeForScore(score), score, dom, requests, weightBytes, ghgGrams, waterCl }
}

function htmlServedSize(abs: string, raw: Uint8Array): number {
  const sidecar = `${abs}.br`
  if (existsSync(sidecar))
    return statSync(sidecar).size
  const packed = brotliSync(raw, appBrotliCacheDir()).byteLength
  return Math.min(packed, raw.byteLength)
}

function isWorse(candidate: Omit<RouteEcoIndex, 'url'>, current: Omit<RouteEcoIndex, 'url'>): boolean {
  if (candidate.score !== current.score)
    return candidate.score < current.score
  if (candidate.weightBytes !== current.weightBytes)
    return candidate.weightBytes > current.weightBytes
  return candidate.dom > current.dom
}

/** Measures EcoIndex across a route's prerendered HTML files, returning the worst (lowest) score for multi-URL routes. */
export function measureRouteEcoIndex(route: RouteManifestEntry, options: { prerenderBaseDir: string, locate: Locate }): RouteEcoIndex | undefined {
  if (route.prerendered === undefined)
    return undefined
  const entries = Object.entries(route.prerendered).sort(([a], [b]) => a.localeCompare(b))
  let worst: Omit<RouteEcoIndex, 'url'> | undefined
  let worstUrl: string | undefined
  let measured = 0

  for (const [url, relFile] of entries) {
    const abs = join(options.prerenderBaseDir, relFile)
    const ext = extname(abs).toLowerCase()
    if ((ext !== '.html' && ext !== '.htm') || !existsSync(abs))
      continue
    const raw = readFileSync(abs)
    const html = raw.toString('utf8')
    const htmlBytes = htmlServedSize(abs, raw)
    const load = measureFirstLoad(firstLoadUrls(html), options.locate, htmlBytes)
    const eco = computeEcoIndex({
      dom: countDomElements(html),
      requests: 1 + load.files,
      weightBytes: load.total,
    })
    measured++
    if (worst === undefined || isWorse(eco, worst)) {
      worst = eco
      worstUrl = url
    }
  }

  if (worst === undefined || worstUrl === undefined)
    return undefined
  return measured > 1 || worstUrl !== route.path ? { ...worst, url: worstUrl } : worst
}
