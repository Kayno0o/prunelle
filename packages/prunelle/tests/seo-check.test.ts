import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seo } from '../../plugin-seo/src/index'
import { build } from '../src/build/index'
import { checkProject, diagnosticData } from '../src/cli/check'

const PRUNELLE_PKG_DIR = join(import.meta.dir, '..')
const SEO_PKG_DIR = join(import.meta.dir, '../../plugin-seo')

const tempDirs: string[] = []
function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function linkPackages(dir: string): void {
  mkdirSync(join(dir, 'node_modules/@prunellejs'), { recursive: true })
  symlinkSync(PRUNELLE_PKG_DIR, join(dir, 'node_modules/prunelle'), 'dir')
  symlinkSync(SEO_PKG_DIR, join(dir, 'node_modules/@prunellejs/seo'), 'dir')
}

function runSeoCheck(dir: string, options: Parameters<typeof seo>[0] = {}): { errors: string[], warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const plugin = seo(options)
  plugin.check!({
    root: dir,
    routesDir: join(dir, 'src/routes'),
    error: msg => errors.push(msg),
    warn: msg => warnings.push(msg),
  })
  return { errors, warnings }
}

afterAll(() => {
  for (const d of tempDirs)
    rmSync(d, { recursive: true, force: true })
})

describe('@prunellejs/seo prunelle check diagnostics (#15)', () => {
  it('warns on missing site unless configured in seo({ site }) or top-level prunelle.config.ts', () => {
    const dir = makeTemp('prunelle-seo-site-')
    mkdirSync(join(dir, 'src/routes'), { recursive: true })
    writeFileSync(join(dir, 'src/routes/index.tsx'), `
      import { Head } from 'prunelle'
      export default function Home() {
        return <Head><title>Home</title><meta name="description" content="Home page." /></Head>
      }
    `)

    // Neither seo({ site }) nor prunelle.config.ts site
    const missing = runSeoCheck(dir)
    expect(missing.warnings.some(w => w.includes('[seo/missing-site]'))).toBe(true)
    // Missing share image does NOT fire when site is unset
    expect(missing.warnings.some(w => w.includes('[seo/missing-image]'))).toBe(false)

    // Nested `site` inside another plugin option must NOT fool top-level detection
    writeFileSync(join(dir, 'prunelle.config.ts'), `
      import { defineConfig } from 'prunelle/config'
      export default defineConfig({
        plugins: [other({ card: { site: 'https://nested.test' } })],
      })
    `)
    const nestedOnly = runSeoCheck(dir)
    expect(nestedOnly.warnings.some(w => w.includes('[seo/missing-site]'))).toBe(true)

    // Top-level site in prunelle.config.ts satisfies site check
    writeFileSync(join(dir, 'prunelle.config.ts'), `
      import { defineConfig } from 'prunelle/config'
      export default defineConfig({
        site: 'https://example.test',
        plugins: [],
      })
    `)
    const fromConfig = runSeoCheck(dir, { image: '/og.png' })
    expect(fromConfig.warnings).toEqual([])

    // Direct seo({ site }) satisfies site check
    const fromOption = runSeoCheck(dir, { site: 'https://example.test', image: '/og.png' })
    expect(fromOption.warnings).toEqual([])
  })

  it('warns on missing title and missing description, respecting _layout.tsx, dynamic expressions, comments, SVG titles, and API routes', () => {
    const dir = makeTemp('prunelle-seo-missing-')
    mkdirSync(join(dir, 'src/routes/api'), { recursive: true })
    mkdirSync(join(dir, 'src/routes/nested'), { recursive: true })
    mkdirSync(join(dir, 'src/routes/_components'), { recursive: true })

    // Page missing both title and description (has an SVG <title> and commented <Head><title> that must not count)
    writeFileSync(join(dir, 'src/routes/bare.tsx'), `
      import { Head } from 'prunelle'
      export default function Bare() {
        return (
          <main>
            {/* <Head><title>Commented title</title><meta name="description" content="Commented" /></Head> */}
            <svg><title>Logo icon</title></svg>
            <h1>Bare</h1>
          </main>
        )
      }
    `)

    // Page with empty <title></title> and empty description
    writeFileSync(join(dir, 'src/routes/empty.tsx'), `
      import { Head } from 'prunelle'
      export default function Empty() {
        return (
          <Head>
            <title>   </title>
            <meta name="description" content="" />
          </Head>
        )
      }
    `)

    // Dynamic title and description (content attribute before name attribute)
    writeFileSync(join(dir, 'src/routes/dynamic.tsx'), `
      import { Head } from 'prunelle'
      export default function Dynamic({ data }: { data: { title: string, desc: string } }) {
        return (
          <Head>
            <title>{data.title}</title>
            <meta content={data.desc} name="description" />
          </Head>
        )
      }
    `)

    // Inherited from nested _layout.tsx
    writeFileSync(join(dir, 'src/routes/nested/_layout.tsx'), `
      import type { PrunelleChild } from 'prunelle'
      import { Head } from 'prunelle'
      export default function NestedLayout({ children }: { children: PrunelleChild }) {
        return (
          <>
            <Head>
              <title>Nested Section</title>
              <meta name="description" content="Inherited description." />
            </Head>
            {children}
          </>
        )
      }
    `)
    writeFileSync(join(dir, 'src/routes/nested/index.tsx'), `
      export default function NestedHome() {
        return <p>Nested</p>
      }
    `)

    // Ignored routes: API, GET handler, _404, 404, _components helper
    writeFileSync(join(dir, 'src/routes/api/health.ts'), `export function GET() { return new Response('ok') }`)
    writeFileSync(join(dir, 'src/routes/feed.ts'), `export function GET() { return new Response('xml') }`)
    writeFileSync(join(dir, 'src/routes/_404.tsx'), `export default function NotFound() { return <p>404</p> }`)
    writeFileSync(join(dir, 'src/routes/404.tsx'), `export default function NotFoundPage() { return <p>404</p> }`)
    writeFileSync(join(dir, 'src/routes/_components/Helper.tsx'), `export default function Helper() { return <span /> }`)

    const { warnings } = runSeoCheck(dir, { site: 'https://example.test', image: '/og.png', name: 'Site Name' })

    const missingTitles = warnings.filter(w => w.includes('[seo/missing-title]'))
    expect(missingTitles.length).toBe(2)
    expect(missingTitles.some(w => w.startsWith('src/routes/bare.tsx:1:1:'))).toBe(true)
    expect(missingTitles.some(w => w.startsWith('src/routes/empty.tsx:6:'))).toBe(true)

    const missingDescs = warnings.filter(w => w.includes('[seo/missing-description]'))
    expect(missingDescs.length).toBe(2)
    expect(missingDescs.some(w => w.startsWith('src/routes/bare.tsx:1:1:'))).toBe(true)
    expect(missingDescs.some(w => w.startsWith('src/routes/empty.tsx:7:'))).toBe(true)

    // Fallback description in seo({ description }) silences missing-description
    const withFallback = runSeoCheck(dir, { site: 'https://example.test', image: '/og.png', description: 'Fallback site description.' })
    expect(withFallback.warnings.some(w => w.includes('[seo/missing-description]'))).toBe(false)
    // Fallback description in localized record also silences missing-description
    const withLocaleFallback = runSeoCheck(dir, { site: 'https://example.test', image: '/og.png', description: { fr: 'Description par défaut.' } })
    expect(withLocaleFallback.warnings.some(w => w.includes('[seo/missing-description]'))).toBe(false)
  })

  it('warns on titles over 60 chars (including titleTemplate) and descriptions over 160 chars', () => {
    const dir = makeTemp('prunelle-seo-lengths-')
    mkdirSync(join(dir, 'src/routes'), { recursive: true })

    // 52 chars raw -> 68 chars with '%s | Acme Studio' -> warns
    writeFileSync(join(dir, 'src/routes/templated.tsx'), `
      import { Head } from 'prunelle'
      export default function Templated() {
        return (
          <Head>
            <title>A very clear and descriptive page heading for guides</title>
            <meta name="description" content="${'a'.repeat(161)}" />
          </Head>
        )
      }
    `)

    // Already contains `name` ("Acme Studio"), so titleTemplate is NOT applied; 58 chars after decoding &amp; -> ok!
    // Description is exactly 160 chars -> ok!
    writeFileSync(join(dir, 'src/routes/exact.tsx'), `
      import { Head } from 'prunelle'
      export default function Exact() {
        return (
          <Head>
            <title>Acme Studio &amp; Engineering Handbook for Fast Modern Web Apps!</title>
            <meta name="description" content="${'b'.repeat(160)}" />
          </Head>
        )
      }
    `)

    // Check length of decoded title in exact.tsx: "Acme Studio & Engineering Handbook for Fast Modern Web Apps!" is 60 chars
    const { warnings } = runSeoCheck(dir, {
      site: 'https://example.test',
      name: 'Acme Studio',
      titleTemplate: '%s | Acme Studio',
      description: { en: 'Short.', fr: 'c'.repeat(165) },
      image: '/og.png',
    })

    const longTitles = warnings.filter(w => w.includes('[seo/long-title]'))
    expect(longTitles.length).toBe(1)
    expect(longTitles[0]).toContain('src/routes/templated.tsx:6:')
    expect(longTitles[0]).toContain('66 characters')

    const longDescs = warnings.filter(w => w.includes('[seo/long-description]'))
    expect(longDescs.length).toBe(2)
    expect(longDescs.some(w => w.startsWith('prunelle.config.ts:1:1:') && w.includes('locale "fr"') && w.includes('165 characters'))).toBe(true)
    expect(longDescs.some(w => w.startsWith('src/routes/templated.tsx:7:') && w.includes('161 characters'))).toBe(true)
  })

  it('warns on duplicate static titles and descriptions across routes', () => {
    const dir = makeTemp('prunelle-seo-dups-')
    mkdirSync(join(dir, 'src/routes'), { recursive: true })

    writeFileSync(join(dir, 'src/routes/about.tsx'), `
      import { Head } from 'prunelle'
      export default function About() {
        return (
          <Head>
            <title>Company Overview</title>
            <meta name="description" content="Learn more about our studio and craft." />
          </Head>
        )
      }
    `)
    writeFileSync(join(dir, 'src/routes/team.tsx'), `
      import { Head } from 'prunelle'
      export default function Team() {
        return (
          <Head>
            <title>Company Overview</title>
            <meta name="description" content="Learn more about our studio and craft." />
          </Head>
        )
      }
    `)

    const { warnings } = runSeoCheck(dir, { site: 'https://example.test', image: '/og.png' })
    const dupTitle = warnings.filter(w => w.includes('[seo/duplicate-title]'))
    const dupDesc = warnings.filter(w => w.includes('[seo/duplicate-description]'))
    expect(dupTitle.length).toBe(1)
    expect(dupTitle[0]).toContain('src/routes/team.tsx:6:')
    expect(dupTitle[0]).toContain('/about')
    expect(dupDesc.length).toBe(1)
    expect(dupDesc[0]).toContain('src/routes/team.tsx:7:')
    expect(dupDesc[0]).toContain('/about')
  })

  it('warns on noindex routes in sitemap unless excluded or sitemap is disabled', () => {
    const dir = makeTemp('prunelle-seo-noindex-')
    mkdirSync(join(dir, 'src/routes'), { recursive: true })

    writeFileSync(join(dir, 'src/routes/secret.tsx'), `
      import { Head } from 'prunelle'
      export default function Secret() {
        return (
          <Head>
            <title>Secret</title>
            <meta name="description" content="Private preview page." />
            <meta name="robots" content="noindex, nofollow" />
          </Head>
        )
      }
    `)
    writeFileSync(join(dir, 'src/routes/public.tsx'), `
      import { Head } from 'prunelle'
      export default function Public() {
        return (
          <Head>
            <title>Public</title>
            <meta name="description" content="Public indexed page." />
            <meta name="robots" content="index, follow" />
          </Head>
        )
      }
    `)

    const flagged = runSeoCheck(dir, { site: 'https://example.test', image: '/og.png' })
    const noindex = flagged.warnings.filter(w => w.includes('[seo/noindex-in-sitemap]'))
    expect(noindex.length).toBe(1)
    expect(noindex[0]).toContain('src/routes/secret.tsx:8:')
    expect(noindex[0]).toContain('sitemapExclude')

    const excluded = runSeoCheck(dir, { site: 'https://example.test', image: '/og.png', sitemapExclude: ['/secret'] })
    expect(excluded.warnings.some(w => w.includes('[seo/noindex-in-sitemap]'))).toBe(false)

    const noSitemap = runSeoCheck(dir, { site: 'https://example.test', image: '/og.png', sitemap: false })
    expect(noSitemap.warnings.some(w => w.includes('[seo/noindex-in-sitemap]'))).toBe(false)
  })

  it('warns on missing share image when site is set and neither seo({ image }) nor og:image is present', () => {
    const dir = makeTemp('prunelle-seo-og-')
    mkdirSync(join(dir, 'src/routes'), { recursive: true })

    writeFileSync(join(dir, 'src/routes/index.tsx'), `
      import { Head } from 'prunelle'
      export default function Home() {
        return (
          <Head>
            <title>Home</title>
            <meta name="description" content="Home page description." />
            <meta property="og:image" content="/cards/home.png" />
          </Head>
        )
      }
    `)
    writeFileSync(join(dir, 'src/routes/pricing.tsx'), `
      import { Head } from 'prunelle'
      export default function Pricing() {
        return (
          <Head>
            <title>Pricing</title>
            <meta name="description" content="Transparent plans." />
          </Head>
        )
      }
    `)

    const { warnings } = runSeoCheck(dir, { site: 'https://example.test' })
    const missingImg = warnings.filter(w => w.includes('[seo/missing-image]'))
    expect(missingImg.length).toBe(1)
    expect(missingImg[0]).toContain('src/routes/pricing.tsx:1:1:')

    const withDefaultImg = runSeoCheck(dir, { site: 'https://example.test', image: '/og.png' })
    expect(withDefaultImg.warnings).toEqual([])
  })

  it('catches duplicate titles/descriptions across prerendered dynamic pages after build via checkProject()', async () => {
    const dir = makeTemp('prunelle-seo-prerender-')
    linkPackages(dir)
    mkdirSync(join(dir, 'src/routes/posts'), { recursive: true })

    writeFileSync(join(dir, 'prunelle.config.ts'), `
      import { defineConfig } from 'prunelle/config'
      import { seo } from '@prunellejs/seo'
      export default defineConfig({
        site: 'https://example.test',
        compliance: { legalNotice: false },
        plugins: [
          seo({
            name: 'Blog',
            titleTemplate: '%s | Blog',
            image: '/og.png',
          }),
        ],
      })
    `)
    writeFileSync(join(dir, 'src/routes/index.tsx'), `
      import { Head } from 'prunelle'
      export const prerender = true
      export default function Home() {
        return (
          <main>
            <Head>
              <title>Home</title>
              <meta name="description" content="Welcome to the blog." />
            </Head>
            <h1>Home</h1>
          </main>
        )
      }
    `)
    writeFileSync(join(dir, 'src/routes/posts/[slug].tsx'), `
      import { Head } from 'prunelle'
      import type { RequestContext } from 'prunelle/server'
      export const prerender = true
      export function paths() {
        return ['/posts/alpha', '/posts/beta']
      }
      export async function load(ctx: RequestContext) {
        return { slug: ctx.params.slug }
      }
      export default function Post({ data }: { data: { slug: string } }) {
        return (
          <article>
            <Head>
              <title>{'Shared Post Title'}</title>
              <meta name="description" content={'Identical post summary across slugs.'} />
            </Head>
            <h1>{data.slug}</h1>
          </article>
        )
      }
    `)

    // Pre-build check: clean for single route (no duplicate yet across routes)
    const beforeBuild = await checkProject(dir, { skipTypecheck: true })
    expect(beforeBuild.ok).toBe(true)
    expect(beforeBuild.warnings.filter(w => w.includes('[seo/'))).toEqual([])

    // Build & prerender the two dynamic URLs
    await build({ root: dir })

    // Post-build check: detects duplicate title & description across /posts/alpha and /posts/beta!
    const afterBuild = await checkProject(dir, { skipTypecheck: true })
    expect(afterBuild.ok).toBe(true)
    const seoWarnings = afterBuild.warnings.filter(w => w.includes('[seo/'))
    expect(seoWarnings.some(w => w.includes('[seo/duplicate-title]') && w.includes('/posts/beta') && w.includes('/posts/alpha'))).toBe(true)
    expect(seoWarnings.some(w => w.includes('[seo/duplicate-description]') && w.includes('/posts/beta') && w.includes('/posts/alpha'))).toBe(true)

    // Verify diagnosticData parses file, line, col cleanly for every SEO warning
    for (const w of seoWarnings) {
      const parsed = diagnosticData(w, 'warning')
      expect(parsed.file).toBeDefined()
      expect(parsed.line).toBeGreaterThanOrEqual(1)
      expect(parsed.col).toBeGreaterThanOrEqual(1)
    }
  })
})
