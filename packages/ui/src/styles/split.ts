// Per-component CSS assembly and grammar splitting for @prunellejs/ui.
// Keeps `base.css`, structural `components/*.css`, tokenized `themed/*.css`, and thin `grammars/*.css`
// composable both as full self-contained sheets and as minimal per-route component subsets.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type GrammarName = 'bare' | 'editorial' | 'workshop' | 'console' | 'soft' | 'orbit' | 'prunelle'

export const GRAMMAR_NAMES: readonly GrammarName[] = ['bare', 'editorial', 'workshop', 'console', 'soft', 'orbit', 'prunelle']

export const UI_COMPONENT_PARTS = [
  'layout',
  'button',
  'card',
  'badge',
  'notice',
  'field',
  'checkbox',
  'switch',
  'radio-group',
  'progress',
  'accordion',
  'tabs',
  'dialog',
  'drawer',
  'command',
  'popover',
  'menu',
  'select',
  'toast',
  'datatable',
] as const

export type UiComponentPart = (typeof UI_COMPONENT_PARTS)[number]

const PART_SET = new Set<string>(UI_COMPONENT_PARTS)

/** Maps every `@prunellejs/ui` TSX/runtime export to the CSS component parts it renders (including transitive parts). */
export const UI_EXPORT_TO_PARTS: Readonly<Record<string, readonly UiComponentPart[]>> = {
  Stack: ['layout'],
  Cluster: ['layout'],
  Grid: ['layout'],
  Sidebar: ['layout'],
  Split: ['layout'],
  Button: ['button'],
  Card: ['card'],
  CardHeader: ['card'],
  CardBody: ['card'],
  CardFooter: ['card'],
  Badge: ['badge'],
  Notice: ['notice'],
  Field: ['field'],
  Checkbox: ['checkbox'],
  Switch: ['switch'],
  RadioGroup: ['radio-group'],
  Progress: ['progress'],
  Accordion: ['accordion'],
  AccordionItem: ['accordion'],
  Popover: ['popover', 'button'],
  Dialog: ['dialog', 'button', 'layout'],
  ControlledDialog: ['dialog', 'button', 'layout'],
  Drawer: ['drawer', 'button', 'layout'],
  ControlledDrawer: ['drawer', 'button', 'layout'],
  Tabs: ['tabs'],
  Menu: ['menu', 'button'],
  Select: ['select'],
  CommandPalette: ['command', 'button'],
  DataTable: ['datatable', 'layout', 'button'],
  Toaster: ['toast'],
  toast: ['toast'],
}

const STYLES_DIR = import.meta.dir

export function grammarCssPath(grammar: GrammarName): string {
  return grammar === 'bare'
    ? join(STYLES_DIR, 'bare.css')
    : join(STYLES_DIR, 'grammars', `${grammar}.css`)
}

interface TaggedBlock {
  css: string
  parts: readonly UiComponentPart[] | null
}

interface ParsedGrammar {
  header: string
  topRules: TaggedBlock[]
  baseBlocks: string[]
  partBlocks: TaggedBlock[]
}

