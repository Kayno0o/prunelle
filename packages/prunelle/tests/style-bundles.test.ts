import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ui } from '../../ui/src/plugin'
import { build } from '../src/build/index'
import { minifyCss } from '../src/build/style-bundles'
import { testApp } from '../src/test/index'

const UI_ENTRY = join(import.meta.dir, '../../ui/src/index.ts')
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

const extractLinks = (html: string): string[] =>
  [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]!)

describe('Stylesheet consolidation (#29) and per-component UI CSS (#32)', () => {
  it('minifyCss preserves calc() operators, strings, descendant pseudo-selectors, and data URIs', () => {
    const src = `
      /* header comment */
      [data-ui] :focus-visible, [data-ui]:focus-visible {
        outline: 2px solid var(--ui-accent);
        width: calc(100% - 2px);
        border-radius: calc(var(--ui-radius) + 4px);
        background: url("data:image/svg+xml,<svg/>");
      }
      @media (max-width: 600px) and (hover: none) {
        a { content: "a  b"; }
      }
    `
    const min = minifyCss(src)
    expect(min).not.toContain('header comment')
    expect(min).toContain('[data-ui] :focus-visible,[data-ui]:focus-visible')
    expect(min).toContain('calc(100% - 2px)')
    expect(min).toContain('calc(var(--ui-radius) + 4px)')
    expect(min).toContain('url("data:image/svg+xml,<svg/>")')
    expect(min).toContain('@media (max-width:600px) and (hover:none)')
    expect(min).toContain('content:"a  b"')
  })

  it('consolidates site-wide + per-route stylesheets to at most 2 hashed immutable links in cascade order (#29)', async () => {
    const dir = makeTemp('prunelle-29-sheets-')
    mkdirSync(join(dir, 'src/routes/blog'), { recursive: true })
    mkdirSync(join(dir, 'src/styles'), { recursive: true })

    writeFileSync(join(dir, 'src/styles/plugin-a.css'), '@layer base { .p { color: rgb(1, 2, 3); } }\n')
    writeFileSync(join(dir, 'src/styles/plugin-b.css'), '.p2 { color: rgb(4, 5, 6); }\n')
    writeFileSync(join(dir, 'src/styles/root.css'), '.root { color: rgb(10, 20, 30); }\n')
    writeFileSync(join(dir, 'src/styles/blog-layout.css'), '.blog { color: rgb(40, 50, 60); }\n')
    writeFileSync(join(dir, 'src/styles/post.css'), '.post { color: rgb(70, 80, 90); }\n')

    writeFileSync(join(dir, 'src/routes/_layout.tsx'), `
      import type { PrunelleChild } from 'prunelle'
      import '../styles/root.css'
      export default function Root({ children }: { children?: PrunelleChild }) {
        return <div class="root">{children}</div>
      }
    `)
    writeFileSync(join(dir, 'src/routes/index.tsx'), `
      export default function Home() {
        return <main>Home</main>
      }
    `)
    writeFileSync(join(dir, 'src/routes/blog/_layout.tsx'), `
      import type { PrunelleChild } from 'prunelle'
      import '../../styles/blog-layout.css'
      export default function BlogLayout({ children }: { children?: PrunelleChild }) {
        return <section class="blog">{children}</section>
      }
    `)
    writeFileSync(join(dir, 'src/routes/blog/index.tsx'), `
      import '../../styles/post.css'
      export default function BlogPost() {
        return <article class="post">Post</article>
      }
    `)

    const plugins = [{ name: 'test-multi-css', css: ['src/styles/plugin-a.css', 'src/styles/plugin-b.css'] }]
    const app = await testApp({ root: dir, plugins, minify: true })

    const homeHtml = await (await app.get('/')).text()
    const blogHtml = await (await app.get('/blog')).text()

    const homeLinks = extractLinks(homeHtml)
    const blogLinks = extractLinks(blogHtml)

    // Home has only site-wide CSS -> 1 single hashed immutable sheet
    expect(homeLinks).toHaveLength(1)
    expect(homeLinks[0]).toMatch(/^\/_pru\/site-[0-9a-f]{8}\.css$/)

    // Blog shares the exact same site-wide sheet + 1 consolidated route sheet (merging blog-layout + post)
    expect(blogLinks).toHaveLength(2)
    expect(blogLinks[0]).toBe(homeLinks[0])
    expect(blogLinks[1]).toMatch(/^\/_pru\/route-[0-9a-f]{8}\.css$/)

    // Verify immutable cache header and cascade order: plugin-a -> plugin-b -> root in site sheet; blog-layout -> post in route sheet
    const siteRes = await app.get(homeLinks[0]!)
    expect(siteRes.headers.get('cache-control')).toContain('immutable')
    const siteCss = await siteRes.text()
    expect(siteCss.indexOf('.p{')).toBeLessThan(siteCss.indexOf('.p2{'))
    expect(siteCss.indexOf('.p2{')).toBeLessThan(siteCss.indexOf('.root{'))

    const routeRes = await app.get(blogLinks[1]!)
    expect(routeRes.headers.get('cache-control')).toContain('immutable')
    const routeCss = await routeRes.text()
    expect(routeCss.indexOf('.blog{')).toBeLessThan(routeCss.indexOf('.post{'))
    expect(routeCss).not.toContain('.root{')
  })

  it('links only the @prunellejs/ui CSS for components a route renders, keeping cascade order (#32)', async () => {
    const dir = makeTemp('prunelle-32-per-comp-')
    mkdirSync(join(dir, 'src/routes'), { recursive: true })
    mkdirSync(join(dir, 'src/styles'), { recursive: true })

    writeFileSync(join(dir, 'src/styles/app.css'), '[data-ui="button"] { letter-spacing: 0.04em; }\n')
    writeFileSync(join(dir, 'src/routes/_layout.tsx'), `
      import type { PrunelleChild } from 'prunelle'
      import '../styles/app.css'
      import { Stack } from ${JSON.stringify(UI_ENTRY)}
      export default function Layout({ children }: { children?: PrunelleChild }) {
        return <Stack gap="md">{children}</Stack>
      }
    `)
    writeFileSync(join(dir, 'src/routes/index.tsx'), `
      import { Button, Card, CardBody } from ${JSON.stringify(UI_ENTRY)}
      export default function Home() {
        return <Card><CardBody><Button tone="accent">Go</Button></CardBody></Card>
      }
    `)
    writeFileSync(join(dir, 'src/routes/admin.tsx'), `
      import { DataTable, Tabs } from ${JSON.stringify(UI_ENTRY)}
      export default function Admin() {
        return (
          <main>
            <Tabs items={[{ id: 'a', label: 'A', content: 'A' }]} />
            <DataTable rows={[{ id: '1', name: 'One' }]} columns={[{ key: 'name', label: 'Name' }]} />
          </main>
        )
      }
    `)

    const manifest = await build({ root: dir, plugins: [ui({ grammar: 'editorial' })] })
    const app = await testApp({ root: dir, plugins: [ui({ grammar: 'editorial' })] })

    const homeLinks = extractLinks(await (await app.get('/')).text())
    const adminLinks = extractLinks(await (await app.get('/admin')).text())

    expect(homeLinks.length).toBeLessThanOrEqual(2)
    expect(adminLinks.length).toBeLessThanOrEqual(2)
    expect(homeLinks[0]).toBe(adminLinks[0])

    let homeCss = ''
    for (const u of homeLinks)
      homeCss += await (await app.get(u)).text()
    let adminCss = ''
    for (const u of adminLinks)
      adminCss += await (await app.get(u)).text()

    // Home renders Stack + Button + Card ONLY — never DataTable, Tabs, CommandPalette, Accordion, etc.
    expect(homeCss).toContain('[data-layout="stack"]')
    expect(homeCss).toContain('[data-ui="button"]')
    expect(homeCss).toContain('[data-ui="card"]')
    expect(homeCss).not.toContain('[data-ui="datatable"]')
    expect(homeCss).not.toContain('[data-ui="tabs"]')
    expect(homeCss).not.toContain('[data-ui="command"]')
    expect(homeCss).not.toContain('[data-ui="accordion"]')

    // Admin renders Stack + Tabs + DataTable (+ Button via DataTable) — never Card or CommandPalette
    expect(adminCss).toContain('[data-ui="datatable"]')
    expect(adminCss).toContain('[data-ui="tabs"]')
    expect(adminCss).not.toContain('[data-ui="card"]')
    expect(adminCss).not.toContain('[data-ui="command"]')

    // Site sheet preserves @layer kui before unlayered app.css
    const siteCss = await (await app.get(homeLinks[0]!)).text()
    expect(siteCss.indexOf('@layer kui')).toBeLessThan(siteCss.indexOf('letter-spacing'))

    // Unused intermediate CSS files were pruned from dist/client
    expect(manifest.assets.filter(a => a.endsWith('.css')).length).toBeLessThanOrEqual(3)
  })
})
