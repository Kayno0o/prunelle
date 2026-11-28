import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileDom, compileSsr } from '../src/compiler/index'
import { pruneForClient } from '../src/build/client-prune'
import { parseTsx } from '../src/compiler/analyze'
import { devServer } from '../src/dev/index'
import { buildEditorCommand, handleOpenEditorRequest, openInEditor, parseSourceLoc } from '../src/dev/open-editor'
import { makeDevReloadAssets } from '../src/dev/reload'
import { testApp, testBrowser } from '../src/test/index'

const PRUNELLE_PKG_DIR = join(import.meta.dir, '..')
const tempDirs: string[] = []

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function linkPrunelle(dir: string): void {
  mkdirSync(join(dir, 'node_modules/@prunellejs'), { recursive: true })
  symlinkSync(PRUNELLE_PKG_DIR, join(dir, 'node_modules/prunelle'), 'dir')
}

afterAll(() => {
  for (const d of tempDirs)
    rmSync(d, { recursive: true, force: true })
})

describe('Dev source tagging in compileSsr & compileDom (#22)', () => {
  const sampleTsx = [
    'import { signal } from \'prunelle\'',
    'export function Page(props: { rest: Record<string, string> }) {',
    '  const count = signal(0)',
    '  return (',
    '    <html lang="en">',
    '      <head>',
    '        <meta charset="utf-8" />',
    '        <title>Demo</title>',
    '        <link rel="stylesheet" href="/app.css" />',
    '        <style>{`body { margin: 0; }`}</style>',
    '        <script>{`window.__x = 1`}</script>',
    '        <noscript><p>Enable JS</p></noscript>',
    '      </head>',
    '      <body>',
    '        <main class="shell">',
    '          <h1>Hello</h1>',
    '          <button type="button" onClick={() => count.value++}>Count {count.value}</button>',
    '          <span data-pru-src="custom:1:1">Kept</span>',
    '          <div {...props.rest}>Spread</div>',
    '        </main>',
    '      </body>',
    '    </html>',
    '  )',
    '}',
  ].join('\n')

  it('produces zero data-pru-src and byte-identical output when devSourceRoot is omitted', () => {
    const ssrDefault = compileSsr('/app/src/routes/index.tsx', sampleTsx)
    const ssrExplicitUndef = compileSsr('/app/src/routes/index.tsx', sampleTsx, { devSourceRoot: undefined })
    expect(ssrDefault.code).toBe(ssrExplicitUndef.code)
    expect(ssrDefault.code).not.toContain('data-pru-src="src/')

    const domDefault = compileDom('/app/src/routes/index.tsx', sampleTsx)
    const domExplicitUndef = compileDom('/app/src/routes/index.tsx', sampleTsx, { devSourceRoot: undefined })
    expect(domDefault.code).toBe(domExplicitUndef.code)
    expect(domDefault.code).not.toContain('data-pru-src="src/')
  })

  it('emits exact file:line:col in SSR and DOM when devSourceRoot is set, skipping document/head/raw-text tags and preserving explicit data-pru-src', () => {
    const ssr = compileSsr('/app/src/routes/index.tsx', sampleTsx, { devSourceRoot: '/app' }).code
    const dom = compileDom('/app/src/routes/index.tsx', sampleTsx, { devSourceRoot: '/app' }).code

    for (const out of [ssr, dom]) {
      // Skipped document/head/raw-text tags never get data-pru-src
      expect(out).not.toMatch(/<(?:html|head|meta|title|link|base|style|script|noscript)\s+data-pru-src=/)

      // Exact 1-based line and col on intrinsic elements
      expect(out).toContain('<body data-pru-src=\\"src/routes/index.tsx:14:7\\">')
      expect(out).toContain('<main data-pru-src=\\"src/routes/index.tsx:15:9\\" class=\\"shell\\">')
      expect(out).toContain('<h1 data-pru-src=\\"src/routes/index.tsx:16:11\\">')
      expect(out).toContain('<button data-pru-src=\\"src/routes/index.tsx:17:11\\" type=\\"button\\">')
      expect(out).toContain('<p data-pru-src=\\"src/routes/index.tsx:12:19\\">')

      // Explicit data-pru-src is respected without duplication
      expect(out).toContain('data-pru-src=\\"custom:1:1\\"')
      expect(out).not.toContain('src/routes/index.tsx:18:')

      // Spread elements keep data-pru-src cleanly
      expect(out).toContain('<div data-pru-src=\\"src/routes/index.tsx:19:11\\"')
    }
  })

  it('preserves exact line and column offsets when pruneForClient runs with preserveLines: true', () => {
    const sameFile = [
      'import { signal } from \'prunelle\'',
      'import { readFileSync } from \'node:fs\'',
      '',
      'export async function load() {',
      '  const x = readFileSync(\'a\', \'utf8\')',
      '  return { x }',
      '}',
      '',
      'export function Counter() {',
      '  const n = signal(0)',
      '  return <button onClick={() => n.value++}>{n.value}</button>',
      '}',
      '',
      'export default function Page() {',
      '  return <main><Counter /></main>',
      '}',
    ].join('\n')

    const pruned = pruneForClient(sameFile, parseTsx('/app/src/routes/index.tsx', sameFile), new Set(['signal', 'Counter']), { preserveLines: true })
    const ssr = compileSsr('/app/src/routes/index.tsx', sameFile, { devSourceRoot: '/app' }).code
    const dom = compileDom('/app/src/routes/index.tsx', pruned, { devSourceRoot: '/app' }).code

    expect(ssr).toContain('data-pru-src=\\"src/routes/index.tsx:11:10\\"')
    expect(dom).toContain('data-pru-src=\\"src/routes/index.tsx:11:10\\"')
  })
})

