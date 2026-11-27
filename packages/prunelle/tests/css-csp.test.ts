import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { analyzeBundleWeights, build, formatBundleReport } from '../src/build/index'
import { createServer, definePlugin, PRUNELLE_ISLAND_STYLE_HASH, PRUNELLE_STREAM_SCRIPT_HASH, PRUNELLE_SUSPENSE_STYLE_HASH, withCspHashes } from '../src/server/index'
import { createHtmlHeaders } from '../src/server/document'
import { type CspDirectives, DEFAULT_CSP, extendCsp } from '../src/server/public'
import { buildSecurityHeaderEntries, inlineStyleHashes, injectMetaCsp, resolveCspPolicy, toMetaCsp } from '../src/server/security'
import { PRUNELLE_STREAM_SCRIPT } from '../src/ssr/context'
import { createNavigation } from '../src/ssr/navigation'

const NAVIGATION_HASHES = createNavigation(undefined)

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

describe('Per-route CSS scoping, strict CSP hashes, and bundle weight report (#3519)', () => {
  it('augments CSP directives with SHA-256 hashes without requiring unsafe-inline', () => {
    const strict = "default-src 'self'; script-src 'self'; style-src 'self'"
    const withIsland = withCspHashes(strict, { styleHashes: [PRUNELLE_ISLAND_STYLE_HASH] })
    expect(withIsland).toContain(`style-src 'self' ${PRUNELLE_ISLAND_STYLE_HASH}`)
    expect(withIsland).not.toContain("'unsafe-inline'")
    expect(withIsland).toContain("script-src 'self'")

    // Derives missing style-src / script-src from default-src
    const minimal = "default-src 'self'"
    const withBoth = withCspHashes(minimal, {
      styleHashes: [PRUNELLE_SUSPENSE_STYLE_HASH],
      scriptHashes: [PRUNELLE_STREAM_SCRIPT_HASH],
    })
    expect(withBoth).toContain(`style-src 'self' ${PRUNELLE_SUSPENSE_STYLE_HASH}`)
    expect(withBoth).toContain(`script-src 'self' ${PRUNELLE_STREAM_SCRIPT_HASH}`)

    // Leaves directives that already allow 'unsafe-inline' untouched
    const loose = "default-src 'self'; style-src 'self' 'unsafe-inline'"
    expect(withCspHashes(loose, { styleHashes: [PRUNELLE_ISLAND_STYLE_HASH] })).toBe(loose)
  })

  it('scopes CSS stylesheets per route (layouts, page CSS, island CSS, and 404 fallback) and analyzes route weights', async () => {
    const dir = makeTemp('prunelle-per-route-css-')
    mkdirSync(join(dir, 'src/routes'), { recursive: true })
    mkdirSync(join(dir, 'src/components'), { recursive: true })
    mkdirSync(join(dir, 'src/styles'), { recursive: true })

    const pluginCssPath = join(dir, 'src/styles/plugin-global.css')
    writeFileSync(pluginCssPath, ':root { --k-global: 1; }\n')
    writeFileSync(join(dir, 'src/styles/layout.css'), 'body { margin: 0; }\n')
    writeFileSync(join(dir, 'src/styles/home.css'), '.home-only { color: #111111; }\n')
    writeFileSync(join(dir, 'src/styles/about.css'), '.about-only { color: #222222; }\n')
    writeFileSync(join(dir, 'src/styles/widget.css'), '.widget-only { color: #333333; }\n')

    writeFileSync(join(dir, 'src/components/Widget.tsx'), `
      import { signal } from 'prunelle'
      import '../styles/widget.css'
      export function Widget() {
        const n = signal(0)
        return <button class="widget-only" type="button" onClick={() => n.value++}>{n.value}</button>
      }
    `)

    writeFileSync(join(dir, 'src/routes/_layout.tsx'), `
      import type { PrunelleChild } from 'prunelle'
      import '../styles/layout.css'
      export default function Layout({ children }: { children?: PrunelleChild }) {
        return <div class="shell">{children}</div>
      }
    `)

    writeFileSync(join(dir, 'src/routes/_404.tsx'), `
      export default function NotFound() {
        return <h1>404</h1>
      }
    `)

    writeFileSync(join(dir, 'src/routes/index.tsx'), `
      import '../styles/home.css'
      import { Widget } from '../components/Widget'
      export default async function Home() {
        return <main class="home-only"><Widget /></main>
      }
    `)

    writeFileSync(join(dir, 'src/routes/about.tsx'), `
      import '../styles/about.css'
      export default async function About() {
        return <main class="about-only">About page (0 KB JS)</main>
      }
    `)

    const plugin = { name: 'test-global-css', css: ['src/styles/plugin-global.css'] }
    const manifest = await build({ root: dir, plugins: [plugin] })
    const app = await createServer({ root: dir, plugins: [plugin] })

    const extractStyles = (html: string) =>
      [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]!)

    const cssTextOf = async (urls: string[]) => {
      let combined = ''
      for (const u of urls)
        combined += await (await app.handle(new Request(`http://localhost${u}`))).text()
      return combined
    }

    // 1. Home route gets plugin + layout + home + widget CSS, NOT about CSS
    const homeHtml = await (await app.handle(new Request('http://localhost/'))).text()
    const homeStyles = extractStyles(homeHtml)
    const homeCss = await cssTextOf(homeStyles)
    expect(homeCss).toContain('--k-global')
    expect(homeCss).toContain('margin:0')
    expect(homeCss).toContain('.home-only')
    expect(homeCss).toContain('.widget-only')
    expect(homeCss).not.toContain('.about-only')

    // 2. About route gets plugin + layout + about CSS, NOT home or widget CSS, and 0 JS!
    const aboutHtml = await (await app.handle(new Request('http://localhost/about'))).text()
    const aboutStyles = extractStyles(aboutHtml)
    const aboutCss = await cssTextOf(aboutStyles)
    expect(aboutCss).toContain('--k-global')
    expect(aboutCss).toContain('margin:0')
    expect(aboutCss).toContain('.about-only')
    expect(aboutCss).not.toContain('.home-only')
    expect(aboutCss).not.toContain('.widget-only')
    // The speculation rules are data, not JS.
    expect(aboutHtml.replace(/<script type="speculationrules">[\s\S]*?<\/script>/, '')).not.toContain('<script')

    // 3. 404 page gets plugin + root layout CSS only (no home/about/widget CSS)
    const notFoundRes = await app.handle(new Request('http://localhost/nope'))
    expect(notFoundRes.status).toBe(404)
    const notFoundCss = await cssTextOf(extractStyles(await notFoundRes.text()))
    expect(notFoundCss).toContain('--k-global')
    expect(notFoundCss).toContain('margin:0')
    expect(notFoundCss).not.toContain('.home-only')
    expect(notFoundCss).not.toContain('.about-only')
    expect(notFoundCss).not.toContain('.widget-only')

    // 4. Metafile / bundle weight report reflects per-route JS & CSS accurately
    const weights = analyzeBundleWeights(manifest, join(dir, 'dist/client'))
    const homeRow = weights.routes.find(r => r.path === '/')!
    const aboutRow = weights.routes.find(r => r.path === '/about')!
    expect(homeRow.jsGzip).toBeGreaterThan(0)
    expect(aboutRow.jsGzip).toBe(0)
    expect(aboutRow.cssFiles).toBeLessThan(homeRow.cssFiles)

    const reportText = formatBundleReport(weights)
    expect(reportText).toContain('PRUNELLE BUNDLE WEIGHT REPORT')
    expect(reportText).toContain('/about')
  })

  it('auto-injects exact SHA-256 CSP hashes for islands & streaming Suspense with zero inline style attrs', async () => {
    const dir = makeTemp('prunelle-strict-csp-')
    mkdirSync(join(dir, 'src/routes'), { recursive: true })
    mkdirSync(join(dir, 'src/components'), { recursive: true })

    writeFileSync(join(dir, 'src/components/Btn.tsx'), `
      import { signal } from 'prunelle'
      export function Btn() {
        const n = signal(0)
        return <button type="button" onClick={() => n.value++}>{n.value}</button>
      }
    `)
    writeFileSync(join(dir, 'src/routes/static.tsx'), `
      export default function StaticPage() {
        return <p>No islands, no suspense</p>
      }
    `)
    writeFileSync(join(dir, 'src/routes/island.tsx'), `
      import { Btn } from '../components/Btn'
      export default async function IslandPage() {
        return <Btn />
      }
    `)
    writeFileSync(join(dir, 'src/routes/stream.tsx'), `
      import { Suspense } from 'prunelle'
      async function Delayed() {
        await Bun.sleep(5)
        return <p id="done">Loaded cleanly</p>
      }
      export default function StreamPage() {
        return <Suspense fallback={<p id="fb">Wait</p>}><Delayed /></Suspense>
      }
    `)

    await build({ root: dir })
    const strictCsp = "default-src 'self'; script-src 'self'; style-src 'self'"
    const app = await createServer({ root: dir, security: { csp: strictCsp } })

    // A static page needs only the hashes of what every page carries: the view transition, the speculation rules and the scroll script.
    const staticRes = await app.handle(new Request('http://localhost/static'))
    expect(staticRes.headers.get('content-security-policy')).toBe(withCspHashes(strictCsp, NAVIGATION_HASHES))

    // Island page automatically gets PRUNELLE_ISLAND_STYLE_HASH in style-src (no unsafe-inline)
    const islandRes = await app.handle(new Request('http://localhost/island'))
    const islandCsp = islandRes.headers.get('content-security-policy')!
    expect(islandCsp).toContain(PRUNELLE_ISLAND_STYLE_HASH)
    expect(islandCsp).not.toContain("'unsafe-inline'")
    expect(islandCsp).not.toContain(PRUNELLE_STREAM_SCRIPT_HASH)

    // Streaming Suspense page automatically gets PRUNELLE_SUSPENSE_STYLE_HASH + PRUNELLE_STREAM_SCRIPT_HASH
    // and emits zero inline style="..." attributes or per-chunk <script> tags
    const streamRes = await app.handle(new Request('http://localhost/stream'))
    const streamCsp = streamRes.headers.get('content-security-policy')!
    expect(streamCsp).toContain(PRUNELLE_SUSPENSE_STYLE_HASH)
    expect(streamCsp).toContain(PRUNELLE_STREAM_SCRIPT_HASH)
    expect(streamCsp).not.toContain("'unsafe-inline'")

    const streamHtml = await streamRes.text()
    expect(streamHtml).not.toContain('style="display:contents"')
    expect(streamHtml).toContain('<pru-s id="k-s-0"><p id="fb">Wait</p></pru-s>')
    expect(streamHtml).toContain('<template data-ks="0"><p id="done">Loaded cleanly</p></template>')

    // Execute the fixed PRUNELLE_STREAM_SCRIPT in Happy-DOM to verify live DOM swap!
    GlobalRegistrator.register()
    try {
      document.body.innerHTML = '<pru-s id="k-s-0"><p id="fb">Wait</p></pru-s>'
      // eslint-disable-next-line no-new-func
      new Function(PRUNELLE_STREAM_SCRIPT)()
      const tpl = document.createElement('template')
      tpl.dataset.ks = '0'
      tpl.innerHTML = '<p id="done">Loaded cleanly</p>'
      document.body.appendChild(tpl)
      await Bun.sleep(10)
      expect(document.getElementById('k-s-0')).toBeNull()
      expect(document.getElementById('done')?.textContent).toBe('Loaded cleanly')
    }
    finally {
      await GlobalRegistrator.unregister()
    }
  })
})

