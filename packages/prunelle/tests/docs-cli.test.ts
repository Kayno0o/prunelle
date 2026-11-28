// Tests for `prunelle docs <words>` (Issue #21): discovering and searching installed `llms.txt` docs.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { discoverLlmsDocs, formatDocsSearchResult, searchLlmsDocs } from '../src/cli/docs'

const PRUNELLE_PKG_DIR = resolve(import.meta.dir, '..')
const AUTH_PKG_DIR = resolve(import.meta.dir, '../../plugin-auth')
const SEO_PKG_DIR = resolve(import.meta.dir, '../../plugin-seo')

function makeTempProject(): string {
  return mkdtempSync(join(tmpdir(), 'prunelle-docs-cli-'))
}

describe('prunelle docs (#21)', () => {
  test('discovers prunelle and installed @prunellejs/* packages including symlinks and hoisted ancestors', () => {
    const root = makeTempProject()
    try {
      const appDir = join(root, 'apps/web')
      mkdirSync(join(root, 'node_modules/@prunellejs'), { recursive: true })
      mkdirSync(join(appDir, 'node_modules/@prunellejs/custom'), { recursive: true })

      // Symlink real workspace packages in root node_modules (hoisted)
      symlinkSync(PRUNELLE_PKG_DIR, join(root, 'node_modules/prunelle'), 'dir')
      symlinkSync(AUTH_PKG_DIR, join(root, 'node_modules/@prunellejs/auth'), 'dir')
      symlinkSync(SEO_PKG_DIR, join(root, 'node_modules/@prunellejs/seo'), 'dir')

      // Local directory package in app node_modules
      writeFileSync(
        join(appDir, 'node_modules/@prunellejs/custom/package.json'),
        JSON.stringify({ name: '@prunellejs/custom', version: '1.2.3' }),
      )
      writeFileSync(
        join(appDir, 'node_modules/@prunellejs/custom/llms.txt'),
        '# @prunellejs/custom Reference\n\n## Setup\n\nCustom widget docs.\n',
      )

      // Package without llms.txt should be ignored
      mkdirSync(join(root, 'node_modules/@prunellejs/empty'), { recursive: true })
      writeFileSync(
        join(root, 'node_modules/@prunellejs/empty/package.json'),
        JSON.stringify({ name: '@prunellejs/empty', version: '0.0.1' }),
      )

      const docs = discoverLlmsDocs(appDir)
      expect(docs.map(d => d.packageName)).toEqual([
        'prunelle',
        '@prunellejs/auth',
        '@prunellejs/custom',
        '@prunellejs/seo',
      ])
      expect(docs[0]!.version).toBeString()
      expect(docs[2]!.version).toBe('1.2.3')
      expect(docs[2]!.relFile).toBe('node_modules/@prunellejs/custom/llms.txt')
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('falls back to running prunelle package llms.txt when node_modules/prunelle is absent', () => {
    const dir = makeTempProject()
    try {
      const docs = discoverLlmsDocs(dir)
      expect(docs.some(d => d.packageName === 'prunelle')).toBe(true)
      const core = docs.find(d => d.packageName === 'prunelle')!
      expect(core.content).toContain('# Prunelle Reference')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('splits Core Rules bold bullets into focused sub-sections with exact 1-based line numbers', () => {
    const dir = makeTempProject()
    try {
      mkdirSync(join(dir, 'node_modules'), { recursive: true })
      symlinkSync(PRUNELLE_PKG_DIR, join(dir, 'node_modules/prunelle'), 'dir')

      const res = searchLlmsDocs(dir, 'consent')
      expect(res.words).toEqual(['consent'])
      expect(res.matches.length).toBeGreaterThan(0)

      const consentSection = res.matches.find(m => m.heading.includes('French web law & Consent'))
      expect(consentSection).toBeDefined()
      expect(consentSection!.heading).toMatch(/^Core Rules.*> French web law & Consent/)
      expect(consentSection!.packageName).toBe('prunelle')
      expect(consentSection!.relFile).toBe('node_modules/prunelle/llms.txt')
      expect(consentSection!.content).toContain('ConsentGate')
      // Must not be the whole Core Rules wall (should not contain Imports or Signals bullets)
      expect(consentSection!.content).not.toContain('- **Imports**:')

      // Verify exact 1-based line number matches the actual file line
      const fileLines = discoverLlmsDocs(dir)[0]!.content.split(/\r?\n/)
      expect(fileLines[consentSection!.line - 1]).toStartWith('- **French web law & Consent')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('keeps indented sub-bullets attached to their parent bold bullet topic', () => {
    const dir = makeTempProject()
    try {
      mkdirSync(join(dir, 'node_modules'), { recursive: true })
      symlinkSync(PRUNELLE_PKG_DIR, join(dir, 'node_modules/prunelle'), 'dir')

      const res = searchLlmsDocs(dir, 'notFound prerender')
      const routesSection = res.matches.find(m => m.heading.includes('Routes'))
      expect(routesSection).toBeDefined()
      expect(routesSection!.content).toContain('notFound()')
      expect(routesSection!.content).toContain('prerender = true')
      expect(routesSection!.content).not.toContain('- **Streaming & Head**:')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('supports multi-word AND matching, case-insensitivity, cross-package search, and limit', () => {
    const dir = makeTempProject()
    try {
      mkdirSync(join(dir, 'node_modules/@prunellejs'), { recursive: true })
      symlinkSync(PRUNELLE_PKG_DIR, join(dir, 'node_modules/prunelle'), 'dir')
      symlinkSync(AUTH_PKG_DIR, join(dir, 'node_modules/@prunellejs/auth'), 'dir')

      const cross = searchLlmsDocs(dir, 'ARGON2ID MAGIC')
      expect(cross.words).toEqual(['argon2id', 'magic'])
      expect(cross.matches.map(m => m.packageName)).toContain('prunelle')
      expect(cross.matches.map(m => m.packageName)).toContain('@prunellejs/auth')

      const authOnly = searchLlmsDocs(dir, 'AUTH_SECRET SESSION')
      expect(authOnly.words).toEqual(['auth_secret', 'session'])
      expect(authOnly.matches.length).toBeGreaterThan(0)
      expect(authOnly.matches[0]!.packageName).toBe('@prunellejs/auth')

      const limited = searchLlmsDocs(dir, 'action', { limit: 2 })
      expect(limited.matches.length).toBeLessThanOrEqual(2)
      expect(limited.packages.map(p => p.name)).toEqual(['prunelle', '@prunellejs/auth'])

      // Verify JSON serialization structure
      const json = JSON.parse(JSON.stringify(limited)) as typeof limited
      expect(json.query).toBe('action')
      expect(json.words).toEqual(['action'])
      expect(Array.isArray(json.packages)).toBe(true)
      expect(Array.isArray(json.matches)).toBe(true)
      expect(typeof json.matches[0]!.line).toBe('number')
      expect(typeof json.matches[0]!.score).toBe('number')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('handles empty query and no-match queries with helpful formatted output', () => {
    const dir = makeTempProject()
    try {
      mkdirSync(join(dir, 'node_modules/@prunellejs'), { recursive: true })
      symlinkSync(PRUNELLE_PKG_DIR, join(dir, 'node_modules/prunelle'), 'dir')
      symlinkSync(AUTH_PKG_DIR, join(dir, 'node_modules/@prunellejs/auth'), 'dir')

      const empty = searchLlmsDocs(dir, '   ')
      expect(empty.words).toEqual([])
      expect(empty.matches).toEqual([])
      expect(empty.packages.length).toBe(2)
      expect(formatDocsSearchResult(empty)).toContain('prunelle')

      const miss = searchLlmsDocs(dir, 'nonexistent-xyzzy-token-999')
      expect(miss.matches).toEqual([])
      const formattedMiss = formatDocsSearchResult(miss)
      expect(formattedMiss).toContain('No docs matched "nonexistent-xyzzy-token-999"')
      expect(formattedMiss).toContain('prunelle')
      expect(formattedMiss).toContain('@prunellejs/auth')

      const hit = searchLlmsDocs(dir, 'sqliteAuthStore', { limit: 1 })
      const formattedHit = formatDocsSearchResult(hit)
      expect(formattedHit).toContain('@prunellejs/auth')
      expect(formattedHit).toContain('node_modules/@prunellejs/auth/llms.txt:')
      expect(formattedHit).toContain('sqliteAuthStore')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
