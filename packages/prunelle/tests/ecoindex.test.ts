import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuildManifest } from '../src/build/manifest'
import { computeEcoIndex, countDomElements } from '../src/build/ecoindex'
import { build } from '../src/build/index'
import { analyzeBundleWeights, formatBundleReport, formatBundleReportJson } from '../src/build/report'

const tempDirs: string[] = []
function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const d of tempDirs)
    rmSync(d, { recursive: true, force: true })
})

describe('countDomElements (#17)', () => {
  it('counts nested tags and void elements while ignoring doctype, comments and closing tags', () => {
    const html = [
      '<!DOCTYPE html>',
      '<!-- <div class="ignored"><p>nope</p></div> -->',
      '<html lang="fr">',
      '<head><meta charset="utf-8"><link rel="stylesheet" href="/a.css"><title>Hello</title></head>',
      '<body>',
      '<main><h1 data-expr="a > b">Title</h1><p>1 < 2 and 3 > 2</p><img src="/a.png" alt="a" /><br><hr/></main>',
      '<svg><path d="M0 0" /></svg>',
      '</body>',
      '</html>',
    ].join('\n')
    // html, head, meta, link, title, body, main, h1, p, img, br, hr, svg, path = 14
    expect(countDomElements(html)).toBe(14)
  })

  it('ignores raw text containing < or fake tags inside script, style, textarea and title', () => {
    const html = [
      '<html>',
      '<head>',
      '<title>A < B & <span>not a tag</span></title>',
      '<STYLE>.a > .b::after { content: "<div><i>x</i></div>"; }</STYLE>',
      '</head>',
      '<body>',
      '<textarea><p>literal markup</p></textarea>',
      '<SCRIPT type="module">if (a < b && c > d) { el.innerHTML = "<section><article></article></section>" }</SCRIPT>',
      '<div>ok</div>',
      '</body>',
      '</html>',
    ].join('\n')
    // html, head, title, style, body, textarea, script, div = 8
    expect(countDomElements(html)).toBe(8)
  })

  it('ignores processing instructions and CDATA sections', () => {
    const html = '<?xml version="1.0"?><!doctype html><![CDATA[<div>ignored</div>]]><main><p>hi</p></main>'
    expect(countDomElements(html)).toBe(2)
  })
})

describe('computeEcoIndex (#17)', () => {
  it('scores a lightweight page as grade A with low GHG and water footprint', () => {
    const res = computeEcoIndex({ dom: 45, requests: 3, weightBytes: 12 * 1024 })
    expect(res.grade).toBe('A')
    expect(res.score).toBeGreaterThan(75)
    expect(res.score).toBeLessThanOrEqual(100)
    expect(res.dom).toBe(45)
    expect(res.requests).toBe(3)
    expect(res.weightBytes).toBe(12 * 1024)
    expect(res.ghgGrams).toBeLessThan(1.5)
    expect(res.waterCl).toBeLessThan(2.25)
  })

  it('scores a heavy page with a low grade and higher GHG and water footprint', () => {
    const res = computeEcoIndex({ dom: 2500, requests: 210, weightBytes: 6 * 1024 * 1024 })
    expect(['F', 'G']).toContain(res.grade)
    expect(res.score).toBeLessThan(20)
    expect(res.ghgGrams).toBeGreaterThan(2.6)
    expect(res.waterCl).toBeGreaterThan(3.9)
  })

  it('matches GreenIT reference anchor points (0/median/max)', () => {
    expect(computeEcoIndex({ dom: 0, requests: 0, weightBytes: 0 })).toEqual({
      grade: 'A',
      score: 100,
      dom: 0,
      requests: 0,
      weightBytes: 0,
      ghgGrams: 1,
      waterCl: 1.5,
    })

    // Exact 10th quantile across all three inputs -> score 50, grade D (>50 is C), 2 gCO2e, 3 cl
    expect(computeEcoIndex({ dom: 603, requests: 78, weightBytes: Math.round(1448.32 * 1024) })).toEqual({
      grade: 'D',
      score: 50,
      dom: 603,
      requests: 78,
      weightBytes: Math.round(1448.32 * 1024),
      ghgGrams: 2,
      waterCl: 3,
    })

    expect(computeEcoIndex({ dom: 600_000, requests: 5000, weightBytes: 300_000 * 1024 })).toEqual({
      grade: 'G',
      score: 0,
      dom: 600_000,
      requests: 5000,
      weightBytes: 300_000 * 1024,
      ghgGrams: 3,
      waterCl: 4.5,
    })
  })
})