describe('the default CSP lets an app style its pages (#3582)', () => {
  const LAYOUT_STYLE_HASH = `'sha256-ac1R1kU5izDDnXGpZrb2k+Dct4jThB3/YH1VfglrT3I='`
  const HEAD_STYLE_HASH = `'sha256-QRQPRLGyxt3RJiKpYNjpkgHcmHU2PywsfL2e8oI0LQA='`
  const styleSrc = (csp: string | null): string[] => csp?.split(';').map(d => d.trim().split(' ')).find(d => d[0] === 'style-src')?.slice(1) ?? []

  async function styledApp(csp?: string) {
    const dir = makeTemp('prunelle-style-csp-')
    mkdirSync(join(dir, 'src/routes/item'), { recursive: true })
    writeFileSync(join(dir, 'src/routes/_layout.tsx'), `
      export default function Layout({ children }) {
        return <div><style>{'main{color:red}'}</style><main>{children}</main></div>
      }
    `)
    writeFileSync(join(dir, 'src/routes/index.tsx'), `
      export default function Home() {
        return <p style="color:blue">home</p>
      }
    `)
    writeFileSync(join(dir, 'src/routes/_404.tsx'), `
      export default function NotFound() {
        return <p>missing</p>
      }
    `)
    writeFileSync(join(dir, 'src/routes/item/[id].tsx'), `
      export default function Item({ params }) {
        return <p>item {params.id}</p>
      }
    `)
    writeFileSync(join(dir, 'src/routes/pre.tsx'), `
      export const prerender = true
      export default function Pre() {
        return <p>prerendered</p>
      }
    `)
    writeFileSync(join(dir, 'src/routes/head.tsx'), `
      import { Head } from 'prunelle'
      export default function WithHead() {
        return <><Head><style>{'p{margin:0}'}</style></Head><p>head</p></>
      }
    `)
    writeFileSync(join(dir, 'src/routes/stream.tsx'), `
      import { Suspense } from 'prunelle'
      async function Later() {
        await Bun.sleep(1)
        return <p>later</p>
      }
      export default function Stream() {
        return <Suspense fallback={<p>wait</p>}><Later /></Suspense>
      }
    `)
    await build({ root: dir })
    return createServer({ root: dir, ...(csp !== undefined ? { security: { csp } } : {}) })
  }

  it('allows style attributes and hashes every rendered <style> block on each way a page is served', async () => {
    const app = await styledApp()
    for (const path of ['/', '/item/7', '/pre', '/head', '/stream', '/missing']) {
      const res = await app.handle(new Request(`http://localhost${path}`))
      const csp = res.headers.get('content-security-policy')
      expect(csp, path).toContain(`style-src-attr 'unsafe-inline'`)
      expect(styleSrc(csp), path).toContain(LAYOUT_STYLE_HASH)
    }
    const head = await app.handle(new Request('http://localhost/head'))
    expect(styleSrc(head.headers.get('content-security-policy'))).toContain(HEAD_STYLE_HASH)
  })

  it('keeps an app\'s own policy, adding only the hashes of what it renders', async () => {
    const strict = "default-src 'self'; script-src 'self'; style-src 'self'"
    const app = await styledApp(strict)
    const res = await app.handle(new Request('http://localhost/'))
    expect(res.headers.get('content-security-policy')).toBe(withCspHashes(strict, { styleHashes: [...NAVIGATION_HASHES.styleHashes, LAYOUT_STYLE_HASH], scriptHashes: NAVIGATION_HASHES.scriptHashes }))
  })

  it('never hashes attacker-injected <style> tags from raw() or innerHTML while still hashing compiler & plugin styles (#3625)', async () => {
    const dir = makeTemp('prunelle-3625-csp-inject-')
    mkdirSync(join(dir, 'src/routes/dyn'), { recursive: true })
    const attackerCss = 'body{background:url(https://evil.example/exfil)}'
    const attackerHash = inlineStyleHashes(`<style>${attackerCss}</style>`)[0]!
    const pluginHeadCss = '.plugin-head{border:1px solid #000}'
    const pluginHeadHash = inlineStyleHashes(`<style>${pluginHeadCss}</style>`)[0]!
    const pluginTransformCss = '.plugin-tx{outline:0}'
    const pluginTransformHash = inlineStyleHashes(`<style>${pluginTransformCss}</style>`)[0]!
    const fallbackCss = '.fb{opacity:.5}'
    const fallbackHash = inlineStyleHashes(`<style>${fallbackCss}</style>`)[0]!

    writeFileSync(join(dir, 'src/routes/_layout.tsx'), `
      export default function Layout({ children }) {
        return <div><style>{'main{color:red}'}</style><main>{children}</main></div>
      }
    `)
    writeFileSync(join(dir, 'src/routes/index.tsx'), `
      import { raw } from 'prunelle/internal/ssr'
      export default function Home() {
        const injected = '<style>${attackerCss}</style>'
        return <section>{raw(injected)}<div innerHTML={injected} /></section>
      }
    `)
    writeFileSync(join(dir, 'src/routes/dyn/[id].tsx'), `
      export default function Dyn() {
        return <article innerHTML={'<STYLE>${attackerCss}</STYLE>'} />
      }
    `)
    writeFileSync(join(dir, 'src/routes/stream.tsx'), `
      import { Suspense } from 'prunelle'
      async function Later() {
        await Bun.sleep(2)
        return <p>later</p>
      }
      export default function Stream() {
        return (
          <Suspense fallback={<><style>{'${fallbackCss}'}</style><p>wait</p><div innerHTML={'<style>${attackerCss}</style>'} /></>}>
            <Later />
          </Suspense>
        )
      }
    `)
    writeFileSync(join(dir, 'src/routes/_404.tsx'), `
      export default function NotFound() {
        return <div innerHTML={'<style>${attackerCss}</style>missing'} />
      }
    `)

    const plugin = definePlugin({
      name: 'csp-plugin-styles',
      head(doc) {
        doc.add(`<style>${pluginHeadCss}</style>`)
      },
      transformHtml(html) {
        return html.replace('</head>', `<style>${pluginTransformCss}</style></head>`)
      },
    })

    // First verify fast static path (no plugins) does not authorize injected <style>
    await build({ root: dir })
    const fastApp = await createServer({ root: dir })
    for (const path of ['/', '/dyn/1', '/stream', '/missing']) {
      const res = await fastApp.handle(new Request(`http://localhost${path}`))
      const csp = res.headers.get('content-security-policy')!
      expect(styleSrc(csp), path).toContain(LAYOUT_STYLE_HASH)
      expect(styleSrc(csp), path).not.toContain(attackerHash)
    }
    const streamRes = await fastApp.handle(new Request('http://localhost/stream'))
    expect(styleSrc(streamRes.headers.get('content-security-policy'))).toContain(fallbackHash)
    const streamHeadRes = await fastApp.handle(new Request('http://localhost/stream', { method: 'HEAD' }))
    expect(styleSrc(streamHeadRes.headers.get('content-security-policy'))).toContain(LAYOUT_STYLE_HASH)
    expect(styleSrc(streamHeadRes.headers.get('content-security-policy'))).toContain(fallbackHash)

    // With plugin head + transformHtml hooks: plugin styles ARE hashed, preexisting injected <style> is STILL not hashed
    const pluginApp = await createServer({ root: dir, plugins: [plugin] })
    const pluginRes = await pluginApp.handle(new Request('http://localhost/'))
    const pluginCsp = pluginRes.headers.get('content-security-policy')!
    expect(styleSrc(pluginCsp)).toContain(LAYOUT_STYLE_HASH)
    expect(styleSrc(pluginCsp)).toContain(pluginHeadHash)
    expect(styleSrc(pluginCsp)).toContain(pluginTransformHash)
    expect(styleSrc(pluginCsp)).not.toContain(attackerHash)
  })

  it('handles case-insensitive <STYLE> tags in inlineStyleHashes and LRU cache eviction past 256 entries (#3625)', () => {
    const hashes = inlineStyleHashes('<STYLE type="text/css">a{color:red}</STYLE><Style>b{color:blue}</Style>')
    expect(hashes.length).toBe(2)
    expect(hashes).toEqual([
      inlineStyleHashes('<style>a{color:red}</style>')[0]!,
      inlineStyleHashes('<style>b{color:blue}</style>')[0]!,
    ])

    // Evicts least-recently-used entries cleanly past 256 without errors or stale headers
    const htmlHeaders = createHtmlHeaders(undefined, { 'content-security-policy': "default-src 'self'; style-src 'self'" })
    for (let i = 0; i < 300; i++) {
      const h = inlineStyleHashes(`<style>.k${i}{z-index:${i}}</style>`)
      const headers = htmlHeaders(false, false, true, h)
      expect(headers['content-security-policy']).toContain(h[0]!)
    }
  })
})

