import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { checkProject, diagnosticData } from '../src/cli/check'
import init, { PRUNELLE_CODE, PRUNELLE_DIAG_SOURCE } from '../src/ts-plugin/index'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'prunelle-ts-plugin-'))
  tempDirs.push(dir)
  return dir
}

interface HarnessOptions {
  projectRoot?: string
  config?: Record<string, unknown>
}

function createHarness(initialFiles: Record<string, string>, options: HarnessOptions = {}) {
  const root = options.projectRoot ?? '/project'
  const files = new Map<string, { text: string, version: number }>()
  let projectVersion = 1

  const toFullPath = (rel: string): string => (rel.startsWith('/') ? rel : join(root, rel))
  for (const [rel, text] of Object.entries(initialFiles))
    files.set(toFullPath(rel), { text, version: 1 })

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: fileName => String(files.get(fileName)?.version ?? 0),
    getProjectVersion: () => String(projectVersion),
    getScriptSnapshot: (fileName) => {
      const entry = files.get(fileName)
      return entry !== undefined ? ts.ScriptSnapshot.fromString(entry.text) : undefined
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      strict: true,
    }),
    getDefaultLibFileName: opts => ts.getDefaultLibFilePath(opts),
    fileExists: fileName => files.has(fileName),
    readFile: fileName => files.get(fileName)?.text,
  }

  const baseService = ts.createLanguageService(host, ts.createDocumentRegistry())
  const pluginModule = init({ typescript: ts })
  const info = {
    config: options.config ?? { name: 'prunelle/ts-plugin' },
    languageService: baseService,
    languageServiceHost: host,
    project: {
      getCurrentDirectory: () => root,
      projectService: {
        logger: {
          info: () => {},
        },
      },
    },
  } as unknown as ts.server.PluginCreateInfo

  const service = pluginModule.create(info)

  const prunelleDiags = (rel: string): ts.Diagnostic[] =>
    service.getSemanticDiagnostics(toFullPath(rel)).filter(d => d.source === PRUNELLE_DIAG_SOURCE)

  const prunelleFixes = (rel: string, diag: ts.Diagnostic): readonly ts.CodeFixAction[] =>
    service.getCodeFixesAtPosition(
      toFullPath(rel),
      diag.start ?? 0,
      (diag.start ?? 0) + (diag.length ?? 0),
      [diag.code],
      {},
      {},
    )

  const updateFile = (rel: string, text: string): void => {
    const full = toFullPath(rel)
    const prev = files.get(full)
    files.set(full, { text, version: (prev?.version ?? 0) + 1 })
    projectVersion++
  }

  return { root, service, toFullPath, prunelleDiags, prunelleFixes, updateFile }
}

function applyTextChanges(code: string, changes: readonly ts.TextChange[]): string {
  const sorted = [...changes].sort((a, b) => b.span.start - a.span.start)
  let next = code
  for (const ch of sorted)
    next = next.slice(0, ch.span.start) + ch.newText + next.slice(ch.span.start + ch.span.length)
  return next
}

function applyFirstFix(code: string, file = 'src/App.tsx', extraFiles: Record<string, string> = {}): { fixed: string, diag: ts.Diagnostic, fix: ts.CodeFixAction, remainingErrors: ts.Diagnostic[] } {
  const h = createHarness({ ...extraFiles, [file]: code })
  const diags = h.prunelleDiags(file)
  expect(diags.length).toBeGreaterThan(0)
  const diag = diags[0]!
  const fixes = h.prunelleFixes(file, diag)
  expect(fixes.length).toBeGreaterThan(0)
  const fix = fixes[0]!
  const fileChange = fix.changes.find(c => c.fileName === h.toFullPath(file))
  expect(fileChange).toBeDefined()
  const fixed = applyTextChanges(code, fileChange!.textChanges)
  h.updateFile(file, fixed)
  const remainingErrors = h.prunelleDiags(file).filter(d => d.category === ts.DiagnosticCategory.Error)
  return { fixed, diag, fix, remainingErrors }
}

