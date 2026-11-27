// Resolves an import the way prunelle build follows it: relative files, then packages through Bun's resolver; prunelle, node:, bun and ~ aliases stay unresolved.

import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import pkg from '../../package.json' with { type: 'json' }

export const PRUNELLE_SRC_ROOT = resolve(import.meta.dir, '..')


export function resolveImportPath(fromFile: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) {
    const base = resolve(dirname(fromFile), specifier)
    const candidates = [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]
    for (const c of candidates) {
      if (statSync(c, { throwIfNoEntry: false })?.isFile())
        return c
    }
    return undefined
  }
  if (
    specifier === 'prunelle'
    || specifier.startsWith('prunelle/')
    || specifier.startsWith('node:')
    || specifier === 'bun'
    || specifier.startsWith('bun:')
    || specifier.startsWith('~')
  ) {
    return undefined
  }
  try {
    const resolved = Bun.resolveSync(specifier, dirname(fromFile))
    return resolved.endsWith('.tsx') || resolved.endsWith('.ts') ? resolved : undefined
  }
  catch {
    return undefined
  }
}

const PRUNELLE_SPECIFIER_FILES = new Map<string, string>(
  Object.entries(pkg.exports as Record<string, string>).map(([subpath, target]) => [
    subpath === '.' ? 'prunelle' : `prunelle/${subpath.slice(2)}`,
    target.replace(/^\.\/src\//, ''),
  ]),
)

/** Maps `prunelle` and its subpaths to their source file. */
export function resolvePrunelleSpecifier(specifier: string): string | undefined {
  const file = PRUNELLE_SPECIFIER_FILES.get(specifier)
  return file === undefined ? undefined : join(PRUNELLE_SRC_ROOT, file)
}