describe('analyzeBundleWeights & bundle reports with EcoIndex (#17)', () => {
  it('populates ecoIndex on prerendered routes, picks the worst URL on dynamic routes, and formats table & JSON', () => {
    const dir = makeTemp('prunelle-ecoindex-report-')
    const clientDir = join(dir, 'client')
    const publicDir = join(dir, 'public')
    const prerenderDir = join(dir, 'prerendered')
    mkdirSync(clientDir, { recursive: true })
    mkdirSync(publicDir, { recursive: true })
    mkdirSync(join(prerenderDir, 'posts/light'), { recursive: true })
    mkdirSync(join(prerenderDir, 'posts/heavy'), { recursive: true })

    writeFileSync(join(clientDir, 'app.css'), 'body{margin:0;font-family:sans-serif}')
    writeFileSync(join(publicDir, 'hero.png'), new Uint8Array(600 * 1024).fill(42))

    const homeHtml = '<!DOCTYPE html><html><head><link rel="stylesheet" href="/_pru/app.css"></head><body><main><h1>Home</h1></main></body></html>'
    const lightHtml = '<!DOCTYPE html><html><head><link rel="stylesheet" href="/_pru/app.css"></head><body><article><h1>Light</h1><p>Short</p></article></body></html>'
    const manyItems = Array.from({ length: 450 }, (_, i) => `<li><span>Item ${i}</span></li>`).join('')
    const heavyHtml = `<!DOCTYPE html><html><head><link rel="stylesheet" href="/_pru/app.css"></head><body><article><h1>Heavy</h1><img src="/hero.png"><ul>${manyItems}</ul></article></body></html>`

    writeFileSync(join(prerenderDir, 'index.html'), homeHtml)
    writeFileSync(join(prerenderDir, 'posts/light/index.html'), lightHtml)
    writeFileSync(join(prerenderDir, 'posts/heavy/index.html'), heavyHtml)

    const manifest: BuildManifest = {
      runtimeScript: undefined,
      styles: ['/_pru/app.css'],
      routes: [
        {
          path: '/',
          file: 'server/index.js',
          layouts: [],
          middlewares: [],
          islandChunks: [],
          styles: ['/_pru/app.css'],
          prerender: true,
          prerendered: { '/': 'prerendered/index.html' },
        },
        {
          path: '/posts/:slug',
          file: 'server/posts/[slug].js',
          layouts: [],
          middlewares: [],
          islandChunks: [],
          styles: ['/_pru/app.css'],
          prerender: true,
          prerendered: {
            '/posts/light': 'prerendered/posts/light/index.html',
            '/posts/heavy': 'prerendered/posts/heavy/index.html',
          },
        },
        {
          path: '/dashboard',
          file: 'server/dashboard.js',
          layouts: [],
          middlewares: [],
          islandChunks: [],
          styles: ['/_pru/app.css'],
        },
      ],
      actions: [],
      islands: {},
      assets: ['app.css'],
      publicFiles: ['hero.png'],
    }

    const report = analyzeBundleWeights(manifest, clientDir, '/_pru', undefined, undefined, [publicDir], dir)
    const home = report.routes.find(r => r.path === '/')!
    const posts = report.routes.find(r => r.path === '/posts/:slug')!
    const dashboard = report.routes.find(r => r.path === '/dashboard')!

    expect(home.ecoIndex).toBeDefined()
    expect(home.ecoIndex!.grade).toBe('A')
    expect(home.ecoIndex!.dom).toBe(6)
    expect(home.ecoIndex!.requests).toBe(2) // HTML + app.css
    expect(home.ecoIndex!.url).toBeUndefined()

    expect(posts.ecoIndex).toBeDefined()
    expect(posts.ecoIndex!.url).toBe('/posts/heavy')
    expect(posts.ecoIndex!.dom).toBe(908) // html, head, link, body, article, h1, img, ul (8) + 450*(li+span)
    expect(posts.ecoIndex!.requests).toBe(3) // HTML + app.css + hero.png
    expect(posts.ecoIndex!.weightBytes).toBeGreaterThan(600 * 1024)
    expect(posts.ecoIndex!.score).toBeLessThan(home.ecoIndex!.score)

    expect(dashboard.ecoIndex).toBeUndefined()

    const text = formatBundleReport(report)
    expect(text).toContain('EcoIndex')
    expect(text).toContain(`${home.ecoIndex!.grade} (${Math.round(home.ecoIndex!.score)})`)
    expect(text).toContain(`${posts.ecoIndex!.grade} (${Math.round(posts.ecoIndex!.score)})`)
    expect(text).toContain('/posts/heavy')
    expect(text).toContain('gCO2e')
    // Non-prerendered route renders '-' in the EcoIndex column
    const dashboardLine = text.split('\n').find(line => line.startsWith('/dashboard'))!
    expect(dashboardLine.trimEnd().endsWith('-')).toBe(true)

    const parsed = JSON.parse(formatBundleReportJson(report)) as { routes: typeof report.routes }
    const parsedPosts = parsed.routes.find(r => r.path === '/posts/:slug')!
    expect(parsedPosts.ecoIndex).toEqual(posts.ecoIndex)
    expect(parsedPosts.ecoIndex).toMatchObject({
      grade: posts.ecoIndex!.grade,
      score: posts.ecoIndex!.score,
      dom: posts.ecoIndex!.dom,
      requests: posts.ecoIndex!.requests,
      weightBytes: posts.ecoIndex!.weightBytes,
      ghgGrams: posts.ecoIndex!.ghgGrams,
      waterCl: posts.ecoIndex!.waterCl,
      url: '/posts/heavy',
    })

    // Without prerenderBaseDir, EcoIndex column is omitted cleanly
    const withoutEco = analyzeBundleWeights(manifest, clientDir, '/_pru', undefined, undefined, [publicDir])
    expect(formatBundleReport(withoutEco)).not.toContain('EcoIndex')
  })

  it('measures real prerendered output from build()', async () => {
    const dir = makeTemp('prunelle-ecoindex-build-')
    mkdirSync(join(dir, 'src/routes/posts'), { recursive: true })
    writeFileSync(join(dir, 'src/routes/index.tsx'), `
      export const prerender = true
      export default function Home() {
        return <main><h1>Hello</h1><p>Zero JS static page.</p></main>
      }
    `)
    writeFileSync(join(dir, 'src/routes/posts/[slug].tsx'), `
      export const prerender = true
      export function paths() { return ['/posts/a', '/posts/b'] }
      export default function Post({ params }: { params: { slug: string } }) {
        const items = params.slug === 'b' ? Array.from({ length: 120 }, (_, i) => i) : [0]
        return <main><h1>{params.slug}</h1><ul>{items.map(i => <li><span>{i}</span></li>)}</ul></main>
      }
    `)
    const outDir = join(dir, 'dist')
    const manifest = await build({ root: dir, outDir, minify: true })
    const report = analyzeBundleWeights(manifest, join(outDir, 'client'), '/_pru', undefined, undefined, [join(outDir, 'public')], outDir)

    const home = report.routes.find(r => r.path === '/')!
    const post = report.routes.find(r => r.path === '/posts/:slug')!

    expect(home.ecoIndex?.grade).toBe('A')
    expect(home.ecoIndex?.requests).toBe(1)
    expect(post.ecoIndex?.url).toBe('/posts/b')
    expect(post.ecoIndex!.dom).toBeGreaterThan(240)
    expect(post.ecoIndex!.score).toBeLessThan(home.ecoIndex!.score)
  })
})