describe('ts-plugin diagnostics', () => {
  test('reports bare signal read, lowercase event, and React/Solid/Astro habits at exact spans', () => {
    const code = [
      `import { signal } from 'prunelle'`,
      `export default function App() {`,
      `  const n = signal(0)`,
      `  return (`,
      `    <div onFocus={() => {}} ariaLabel="box">`,
      `      <button onclick={() => n.value++}>{n}</button>`,
      `      <svg><path strokeWidth="2" /></svg>`,
      `      <input aria-label="x" defaultValue="a" />`,
      `      <span dangerouslySetInnerHTML={{ __html: '<b>hi</b>' }} />`,
      `      <button onClick={n.value++}>bad</button>`,
      `      <button on:click={() => {}}>ns</button>`,
      `      <Widget client:visible />`,
      `    </div>`,
      `  )`,
      `}`,
    ].join('\n')

    const h = createHarness({ 'src/App.tsx': code })
    const diags = h.prunelleDiags('src/App.tsx')
    const messages = diags.map(d => String(d.messageText))

    expect(messages.some(m => m.includes('n without .value in src/App.tsx: write n.value.'))).toBe(true)
    expect(messages.some(m => m.includes('onclick in src/App.tsx: write onClick={...}'))).toBe(true)
    expect(messages.some(m => m.includes('onFocus on <div> in src/App.tsx: focus does not bubble, write onFocusIn={...}'))).toBe(true)
    expect(messages.some(m => m.includes('ariaLabel in src/App.tsx: write aria-label={...}'))).toBe(true)
    expect(messages.some(m => m.includes('strokeWidth in src/App.tsx: write stroke-width={...}'))).toBe(true)
    expect(messages.some(m => m.includes('defaultValue in src/App.tsx: write value={...}'))).toBe(true)
    expect(messages.some(m => m.includes('dangerouslySetInnerHTML in src/App.tsx: write innerHTML='))).toBe(true)
    expect(messages.some(m => m.includes('onClick runs n.value++ at render in src/App.tsx: write onClick={() => n.value++}.'))).toBe(true)
    expect(messages.some(m => m.includes('on:click in src/App.tsx: write onClick={...}'))).toBe(true)
    expect(messages.some(m => m.includes('client:visible in src/App.tsx: write $hydrate="visible"'))).toBe(true)

    const bareDiag = diags.find(d => d.code === PRUNELLE_CODE.BARE_SIGNAL)!
    expect(code.slice(bareDiag.start!, bareDiag.start! + bareDiag.length!)).toBe('n')

    const onclickDiag = diags.find(d => d.code === PRUNELLE_CODE.LOWERCASE_EVENT)!
    expect(code.slice(onclickDiag.start!, onclickDiag.start! + onclickDiag.length!)).toBe('onclick')
  })

  test('reports directives, <Suspense> children, <Head> in island, async interactive, island(), hydrate mode, and @kayjs imports', () => {
    const h = createHarness({
      'src/directive.tsx': `'use client'\nexport default function A() { return <p>hi</p> }\n`,
      'src/suspense.tsx': `import { Suspense } from 'prunelle'\nexport default function S() { return <Suspense><A /><B /></Suspense> }\n`,
      'src/head-island.tsx': `import { Head, signal } from 'prunelle'\nexport default function P() { const c = signal(0); return <><Head><title>x</title></Head><p>{c.value}</p></> }\n`,
      'src/async-island.tsx': `import { signal } from 'prunelle'\nexport default async function P() { const c = signal(0); return <p>{c.value}</p> }\n`,
      'src/removed-island.tsx': `import { island } from 'prunelle'\nexport default island(() => <p>x</p>)\n`,
      'src/bad-hydrate.tsx': `export const hydrate = 'bogus'\nexport default function P() { return <p>x</p> }\n`,
      'src/kay.tsx': `import { signal } from '@kayjs/kay'\nexport const n = signal(0)\n`,
    })

    expect(h.prunelleDiags('src/directive.tsx')[0]?.messageText).toContain(`'use client' in src/directive.tsx: delete it`)
    expect(h.prunelleDiags('src/suspense.tsx')[0]?.messageText).toContain('<Suspense> with 2 children in src/suspense.tsx')
    expect(h.prunelleDiags('src/head-island.tsx')[0]?.messageText).toContain('<Head> in an island in src/head-island.tsx')
    expect(h.prunelleDiags('src/async-island.tsx')[0]?.messageText).toContain('async route component in src/async-island.tsx cannot use browser interactivity')
    expect(h.prunelleDiags('src/removed-island.tsx')[0]?.messageText).toContain('island() in src/removed-island.tsx: it is gone')
    expect(h.prunelleDiags('src/bad-hydrate.tsx')[0]?.messageText).toContain('hydrate = "bogus" in src/bad-hydrate.tsx')
    expect(h.prunelleDiags('src/kay.tsx')[0]?.messageText).toContain(`import from '@kayjs/kay' in src/kay.tsx: write 'prunelle'`)
  })

  test('reports compliance & browser-global warnings with Warning category and respects prunelle-ignore and config', () => {
    const code = [
      `export default function Page() {`,
      `  const w = window.innerWidth`,
      `  return (`,
      `    <div>`,
      `      <img src="/a.png" />`,
      `      {/* prunelle-ignore rgaa/img-alt */}`,
      `      <img src="/b.png" />`,
      `      <input type="text" onChange={() => {}} />`,
      `      <script src="https://cdn.example.com/a.js"></script>`,
      `      <p>{w}</p>`,
      `    </div>`,
      `  )`,
      `}`,
    ].join('\n')

    const h = createHarness({ 'src/Page.tsx': code })
    const warnings = h.prunelleDiags('src/Page.tsx')
    expect(warnings.every(d => d.category === ts.DiagnosticCategory.Warning)).toBe(true)
    const msgs = warnings.map(d => String(d.messageText))

    // Only one img-alt warning (second img is suppressed by prunelle-ignore)
    expect(msgs.filter(m => m.includes('[rgaa/img-alt]')).length).toBe(1)
    expect(msgs.some(m => m.includes('[rgaa/form-label]'))).toBe(true)
    expect(msgs.some(m => m.includes('[rgpd/third-party-url]'))).toBe(true)
    expect(msgs.some(m => m.includes('onChange on <input> in src/Page.tsx'))).toBe(true)
    expect(msgs.some(m => m.includes('`window` read while <Page> renders in src/Page.tsx'))).toBe(true)

    // Respects compliance.ignore and site in plugin config
    const hFiltered = createHarness(
      { 'src/Page.tsx': code },
      { config: { name: 'prunelle/ts-plugin', site: 'https://cdn.example.com', compliance: { ignore: ['rgaa/img-alt', 'rgaa/form-label'] } } },
    )
    const filteredMsgs = hFiltered.prunelleDiags('src/Page.tsx').map(d => String(d.messageText))
    expect(filteredMsgs.some(m => m.includes('[rgaa/img-alt]'))).toBe(false)
    expect(filteredMsgs.some(m => m.includes('[rgaa/form-label]'))).toBe(false)
    expect(filteredMsgs.some(m => m.includes('[rgpd/third-party-url]'))).toBe(false)
  })

  test('skips node_modules, .d.ts, and incomplete syntax while typing', () => {
    const h = createHarness({
      'node_modules/pkg/index.tsx': `export default function A() { return <button onclick={() => {}}>x</button> }\n`,
      'src/types.d.ts': `export declare const x: number\n`,
      'src/typing.tsx': `export default function A() { return <button onclick={`,
    })
    expect(h.prunelleDiags('node_modules/pkg/index.tsx')).toEqual([])
    expect(h.prunelleDiags('src/types.d.ts')).toEqual([])
    expect(h.prunelleDiags('src/typing.tsx')).toEqual([])
  })

  test('reads static compliance and site from prunelle.config.ts without executing it and registers supported code fixes', () => {
    const dir = makeTempProject()
    writeFileSync(
      join(dir, 'prunelle.config.ts'),
      [
        `throw new Error('must never execute user config inside tsserver')`,
        `export default {`,
        `  site: 'https://assets.example.org',`,
        `  compliance: { ignore: ['rgaa/img-alt'] },`,
        `}`,
      ].join('\n'),
    )
    const code = [
      `export default function Page() {`,
      `  return <div><img src="/a.png" /><script src="https://assets.example.org/app.js"></script><input type="text" /></div>`,
      `}`,
    ].join('\n')

    const h = createHarness({ 'src/Page.tsx': code }, { projectRoot: dir })
    const msgs = h.prunelleDiags('src/Page.tsx').map(d => String(d.messageText))
    expect(msgs.some(m => m.includes('[rgaa/img-alt]'))).toBe(false)
    expect(msgs.some(m => m.includes('[rgpd/third-party-url]'))).toBe(false)
    expect(msgs.some(m => m.includes('[rgaa/form-label]'))).toBe(true)

    const supported = ts.getSupportedCodeFixes()
    expect(supported).toContain(String(PRUNELLE_CODE.BARE_SIGNAL))
    expect(supported).toContain(String(PRUNELLE_CODE.LOWERCASE_EVENT))
  })

  test('produces exact message parity with prunelle check', async () => {
    const dir = makeTempProject()
    mkdirSync(join(dir, 'src/routes'), { recursive: true })
    const routeCode = [
      `import { signal } from 'prunelle'`,
      `export default function Home() {`,
      `  const count = signal(0)`,
      `  return (`,
      `    <div>`,
      `      <img src="/logo.png" />`,
      `      <button onclick={() => count.value++}>{count}</button>`,
      `    </div>`,
      `  )`,
      `}`,
    ].join('\n')
    writeFileSync(join(dir, 'src/routes/index.tsx'), routeCode)
    writeFileSync(join(dir, 'src/routes/mentions-legales.tsx'), `export default function Legal() { return <p>Legal</p> }\n`)

    const check = await checkProject(dir, { skipTypecheck: true })
    const checkErrs = check.errors.map(e => diagnosticData(e, 'error')).filter(d => d.file === 'src/routes/index.tsx').map(d => d.message).sort()
    const checkWarns = check.warnings.map(w => diagnosticData(w, 'warning')).filter(d => d.file === 'src/routes/index.tsx').map(d => d.message).sort()

    const h = createHarness({ 'src/routes/index.tsx': routeCode }, { projectRoot: dir })
    const pluginDiags = h.prunelleDiags('src/routes/index.tsx')
    const pluginErrs = pluginDiags.filter(d => d.category === ts.DiagnosticCategory.Error).map(d => String(d.messageText)).sort()
    const pluginWarns = pluginDiags.filter(d => d.category === ts.DiagnosticCategory.Warning).map(d => String(d.messageText)).sort()

    expect(pluginErrs).toEqual(checkErrs)
    expect(pluginWarns).toEqual(checkWarns)
  })
})