const DATA_UI_RE = /\[data-ui="([^"]+)"\]/g
const DATA_LAYOUT_RE = /\[data-layout(?:="[^"]*")?\]/
const PART_TAG_RE = /\/\*\s*@part:\s*([^*]+?)\s*\*\//
const LEADING_COMMENT_RE = /^\s*(\/\*[\s\S]*?\*\/)/

function resolveDataUiPart(name: string): UiComponentPart | undefined {
  if (name === 'table')
    return 'datatable'
  if (name === 'toaster')
    return 'toast'
  return PART_SET.has(name) ? (name as UiComponentPart) : undefined
}

function detectBlockParts(prelude: string, partComment: string | undefined): readonly UiComponentPart[] | null {
  if (partComment !== undefined) {
    const tagged = partComment
      .split(',')
      .map(s => s.trim())
      .filter((s): s is UiComponentPart => PART_SET.has(s))
    return tagged.length > 0 ? tagged : null
  }
  const found = new Set<UiComponentPart>()
  if (DATA_LAYOUT_RE.test(prelude))
    found.add('layout')
  for (const match of prelude.matchAll(DATA_UI_RE)) {
    const part = resolveDataUiPart(match[1]!)
    if (part !== undefined)
      found.add(part)
  }
  return found.size > 0 ? [...found] : null
}

interface RawBlock {
  prelude: string
  full: string
  partComment: string | undefined
}

function scanTopBlocks(css: string): RawBlock[] {
  const blocks: RawBlock[] = []
  let i = 0
  const n = css.length
  let pendingPart: string | undefined

  while (i < n) {
    while (i < n && /\s/.test(css[i]!))
      i++
    if (i >= n)
      break
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const commentEnd = end === -1 ? n : end + 2
      const comment = css.slice(i, commentEnd)
      const tag = comment.match(PART_TAG_RE)
      if (tag !== null)
        pendingPart = tag[1]
      i = commentEnd
      continue
    }

    const start = i
    let depth = 0
    let braceStart = -1
    let quote: string | null = null

    while (i < n) {
      const ch = css[i]!
      if (quote !== null) {
        if (ch === '\\')
          i++
        else if (ch === quote)
          quote = null
      }
      else if (ch === '"' || ch === '\'') {
        quote = ch
      }
      else if (ch === '/' && css[i + 1] === '*') {
        const end = css.indexOf('*/', i + 2)
        i = end === -1 ? n - 1 : end + 1
      }
      else if (ch === '{') {
        if (depth === 0)
          braceStart = i
        depth++
      }
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          i++
          break
        }
      }
      else if (ch === ';' && depth === 0) {
        i++
        break
      }
      i++
    }

    const full = css.slice(start, i).trim()
    if (full.length > 0 && !full.startsWith('@import')) {
      const prelude = braceStart === -1 ? full : css.slice(start, braceStart).trim()
      blocks.push({ prelude, full, partComment: pendingPart })
    }
    pendingPart = undefined
  }
  return blocks
}

function unwrapLayerKui(css: string): string {
  const blocks = scanTopBlocks(css)
  const inner: string[] = []
  for (const b of blocks) {
    if (/^@layer\s+kui\b/.test(b.prelude)) {
      const open = b.full.indexOf('{')
      const close = b.full.lastIndexOf('}')
      if (open !== -1 && close > open)
        inner.push(b.full.slice(open + 1, close).trim())
    }
    else {
      inner.push(b.full)
    }
  }
  return inner.join('\n')
}

let cachedBaseBody: string | undefined
const cachedComponentBodies = new Map<UiComponentPart, string>()
const cachedThemedBodies = new Map<UiComponentPart, string | null>()
const cachedGrammars = new Map<GrammarName, ParsedGrammar>()

function readBaseBody(): string {
  if (cachedBaseBody === undefined)
    cachedBaseBody = unwrapLayerKui(readFileSync(join(STYLES_DIR, 'base.css'), 'utf8'))
  return cachedBaseBody
}

function readComponentBody(part: UiComponentPart): string {
  let body = cachedComponentBodies.get(part)
  if (body === undefined) {
    body = unwrapLayerKui(readFileSync(join(STYLES_DIR, 'components', `${part}.css`), 'utf8'))
    cachedComponentBodies.set(part, body)
  }
  return body
}

function readThemedBody(part: UiComponentPart): string | null {
  let body = cachedThemedBodies.get(part)
  if (body === undefined) {
    const file = join(STYLES_DIR, 'themed', `${part}.css`)
    body = existsSync(file) ? unwrapLayerKui(readFileSync(file, 'utf8')) : null
    cachedThemedBodies.set(part, body)
  }
  return body
}

