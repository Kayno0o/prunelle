// `prunelle upgrade`: moves an app written for kay v2 (`@kayjs/kay`) onto prunelle: its dependencies, config file, imports, the names it imports and the names the browser receives.

import type { Dirent } from 'node:fs'
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pkg from '../../package.json' with { type: 'json' }
import { isNotSourceDir, relPosix } from '../build/files'
import { resolvePrunelleSpecifier } from '../build/resolve'
import { parseTsx } from '../compiler/analyze'
import { renameKayNames } from './upgrade-names'

export interface UpgradeResult {
  /** Root-relative files rewritten, moved (`from -> to`) or removed. */
  changed: string[]
  /** `file:line: what` for each step left for the developer. */
  manual: string[]
}

// The specifiers and file names every kind of file may name.
const PATH_RULES: [RegExp, string][] = [
  [/@kayjs\/kay(?![\w-])/g, 'prunelle'],
  [/@kayjs\//g, '@prunellejs/'],
  [/\.kay-(cache|dev)\b/g, '.prunelle-$1'],
  [/\bkay\.config\b/g, 'prunelle.config'],
  [/\bkay v2\b/g, 'prunelle'],
]
// The names kay sent the browser, as app code and styles may spell them.
const WIRE_RULES: [RegExp, string][] = [
  [/\bdata-kay-/g, 'data-pru-'],
  [/\bx-kay-/gi, 'x-pru-'],
  [/\/_kay\//g, '/_pru/'],
  [/\bkay-(island|slot|s)\b/g, 'pru-$1'],
  [/\bkay:(consent|navigate|region)\b/g, 'pru:$1'],
  [/\bkay_(session|consent)\b/g, 'pru_$1'],
]
// The kay CLI run as a command; the PATH_RULES run first, so `kay.config` and `.kay-cache` are gone by then.
const CLI_RULE: [RegExp, string] = [/(?<![\w.@/-])kay(?![\w.:/-])/g, 'prunelle']

const SOURCE_FILE_RE = /\.(?:tsx?|mts)$/
const STYLE_OR_SCRIPT_RE = /\.(?:css|js|mjs)$/
const CONFIG_FILE_RE = /^(?:tsconfig(?:\.[\w-]+)?\.json|bunfig\.toml|\.gitignore|\.dockerignore)$/
const BUILD_FILE_RE = /^(?:Dockerfile(?:\.[\w-]+)?|[\w-]+\.Dockerfile|[Jj]ustfile|Makefile|(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml)$/
// The agent instructions `prunelle new` writes, which name the llms.txt to read and the CLI to run (#42).
const AGENT_FILE_RE = /^(?:AGENTS|CLAUDE)\.md$/
const CI_DIRS = ['.forgejo/workflows', '.github/workflows', '.gitea/workflows']
const CACHE_DIRS = ['.kay-cache', '.kay-dev']
const PRUNELLE_SOURCE_RE = /^prunelle(\/.*)?$/

const apply = (text: string, rules: readonly [RegExp, string][]): string => rules.reduce((out, [re, to]) => out.replace(re, to), text)

/** Rewrites the app at `root` in place, and each package its bun workspace lists; installing the renamed dependencies is the caller's job. */
export function upgradeProject(root: string): UpgradeResult {
  const v1 = kayV1Dependency(root)
  if (v1 !== undefined)
    return { changed: [], manual: [`package.json:1: ${v1} is kay v1: prunelle upgrade moves kay v2 apps, so this one is left as it is.`] }
  const changed: string[] = []
  const manual: string[] = []
  const write = (file: string, before: string, after: string): void => {
    if (after === before)
      return
    writeFileSync(join(root, file), after)
    changed.push(file)
  }
  moveConfig(root, changed, manual)
  for (const file of rootFiles(root)) {
    const text = readFileSync(join(root, file), 'utf8')
    if (file === 'package.json')
      write(file, text, upgradePackageJson(text))
    else if (CONFIG_FILE_RE.test(file))
      write(file, text, apply(text, PATH_RULES))
    else if (BUILD_FILE_RE.test(file) || AGENT_FILE_RE.test(file))
      write(file, text, apply(apply(text, PATH_RULES), [CLI_RULE]))
  }
  for (const dir of CI_DIRS) {
    if (!existsSync(join(root, dir)))
      continue
    for (const name of readdirSync(join(root, dir)).sort()) {
      const file = `${dir}/${name}`
      const text = readFileSync(join(root, file), 'utf8')
      write(file, text, apply(apply(text, PATH_RULES), [CLI_RULE]))
    }
  }
  for (const file of sourceFiles(root)) {
    const text = readFileSync(join(root, file), 'utf8')
    const renamed = SOURCE_FILE_RE.test(file) ? renameKayNames(file, text) : text
    const next = apply(apply(renamed, PATH_RULES), WIRE_RULES)
    write(file, text, next)
    if (SOURCE_FILE_RE.test(file) && next !== text)
      checkImports(file, next, manual)
  }
  for (const dir of CACHE_DIRS) {
    if (existsSync(join(root, dir))) {
      rmSync(join(root, dir), { recursive: true, force: true })
      changed.push(`${dir}/`)
    }
  }
  // A member on neither kay nor prunelle, a plain Bun app or a tool, has nothing to move; one already on prunelle may keep names an earlier upgrade missed.
  for (const member of workspaceMembers(root).filter(m => onKayOrPrunelle(join(root, m)))) {
    const res = upgradeProject(join(root, member))
    changed.push(...res.changed.map(file => `${member}/${file}`))
    manual.push(...res.manual.map(line => `${member}/${line}`))
  }
  return { changed: changed.sort(), manual }
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const V1_RANGE_RE = /^[~^>=\s]*1\./

const KAY_OR_PRUNELLE_RE = /^(?:npm:)?(?:@kayjs\/|prunelle(?:@|$)|@prunellejs\/)/

function onKayOrPrunelle(root: string): boolean {
  const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
  return DEP_FIELDS.some(field => Object.entries(json[field] ?? {}).some(([name, range]) => KAY_OR_PRUNELLE_RE.test(name) || KAY_OR_PRUNELLE_RE.test(range)))
}

// kay's core at a 1.x range, as `@kayjs/kay` or an `npm:@kayjs/kay@` alias: an app of `.kay` files prunelle cannot take.
function kayV1Dependency(root: string): string | undefined {
  if (!existsSync(join(root, 'package.json')))
    return undefined
  const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(json[field] ?? {})) {
      if (name === '@kayjs/kay' && V1_RANGE_RE.test(range))
        return `${name}@${range}`
      if (range.startsWith('npm:@kayjs/kay@') && V1_RANGE_RE.test(range.slice('npm:@kayjs/kay@'.length)))
        return `${name}: ${range}`
    }
  }
  return undefined
}

// The folders the root package.json lists as `workspaces`, an array of globs or `{ packages }`.
function workspaceMembers(root: string): string[] {
  if (!existsSync(join(root, 'package.json')))
    return []
  const { workspaces } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { workspaces?: string[] | { packages?: string[] } }
  const patterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages ?? []
  const members = new Set<string>()
  for (const pattern of patterns) {
    for (const file of new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root })) {
      if (!file.split('/').includes('node_modules'))
        members.add(dirname(file))
    }
  }
  return [...members].sort()
}

