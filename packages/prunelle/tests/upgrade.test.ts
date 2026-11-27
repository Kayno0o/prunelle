import { afterAll, describe, expect, it, spyOn } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
        dependencies: { '@kayjs/kay': '^2.1.0', 'hono': '^4.0.0', '@kayjs/ui': '^2.0.0-alpha.9' },
        devDependencies: { '@kayjs/auth': '2.0.0-alpha.9' },
      }, null, '\t')}\n`,
    })
    expect(upgradeProject(dir)).toEqual({ changed: ['package.json'], manual: [] })
    expect(read(dir, 'package.json')).toBe(`${JSON.stringify({
      name: 'app',
      scripts: { dev: 'prunelle dev', build: 'bunx prunelle build && echo okay', kayak: 'kayak paddle' },
      dependencies: { '@prunellejs/ui': `^${pkg.version}`, 'hono': '^4.0.0', 'prunelle': `^${pkg.version}` },
      devDependencies: { '@prunellejs/auth': `^${pkg.version}` },
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
      'import { seo } from \'@prunellejs/seo\'',
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
      'Dockerfile': 'FROM oven/bun\n# kay v2 binds 127.0.0.1.\nCOPY kay.config.ts .\nRUN bunx kay build\nCMD ["bunx", "kay", "start"]\n',
      'Justfile': 'dev:\n  bun kay dev\n',
      '.forgejo/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: bunx kay check\n',
      '.kay-cache/server/index.js': '',
    })
    expect(upgradeProject(dir).changed).toEqual(['.forgejo/workflows/ci.yml', '.gitignore', '.kay-cache/', 'Dockerfile', 'Justfile', 'tsconfig.json'])
    expect(read(dir, 'tsconfig.json')).toBe('{\n  // kept\n  "compilerOptions": { "jsxImportSource": "prunelle", "types": ["prunelle/ambient"] }\n}\n')
    expect(read(dir, '.gitignore')).toBe('dist\n.prunelle-cache\n.prunelle-dev\n')
    expect(read(dir, 'Dockerfile')).toBe('FROM oven/bun\n# prunelle binds 127.0.0.1.\nCOPY prunelle.config.ts .\nRUN bunx prunelle build\nCMD ["bunx", "prunelle", "start"]\n')
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

  it('upgrades each package a bun workspace lists, from its root', () => {
    const kayDeps = (field: string) => `${JSON.stringify({ name: 'member', [field]: { '@kayjs/kay': '^2.0.0-beta.8' } })}\n`
    const legacy = `${JSON.stringify({ name: 'legacy', scripts: { dev: 'kay dev' }, dependencies: { kay: 'npm:@kayjs/kay@~1.112.2' } })}\n`
    const dir = appWith({
      'package.json': `${JSON.stringify({ name: 'mono', private: true, workspaces: ['apps/**', 'shell/', 'legacy', 'plain'] })}\n`,
      'legacy/package.json': legacy,
      'plain/package.json': `${JSON.stringify({ name: 'plain', devDependencies: { '@types/bun': '^1.4.4' } })}\n`,

      'plain/compose.yaml': '# Not in .env.example, which kay check would refuse.\n',
      'legacy/kay.config.ts': 'export default {}\n',
      'tsconfig.json': '{ "compilerOptions": { "jsxImportSource": "@kayjs/kay" } }\n',
      'apps/web/package.json': kayDeps('dependencies'),
      'apps/web/kay.config.ts': 'export default {}\n',
      'apps/web/src/index.ts': 'import { signal, gone } from \'@kayjs/kay\'\nexport const n = signal(gone)\n',
      'apps/web/node_modules/dep/package.json': kayDeps('dependencies'),
      'shell/package.json': kayDeps('peerDependencies'),
      'tools/package.json': kayDeps('dependencies'),
    })
    expect(upgradeProject(dir)).toEqual({
      changed: ['apps/web/kay.config.ts -> prunelle.config.ts', 'apps/web/package.json', 'apps/web/src/index.ts', 'shell/package.json', 'tsconfig.json'],
      manual: ['apps/web/src/index.ts:1: prunelle does not export gone.', 'legacy/package.json:1: kay: npm:@kayjs/kay@~1.112.2 is kay v1: prunelle upgrade moves kay v2 apps, so this one is left as it is.'],
    })
    expect(read(dir, 'legacy/package.json')).toBe(legacy)
    expect(existsSync(join(dir, 'legacy/kay.config.ts'))).toBe(true)
    expect(JSON.parse(read(dir, 'shell/package.json')).peerDependencies).toEqual({ prunelle: `^${pkg.version}` })
    expect(read(dir, 'apps/web/src/index.ts')).toBe('import { signal, gone } from \'prunelle\'\nexport const n = signal(gone)\n')
    expect(read(dir, 'tools/package.json')).toBe(kayDeps('dependencies'))
    expect(read(dir, 'plain/compose.yaml')).toBe('# Not in .env.example, which kay check would refuse.\n')
    expect(read(dir, 'apps/web/node_modules/dep/package.json')).toBe(kayDeps('dependencies'))
  })

  it('installs at the root when an app\'s or only a workspace package\'s dependencies changed', async () => {
    const kayDeps = `${JSON.stringify({ name: 'web', dependencies: { '@kayjs/kay': '^2.0.0-beta.8' } })}\n`
    const app = appWith({ 'package.json': kayDeps })
    const mono = appWith({
      'package.json': `${JSON.stringify({ name: 'mono', workspaces: { packages: ['web'] } })}\n`,
      'web/package.json': kayDeps,
    })
    const spawn = spyOn(Bun, 'spawnSync').mockImplementation(() => ({ exitCode: 0 }) as unknown as ReturnType<typeof Bun.spawnSync>)
    const log = spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(await runCli(['upgrade', app])).toBe(0)
      expect(await runCli(['upgrade', mono])).toBe(0)
      expect(spawn.mock.calls.map(([cmd, opts]) => [cmd, (opts as { cwd: string }).cwd])).toEqual([[['bun', 'install'], app], [['bun', 'install'], mono]])
    }
    finally {
      spawn.mockRestore()
      log.mockRestore()
    }
  })

  it('leaves an app on kay v1 as it is, saying why', () => {
    const pkgJson = `${JSON.stringify({ name: 'old', dependencies: { '@kayjs/ui': '1.104.0', '@kayjs/kay': '^1.104.0' } })}\n`
    const dir = appWith({ 'package.json': pkgJson, 'src/app.ts': 'import { signal } from \'@kayjs/kay\'\n' })
    expect(upgradeProject(dir)).toEqual({ changed: [], manual: ['package.json:1: @kayjs/kay@^1.104.0 is kay v1: prunelle upgrade moves kay v2 apps, so this one is left as it is.'] })
    expect(read(dir, 'src/app.ts')).toBe('import { signal } from \'@kayjs/kay\'\n')
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

  it('steps over a folder it cannot read, such as a container\'s data, and upgrades the rest', () => {
    const dir = appWith({
      'package.json': `${JSON.stringify({ name: 'app', dependencies: { '@kayjs/kay': '^2.1.0' } })}\n`,
      'data-prod/db.sqlite': '',
      'src/index.ts': 'import { signal } from \'@kayjs/kay\'\n',
    })
    chmodSync(join(dir, 'data-prod'), 0o000)
    try {
      expect(upgradeProject(dir).changed).toEqual(['package.json', 'src/index.ts'])
    }
    finally {
      chmodSync(join(dir, 'data-prod'), 0o755)
    }
  })
})
