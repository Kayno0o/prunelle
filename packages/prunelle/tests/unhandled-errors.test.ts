import { afterAll, describe, expect, it, spyOn } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../src/build/index'
import { devServer } from '../src/dev/index'
import { createServer, definePlugin } from '../src/server/index'
import { testApp } from '../src/test/index'

const PRUNELLE_PKG_DIR = join(import.meta.dir, '..')
const tempDirs: string[] = []
function appWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'prunelle-unhandled-'))
  tempDirs.push(dir)
  mkdirSync(join(dir, 'node_modules/@prunellejs'), { recursive: true })
  symlinkSync(PRUNELLE_PKG_DIR, join(dir, 'node_modules/prunelle'), 'dir')
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

afterAll(() => {
  for (const d of tempDirs)
    rmSync(d, { recursive: true, force: true })
})

const routes = {
  'src/routes/boom.tsx': `export default function Boom() { throw new Error('prunelle: page exploded') }`,
  'src/routes/api/boom.ts': `export function GET(): Response { throw new Error('api exploded') }`,
}

describe('unhandled runtime errors (#3607)', () => {
  it('testApp records them in app.errors, even without dev', async () => {
    const t = await testApp({ root: appWith(routes) })
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await t.get('/api/boom', { accept: 'application/json' })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ ok: false, status: 500, error: 'Internal Server Error' })
      await t.get('/boom')
      expect(t.errors).toEqual(['route GET /api/boom: api exploded', 'route GET /boom: prunelle: page exploded'])
      expect(quiet).not.toHaveBeenCalled()
    }
    finally {
      quiet.mockRestore()
    }
  })

  it('dev: true logs them and shows the message and stack in the response', async () => {
    const t = await testApp({ root: appWith(routes), dev: true })
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const json = await t.get('/api/boom', { accept: 'application/json' })
      const body = await json.json() as { ok: boolean, status: number, error: string, stack: string }
      expect(json.status).toBe(500)
      expect(body).toMatchObject({ ok: false, status: 500, error: 'api exploded' })
      expect(body.stack).toContain('api exploded')

      const page = await t.get('/boom')
      expect(page.status).toBe(500)
      expect(page.headers.get('content-type')).toContain('text/plain')
      expect(await page.text()).toContain('prunelle: page exploded')

      expect(log).toHaveBeenCalledTimes(2)
      expect(String(log.mock.calls[0]![0])).toContain('GET /api/boom')
      expect(t.errors).toHaveLength(2)
    }
    finally {
      log.mockRestore()
    }
  })

  it('dev: true stays quiet when an onError hook is configured', async () => {
    const dir = appWith({
      ...routes,
      'prunelle.config.ts': `import { defineConfig } from 'prunelle/config'\nexport default defineConfig({ onError: () => {} })`,
    })
    const t = await testApp({ root: dir, dev: true })
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await t.get('/api/boom')
      expect(log).not.toHaveBeenCalled()
      expect(t.errors).toHaveLength(1)
    }
    finally {
      log.mockRestore()
    }
  })

  it('prunelle dev answers a build error with JSON when the request asks for it', async () => {
    const dir = appWith({ 'src/routes/index.tsx': `export default function Home() { return <h1>ok</h1> }` })
    const srv = await devServer({ root: dir, port: 0 })
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      writeFileSync(join(dir, 'src/routes/index.tsx'), `export default function Home( { return <h1>broken</h1> }`)
      await srv.rebuild()
      const json = await fetch(`${srv.url}/`, { headers: { accept: 'application/json' } })
      expect(json.status).toBe(500)
      const body = await json.json() as { ok: boolean, status: number, error: string }
      expect(body).toMatchObject({ ok: false, status: 500 })
      expect(body.error.length).toBeGreaterThan(0)

      const text = await fetch(`${srv.url}/`, { headers: { accept: 'text/plain' } })
      expect(text.headers.get('content-type')).toContain('text/plain')
      expect(await text.text()).toBe(body.error)

      const html = await fetch(`${srv.url}/`, { headers: { accept: 'text/html' } })
      expect(html.headers.get('content-type')).toContain('text/html')
    }
    finally {
      log.mockRestore()
      srv.stop()
    }
  })

  it('prunelle dev answers a throwing route with its message in JSON', async () => {
    const dir = appWith(routes)
    const srv = await devServer({ root: dir, port: 0 })
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await fetch(`${srv.url}/api/boom`, { headers: { accept: 'application/json' } })
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ error: 'api exploded' })
    }
    finally {
      log.mockRestore()
      srv.stop()
    }
  })
})

// Each throw sits a few lines down, below a multi-line JSX root, so a shifted line shows.
const traced = {
  'src/routes/api/boom.ts': `export function GET(): Response {\n  const reason = 'api exploded'\n  throw new Error(reason)\n}\n`,
  'src/components/Badge.tsx': `export function Badge() {\n  const icon = (\n    <i>\n      x\n    </i>\n  )\n  if (icon)\n    throw new Error('badge exploded')\n  return <span>{icon}</span>\n}\n`,
  'src/routes/list.tsx': `function check(i: number): number {\n  if (i > 1)\n    throw new Error('list exploded')\n  return i\n}\n\nexport default function List() {\n  return (\n    <ul>\n      <li>first</li>\n      {[1, 2].map(i => <li>{check(i)}</li>)}\n    </ul>\n  )\n}\n`,
  'src/routes/index.tsx': `import { Badge } from '../components/Badge'\n\nexport default function Page() {\n  const items = [1, 2]\n  return (\n    <main>\n      <h1>Title</h1>\n      {items.map(i => <p>{i}</p>)}\n      <Badge />\n    </main>\n  )\n}\n`,
}