function moveConfig(root: string, changed: string[], manual: string[]): void {
  if (!existsSync(join(root, 'kay.config.ts')))
    return
  if (existsSync(join(root, 'prunelle.config.ts'))) {
    manual.push('kay.config.ts:1: prunelle.config.ts exists too: merge kay.config.ts into it, then delete it.')
    return
  }
  renameSync(join(root, 'kay.config.ts'), join(root, 'prunelle.config.ts'))
  changed.push('kay.config.ts -> prunelle.config.ts')
}

function rootFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort()
}

// The entries of `dir`, none for a folder the user cannot read: a container's data, never source they edit.
function readableEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES' || (err as NodeJS.ErrnoException).code === 'EPERM')
      return []
    throw err
  }
}

// A folder holding its own package.json is another package, upgraded on its own.
function sourceFiles(root: string, dir = root, out: string[] = []): string[] {
  if (dir !== root && existsSync(join(dir, 'package.json')))
    return out
  for (const entry of readableEntries(dir)) {
    if (isNotSourceDir(entry.name))
      continue
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      sourceFiles(root, path, out)
    else if (SOURCE_FILE_RE.test(entry.name) || STYLE_OR_SCRIPT_RE.test(entry.name))
      out.push(relPosix(root, path))
  }
  return out.sort()
}

