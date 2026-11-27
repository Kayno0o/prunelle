import type { TaskDefinition, TaskSpec } from './types'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import prunellePkg from '../../packages/prunelle/package.json' with { type: 'json' }
import { scaffoldProject } from '../../packages/prunelle/src/cli/new'

export const REPO_ROOT = resolve(import.meta.dir, '../..')
export const PACKAGES_DIR = join(REPO_ROOT, 'packages')
export const PRUNELLE_CLI_ENTRY = join(PACKAGES_DIR, 'prunelle/src/cli/index.ts')

// Each package name and its folder under packages/.
export const WORKSPACE_PACKAGES: Record<string, string> = {
  'prunelle': 'prunelle',
  '@prunellejs/auth': 'plugin-auth',
  '@prunellejs/content': 'plugin-content',
  '@prunellejs/i18n': 'plugin-i18n',
  '@prunellejs/icons': 'plugin-icons',
  '@prunellejs/images': 'plugin-images',
  '@prunellejs/live': 'plugin-live',
  '@prunellejs/mail': 'plugin-mail',
  '@prunellejs/mcp': 'plugin-mcp',
  '@prunellejs/seo': 'plugin-seo',
  '@prunellejs/spa': 'plugin-spa',
  '@prunellejs/tailwind': 'plugin-tailwind',
  '@prunellejs/ui': 'ui',
}

const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(kb|b)?$/i

export function parseSizeBytes(raw: string): number {
  const match = SIZE_RE.exec(raw.trim())
  if (match === null)
    throw new Error(`evals: invalid size "${raw}" (expected e.g. "0kb", "15kb", or "4096")`)
  const unit = match[2]?.toLowerCase()
  const mult = unit === 'kb' ? 1024 : 1
  return Math.round(Number(match[1]) * mult)
}

function replaceSymlink(target: string, linkPath: string, type: 'dir' | 'file' = 'dir'): void {
  if (existsSync(linkPath) || isDanglingSymlink(linkPath))
    rmSync(linkPath, { recursive: true, force: true })
  symlinkSync(target, linkPath, type)
}

function isDanglingSymlink(path: string): boolean {
  try {
    lstatSync(path)
    return true
  }
  catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

/**
 * Links `prunelle`, the local `@prunellejs/*` workspace packages and monorepo dev tooling (`@types`,
 * `typescript`, `@kaynooo`, `oxc-parser`, `.bin/prunelle`, `.bin/tsc`) into `destDir/node_modules`.
 */
export function linkWorkspacePackages(destDir: string): void {
  const root = resolve(destDir)
  const nm = join(root, 'node_modules')
  const binDir = join(nm, '.bin')
  mkdirSync(join(nm, '@prunellejs'), { recursive: true })
  mkdirSync(binDir, { recursive: true })

  for (const [pkgName, folder] of Object.entries(WORKSPACE_PACKAGES)) {
    const src = join(PACKAGES_DIR, folder)
    if (existsSync(src))
      replaceSymlink(src, join(nm, pkgName), 'dir')
  }

  const rootNm = join(REPO_ROOT, 'node_modules')
  for (const dep of ['@types', '@kaynooo', 'typescript', 'oxc-parser']) {
    const src = join(rootNm, dep)
    if (existsSync(src))
      replaceSymlink(src, join(nm, dep), 'dir')
  }

  replaceSymlink(PRUNELLE_CLI_ENTRY, join(binDir, 'prunelle'), 'file')
  const rootTsc = join(rootNm, '.bin/tsc')
  if (existsSync(rootTsc))
    replaceSymlink(rootTsc, join(binDir, 'tsc'), 'file')
}

function syncPackageDependencies(destDir: string, spec: TaskSpec): void {
  const pkgPath = join(destDir, 'package.json')
  if (!existsSync(pkgPath))
    return
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>
    [k: string]: unknown
  }
  const deps: Record<string, string> = { ...(pkg.dependencies ?? {}) }
  const version = `^${prunellePkg.version}`
  for (const name of spec.packages)
    deps[name] = deps[name] ?? version
  pkg.dependencies = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

export interface InitWorkspaceResult {
  dir: string
  task: TaskSpec
  promptPath: string
  files: string[]
}

export function initTaskWorkspace(
  task: TaskDefinition,
  destDir: string,
  options: { force?: boolean } = {},
): InitWorkspaceResult {
  const root = resolve(destDir)
  const scaffolded = scaffoldProject(root, {
    template: task.spec.template,
    force: options.force,
    prunelleVersion: `^${prunellePkg.version}`,
  })
  syncPackageDependencies(root, task.spec)
  linkWorkspacePackages(root)
  const copiedPrompt = join(root, 'TASK.md')
  copyFileSync(task.promptPath, copiedPrompt)
  return {
    dir: root,
    task: task.spec,
    promptPath: copiedPrompt,
    files: [...scaffolded.files, 'TASK.md'],
  }
}