describe('ts-plugin quick fixes', () => {
  test('1. bare signal read: n -> n.value and ns.n -> ns.n.value', () => {
    const local = applyFirstFix(`import { signal } from 'prunelle'\nexport default function C() { const n = signal(0); return <p>{n}</p> }\n`)
    expect(local.fixed).toBe(`import { signal } from 'prunelle'\nexport default function C() { const n = signal(0); return <p>{n.value}</p> }\n`)
    expect(local.remainingErrors).toEqual([])

    const ns = applyFirstFix(
      `import * as ns from './store'\nexport default function C() { return <p>{ns.n}</p> }\n`,
      'src/App.tsx',
      { 'src/store.ts': `import { signal } from 'prunelle'\nexport const n = signal(0)\n` },
    )
    expect(ns.fixed).toBe(`import * as ns from './store'\nexport default function C() { return <p>{ns.n.value}</p> }\n`)
    expect(ns.remainingErrors).toEqual([])
  })

  test('2. lowercase DOM event: onclick -> onClick, onkeydown -> onKeyDown', () => {
    const click = applyFirstFix(`export default function C() { return <button onclick={() => {}}>ok</button> }\n`)
    expect(click.fixed).toBe(`export default function C() { return <button onClick={() => {}}>ok</button> }\n`)
    expect(click.remainingErrors).toEqual([])

    const key = applyFirstFix(`export default function C() { return <button onkeydown={() => {}}>ok</button> }\n`)
    expect(key.fixed).toBe(`export default function C() { return <button onKeyDown={() => {}}>ok</button> }\n`)
    expect(key.remainingErrors).toEqual([])
  })

  test('3. renamed React event: onDoubleClick -> onDblClick', () => {
    const res = applyFirstFix(`export default function C() { return <button onDoubleClick={() => {}}>ok</button> }\n`)
    expect(res.fixed).toBe(`export default function C() { return <button onDblClick={() => {}}>ok</button> }\n`)
    expect(res.remainingErrors).toEqual([])
  })

  test('4. namespaced attributes: on:click, client:visible, client:only, set:html, prop:foo', () => {
    const ev = applyFirstFix(`export default function C() { return <button on:click={() => {}}>ok</button> }\n`)
    expect(ev.fixed).toBe(`export default function C() { return <button onClick={() => {}}>ok</button> }\n`)
    expect(ev.remainingErrors).toEqual([])

    const vis = applyFirstFix(`export default function C() { return <Widget client:visible /> }\n`)
    expect(vis.fixed).toBe(`export default function C() { return <Widget $hydrate="visible" /> }\n`)
    expect(vis.remainingErrors).toEqual([])

    const only = applyFirstFix(`export default function C() { return <Widget client:only="react" /> }\n`)
    expect(only.fixed).toBe(`export default function C() { return <Widget $hydrate="client" /> }\n`)
    expect(only.remainingErrors).toEqual([])

    const setHtml = applyFirstFix(`export default function C() { return <div set:html="<p>hi</p>" /> }\n`)
    expect(setHtml.fixed).toBe(`export default function C() { return <div innerHTML="<p>hi</p>" /> }\n`)
    expect(setHtml.remainingErrors).toEqual([])

    const prop = applyFirstFix(`export default function C() { return <div prop:title="hi" /> }\n`)
    expect(prop.fixed).toBe(`export default function C() { return <div title="hi" /> }\n`)
    expect(prop.remainingErrors).toEqual([])
  })

  test('5. camelCase ARIA: ariaLabel -> aria-label', () => {
    const res = applyFirstFix(`export default function C() { return <button ariaLabel="close">x</button> }\n`)
    expect(res.fixed).toBe(`export default function C() { return <button aria-label="close">x</button> }\n`)
    expect(res.remainingErrors).toEqual([])
  })

  test('6. camelCase SVG: strokeWidth -> stroke-width and xlinkHref -> xlink:href', () => {
    const sw = applyFirstFix(`export default function C() { return <svg><path strokeWidth="2" /></svg> }\n`)
    expect(sw.fixed).toBe(`export default function C() { return <svg><path stroke-width="2" /></svg> }\n`)
    expect(sw.remainingErrors).toEqual([])

    const xl = applyFirstFix(`export default function C() { return <svg><use xlinkHref="#a" /></svg> }\n`)
    expect(xl.fixed).toBe(`export default function C() { return <svg><use xlink:href="#a" /></svg> }\n`)
    expect(xl.remainingErrors).toEqual([])
  })

  test('7. React uncontrolled defaults: defaultValue -> value, defaultChecked -> checked', () => {
    const dv = applyFirstFix(`export default function C() { return <input aria-label="a" defaultValue="hi" /> }\n`)
    expect(dv.fixed).toBe(`export default function C() { return <input aria-label="a" value="hi" /> }\n`)
    expect(dv.remainingErrors).toEqual([])

    const dc = applyFirstFix(`export default function C() { return <input aria-label="a" type="checkbox" defaultChecked /> }\n`)
    expect(dc.fixed).toBe(`export default function C() { return <input aria-label="a" type="checkbox" checked /> }\n`)
    expect(dc.remainingErrors).toEqual([])
  })

  test('8. boolean string "false": disabled="false" -> disabled={false}', () => {
    const res = applyFirstFix(`export default function C() { return <button disabled="false">ok</button> }\n`)
    expect(res.fixed).toBe(`export default function C() { return <button disabled={false}>ok</button> }\n`)
    expect(res.remainingErrors).toEqual([])
  })

  test('9. React innerHTML: dangerouslySetInnerHTML & innerHTML={{ __html }} -> innerHTML={expr}', () => {
    const danger = applyFirstFix(`export default function C({ html }: { html: string }) { return <div dangerouslySetInnerHTML={{ __html: html }} /> }\n`)
    expect(danger.fixed).toBe(`export default function C({ html }: { html: string }) { return <div innerHTML={html} /> }\n`)
    expect(danger.remainingErrors).toEqual([])

    const innerObj = applyFirstFix(`export default function C({ html }: { html: string }) { return <div innerHTML={{ __html: html }} /> }\n`)
    expect(innerObj.fixed).toBe(`export default function C({ html }: { html: string }) { return <div innerHTML={html} /> }\n`)
    expect(innerObj.remainingErrors).toEqual([])
  })

  test('10. render-time handler mutation: onClick={n.value++} -> onClick={() => n.value++}', () => {
    const res = applyFirstFix(`import { signal } from 'prunelle'\nexport default function C() { const n = signal(0); return <button onClick={n.value++}>{n.value}</button> }\n`)
    expect(res.fixed).toBe(`import { signal } from 'prunelle'\nexport default function C() { const n = signal(0); return <button onClick={() => n.value++}>{n.value}</button> }\n`)
    expect(res.remainingErrors).toEqual([])
  })

  test('11. directives: removes use client / use server cleanly', () => {
    const client = applyFirstFix(`'use client'\nexport default function C() { return <p>hi</p> }\n`)
    expect(client.fixed).toBe(`export default function C() { return <p>hi</p> }\n`)
    expect(client.remainingErrors).toEqual([])

    const server = applyFirstFix(`'use server';\nexport const x = 1\n`)
    expect(server.fixed).toBe(`export const x = 1\n`)
    expect(server.remainingErrors).toEqual([])
  })

  test('12. non-bubbling focus events: onFocus -> onFocusIn, onBlur -> onFocusOut', () => {
    const focus = applyFirstFix(`export default function C() { return <div onFocus={() => {}}>hi</div> }\n`)
    expect(focus.fixed).toBe(`export default function C() { return <div onFocusIn={() => {}}>hi</div> }\n`)
    expect(focus.remainingErrors).toEqual([])

    const blur = applyFirstFix(`export default function C() { return <div onBlur={() => {}}>hi</div> }\n`)
    expect(blur.fixed).toBe(`export default function C() { return <div onFocusOut={() => {}}>hi</div> }\n`)
    expect(blur.remainingErrors).toEqual([])
  })

  test('13. text input onChange warning -> onInput', () => {
    const code = `export default function C() { return <input aria-label="name" onChange={() => {}} /> }\n`
    const res = applyFirstFix(code)
    expect(res.diag.category).toBe(ts.DiagnosticCategory.Warning)
    expect(res.fixed).toBe(`export default function C() { return <input aria-label="name" onInput={() => {}} /> }\n`)
    const h = createHarness({ 'src/App.tsx': res.fixed })
    expect(h.prunelleDiags('src/App.tsx')).toEqual([])
  })

  test('14. @kayjs/* import -> prunelle / @prunellejs/*', () => {
    const core = applyFirstFix(`import { signal } from '@kayjs/kay'\nexport const n = signal(0)\n`, 'src/a.ts')
    expect(core.fixed).toBe(`import { signal } from 'prunelle'\nexport const n = signal(0)\n`)
    expect(core.remainingErrors).toEqual([])

    const plugin = applyFirstFix(`import { auth } from "@kayjs/auth"\nexport const a = auth\n`, 'src/b.ts')
    expect(plugin.fixed).toBe(`import { auth } from "@prunellejs/auth"\nexport const a = auth\n`)
    expect(plugin.remainingErrors).toEqual([])
  })
})