// Every `@prunellejs/*` package is released at prunelle's version, so they all move with it.
function upgradePackageJson(text: string): string {
  const json = JSON.parse(text) as Record<string, unknown>
  const indent = /^\{\n([ \t]+)"/.exec(text)?.[1] ?? '  '
  const before = JSON.stringify(json, null, indent)
  const range = `^${pkg.version}`
  for (const field of DEP_FIELDS) {
    const deps = json[field] as Record<string, string> | undefined
    if (deps === undefined || !Object.keys(deps).some(name => name.startsWith('@kayjs/')))
      continue
    const entries = Object.entries(deps).map(([name, version]) => name.startsWith('@kayjs/') ? [apply(name, PATH_RULES), range] : [name, version])
    json[field] = Object.fromEntries(entries.sort(([a], [b]) => a!.localeCompare(b!)))
  }
  const scripts = json.scripts as Record<string, string> | undefined
  if (scripts !== undefined)
    json.scripts = Object.fromEntries(Object.entries(scripts).map(([name, cmd]) => [name, apply(apply(cmd, PATH_RULES), [CLI_RULE])]))
  const after = JSON.stringify(json, null, indent)
  return after === before ? text : `${after}\n`
}

const exportCache = new Map<string, Set<string>>()

/** The names an entry of `prunelle` exports, read from its source. */
function exportsOf(file: string): Set<string> {
  let names = exportCache.get(file)
  if (names === undefined) {
    names = new Set()
    for (const stmt of parseTsx(file, readFileSync(file, 'utf8')).body) {
      if (stmt.type !== 'ExportNamedDeclaration')
        continue
      for (const spec of stmt.specifiers)
        names.add(spec.exported.type === 'Identifier' ? spec.exported.name : String(spec.exported.value))
      const decl = stmt.declaration
      if (decl?.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (d.id.type === 'Identifier')
            names.add(d.id.name)
        }
      }
      else if (decl !== null && 'id' in decl && decl.id?.type === 'Identifier') {
        names.add(decl.id.name)
      }
    }
    exportCache.set(file, names)
  }
  return names
}

// A name kay exported that prunelle no longer does is reported on the line importing it.
function checkImports(file: string, code: string, manual: string[]): void {
  for (const stmt of parseTsx(file, code).body) {
    if (stmt.type !== 'ImportDeclaration' || !PRUNELLE_SOURCE_RE.test(stmt.source.value))
      continue
    const line = code.slice(0, stmt.start).split('\n').length
    const entry = resolvePrunelleSpecifier(stmt.source.value)
    if (entry === undefined) {
      manual.push(`${file}:${line}: prunelle has no ${stmt.source.value} entry: import from prunelle, prunelle/server, prunelle/config or prunelle/test.`)
      continue
    }
    for (const spec of stmt.specifiers) {
      const name = spec.type === 'ImportSpecifier' ? (spec.imported.type === 'Identifier' ? spec.imported.name : String(spec.imported.value)) : undefined
      if (name !== undefined && !exportsOf(entry).has(name))
        manual.push(`${file}:${line}: ${stmt.source.value} does not export ${name}.`)
    }
  }
}