function parseGrammar(grammar: GrammarName): ParsedGrammar {
  const existing = cachedGrammars.get(grammar)
  if (existing !== undefined)
    return existing

  const raw = readFileSync(grammarCssPath(grammar), 'utf8')
  const header = raw.match(LEADING_COMMENT_RE)?.[1] ?? ''
  if (grammar === 'bare') {
    const parsed: ParsedGrammar = { header, topRules: [], baseBlocks: [], partBlocks: [] }
    cachedGrammars.set(grammar, parsed)
    return parsed
  }

  const topRules: TaggedBlock[] = []
  const baseBlocks: string[] = []
  const partBlocks: TaggedBlock[] = []

  for (const top of scanTopBlocks(raw)) {
    if (/^@layer\s+kui\b/.test(top.prelude)) {
      const open = top.full.indexOf('{')
      const close = top.full.lastIndexOf('}')
      if (open === -1 || close <= open)
        continue
      const inner = top.full.slice(open + 1, close)
      for (const blk of scanTopBlocks(inner)) {
        const parts = detectBlockParts(blk.prelude, blk.partComment)
        if (parts === null)
          baseBlocks.push(blk.full)
        else
          partBlocks.push({ css: blk.full, parts })
      }
    }
    else {
      topRules.push({ css: top.full, parts: detectBlockParts(top.prelude, top.partComment) })
    }
  }

  const parsed: ParsedGrammar = { header, topRules, baseBlocks, partBlocks }
  cachedGrammars.set(grammar, parsed)
  return parsed
}

function matchesAnyPart(blockParts: readonly UiComponentPart[] | null, wanted: ReadonlySet<UiComponentPart>): boolean {
  if (blockParts === null)
    return false
  for (const p of blockParts) {
    if (wanted.has(p))
      return true
  }
  return false
}

/** Returns `base.css` plus the grammar's global tokens & root/body rules (excluding component-specific blocks). */
export function renderGrammarBaseCss(grammar: GrammarName): string {
  const parsed = parseGrammar(grammar)
  const out: string[] = []
  if (parsed.header)
    out.push(parsed.header)
  for (const rule of parsed.topRules) {
    if (rule.parts === null)
      out.push(rule.css)
  }
  const layerBody = [readBaseBody(), ...parsed.baseBlocks].filter(Boolean).join('\n\n')
  out.push(`@layer kui {\n${layerBody}\n}`)
  return `${out.join('\n\n')}\n`
}

/** Returns ONLY the component CSS (structural + tokenized + grammar overrides) for `parts`, in deterministic cascade order inside `@layer kui`. */
export function renderGrammarPartsCss(grammar: GrammarName, parts: Iterable<UiComponentPart>): string {
  const wanted = new Set<UiComponentPart>()
  for (const p of parts) {
    if (PART_SET.has(p))
      wanted.add(p)
  }
  if (wanted.size === 0)
    return ''

  const ordered = UI_COMPONENT_PARTS.filter(p => wanted.has(p))
  const parsed = parseGrammar(grammar)
  const out: string[] = []

  for (const rule of parsed.topRules) {
    if (matchesAnyPart(rule.parts, wanted))
      out.push(rule.css)
  }

  const layerChunks: string[] = []
  for (const part of ordered)
    layerChunks.push(readComponentBody(part))

  if (grammar !== 'bare') {
    for (const part of ordered) {
      const themed = readThemedBody(part)
      if (themed !== null)
        layerChunks.push(themed)
    }
    for (const blk of parsed.partBlocks) {
      if (matchesAnyPart(blk.parts, wanted))
        layerChunks.push(blk.css)
    }
  }

  out.push(`@layer kui {\n${layerChunks.filter(Boolean).join('\n\n')}\n}`)
  return `${out.join('\n\n')}\n`
}

/** Returns the complete self-contained CSS source for a grammar (with all `@import`s resolved). */
export function renderGrammarCss(grammar: GrammarName): string {
  const parsed = parseGrammar(grammar)
  const out: string[] = []
  if (parsed.header)
    out.push(parsed.header)
  for (const rule of parsed.topRules)
    out.push(rule.css)

  const layerChunks: string[] = [readBaseBody(), ...parsed.baseBlocks]
  for (const part of UI_COMPONENT_PARTS)
    layerChunks.push(readComponentBody(part))

  if (grammar !== 'bare') {
    for (const part of UI_COMPONENT_PARTS) {
      const themed = readThemedBody(part)
      if (themed !== null)
        layerChunks.push(themed)
    }
    for (const blk of parsed.partBlocks)
      layerChunks.push(blk.css)
  }

  out.push(`@layer kui {\n${layerChunks.filter(Boolean).join('\n\n')}\n}`)
  return `${out.join('\n\n')}\n`
}
