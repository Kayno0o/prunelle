// `prunelle new <name> [--template minimal|fullstack|blog|app] [--force]` project scaffolder: copies `templates/_shared` and `templates/<template>`.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import pkg from '../../package.json' with { type: 'json' }
import { isNotSourceDir, relPosix, walkFiles } from '../build/files'

export type ScaffoldTemplate = 'minimal' | 'fullstack' | 'blog' | 'app'

export interface ScaffoldOptions {
  template?: ScaffoldTemplate | undefined
  force?: boolean | undefined
  prunelleVersion?: string | undefined
}

const TEMPLATES_DIR = join(import.meta.dir, '../../templates')

// npm leaves dotfiles like `.gitignore` out of a package, so the template stores them without the leading dot.
const RENAMED: Record<string, string> = { 'gitignore': '.gitignore', 'mcp.json': '.mcp.json' }

export function scaffoldProject(targetDir: string, options: ScaffoldOptions = {}): { root: string, files: string[] } {
  const root = resolve(targetDir)
  const name = basename(root).toLowerCase().replace(/[^a-z0-9-_]/g, '-') || 'prunelle-app'
  const template: ScaffoldTemplate = options.template ?? 'minimal'
  const prunelleVersion = options.prunelleVersion ?? `^${pkg.version}`

  if (existsSync(root) && readdirSync(root).length > 0 && !options.force)
    throw new Error(`prunelle new: directory "${root}" is not empty (pass --force to overwrite)`)

  const written: string[] = []
  for (const dir of [join(TEMPLATES_DIR, '_shared'), join(TEMPLATES_DIR, template)]) {
    for (const abs of walkFiles(dir, { skipDir: isNotSourceDir, keep: entry => entry.isFile() })) {
      const rel = RENAMED[relPosix(dir, abs)] ?? relPosix(dir, abs)
      const text = readFileSync(abs, 'utf8').replaceAll('__APP_NAME__', name).replaceAll('__PRUNELLE_VERSION__', prunelleVersion)
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), text)
      written.push(rel)
    }
  }
  return { root, files: written }
}