describe('open-editor command builder and path confinement (#22)', () => {
  const loc = { file: '/workspace/app/src/routes/index.tsx', line: 42, col: 7 }

  it('builds editor commands for VS Code, Zed, JetBrains, Sublime/Helix, terminal editors, templates, and quoted paths', () => {
    expect(buildEditorCommand('code', loc)).toEqual(['code', '--goto', `${loc.file}:42:7`])
    expect(buildEditorCommand('cursor --reuse-window', loc)).toEqual(['cursor', '--reuse-window', '--goto', `${loc.file}:42:7`])
    expect(buildEditorCommand('zed', loc)).toEqual(['zed', `${loc.file}:42:7`])
    expect(buildEditorCommand('zeditor -n', loc)).toEqual(['zeditor', '-n', `${loc.file}:42:7`])
    expect(buildEditorCommand('webstorm', loc)).toEqual(['webstorm', '--line', '42', '--column', '7', loc.file])
    expect(buildEditorCommand('idea', loc)).toEqual(['idea', '--line', '42', '--column', '7', loc.file])
    expect(buildEditorCommand('subl', loc)).toEqual(['subl', `${loc.file}:42:7`])
    expect(buildEditorCommand('hx', loc)).toEqual(['hx', `${loc.file}:42:7`])
    expect(buildEditorCommand('nvim', loc)).toEqual(['nvim', '+42', loc.file])
    expect(buildEditorCommand('my-ed --open {file} --at {line},{col}', loc)).toEqual([
      'my-ed', '--open', loc.file, '--at', '42,7',
    ])
    expect(buildEditorCommand('"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" -r', loc)).toEqual([
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', '-r', '--goto', `${loc.file}:42:7`,
    ])
  })

  it('rejects path traversal, outside-root absolute paths, escaping symlinks, missing files, and missing editor env', () => {
    const root = makeTemp('prunelle-open-editor-root-')
    const outside = makeTemp('prunelle-open-editor-outside-')
    mkdirSync(join(root, 'src/routes'), { recursive: true })
    const validFile = join(root, 'src/routes/index.tsx')
    const outsideFile = join(outside, 'secret.txt')
    writeFileSync(validFile, 'export default () => <div />\n')
    writeFileSync(outsideFile, 'secret\n')
    symlinkSync(outsideFile, join(root, 'src/escape.tsx'))

    // Traversal
    const trav = parseSourceLoc('../etc/passwd:1:1', root)
    expect('error' in trav && trav.status).toBe(403)

    // Absolute outside root
    const absOut = parseSourceLoc(`${outsideFile}:1:1`, root)
    expect('error' in absOut && absOut.status).toBe(403)

    // Symlink escaping root
    const symOut = parseSourceLoc('src/escape.tsx:1:1', root)
    expect('error' in symOut && symOut.status).toBe(403)

    // Missing file inside root
    const missing = parseSourceLoc('src/routes/nope.tsx:1:1', root)
    expect('error' in missing && missing.status).toBe(404)

    // Malformed loc
    const bad = parseSourceLoc('src/routes/index.tsx:0:1', root)
    expect('error' in bad && bad.status).toBe(400)

    // Missing editor env
    const noEnv = openInEditor('src/routes/index.tsx:1:1', root, { env: {} })
    expect(noEnv.ok).toBe(false)
    if (!noEnv.ok) {
      expect(noEnv.status).toBe(400)
      expect(noEnv.error).toContain('PRUNELLE_EDITOR')
    }

    // Valid open prefers PRUNELLE_EDITOR over VISUAL and invokes spawn with exact argv
    const spawned: string[][] = []
    const okPrimary = openInEditor('src/routes/index.tsx:1:5', root, {
      env: { PRUNELLE_EDITOR: 'zed', VISUAL: 'code' },
      spawn: cmd => spawned.push(cmd),
    })
    expect(okPrimary).toEqual({ ok: true, command: ['zed', `${validFile}:1:5`] })

    // Falls back to VISUAL when PRUNELLE_EDITOR is unset
    const okVisual = openInEditor('src/routes/index.tsx:1:5', root, {
      env: { VISUAL: 'code' },
      spawn: cmd => spawned.push(cmd),
    })
    expect(okVisual).toEqual({ ok: true, command: ['code', '--goto', `${validFile}:1:5`] })
    expect(spawned).toHaveLength(2)
  })

  it('handleOpenEditorRequest validates method, query param, and JSON body', async () => {
    const root = makeTemp('prunelle-open-editor-req-')
    mkdirSync(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/a.tsx')
    writeFileSync(file, 'export default () => <p />\n')

    const getRes = await handleOpenEditorRequest(new Request('http://localhost/_pru/open-editor'), root)
    expect(getRes.status).toBe(405)

    const badJsonRes = await handleOpenEditorRequest(new Request('http://localhost/_pru/open-editor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    }), root)
    expect(badJsonRes.status).toBe(400)

    const spawned: string[][] = []
    const queryRes = await handleOpenEditorRequest(
      new Request('http://localhost/_pru/open-editor?src=src/a.tsx:1:22', { method: 'POST' }),
      root,
      { env: { PRUNELLE_EDITOR: 'webstorm' }, spawn: cmd => spawned.push(cmd) },
    )
    expect(queryRes.status).toBe(200)
    expect(spawned).toEqual([['webstorm', '--line', '1', '--column', '22', file]])
  })
})

describe('devServer & hydration end-to-end (#22)', () => {
  it('devServer tags HTML with data-pru-src, injects CSP-hashed Alt-click handler, and exposes /_pru/open-editor', async () => {
    const dir = makeTemp('prunelle-dev-src-jump-')
    linkPrunelle(dir)
    mkdirSync(join(dir, 'src/routes'), { recursive: true })
    writeFileSync(join(dir, 'src/routes/index.tsx'), [
      'export default function Home() {',
      '  return <main><h1>Jump target</h1></main>',
      '}',
    ].join('\n'))

    const assets = makeDevReloadAssets('/_pru')
    expect(assets.openEditorPath).toBe('/_pru/open-editor')
    expect(assets.script).toContain('e.altKey')
    expect(assets.script).toContain('/_pru/open-editor')

    const srv = await devServer({ root: dir, port: 0 })
    try {
      const res = await fetch(`${srv.url}/`)
      const html = await res.text()
      const csp = res.headers.get('content-security-policy') ?? ''

      expect(html).toContain('<main data-pru-src="src/routes/index.tsx:2:10">')
      expect(html).toContain('<h1 data-pru-src="src/routes/index.tsx:2:16">Jump target</h1>')
      expect(html).toContain('/_pru/open-editor')
      expect(csp).toContain(assets.hash)
      expect(html).not.toMatch(/<(?:html|head|meta|title|script)\s+data-pru-src=/)

      const methodRes = await fetch(`${srv.url}/_pru/open-editor`, { method: 'GET' })
      expect(methodRes.status).toBe(405)

      const missingBody = await fetch(`${srv.url}/_pru/open-editor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(missingBody.status).toBe(400)

      const prevEditor = process.env.PRUNELLE_EDITOR
      const prevVisual = process.env.VISUAL
      try {
        process.env.PRUNELLE_EDITOR = 'code'
        const traversalRes = await fetch(`${srv.url}/_pru/open-editor`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ src: '../etc/passwd:1:1' }),
        })
        expect(traversalRes.status).toBe(403)
      }
      finally {
        if (prevEditor === undefined)
          delete process.env.PRUNELLE_EDITOR
        else
          process.env.PRUNELLE_EDITOR = prevEditor
        if (prevVisual === undefined)
          delete process.env.VISUAL
        else
          process.env.VISUAL = prevVisual
      }
    }
    finally {
      await srv.stop()
    }
  })

  it('production testApp emits zero data-pru-src; dev testBrowser hydrates islands cleanly with data-pru-src on SSR and dynamic DOM nodes', async () => {
    const dir = makeTemp('prunelle-dev-hydrate-src-')
    linkPrunelle(dir)
    mkdirSync(join(dir, 'src/routes'), { recursive: true })
    mkdirSync(join(dir, 'src/components'), { recursive: true })

    writeFileSync(join(dir, 'src/components/Counter.tsx'), [
      'import { signal } from \'prunelle\'',
      'export function Counter() {',
      '  const items = signal([\'a\'])',
      '  return (',
      '    <section class="counter">',
      '      <button type="button" onClick={() => { items.value = [...items.value, `item-${items.value.length}`] }}>Add ({items.value.length})</button>',
      '      <ul>{items.value.map(item => <li key={item}>{item}</li>)}</ul>',
      '    </section>',
      '  )',
      '}',
    ].join('\n'))

    writeFileSync(join(dir, 'src/routes/index.tsx'), [
      'import { signal } from \'prunelle\'',
      'import { Counter } from \'../components/Counter\'',
      '',
      'export async function load() {',
      '  return { heading: \'Hydrate Dev\' }',
      '}',
      '',
      'export function LocalToggle() {',
      '  const open = signal(false)',
      '  return (',
      '    <div>',
      '      <button id="toggle" type="button" onClick={() => { open.value = !open.value }}>Toggle</button>',
      '      {open.value && <p id="revealed">Shown</p>}',
      '    </div>',
      '  )',
      '}',
      '',
      'export default function Home({ data }: { data: { heading: string } }) {',
      '  return <main><h1>{data.heading}</h1><Counter /><LocalToggle /></main>',
      '}',
    ].join('\n'))

    // Production build has zero data-pru-src anywhere
    const prod = await testApp({ root: dir })
    const prodHtml = await (await prod.get('/')).text()
    expect(prodHtml).not.toContain('data-pru-src')
    for (const file of prod.manifest?.assets ?? []) {
      if (file.endsWith('.js')) {
        const jsRes = await prod.get(`/_pru/${file}`)
        expect(jsRes.status).toBe(200)
        expect(await jsRes.text()).not.toContain('data-pru-src')
      }
    }

    // Dev browser test: hydrates islands with zero errors and keeps exact data-pru-src on SSR + dynamic nodes
    const browser = await testBrowser({ root: dir, dev: true })
    try {
      const page = await browser.open('/')
      try {
        expect(page.errors).toEqual([])
        const initial = await page.evaluate(() => ({
          h1: document.querySelector('h1')?.getAttribute('data-pru-src'),
          section: document.querySelector('section.counter')?.getAttribute('data-pru-src'),
          li: document.querySelector('li')?.getAttribute('data-pru-src'),
          toggleBtn: document.querySelector('#toggle')?.getAttribute('data-pru-src'),
        }))
        expect(initial.h1).toBe('src/routes/index.tsx:19:16')
        expect(initial.section).toBe('src/components/Counter.tsx:5:5')
        expect(initial.li).toBe('src/components/Counter.tsx:7:36')
        expect(initial.toggleBtn).toBe('src/routes/index.tsx:12:7')

        // Interactive island update creates new <li> with exact data-pru-src from compiled DOM template
        await page.click('section.counter button')
        expect(await page.text('section.counter button')).toBe('Add (2)')
        const liSrcs = await page.evaluate(() => [...document.querySelectorAll('li')].map(el => el.getAttribute('data-pru-src')))
        expect(liSrcs).toEqual([
          'src/components/Counter.tsx:7:36',
          'src/components/Counter.tsx:7:36',
        ])

        // Same-file island conditional render keeps exact line number despite pruned load() above it!
        await page.click('#toggle')
        await page.waitFor('#revealed')
        const revealedSrc = await page.evaluate(() => document.querySelector('#revealed')?.getAttribute('data-pru-src'))
        expect(revealedSrc).toBe('src/routes/index.tsx:13:22')
        expect(page.errors).toEqual([])
      }
      finally {
        await page.close()
      }
    }
    finally {
      await browser.close()
    }
  })
})
