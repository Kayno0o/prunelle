// End-to-end tests for the built-in `a11y()` plugin, axe-core + Chromium route audit, RGAA 4.1 mapping, and accessibility declaration drafter (#18).

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { a11y, auditAccessibility, draftAccessibilityStatement, formatA11yReport, rgaaCriteriaForAxeRule } from '../src/a11y/index'
import { build } from '../src/build/index'
import { checkProject } from '../src/cli/check'
import { runCli } from '../src/cli/index'

const PRUNELLE_PKG_DIR = resolve(import.meta.dir, '..')

function makeTempApp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(join(dir, 'src/routes'), { recursive: true })
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  symlinkSync(PRUNELLE_PKG_DIR, join(dir, 'node_modules/prunelle'), 'dir')
  return dir
}

function readAllFiles(dir: string): string[] {
  if (!existsSync(dir))
    return []
  const out: string[] = []
  for (const ent of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (ent.isFile())
      out.push(join(ent.parentPath, ent.name))
  }
  return out
}

describe('a11y plugin, RGAA 4.1 audit & declaration draft (#18)', () => {
  let appDir: string

  beforeAll(() => {
    appDir = makeTempApp('prunelle-a11y-e2e-')

    writeFileSync(join(appDir, 'prunelle.config.ts'), `
import { a11y, defineConfig } from 'prunelle/config'

export default defineConfig({
  lang: 'fr',
  site: 'https://exemple.fr',
  compliance: {
    publicBody: true,
    legalNotice: false,
  },
  plugins: [a11y({ organization: 'Mairie Exemple', contactEmail: 'a11y@exemple.fr' })],
})
`)

    // Interactive island to ensure dist/client/ emits JS chunks and never bundles a11y/axe-core/playwright-core
    mkdirSync(join(appDir, 'src/components'), { recursive: true })
    writeFileSync(join(appDir, 'src/components/Counter.tsx'), `
import { signal } from 'prunelle'

export function Counter() {
  const count = signal(0)
  return <button type="button" onClick={() => count.value++}>Compteur : {count.value}</button>
}
`)

    // Clean, accessible prerendered route (0 axe-core violations)
    writeFileSync(join(appDir, 'src/routes/index.tsx'), `
import { Head } from 'prunelle'
import { Counter } from '../components/Counter'

export const prerender = true

export default function Home() {
  return (
    <>
      <Head>
        <title>Accueil — Exemple</title>
      </Head>
      <main>
        <h1>Bienvenue sur le site</h1>
        <p>Une page accessible conforme aux vérifications automatisées.</p>
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="Illustration de bienvenue" />
        <Counter />
      </main>
    </>
  )
}
`)

    // Intentionally inaccessible prerendered route (missing img alt, empty button name, unlabeled input)
    writeFileSync(join(appDir, 'src/routes/broken.tsx'), `
import { Head } from 'prunelle'

export const prerender = true

export default function Broken() {
  return (
    <>
      <Head>
        <title>Page avec défauts</title>
      </Head>
      <main>
        <h1>Page défectueuse</h1>
        {/* prunelle-ignore rgaa/img-alt */}
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" />
        {/* prunelle-ignore rgaa/accessible-name */}
        <button type="button"></button>
        {/* prunelle-ignore rgaa/form-label */}
        <input type="text" name="email" />
      </main>
    </>
  )
}
`)
  })

  afterAll(() => {
    rmSync(appDir, { recursive: true, force: true })
  })

  it('maps common axe-core rules and prefix families to French RGAA 4.1 criteria', () => {
    expect(rgaaCriteriaForAxeRule('image-alt').map(c => c.id)).toEqual(['1.1'])
    expect(rgaaCriteriaForAxeRule('color-contrast').map(c => c.id)).toEqual(['3.2'])
    expect(rgaaCriteriaForAxeRule('html-has-lang').map(c => c.id)).toEqual(['8.3'])
    expect(rgaaCriteriaForAxeRule('document-title').map(c => c.id)).toEqual(['8.5'])
    expect(rgaaCriteriaForAxeRule('heading-order').map(c => c.id)).toEqual(['9.1'])
    expect(rgaaCriteriaForAxeRule('landmark-one-main').map(c => c.id)).toEqual(['9.2'])
    expect(rgaaCriteriaForAxeRule('label').map(c => c.id)).toEqual(['11.1'])
    expect(rgaaCriteriaForAxeRule('link-name').map(c => c.id)).toContain('6.1')
    expect(rgaaCriteriaForAxeRule('button-name').map(c => c.id)).toEqual(['7.1'])
    expect(rgaaCriteriaForAxeRule('aria-valid-attr-value').map(c => c.id)).toEqual(['7.1'])
    expect(rgaaCriteriaForAxeRule('frame-title').map(c => c.id)).toEqual(['2.1'])
    expect(rgaaCriteriaForAxeRule('td-headers-attr').map(c => c.id)).toEqual(['5.7'])
    expect(rgaaCriteriaForAxeRule('bypass').map(c => c.id)).toEqual(['12.7'])
    expect(rgaaCriteriaForAxeRule('meta-viewport').map(c => c.id)).toEqual(['10.4'])
  })

  it('audits prerendered routes with axe-core in Chromium, reports clean vs broken routes with RGAA 4.1 criteria', async () => {
    const report = await auditAccessibility({ root: appDir })

    expect(report.ok).toBe(false)
    expect(report.routes.map(r => r.route)).toEqual(['/', '/broken'])

    const home = report.routes.find(r => r.route === '/')!
    expect(home.violations).toEqual([])
    expect(home.passes).toBeGreaterThan(0)
    expect(home.pageErrors).toEqual([])

    const broken = report.routes.find(r => r.route === '/broken')!
    const ruleIds = broken.violations.map(v => v.id)
    expect(ruleIds).toContain('image-alt')
    expect(ruleIds).toContain('button-name')
    expect(ruleIds).toContain('label')

    const imgViolation = broken.violations.find(v => v.id === 'image-alt')!
    expect(imgViolation.rgaa.map(c => c.id)).toEqual(['1.1'])
    expect(imgViolation.nodes.length).toBe(1)

    const btnViolation = broken.violations.find(v => v.id === 'button-name')!
    expect(btnViolation.rgaa.map(c => c.id)).toEqual(['7.1'])

    const labelViolation = broken.violations.find(v => v.id === 'label')!
    expect(labelViolation.rgaa.map(c => c.id)).toEqual(['11.1'])

    const formatted = formatA11yReport(report)
    expect(formatted).toContain('✓ / (0 violations')
    expect(formatted).toContain('✗ /broken')
    expect(formatted).toContain('RGAA 1.1')
    expect(formatted).toContain('RGAA 7.1')
    expect(formatted).toContain('RGAA 11.1')
  }, 60_000)

  it('drafts an editable RGAA 4.1.2 declaration page that satisfies prunelle check with zero errors and zero RGAA warnings', async () => {
    const draftDir = makeTempApp('prunelle-a11y-draft-')
    try {
      writeFileSync(join(draftDir, 'prunelle.config.ts'), `
import { a11y, defineConfig } from 'prunelle/config'

export default defineConfig({
  lang: 'fr',
  site: 'https://mairie.exemple.fr',
  compliance: {
    publicBody: true,
    legalNotice: false,
  },
  plugins: [a11y()],
})
`)
      writeFileSync(join(draftDir, 'src/routes/index.tsx'), `
import { Head } from 'prunelle'

export const prerender = true

export default function Home() {
  return (
    <>
      <Head><title>Accueil</title></Head>
      <main><h1>Accueil</h1><p>Contenu principal.</p></main>
    </>
  )
}
`)

      // Before drafting, publicBody: true warns about missing rgaa/accessibility-statement
      const before = await checkProject(draftDir, { skipTypecheck: true })
      expect(before.ok).toBe(true)
      expect(before.warnings.some(w => w.includes('rgaa/accessibility-statement'))).toBe(true)

      const audit = await auditAccessibility({ root: draftDir })
      expect(audit.ok).toBe(true)

      const drafted = draftAccessibilityStatement({
        root: draftDir,
        report: audit,
        organization: 'Mairie Exemple',
        siteUrl: 'https://mairie.exemple.fr',
        contactEmail: 'accessibilite@mairie.exemple.fr',
      })

      expect(drafted.relativePath).toBe('src/routes/accessibilite.tsx')
      expect(drafted.status).toBe('partial')
      expect(existsSync(drafted.path)).toBe(true)
      expect(drafted.content).toContain('<Head>')
      expect(drafted.content).toContain('Déclaration d\'accessibilité')
      expect(drafted.content).toContain('État de conformité')
      expect(drafted.content).toContain('partiellement conforme')
      expect(drafted.content).toContain('Résultats des tests')
      expect(drafted.content).toContain('Contenus non accessibles')
      expect(drafted.content).toContain('Établissement de cette déclaration d\'accessibilité')
      expect(drafted.content).toContain('Retour d\'information et contact')
      expect(drafted.content).toContain('Voies de recours')
      expect(drafted.content).toContain('Défenseur des droits')
      expect(drafted.content).toContain('Mairie Exemple')

      // After drafting, prunelle check reports 0 errors and 0 RGAA warnings!
      const after = await checkProject(draftDir, { skipTypecheck: true })
      expect(after.errors).toEqual([])
      expect(after.warnings).toEqual([])

      // Auditing the app again now includes the generated /accessibilite page and it passes axe-core cleanly!
      const postAudit = await auditAccessibility({ root: draftDir })
      expect(postAudit.ok).toBe(true)
      expect(postAudit.routes.map(r => r.route)).toEqual(['/', '/accessibilite'])
    }
    finally {
      rmSync(draftDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('registers the `a11y` plugin CLI command and supports --routes, --json, --draft, and non-zero exit on violations', async () => {
    const plugin = a11y()
    expect(plugin.name).toBe('prunelle:a11y')
    expect(typeof plugin.commands?.a11y).toBe('function')

    // Auditing only the clean `/` route exits 0
    const cleanCode = await runCli(['a11y', '--routes', '/'], { cwd: appDir })
    expect(cleanCode).toBe(0)

    // Auditing `/broken` exits 1 when violations exist
    const brokenCode = await runCli(['a11y', '--routes', '/broken'], { cwd: appDir })
    expect(brokenCode).toBe(1)

    // Auditing `/broken` with --no-fail exits 0
    const noFailCode = await runCli(['a11y', '--routes', '/broken', '--no-fail'], { cwd: appDir })
    expect(noFailCode).toBe(0)

    // Auditing with --draft writes the declaration and exits 0 even when violations exist
    const draftRel = 'src/routes/declaration-cli.tsx'
    const draftCode = await runCli(['a11y', '--routes', '/broken', '--draft', draftRel], { cwd: appDir })
    expect(draftCode).toBe(0)
    const draftFile = join(appDir, draftRel)
    expect(existsSync(draftFile)).toBe(true)
    const draftSource = readFileSync(draftFile, 'utf8')
    expect(draftSource).toContain('non conforme')
    expect(draftSource).toContain('RGAA 1.1')
    expect(draftSource).toContain('/broken')
    rmSync(draftFile, { force: true })
  }, 60_000)

  it('never bundles axe-core or playwright-core into dist/client/ or dist/server/', async () => {
    const outDir = join(appDir, 'dist-bundle-check')
    try {
      await build({ root: appDir, outDir })

      const clientFiles = readAllFiles(join(outDir, 'client'))
      expect(clientFiles.some(f => f.endsWith('.js'))).toBe(true)
      for (const file of clientFiles) {
        const text = readFileSync(file, 'utf8')
        expect(text).not.toContain('axe-core')
        expect(text).not.toContain('playwright-core')
        expect(text).not.toContain('auditAccessibility')
      }

      const serverJsFiles = readAllFiles(join(outDir, 'server')).filter(f => f.endsWith('.js'))
      expect(serverJsFiles.length).toBeGreaterThan(0)
      for (const file of serverJsFiles) {
        const text = readFileSync(file, 'utf8')
        expect(text).not.toContain('playwright-core')
        expect(text).not.toContain('axe.min.js')
        expect(text).not.toMatch(/from\s+["']axe-core["']/)
        expect(text).not.toMatch(/from\s+["']@kaynooo\/cli-kit["']/)
      }
    }
    finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 60_000)
})
