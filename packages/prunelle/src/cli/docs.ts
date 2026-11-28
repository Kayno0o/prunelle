// `prunelle docs <words>`: discover and search installed `llms.txt` files for `prunelle` and `@prunellejs/*` packages.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { relPosix } from '../build/files'

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/
const BOLD_BULLET_RE = /^- \*\*(.+?)\*\*/
const FENCE_RE = /^\s*```/
const WORD_SPLIT_RE = /\s+/
const SCOPED_PACKAGE_DIRS = ['@prunellejs', '@prunelle'] as const
const DEFAULT_LIMIT = 20

export interface LlmsPackageDoc {
  packageName: string
  version: string | undefined
  file: string
  relFile: string
  content: string
}

export interface DocsMatch {
  packageName: string
  version: string | undefined
  file: string
  relFile: string
  heading: string
  line: number
  score: number
  content: string
}

export interface DocsSearchResult {
  query: string
  words: string[]
  packages: { name: string, version: string | undefined, file: string }[]
  matches: DocsMatch[]
}

interface ParsedSection {
  heading: string
  line: number
  content: string
}

interface HeadingBlock {
  heading: string
  line: number
  lines: { num: number, text: string }[]
}

function isFile(path: string): boolean {
  const st = statSync(path, { throwIfNoEntry: false })
  return st !== undefined && st.isFile()
}

function isDirectory(path: string): boolean {
  const st = statSync(path, { throwIfNoEntry: false })
  return st !== undefined && st.isDirectory()
}

function readPackageMeta(pkgDir: string, fallbackName: string): { name: string, version: string | undefined } {
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (!isFile(pkgJsonPath))
    return { name: fallbackName, version: undefined }
  try {
    const parsed = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { name?: unknown, version?: unknown }
    const name = typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : fallbackName
    const version = typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : undefined
    return { name, version }
  }
  catch {
    return { name: fallbackName, version: undefined }
  }
}

function addPackageDoc(
  docs: LlmsPackageDoc[],
  seen: Set<string>,
  root: string,
  pkgDir: string,
  fallbackName: string,
): void {
  const llmsPath = join(pkgDir, 'llms.txt')
  if (!isFile(llmsPath))
    return
  const meta = readPackageMeta(pkgDir, fallbackName)
  if (seen.has(meta.name))
    return
  seen.add(meta.name)
  docs.push({
    packageName: meta.name,
    version: meta.version,
    file: llmsPath,
    relFile: relPosix(root, llmsPath),
    content: readFileSync(llmsPath, 'utf8'),
  })
}

function scanScopedPackages(
  docs: LlmsPackageDoc[],
  seen: Set<string>,
  root: string,
  nodeModulesDir: string,
): void {
  for (const scope of SCOPED_PACKAGE_DIRS) {
    const scopeDir = join(nodeModulesDir, scope)
    if (!isDirectory(scopeDir))
      continue
    let entries: string[]
    try {
      entries = readdirSync(scopeDir)
    }
    catch {
      continue
    }
    for (const entry of entries)
      addPackageDoc(docs, seen, root, join(scopeDir, entry), `${scope}/${entry}`)
  }
}

/** Discovers `llms.txt` files for `prunelle` and installed `@prunellejs/*` (and `@prunelle/*`) packages from `rootDir` up through ancestor `node_modules`. */
export function discoverLlmsDocs(rootDir: string): LlmsPackageDoc[] {
  const root = resolve(rootDir)
  const docs: LlmsPackageDoc[] = []
  const seen = new Set<string>()

  let dir = root
  while (true) {
    const nodeModulesDir = join(dir, 'node_modules')
    if (isDirectory(nodeModulesDir)) {
      if (!seen.has('prunelle'))
        addPackageDoc(docs, seen, root, join(nodeModulesDir, 'prunelle'), 'prunelle')
      scanScopedPackages(docs, seen, root, nodeModulesDir)
    }
    const parent = dirname(dir)
    if (parent === dir)
      break
    dir = parent
  }

  if (!seen.has('prunelle'))
    addPackageDoc(docs, seen, root, resolve(import.meta.dir, '../..'), 'prunelle')

  docs.sort((a, b) => {
    if (a.packageName === 'prunelle' && b.packageName !== 'prunelle')
      return -1
    if (b.packageName === 'prunelle' && a.packageName !== 'prunelle')
      return 1
    return a.packageName.localeCompare(b.packageName)
  })
  return docs
}

