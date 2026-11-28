// Dev-only `data-pru-src="file:line:col"` source-location tagging for SSR and DOM compilers.

import type { JSXElement } from 'oxc-parser'
import { isAbsolute, relative } from 'node:path'
import { escapeStaticAttr, jsxTagName } from './shared'

const DEV_SOURCE_SKIP_TAGS = new Set([
  'html',
  'head',
  'title',
  'meta',
  'link',
  'base',
  'style',
  'script',
  'noscript',
])

const NOOP_DEV_SOURCE = (): string => ''

function toDevRelPath(filename: string, devSourceRoot: string): string {
  if (!isAbsolute(filename) && isAbsolute(devSourceRoot))
    return filename.replaceAll('\\', '/')
  const rel = relative(devSourceRoot, filename).replaceAll('\\', '/')
  if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    return filename.replaceAll('\\', '/')
  return rel
}

function hasDevSourceAttr(node: JSXElement): boolean {
  for (const attr of node.openingElement.attributes) {
    if (attr.type === 'JSXAttribute' && jsxTagName(attr.name) === 'data-pru-src')
      return true
  }
  return false
}

/** Precomputes the character offset of every 1-based line start in `code`. */
export function buildLineStarts(code: string): number[] {
  const starts = [0]
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10)
      starts.push(i + 1)
  }
  return starts
}

/** O(log N) lookup of 1-based `{ line, col }` for a character offset using precomputed `lineStarts`. */
export function offsetToLineColFast(lineStarts: readonly number[], offset: number): { line: number, col: number } {
  const clamped = offset < 0 ? 0 : offset
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid]! <= clamped)
      lo = mid
    else
      hi = mid - 1
  }
  return { line: lo + 1, col: clamped - lineStarts[lo]! + 1 }
}

/** Formats ` data-pru-src="relPath:line:col"` for an intrinsic JSX element, or `''` when skipped. */
export function formatDevSourceAttr(
  node: JSXElement,
  tag: string,
  relPath: string,
  lineStarts: readonly number[],
): string {
  if (DEV_SOURCE_SKIP_TAGS.has(tag) || hasDevSourceAttr(node))
    return ''
  const { line, col } = offsetToLineColFast(lineStarts, node.openingElement.start)
  return ` data-pru-src="${escapeStaticAttr(`${relPath}:${line}:${col}`)}"`
}

/** Returns a per-element `data-pru-src` formatter when `devSourceRoot` is set, or a zero-cost no-op otherwise. */
export function createDevSourceAttr(
  filename: string,
  code: string,
  devSourceRoot: string | undefined,
): (node: JSXElement, tag: string) => string {
  if (devSourceRoot === undefined)
    return NOOP_DEV_SOURCE
  const relPath = toDevRelPath(filename, devSourceRoot)
  const lineStarts = buildLineStarts(code)
  return (node, tag) => formatDevSourceAttr(node, tag, relPath, lineStarts)
}
