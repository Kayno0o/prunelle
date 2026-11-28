// Static scanner detecting which `@prunellejs/ui` component parts a set of source files renders.
// Checks both named imports from `@prunellejs/ui` and literal `data-ui="..."` / `data-layout="..."` attributes.

import type { UiComponentPart } from './split'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { UI_COMPONENT_PARTS, UI_EXPORT_TO_PARTS } from './split'

const PART_SET = new Set<string>(UI_COMPONENT_PARTS)
const UI_SRC_DIR = resolve(import.meta.dir, '..')

const IMPORT_STMT_RE = /import\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g
const NAMED_LIST_RE = /\{([\s\S]*?)\}/
const NAMESPACE_RE = /\*\s+as\s+[A-Za-z_$]/
const DATA_UI_ATTR_RE = /\bdata-ui\s*=\s*(?:["']([^"']+)["']|\{([^}]*)\})/g
const DATA_LAYOUT_ATTR_RE = /\bdata-layout\s*=/
const STATIC_QUOTED_RE = /^\s*["']([^"']+)["']\s*$/

const DATA_UI_ALIASES: Readonly<Record<string, readonly UiComponentPart[]>> = {
  'table': ['datatable'],
  'toaster': ['toast'],
  'dialog-root': ['dialog', 'button', 'layout'],
  'drawer-root': ['drawer', 'button', 'layout'],
  'command-root': ['command', 'button'],
}

function isUiImportSource(specifier: string): boolean {
  if (specifier === '@prunellejs/ui')
    return true
  // Tests and monorepo apps may import the workspace package entry directly.
  return specifier.endsWith('/packages/ui/src/index.ts') || specifier.endsWith('/packages/ui/src/index')
}

function isInsideUiPackage(file: string): boolean {
  const norm = file.replace(/\\/g, '/')
  return norm.startsWith(`${UI_SRC_DIR.replace(/\\/g, '/')}/`)
    || norm.includes('/node_modules/@prunellejs/ui/')
}

function addPartForAttr(value: string, out: Set<UiComponentPart>): void {
  const aliased = DATA_UI_ALIASES[value]
  if (aliased !== undefined) {
    for (const p of aliased)
      out.add(p)
    return
  }
  if (PART_SET.has(value))
    out.add(value as UiComponentPart)
}

export interface FileUiScan {
  parts: readonly UiComponentPart[]
  all: boolean
}

function scanSingleFile(file: string): FileUiScan {
  if (isInsideUiPackage(file) || !existsSync(file))
    return { parts: [], all: false }

  const code = readFileSync(file, 'utf8')
  const parts = new Set<UiComponentPart>()
  let all = false

  for (const match of code.matchAll(IMPORT_STMT_RE)) {
    const clause = match[1]!
    const source = match[2]!
    if (!isUiImportSource(source))
      continue
    if (NAMESPACE_RE.test(clause)) {
      all = true
      break
    }
    const named = NAMED_LIST_RE.exec(clause)
    if (named !== null) {
      for (const rawSpec of named[1]!.split(',')) {
        const spec = rawSpec.trim()
        if (spec === '' || spec.startsWith('type '))
          continue
        const imported = spec.split(/\s+as\s+/)[0]!.trim()
        const mapped = UI_EXPORT_TO_PARTS[imported]
        if (mapped !== undefined) {
          for (const p of mapped)
            parts.add(p)
        }
      }
    }
  }

  if (!all) {
    if (DATA_LAYOUT_ATTR_RE.test(code))
      parts.add('layout')
    for (const match of code.matchAll(DATA_UI_ATTR_RE)) {
      const literal = match[1]
      if (literal !== undefined) {
        addPartForAttr(literal, parts)
        continue
      }
      const expr = match[2] ?? ''
      const staticMatch = STATIC_QUOTED_RE.exec(expr)
      if (staticMatch !== null) {
        addPartForAttr(staticMatch[1]!, parts)
      }
      else {
        all = true
        break
      }
    }
  }

  return all
    ? { parts: UI_COMPONENT_PARTS, all: true }
    : { parts: [...parts], all: false }
}

/** Creates a per-build cached scanner resolving the set of `@prunellejs/ui` component parts used by a list of source files. */
export function createUiPartScanner(): (files: readonly string[]) => Set<UiComponentPart> {
  const cache = new Map<string, FileUiScan>()
  const scan = (file: string): FileUiScan => {
    let entry = cache.get(file)
    if (entry === undefined) {
      entry = scanSingleFile(file)
      cache.set(file, entry)
    }
    return entry
  }
  return (files: readonly string[]): Set<UiComponentPart> => {
    const out = new Set<UiComponentPart>()
    for (const file of files) {
      const res = scan(file)
      if (res.all)
        return new Set(UI_COMPONENT_PARTS)
      for (const p of res.parts)
        out.add(p)
    }
    return out
  }
}