const tracedPaths = ['/api/boom', '/', '/list']

function expectSourceLines([route, page, list]: string[]): void {
  expect(route).toContain('/src/routes/api/boom.ts:3:')
  expect(page).toContain('/src/components/Badge.tsx:8:')
  expect(page).toContain('/src/routes/index.tsx:9:')
  expect(list).toContain('/src/routes/list.tsx:3:')
  expect(list).toContain('/src/routes/list.tsx:11:')
}

describe('stack traces name the source line (#3666)', () => {
  it('testApp', async () => {
    const t = await testApp({ root: appWith(traced), dev: true })
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const stacks: string[] = []
      for (const path of tracedPaths)
        stacks.push((await (await t.get(path, { accept: 'application/json' })).json() as { stack: string }).stack)
      expectSourceLines(stacks)
    }
    finally {
      log.mockRestore()
    }
  })

  it('prunelle dev', async () => {
    const srv = await devServer({ root: appWith(traced), port: 0 })
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const stacks: string[] = []
      for (const path of tracedPaths)
        stacks.push((await (await fetch(`${srv.url}${path}`, { headers: { accept: 'application/json' } })).json() as { stack: string }).stack)
      expectSourceLines(stacks)
    }
    finally {
      log.mockRestore()
      srv.stop()
    }
  })

  it('a built app under prunelle start', async () => {
    const dir = appWith(traced)
    await build({ root: dir })
    const stacks: string[] = []
    const app = await createServer({ root: dir, errorSink: info => stacks.push((info.error as Error).stack ?? '') })
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const path of tracedPaths)
        await app.handle(new Request(`http://localhost${path}`))
      expect(stacks.length).toBe(3)
      expectSourceLines(stacks)
    }
    finally {
      quiet.mockRestore()
      await app.dispose?.()
    }
  })
})

describe('production stderr logging when no onError is set (#30)', () => {
  it('logs route, load, action, plugin route, and streamed Suspense errors with method, path and stack', async () => {
    const dir = appWith({
      'src/actions/fail.ts': `import { action } from 'prunelle/server'\nexport const failAction = action(async () => { throw new Error('action exploded') })\n`,
      'src/routes/index.tsx': `import { failAction } from '../actions/fail'\nexport default function Home() { return <form action={failAction} method="post"><button type="submit">go</button></form> }\n`,
      'src/routes/boom.tsx': `export default function Boom() { throw new Error('route exploded') }\n`,
      'src/routes/load-boom.tsx': `export function load() { throw new Error('load exploded') }\nexport default function LoadBoom() { return <p>ok</p> }\n`,
      'src/routes/stream-boom.tsx': `import { Suspense } from 'prunelle'\nasync function Broken(): Promise<string> { throw new Error('suspense exploded') }\nexport default function StreamBoom() { return <main><Suspense fallback={<p>wait</p>}><Broken /></Suspense></main> }\n`,
    })
    const plugin = definePlugin({
      name: 'boom-plugin',
      server(api) {
        api.route('GET', '/plugin-boom', () => {
          throw new Error('plugin exploded')
        })
      },
    })
    const manifest = await build({ root: dir, plugins: [plugin] })
    const actionUrl = manifest.actions[0]!.url
    const app = await createServer({ root: dir, plugins: [plugin] })
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const routeRes = await app.handle(new Request('http://localhost/boom'))
      expect(routeRes.status).toBe(500)

      const loadRes = await app.handle(new Request('http://localhost/load-boom'))
      expect(loadRes.status).toBe(500)

      const actionRes = await app.handle(new Request(`http://localhost${actionUrl}`, {
        method: 'POST',
        headers: { origin: 'http://localhost', accept: 'application/json' },
      }))
      expect(actionRes.status).toBe(500)

      const pluginRes = await app.handle(new Request('http://localhost/plugin-boom'))
      expect(pluginRes.status).toBe(500)

      const streamRes = await app.handle(new Request('http://localhost/stream-boom'))
      await streamRes.text()

      expect(log).toHaveBeenCalledTimes(5)
      const entries = log.mock.calls.map(([msg, err]) => ({
        msg: String(msg),
        stack: err instanceof Error ? err.stack ?? '' : String(err),
      }))
      expect(entries[0]!.msg).toContain('route GET /boom')
      expect(entries[0]!.stack).toContain('route exploded')
      expect(entries[1]!.msg).toContain('route GET /load-boom')
      expect(entries[1]!.stack).toContain('load exploded')
      expect(entries[2]!.msg).toContain(`action POST ${actionUrl}`)
      expect(entries[2]!.stack).toContain('action exploded')
      expect(entries[3]!.msg).toContain('plugin GET /plugin-boom')
      expect(entries[3]!.stack).toContain('plugin exploded')
      expect(entries[4]!.msg).toContain('route GET /stream-boom')
      expect(entries[4]!.stack).toContain('suspense exploded')
    }
    finally {
      log.mockRestore()
      await app.dispose?.()
    }
  })

  it('delivers every error to a configured onError hook without doubling it on stderr', async () => {
    const dir = appWith({
      'src/routes/boom.tsx': `export default function Boom() { throw new Error('handled exploded') }\n`,
    })
    await build({ root: dir })
    const seen: string[] = []
    const app = await createServer({
      root: dir,
      onError: ({ error, request, source }) => {
        seen.push(`${source} ${request.method} ${new URL(request.url).pathname}: ${(error as Error).message}`)
      },
    })
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await app.handle(new Request('http://localhost/boom'))
      expect(res.status).toBe(500)
      expect(seen).toEqual(['route GET /boom: handled exploded'])
      expect(log).not.toHaveBeenCalled()
    }
    finally {
      log.mockRestore()
      await app.dispose?.()
    }
  })
})