describe('ts-plugin Node.js tsserver compatibility', () => {
  test('loads packages/prunelle/ts-plugin.cjs in real Node.js and serves diagnostics + quick fixes', () => {
    const pluginPath = resolve(import.meta.dir, '../ts-plugin.cjs')
    const script = `
      const ts = require('typescript');
      const init = require(${JSON.stringify(pluginPath)});
      if (typeof init !== 'function') throw new Error('expected callable CJS factory, got ' + typeof init);
      const file = '/app/src/Counter.tsx';
      const code = "import { signal } from 'prunelle'\\nexport default function Counter() {\\n  const n = signal(0)\\n  return <button onclick={() => n.value++}>{n}</button>\\n}\\n";
      const host = {
        getScriptFileNames: () => [file],
        getScriptVersion: () => '1',
        getScriptSnapshot: f => f === file ? ts.ScriptSnapshot.fromString(code) : undefined,
        getCurrentDirectory: () => '/app',
        getCompilationSettings: () => ({ target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve }),
        getDefaultLibFileName: opts => ts.getDefaultLibFilePath(opts),
        fileExists: f => f === file,
        readFile: f => f === file ? code : undefined,
      };
      const base = ts.createLanguageService(host, ts.createDocumentRegistry());
      const ls = init({ typescript: ts }).create({
        config: { name: 'prunelle/ts-plugin' },
        languageService: base,
        languageServiceHost: host,
        project: { getCurrentDirectory: () => '/app', projectService: { logger: { info() {} } } },
      });
      const diags = ls.getSemanticDiagnostics(file).filter(d => d.source === 'prunelle');
      const bare = diags.find(d => String(d.messageText).includes('n without .value'));
      const lower = diags.find(d => String(d.messageText).includes('onclick'));
      if (!bare || !lower) throw new Error('missing diagnostics: ' + JSON.stringify(diags.map(d => d.messageText)));
      const bareFixes = ls.getCodeFixesAtPosition(file, bare.start, bare.start + bare.length, [bare.code], {}, {});
      const lowerFixes = ls.getCodeFixesAtPosition(file, lower.start, lower.start + lower.length, [lower.code], {}, {});
      console.log(JSON.stringify({
        diagCount: diags.length,
        bareFix: bareFixes[0]?.changes[0]?.textChanges[0],
        lowerFix: lowerFixes[0]?.changes[0]?.textChanges[0],
      }));
    `
    const proc = Bun.spawnSync(['node', '-e', script], { cwd: resolve(import.meta.dir, '../../..') })
    if (proc.exitCode !== 0)
      throw new Error(`node exited with ${proc.exitCode}:\n${proc.stderr.toString()}`)
    const out = JSON.parse(proc.stdout.toString().trim()) as {
      diagCount: number
      bareFix?: { newText: string }
      lowerFix?: { newText: string }
    }
    expect(out.diagCount).toBe(2)
    expect(out.bareFix?.newText).toBe('n.value')
    expect(out.lowerFix?.newText).toBe('onClick')
  })
})