function splitHeadingBlocks(content: string): HeadingBlock[] {
  const rawLines = content.split(/\r?\n/)
  const blocks: HeadingBlock[] = []
  let current: HeadingBlock | undefined
  let inFence = false

  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i]!
    const num = i + 1
    if (FENCE_RE.test(text))
      inFence = !inFence

    if (!inFence) {
      const headingMatch = HEADING_RE.exec(text)
      if (headingMatch !== null) {
        current = { heading: headingMatch[2]!.trim(), line: num, lines: [] }
        blocks.push(current)
        continue
      }
    }

    if (current === undefined) {
      current = { heading: 'Overview', line: num, lines: [] }
      blocks.push(current)
    }
    current.lines.push({ num, text })
  }

  return blocks
}

function flushLines(heading: string, line: number, lines: readonly { num: number, text: string }[], out: ParsedSection[]): void {
  const text = lines.map(l => l.text).join('\n').trim()
  if (text.length > 0)
    out.push({ heading, line, content: text })
}

function splitBlockSections(block: HeadingBlock): ParsedSection[] {
  const hasBoldBullet = (() => {
    let inFence = false
    for (const l of block.lines) {
      if (FENCE_RE.test(l.text))
        inFence = !inFence
      else if (!inFence && BOLD_BULLET_RE.test(l.text))
        return true
    }
    return false
  })()

  if (!hasBoldBullet) {
    const out: ParsedSection[] = []
    flushLines(block.heading, block.line, block.lines, out)
    return out
  }

  const sections: ParsedSection[] = []
  let activeBullet: { heading: string, line: number, lines: { num: number, text: string }[] } | undefined
  let generalLines: { num: number, text: string }[] = []
  let generalLine = block.line
  let inFence = false

  const flushActiveBullet = (): void => {
    if (activeBullet !== undefined) {
      flushLines(activeBullet.heading, activeBullet.line, activeBullet.lines, sections)
      activeBullet = undefined
    }
  }

  const flushGeneral = (): void => {
    if (generalLines.length > 0) {
      flushLines(block.heading, generalLine, generalLines, sections)
      generalLines = []
    }
  }

  for (const entry of block.lines) {
    if (FENCE_RE.test(entry.text))
      inFence = !inFence

    if (!inFence) {
      const bulletMatch = BOLD_BULLET_RE.exec(entry.text)
      if (bulletMatch !== null) {
        flushGeneral()
        flushActiveBullet()
        activeBullet = {
          heading: `${block.heading} > ${bulletMatch[1]!.trim()}`,
          line: entry.num,
          lines: [entry],
        }
        continue
      }

      if (activeBullet !== undefined) {
        if (entry.text.trim() === '' || entry.text.startsWith(' ') || entry.text.startsWith('\t')) {
          activeBullet.lines.push(entry)
          continue
        }
        flushActiveBullet()
      }
    }
    else if (activeBullet !== undefined) {
      activeBullet.lines.push(entry)
      continue
    }

    if (generalLines.length === 0)
      generalLine = entry.num
    generalLines.push(entry)
  }

  flushActiveBullet()
  flushGeneral()
  return sections
}

function parseSections(content: string): ParsedSection[] {
  const blocks = splitHeadingBlocks(content)
  const sections: ParsedSection[] = []
  for (const block of blocks) {
    for (const section of splitBlockSections(block))
      sections.push(section)
  }
  return sections
}

