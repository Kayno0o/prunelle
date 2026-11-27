import { afterAll, describe, expect, it, spyOn } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pkg from '../package.json' with { type: 'json' }
import { checkProject } from '../src/cli/check'
import { runCli } from '../src/cli/index'
import { upgradeProject } from '../src/cli/upgrade'

const tempDirs: string[] = []
function appWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'prunelle-upgrade-'))
  tempDirs.push(dir)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}
const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')
const lines = (...l: string[]): string => `${l.join('\n')}\n`

afterAll(() => {
  for (const d of tempDirs)
    rmSync(d, { recursive: true, force: true })
})

describe('prunelle upgrade moves a kay v2 app onto prunelle (#27)', () => {
  it('renames every @kayjs dependency at prunelle\'s version and the kay CLI in the scripts', () => {
    const dir = appWith({
      'package.json': `${JSON.stringify({
        name: 'app',
        scripts: { dev: 'kay dev', build: 'bunx @kayjs/kay build && echo okay', kayak: 'kayak paddle' },
        dependencies: { '@kayjs/kay': '^2.0.0-alpha.9', 'hono': '^4.0.0', '@kayjs/ui': '^2.0.0-alpha.9' },
        devDependencies: { '@kayjs/auth': '2.0.0-alpha.9' },
      }, null, '\t')}\n`,
    })
    expect(upgradeProject(dir)).toEqual({ changed: ['package.json'], manual: [] })
    expect(read(dir, 'package.json')).toBe(`${JSON.stringify({
      name: 'app',
      scripts: { dev: 'prunelle dev', build: 'bunx prunelle build && echo okay', kayak: 'kayak paddle' },
      dependencies: { '@prunelle/ui': `^${pkg.version}`, 'hono': '^4.0.0', 'prunelle': `^${pkg.version}` },
      devDependencies: { '@prunelle/auth': `^${pkg.version}` },
    }, null, '\t')}\n`)
  })

  it('moves kay.config.ts to prunelle.config.ts, and leaves both to the developer when both exist', () => {
    const dir = appWith({ 'kay.config.ts': 'export default {}\n' })
    expect(upgradeProject(dir)).toEqual({ changed: ['kay.config.ts -> prunelle.config.ts'], manual: [] })
    expect(read(dir, 'prunelle.config.ts')).toBe('export default {}\n')

    const both = appWith({ 'kay.config.ts': 'export default {}\n', 'prunelle.config.ts': 'export default { lang: \'fr\' }\n' })
    expect(upgradeProject(both)).toEqual({ changed: [], manual: ['kay.config.ts:1: prunelle.config.ts exists too: merge kay.config.ts into it, then delete it.'] })
    expect(existsSync(join(both, 'kay.config.ts'))).toBe(true)
  })

  it('rewrites the imports and every use of the names kay exported, leaving keys and the app\'s own names alone', () => {
    const dir = appWith({
      'src/app.ts': lines(
        'import type { KayPlugin as Plugin, KayConfig } from \'@kayjs/kay/config\'',
        'import { defineConfig } from "@kayjs/kay/config"',
        'import * as kay from \'@kayjs/kay/server\'',
        'import { seo } from \'@kayjs/seo\'',
        'const plugins: Plugin[] = [seo({ site: \'https://a.test\' })]',
        'export const config: KayConfig = defineConfig({ plugins })',
        'export const table = { KayConfig: 1 }',
        'export type Locals = import(\'@kayjs/kay/server\').KayLocals',
        'export type App = kay.KayApp',
        'const kayName = \'kay\'',
        'export const lazy = () => import(\'@kayjs/kay/test\')',
        'declare module \'@kayjs/kay/server\' { interface KayLocals { user?: string } }',
      ),
    })
    expect(upgradeProject(dir)).toEqual({ changed: ['src/app.ts'], manual: [] })
    expect(read(dir, 'src/app.ts')).toBe(lines(
      'import type { PrunellePlugin as Plugin, PrunelleConfig } from \'prunelle/config\'',
      'import { defineConfig } from "prunelle/config"',
      'import * as kay from \'prunelle/server\'',
      'import { seo } from \'@prunelle/seo\'',
      'const plugins: Plugin[] = [seo({ site: \'https://a.test\' })]',
      'export const config: PrunelleConfig = defineConfig({ plugins })',
      'export const table = { KayConfig: 1 }',
      'export type Locals = import(\'prunelle/server\').PrunelleLocals',
      'export type App = kay.PrunelleApp',
      'const kayName = \'kay\'',
      'export const lazy = () => import(\'prunelle/test\')',
      'declare module \'prunelle/server\' { interface PrunelleLocals { user?: string } }',
    ))
  })

  it('keeps the old name as an alias where the file exports it, uses it as a shorthand or already has the new one', () => {
    const dir = appWith({
      'src/types.ts': lines(
        'import type { KayPlugin, KayConfig, KayLocals } from \'@kayjs/kay/server\'',
        'export type { KayPlugin }',
        'export const names = { KayConfig }',
        'type PrunelleLocals = KayLocals',
        'export { KayApp, type KayPlugin as Plugin } from \'@kayjs/kay/server\'',
      ),
    })
    upgradeProject(dir)
    expect(read(dir, 'src/types.ts')).toBe(lines(
      'import type { PrunellePlugin as KayPlugin, PrunelleConfig as KayConfig, PrunelleLocals as KayLocals } from \'prunelle/server\'',
      'export type { KayPlugin }',
      'export const names = { KayConfig }',
      'type PrunelleLocals = KayLocals',
      'export { PrunelleApp as KayApp, type PrunellePlugin as Plugin } from \'prunelle/server\'',
    ))
  })

  it('renames the names the browser receives in scripts and styles', () => {
    const dir = appWith({
      'src/nav.ts': lines(
        'document.addEventListener(\'kay:navigate\', () => fetch(\'/_kay/dev-events\', { headers: { \'X-Kay-Region\': \'main\' } }))',
        'export const consent = document.cookie.includes(\'kay_consent\')',
      ),
      'src/styles/app.css': 'kay-island[data-kay-hydrate], kay-s { display: block }\n.kayak { color: red }\n',
    })
    expect(upgradeProject(dir).changed).toEqual(['src/nav.ts', 'src/styles/app.css'])
    expect(read(dir, 'src/nav.ts')).toBe(lines(
      'document.addEventListener(\'pru:navigate\', () => fetch(\'/_pru/dev-events\', { headers: { \'x-pru-Region\': \'main\' } }))',
      'export const consent = document.cookie.includes(\'pru_consent\')',
    ))
    expect(read(dir, 'src/styles/app.css')).toBe('pru-island[data-pru-hydrate], pru-s { display: block }\n.kayak { color: red }\n')
  })

  it('renames the package, the CLI and its folders in the config, build and CI files, and removes the kay caches', () => {
    const dir = appWith({
      'tsconfig.json': '{\n  // kept\n  "compilerOptions": { "jsxImportSource": "@kayjs/kay", "types": ["@kayjs/kay/ambient"] }\n}\n',
      '.gitignore': 'dist\n.kay-cache\n.kay-dev\n',
      'Dockerfile': 'FROM oven/bun\nCOPY kay.config.ts .\nRUN bunx kay build\nCMD ["bunx", "kay", "start"]\n',
      'Justfile': 'dev:\n  bun kay dev\n',
      '.forgejo/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: bunx kay check\n',
      '.kay-cache/server/index.js': '',
    })
    expect(upgradeProject(dir).changed).toEqual(['.forgejo/workflows/ci.yml', '.gitignore', '.kay-cache/', 'Dockerfile', 'Justfile', 'tsconfig.json'])
    expect(read(dir, 'tsconfig.json')).toBe('{\n  // kept\n  "compilerOptions": { "jsxImportSource": "prunelle", "types": ["prunelle/ambient"] }\n}\n')
    expect(read(dir, '.gitignore')).toBe('dist\n.prunelle-cache\n.prunelle-dev\n')
    expect(read(dir, 'Dockerfile')).toBe('FROM oven/bun\nCOPY prunelle.config.ts .\nRUN bunx prunelle build\nCMD ["bunx", "prunelle", "start"]\n')
    expect(read(dir, 'Justfile')).toBe('dev:\n  bun prunelle dev\n')
    expect(read(dir, '.forgejo/workflows/ci.yml')).toBe('jobs:\n  test:\n    steps:\n      - run: bunx prunelle check\n')
    expect(existsSync(join(dir, '.kay-cache'))).toBe(false)
  })

  it('names each import prunelle cannot serve, with its line', () => {
    const dir = appWith({
      'src/server.ts': lines(
        'import { signal } from \'@kayjs/kay\'',
        'import { loadConfig, nodeEnv } from \'@kayjs/kay/server\'',
        'import { mount } from \'@kayjs/kay/dom\'',
      ),
    })
    expect(upgradeProject(dir).manual).toEqual([
      'src/server.ts:2: prunelle/server does not export loadConfig.',
      'src/server.ts:3: prunelle has no prunelle/dom entry: import from prunelle, prunelle/server, prunelle/config or prunelle/test.',
    ])
  })

  it('takes a kay v2 app to a passing prunelle check', async () => {
    const dir = appWith({
      'package.json': `${JSON.stringify({ name: 'app', dependencies: { '@kayjs/kay': '^2.0.0-alpha.9' } }, null, 2)}\n`,
      'kay.config.ts': 'import type { KayPlugin } from \'@kayjs/kay/config\'\nimport { defineConfig } from \'@kayjs/kay/config\'\nconst plugins: KayPlugin[] = []\nexport default defineConfig({ lang: \'fr\', plugins })\n',
      'src/actions/notes.ts': 'import { action } from \'@kayjs/kay/server\'\nexport const save = action(async () => ({ ok: true }))\n',
      'src/routes/index.tsx': 'import { signal } from \'@kayjs/kay\'\nimport { save } from \'../actions/notes\'\nfunction Counter() { const n = signal(0); return <button type="button" onClick={() => n.value++}>{n.value}</button> }\nexport default function Home() { return <main><Counter /><form action={save} method="post"><button>Save</button></form></main> }\n',
    })
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    symlinkSync(join(import.meta.dir, '..'), join(dir, 'node_modules/prunelle'), 'dir')

    const out: string[] = []
    const log = spyOn(console, 'log').mockImplementation((line: string) => out.push(line))
    try {
      expect(await runCli(['upgrade', dir, '--no-install'])).toBe(0)
    }
    finally {
      log.mockRestore()
    }
    expect(out).toEqual([
      '  kay.config.ts -> prunelle.config.ts',
      '  package.json',
      '  prunelle.config.ts',
      '  src/actions/notes.ts',
      '  src/routes/index.tsx',
      'prunelle upgrade rewrote 5 files',
      'Signed-in users sign in again and visitors answer the cookie banner again: prunelle names its cookies pru_session and pru_consent.',
      'Next: prunelle check',
    ])
    expect(await checkProject(dir, { skipTypecheck: true })).toMatchObject({ ok: true, errors: [] })
  })

  it('leaves node_modules, dist, nested packages and an app already on prunelle untouched', () => {
    const dir = appWith({
      'starters/old/package.json': '{}\n',
      'starters/old/src/index.ts': 'import { signal } from \'@kayjs/kay\'\n',
      'node_modules/lib/index.ts': 'import { signal } from \'@kayjs/kay\'\n',
      'dist/types/index.ts': 'import { signal } from \'@kayjs/kay\'\n',
      '.cache/kay/index.ts': 'import { signal } from \'@kayjs/kay\'\n',
      'package.json': `${JSON.stringify({ name: 'app', dependencies: { prunelle: '^0.1.0' } })}\n`,
      'src/index.ts': 'import { signal } from \'prunelle\'\nexport const okay = signal(\'kay\')\n',
    })
    expect(upgradeProject(dir)).toEqual({ changed: [], manual: [] })
    expect(read(dir, 'node_modules/lib/index.ts')).toBe('import { signal } from \'@kayjs/kay\'\n')
  })
})