function extractMetaCsp(html: string): string | undefined {
  return /<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i.exec(html)?.[1]
}

function linkPrunelle(dir: string): void {
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  symlinkSync(join(import.meta.dir, '..'), join(dir, 'node_modules/prunelle'), 'dir')
}

function findChromiumPath(): string {
  const found = [process.env.BUN_CHROME_PATH, chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome']
    .find((path): path is string => typeof path === 'string' && path.length > 0 && existsSync(path))
  if (found === undefined)
    throw new Error('Chromium executable not found for CSP browser verification test.')
  return found
}

describe('extending the default CSP without copying the whole policy (#54)', () => {
  it('merges directive additions onto DEFAULT_CSP while preserving other directives and default-src seeding', () => {
    const extra: CspDirectives = {
      'style-src': 'https://fonts.googleapis.com',
      'font-src': ['https://fonts.gstatic.com', 'https://fonts.gstatic.com'],
      'connect-src': ['https://api.example.com'],
      'frame-ancestors': "'none'",
      'object-src': 'https://embed.example.com',
      'report-to': 'csp-endpoint',
      'upgrade-insecure-requests': '',
    }
    const policy = extendCsp(extra)

    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("style-src 'self' https://fonts.googleapis.com")
    expect(policy).toContain("style-src-attr 'unsafe-inline'")
    expect(policy).toContain("img-src 'self' data: blob:")
    expect(policy).toContain("font-src 'self' data: https://fonts.gstatic.com")
    // New fetch directive inherits 'self' from default-src so same-origin fetches keep working.
    expect(policy).toContain("connect-src 'self' https://api.example.com")
    // Tightening with 'none' replaces prior sources; extending a 'none' directive replaces 'none'.
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain('object-src https://embed.example.com')
    expect(policy).not.toContain("object-src 'none'")
    // Non-fetch directives do not seed 'self', and empty tokens emit valueless directives.
    expect(policy).toContain('report-to csp-endpoint')
    expect(policy).toContain('; upgrade-insecure-requests')
    expect(policy).not.toContain("report-to 'self'")

    // Hashes from withCspHashes land inside the extended directive.
    const hashed = withCspHashes(policy, { styleHashes: [PRUNELLE_ISLAND_STYLE_HASH] })
    expect(hashed).toContain(`style-src 'self' https://fonts.googleapis.com ${PRUNELLE_ISLAND_STYLE_HASH}`)
  })

  it('supports security.csp object form in resolveCspPolicy, buildSecurityHeaderEntries, and createServer', async () => {
    const extra: CspDirectives = {
      'style-src': 'https://fonts.googleapis.com',
      'font-src': ['https://fonts.gstatic.com'],
    }
    expect(resolveCspPolicy({ csp: extra })).toBe(extendCsp(extra))
    expect(resolveCspPolicy({ csp: false })).toBeUndefined()
    expect(resolveCspPolicy(false)).toBeUndefined()
    expect(resolveCspPolicy(undefined)).toBe(DEFAULT_CSP)

    const entries = buildSecurityHeaderEntries({ csp: extra })
    expect(entries.find(([k]) => k === 'content-security-policy')?.[1]).toBe(extendCsp(extra))

    const dir = makeTemp('prunelle-extend-csp-')
    mkdirSync(join(dir, 'src/routes/api'), { recursive: true })
    mkdirSync(join(dir, 'src/components'), { recursive: true })
    writeFileSync(join(dir, 'src/components/Counter.tsx'), `
      import { signal } from 'prunelle'
      export function Counter() {
        const n = signal(0)
        return <button type="button" onClick={() => n.value++}>{n.value}</button>
      }
    `)
    writeFileSync(join(dir, 'src/routes/index.tsx'), `
      import { Counter } from '../components/Counter'
      export default function Home() {
        return <main><style>{'main{padding:1rem}'}</style><Counter /></main>
      }
    `)
    writeFileSync(join(dir, 'src/routes/api/ping.ts'), `
      export function GET() {
        return Response.json({ ok: true })
      }
    `)

    await build({ root: dir })
    const app = await createServer({ root: dir, security: { csp: extra } })

    const pageRes = await app.handle(new Request('http://localhost/'))
    const pageCsp = pageRes.headers.get('content-security-policy')!
    const styleHash = inlineStyleHashes('<style>main{padding:1rem}</style>')[0]!
    expect(pageCsp).toContain(`style-src 'self' https://fonts.googleapis.com`)
    expect(pageCsp).toContain(PRUNELLE_ISLAND_STYLE_HASH)
    expect(pageCsp).toContain(styleHash)
    expect(pageCsp).toContain("font-src 'self' data: https://fonts.gstatic.com")
    expect(pageCsp).toContain("object-src 'none'")
    expect(pageCsp).toContain("frame-ancestors 'self'")

    // Non-HTML responses also receive the extended CSP string (not an object).
    const apiRes = await app.handle(new Request('http://localhost/api/ping'))
    expect(apiRes.headers.get('content-security-policy')).toBe(extendCsp(extra))
  })
})

describe('static export carries per-page CSP meta tags (#37)', () => {
  it('strips meta-disallowed directives and injects CSP right after charset in <head>', () => {
    const rawPolicy = `${DEFAULT_CSP}; report-uri /csp-report; sandbox allow-scripts`
    const metaPolicy = toMetaCsp(rawPolicy)
    expect(metaPolicy).not.toContain('frame-ancestors')
    expect(metaPolicy).not.toContain('report-uri')
    expect(metaPolicy).not.toContain('sandbox')
    expect(metaPolicy).toContain("default-src 'self'")
    expect(metaPolicy).toContain("object-src 'none'")

    const doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0}</style></head><body>hi</body></html>'
    const injected = injectMetaCsp(doc, rawPolicy)
    expect(injected).toBe(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${metaPolicy}"><style>body{margin:0}</style></head><body>hi</body></html>`)

    // Does not double-inject when a CSP meta tag already exists, and skips empty/null policies.
    expect(injectMetaCsp(injected, rawPolicy)).toBe(injected)
    expect(injectMetaCsp(doc, null)).toBe(doc)
    expect(injectMetaCsp(doc, "frame-ancestors 'self'")).toBe(doc)

    // Falls back to right after <head> when no charset meta is present.
    const noCharset = '<html><head><title>x</title></head><body></body></html>'
    expect(injectMetaCsp(noCharset, "default-src 'self'")).toBe(`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'"><title>x</title></head><body></body></html>`)
  })

  it('embeds hashed CSP on island, inline-style, plain, 404, base-path, and extended-CSP static pages, and skips it when disabled or non-static', async () => {
    const makeApp = (prefix: string, configCode?: string) => {
      const dir = makeTemp(prefix)
      linkPrunelle(dir)
      mkdirSync(join(dir, 'src/routes'), { recursive: true })
      mkdirSync(join(dir, 'src/components'), { recursive: true })
      mkdirSync(join(dir, 'src/styles'), { recursive: true })
      writeFileSync(join(dir, 'src/styles/app.css'), 'body{font-family:sans-serif}\n')
      writeFileSync(join(dir, 'src/components/Counter.tsx'), `
        import { signal } from 'prunelle'
        export function Counter() {
          const count = signal(0)
          return <button id="inc" type="button" onClick={() => count.value++}>count:{count.value}</button>
        }
      `)
      writeFileSync(join(dir, 'src/routes/index.tsx'), `
        import '../styles/app.css'
        import { Counter } from '../components/Counter'
        export const prerender = true
        export default function IslandPage() {
          return <main><h1>Island</h1><Counter /></main>
        }
      `)
      writeFileSync(join(dir, 'src/routes/styled.tsx'), `
        export const prerender = true
        export default function StyledPage() {
          return <main><style>{'#swatch{color:rgb(10, 20, 30)}'}</style><p id="swatch">Styled only</p></main>
        }
      `)
      writeFileSync(join(dir, 'src/routes/plain.tsx'), `
        export const prerender = true
        export default function PlainPage() {
          return <main><p id="plain">Zero JS, zero inline style</p></main>
        }
      `)
      writeFileSync(join(dir, 'src/routes/_404.tsx'), `
        export default function NotFound() {
          return <main><style>{'.nf{color:crimson}'}</style><h1 class="nf">Not found</h1></main>
        }
      `)
      if (configCode !== undefined)
        writeFileSync(join(dir, 'prunelle.config.ts'), configCode)
      return dir
    }

    // 1. Standard static export with island, inline-style, plain, and 404 pages + real Chromium check.
    const staticDir = makeApp('prunelle-static-csp-')
    await build({ root: staticDir, static: true })

    const islandHtml = readFileSync(join(staticDir, 'dist/index.html'), 'utf8')
    const styledHtml = readFileSync(join(staticDir, 'dist/styled/index.html'), 'utf8')
    const plainHtml = readFileSync(join(staticDir, 'dist/plain/index.html'), 'utf8')
    const notFoundHtml = readFileSync(join(staticDir, 'dist/404.html'), 'utf8')

    const islandCsp = extractMetaCsp(islandHtml)
    const styledCsp = extractMetaCsp(styledHtml)
    const plainCsp = extractMetaCsp(plainHtml)
    const notFoundCsp = extractMetaCsp(notFoundHtml)

    expect(islandCsp).toBeDefined()
    expect(islandCsp).toContain(PRUNELLE_ISLAND_STYLE_HASH)
    expect(islandCsp).not.toContain('frame-ancestors')

    const styledHash = inlineStyleHashes('<style>#swatch{color:rgb(10, 20, 30)}</style>')[0]!
    expect(styledCsp).toBeDefined()
    expect(styledCsp).toContain(styledHash)
    expect(styledCsp).not.toContain(PRUNELLE_ISLAND_STYLE_HASH)
    expect(styledCsp).not.toContain('frame-ancestors')

    expect(plainCsp).toBeDefined()
    expect(plainCsp).toContain("default-src 'self'")
    expect(plainCsp).not.toContain(PRUNELLE_ISLAND_STYLE_HASH)
    expect(plainCsp).not.toContain('frame-ancestors')

    const nfHash = inlineStyleHashes('<style>.nf{color:crimson}</style>')[0]!
    expect(notFoundCsp).toBeDefined()
    expect(notFoundCsp).toContain(nfHash)
    expect(notFoundCsp).not.toContain('frame-ancestors')

    // CSP meta must appear before the first <style>, <script>, or <link> in <head>.
    expect(islandHtml.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(islandHtml.indexOf('<link '))
    expect(styledHtml.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(styledHtml.indexOf('<style>'))

    // 2. Real Chromium load of the static export: island page, inline-style page, and plain 0-JS page all load with zero CSP violations.
    const distRoot = join(staticDir, 'dist')
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        const pathname = new URL(req.url).pathname
        if (pathname === '/favicon.ico')
          return new Response(null, { status: 204 })
        const direct = join(distRoot, pathname.slice(1))
        const full = pathname === '/'
          ? join(distRoot, 'index.html')
          : existsSync(direct) && statSync(direct).isFile()
            ? direct
            : join(distRoot, pathname.slice(1), 'index.html')
        if (!existsSync(full) || !statSync(full).isFile())
          return new Response(Bun.file(join(distRoot, '404.html')), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } })
        return new Response(Bun.file(full), { headers: { 'content-security-policy': "frame-ancestors 'self'" } })
      },
    })
    const browser = await chromium.launch({ headless: true, executablePath: findChromiumPath() })
    try {
      const origin = `http://127.0.0.1:${server.port}`
      for (const path of ['/', '/styled', '/plain']) {
        const context = await browser.newContext()
        const page = await context.newPage()
        const problems: string[] = []
        page.on('pageerror', err => problems.push(`pageerror: ${err.message}`))
        page.on('console', (msg) => {
          if (msg.type() === 'error' || msg.type() === 'warning')
            problems.push(`${msg.type()}: ${msg.text()}`)
        })
        await page.addInitScript(() => {
          document.addEventListener('securitypolicyviolation', (e) => {
            console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`)
          })
        })
        await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 10_000 })
        if (path === '/') {
          await page.waitForFunction(() => [...document.querySelectorAll('pru-island')].every(el => (el as HTMLElement & { _d?: unknown })._d !== undefined), undefined, { timeout: 10_000 })
          await page.click('#inc')
          expect(await page.locator('#inc').innerText()).toBe('count:1')
        }
        if (path === '/styled') {
          const color = await page.evaluate(() => getComputedStyle(document.querySelector('#swatch')!).color)
          expect(color).toBe('rgb(10, 20, 30)')
        }
        expect(problems, path).toEqual([])
        await context.close()
      }
    }
    finally {
      await browser.close()
      server.stop(true)
    }

    // 3. Base path (assetPrefix) static build still embeds CSP meta and loads assets under the prefix.
    const prefixDir = makeApp('prunelle-static-csp-prefix-')
    await build({ root: prefixDir, static: true, assetPrefix: '/blog/_pru' })
    const prefixHtml = readFileSync(join(prefixDir, 'dist/index.html'), 'utf8')
    expect(prefixHtml).toContain('/blog/_pru/')
    expect(extractMetaCsp(prefixHtml)).toContain(PRUNELLE_ISLAND_STYLE_HASH)

    // 4. security.csp: false and security: false emit NO CSP meta tag on pages or 404.
    for (const cfg of [
      `import { defineConfig } from 'prunelle/config'\nexport default defineConfig({ security: { csp: false } })\n`,
      `import { defineConfig } from 'prunelle/config'\nexport default defineConfig({ security: false })\n`,
    ]) {
      const noCspDir = makeApp('prunelle-static-nocsp-', cfg)
      await build({ root: noCspDir, static: true })
      expect(extractMetaCsp(readFileSync(join(noCspDir, 'dist/index.html'), 'utf8'))).toBeUndefined()
      expect(extractMetaCsp(readFileSync(join(noCspDir, 'dist/404.html'), 'utf8'))).toBeUndefined()
    }

    // 5. Extended CSP object in prunelle.config.ts lands in static meta CSP with hashes.
    const extDir = makeApp(
      'prunelle-static-extcsp-',
      `import { defineConfig } from 'prunelle/config'\nexport default defineConfig({ security: { csp: { 'font-src': ['https://fonts.gstatic.com'], 'style-src': 'https://fonts.googleapis.com' } } })\n`,
    )
    await build({ root: extDir, static: true })
    const extMeta = extractMetaCsp(readFileSync(join(extDir, 'dist/index.html'), 'utf8'))!
    expect(extMeta).toContain(`style-src 'self' https://fonts.googleapis.com`)
    expect(extMeta).toContain(PRUNELLE_ISLAND_STYLE_HASH)
    expect(extMeta).toContain("font-src 'self' data: https://fonts.gstatic.com")
    expect(extractMetaCsp(readFileSync(join(extDir, 'dist/404.html'), 'utf8'))).toContain("font-src 'self' data: https://fonts.gstatic.com")

    // 6. Non-static (server) build with prerendered routes does NOT inject a meta CSP tag.
    const serverDir = makeApp('prunelle-server-prerender-csp-')
    await build({ root: serverDir })
    const preHtml = readFileSync(join(serverDir, 'dist/prerendered/index.html'), 'utf8')
    expect(extractMetaCsp(preHtml)).toBeUndefined()
  }, 30_000)
})