function countOccurrences(haystack: string, needle: string, maxCount: number): number {
  let count = 0
  let pos = 0
  while (count < maxCount) {
    const idx = haystack.indexOf(needle, pos)
    if (idx === -1)
      break
    count++
    pos = idx + needle.length
  }
  return count
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scoreSection(
  pkgLower: string,
  headingLower: string,
  contentLower: string,
  words: readonly string[],
  phrase: string,
): number {
  let score = 0
  if (headingLower.includes(phrase))
    score += 30
  if (pkgLower.includes(phrase))
    score += 25
  if (contentLower.includes(phrase))
    score += 10

  for (const word of words) {
    const wordBoundary = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(word)}(?:$|[^a-z0-9])`)
    if (pkgLower.includes(word))
      score += wordBoundary.test(pkgLower) ? 25 : 15
    if (headingLower.includes(word))
      score += wordBoundary.test(headingLower) ? 25 : 20
    const bodyHits = countOccurrences(contentLower, word, 10)
    score += bodyHits * 2
    if (bodyHits > 0 && wordBoundary.test(contentLower))
      score += 3
  }

  return score
}

/** Searches installed `llms.txt` docs for every whitespace-separated word in `query` (case-insensitive AND). */
export function searchLlmsDocs(
  rootDir: string,
  query: string,
  options?: { limit?: number | undefined },
): DocsSearchResult {
  const docs = discoverLlmsDocs(rootDir)
  const packages = docs.map(doc => ({ name: doc.packageName, version: doc.version, file: doc.relFile }))
  const words = query.trim().toLowerCase().split(WORD_SPLIT_RE).filter(Boolean)
  if (words.length === 0)
    return { query, words: [], packages, matches: [] }

  const phrase = words.join(' ')
  const matches: DocsMatch[] = []

  for (const doc of docs) {
    const pkgLower = doc.packageName.toLowerCase()
    for (const section of parseSections(doc.content)) {
      const headingLower = section.heading.toLowerCase()
      const contentLower = section.content.toLowerCase()
      const combined = `${pkgLower} ${headingLower} ${contentLower}`
      if (!words.every(word => combined.includes(word)))
        continue

      const score = scoreSection(pkgLower, headingLower, contentLower, words, phrase)
      matches.push({
        packageName: doc.packageName,
        version: doc.version,
        file: doc.file,
        relFile: doc.relFile,
        heading: section.heading,
        line: section.line,
        score,
        content: section.content,
      })
    }
  }

  matches.sort((a, b) => {
    if (b.score !== a.score)
      return b.score - a.score
    const aCore = a.packageName === 'prunelle' ? 0 : 1
    const bCore = b.packageName === 'prunelle' ? 0 : 1
    if (aCore !== bCore)
      return aCore - bCore
    const byPkg = a.packageName.localeCompare(b.packageName)
    if (byPkg !== 0)
      return byPkg
    return a.line - b.line
  })

  const limit = options?.limit ?? DEFAULT_LIMIT
  const limited = limit >= 0 ? matches.slice(0, limit) : matches
  return { query, words, packages, matches: limited }
}

function formatPackageLabel(name: string, version: string | undefined): string {
  return version !== undefined ? `${name}@${version}` : name
}

/** Formats a `DocsSearchResult` for terminal output. */
export function formatDocsSearchResult(result: DocsSearchResult): string {
  if (result.matches.length === 0) {
    const pkgList = result.packages.length > 0
      ? result.packages.map(pkg => `${formatPackageLabel(pkg.name, pkg.version)} (${pkg.file})`).join(', ')
      : '(none)'
    if (result.words.length === 0)
      return `No search words provided.\nAvailable packages (${result.packages.length}): ${pkgList}`
    return `No docs matched "${result.query}".\nSearched packages (${result.packages.length}): ${pkgList}`
  }

  return result.matches.map((match) => {
    const pkgLabel = formatPackageLabel(match.packageName, match.version)
    return `=== ${pkgLabel} — ${match.heading} (${match.relFile}:${match.line}) ===\n${match.content}`
  }).join('\n\n')
}
