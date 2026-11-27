import { afterAll, describe, expect, it, spyOn } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../src/build/index'
import { devServer } from '../src/dev/index'
import { assertKnownConfigKeys } from '../src/plugins/config'
import { createServer, definePlugin } from '../src/server/index'
import { testApp } from '../src/test/index'

const PRUNELLE_PKG_DIR = join(import.meta.dir, '..')
const tempDirs: string[] = []

function appWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'prunelle-obs-'))
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

describe('health check endpoint (/_pru/health) (#8)', () => {
  it('answers 200 JSON on GET/HEAD and 405 on POST even with no / route and a blocking root _middleware.ts', async () => {
    const dir = appWith({
      'src/routes/_middleware.ts': `export default function auth(ctx: { deny: (s: number, m: string) => Response }) { return ctx.deny(401, 'blocked') }\n`,
      'src/routes/about.tsx': `export default function About() { return <p>about</p> }\n`,
    })
    await build({ root: dir })
    const app = await createServer({ root: dir })
    try {
      // Root middleware blocks normal routes
      const blocked = await app.handle(new Request('http://localhost/about'))
      expect(blocked.status).toBe(401)

      // /_pru/health bypasses middleware and does not need a `/` route
      const res = await app.handle(new Request('http://localhost/_pru/health'))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('x-request-id')).toBeTruthy()
      expect(await res.json()).toEqual({ ok: true })

      const head = await app.handle(new Request('http://localhost/_pru/health', { method: 'HEAD' }))
      expect(head.status).toBe(200)
      expect(head.headers.get('cache-control')).toBe('no-store')
      expect(head.headers.get('x-request-id')).toBeTruthy()
      expect(await head.text()).toBe('')

      const post = await app.handle(new Request('http://localhost/_pru/health', { method: 'POST' }))
      expect(post.status).toBe(405)
      expect(post.headers.get('allow')).toBe('GET, HEAD')
      expect(post.headers.get('x-request-id')).toBeTruthy()
    }
    finally {
      await app.dispose?.()
    }
  })

  it('respects custom assetPrefix and runs both app and plugin health checks', async () => {
    let dbHealthy = true
    let cacheMode: 'ok' | 'false' | 'msg' | 'throw' = 'ok'

    const plugin = definePlugin({
      name: 'queue-plugin',
      server(api) {
        api.healthCheck('queue', async () => ({ ok: true }))
      },
    })

    const dir = appWith({
      'src/routes/index.tsx': `export default function Home() { return <p>ok</p> }\n`,
    })
    await build({ root: dir, assetPrefix: '/_static', plugins: [plugin] })
    const app = await createServer({
      root: dir,
      assetPrefix: '/_static',
      plugins: [plugin],
      healthCheck: {
        db: () => dbHealthy,
        cache: async () => {
          if (cacheMode === 'false')
            return false
          if (cacheMode === 'msg')
            return { ok: false, message: 'redis unreachable' }
          if (cacheMode === 'throw')
            throw new Error('connection refused')
          return undefined
        },
      },
    })
    try {
      const okRes = await app.handle(new Request('http://localhost/_static/health'))
      expect(okRes.status).toBe(200)
      expect(await okRes.json()).toEqual({
        ok: true,
        checks: {
          db: { ok: true },
          cache: { ok: true },
          queue: { ok: true },
        },
      })

      dbHealthy = false
      const failBool = await app.handle(new Request('http://localhost/_static/health'))
      expect(failBool.status).toBe(503)
      expect(await failBool.json()).toEqual({
        ok: false,
        checks: {
          db: { ok: false },
          cache: { ok: true },
          queue: { ok: true },
        },
      })

      dbHealthy = true
      cacheMode = 'msg'
      const failMsg = await app.handle(new Request('http://localhost/_static/health'))
      expect(failMsg.status).toBe(503)
      expect(await failMsg.json()).toEqual({
        ok: false,
        checks: {
          db: { ok: true },
          cache: { ok: false, error: 'redis unreachable' },
          queue: { ok: true },
        },
      })

      cacheMode = 'throw'
      const failThrow = await app.handle(new Request('http://localhost/_static/health'))
      expect(failThrow.status).toBe(503)
      expect(await failThrow.json()).toEqual({
        ok: false,
        checks: {
          db: { ok: true },
          cache: { ok: false, error: 'connection refused' },
          queue: { ok: true },
        },
      })
    }
    finally {
      await app.dispose?.()
    }
  })

  it('accepts a single function healthCheck and passes assertKnownConfigKeys', async () => {
    expect(() => assertKnownConfigKeys({ healthCheck: () => true })).not.toThrow()

    const dir = appWith({
      'src/routes/index.tsx': `export default function Home() { return <p>ok</p> }\n`,
    })
    await build({ root: dir })
    const app = await createServer({ root: dir, healthCheck: () => ({ ok: false, message: 'warming up' }) })
    try {
      const res = await app.handle(new Request('http://localhost/_pru/health'))
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({
        ok: false,
        checks: { app: { ok: false, error: 'warming up' } },
      })
    }
    finally {
      await app.dispose?.()
    }
  })
})

describe('compiled binary --health probes /_pru/health (#8)', () => {
  async function spawnCompiledAndProbe(configSource: string, routes: Record<string, string>): Promise<number> {
    const dir = appWith({
      ...routes,
      'prunelle.config.ts': configSource,
    })
    const binPath = join(dir, 'app-bin')
    await build({ root: dir, compile: binPath })

    const proc = Bun.spawn([binPath], {
      cwd: dir,
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    try {
      const reader = proc.stdout.getReader()
      const decoder = new TextDecoder()
      let out = ''
      let url = ''
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const { value, done } = await reader.read()
        if (done)
          break
        out += decoder.decode(value)
        const match = /http:\/\/\S+/.exec(out)
        if (match) {
          url = match[0]
          break
        }
      }
      reader.releaseLock()
      const port = url === '' ? '0' : new URL(url).port
      return Bun.spawnSync([binPath, '--health'], {
        cwd: dir,
        env: { ...process.env, PORT: port, HOST: '127.0.0.1' },
        stdout: 'pipe',
        stderr: 'pipe',
      }).exitCode
    }
    finally {
      proc.kill()
      await proc.exited
    }
  }

  it('exits 0 when healthy (even if / returns 500 or is absent) and exits 1 when healthCheck fails', async () => {
    const okExit = await spawnCompiledAndProbe(
      `export default { healthCheck: () => true }\n`,
      { 'src/routes/index.tsx': `export default function Home() { throw new Error('home broken') }\n` },
    )
    expect(okExit).toBe(0)

    const failExit = await spawnCompiledAndProbe(
      `export default { healthCheck: () => false }\n`,
      { 'src/routes/index.tsx': `export default function Home() { return <p>ok</p> }\n` },
    )
    expect(failExit).toBe(1)
  }, 30_000)
})

describe('request ID (x-request-id) (#8)', () => {
  it('generates unique x-request-id on every response and exposes ctx.requestId across routes, APIs, actions, and errors', async () => {
    const dir = appWith({
      'public/robots.txt': 'User-agent: *\n',
      'src/actions/echo.ts': `import { action } from 'prunelle/server'\nexport const echoId = action(async (ctx) => ({ id: ctx.requestId }))\n`,
      'src/routes/index.tsx': `import { echoId } from '../actions/echo'\nexport default function Home() { return <form action={echoId} method="post"><button type="submit">go</button></form> }\n`,
      'src/routes/fast-load.tsx': `export function load(ctx: { requestId: string }) { return { id: ctx.requestId } }\nexport default function FastLoad({ data }: { data: { id: string } }) { return <p>{data.id}</p> }\n`,
      'src/routes/api/id.ts': `export function GET(ctx: { requestId: string, json: (d: unknown) => Response }) { return ctx.json({ id: ctx.requestId }) }\n`,
      'src/routes/boom.tsx': `export default function Boom() { throw new Error('boom id test') }\n`,
    })
    const manifest = await build({ root: dir })
    const actionUrl = manifest.actions[0]!.url
    const seenErrors: { source: string, requestId?: string | undefined }[] = []

    const app = await createServer({
      root: dir,
      onError: ({ source, requestId }) => {
        seenErrors.push({ source, requestId })
      },
    })
    try {
      // Fast static page (no load)
      const r1 = await app.handle(new Request('http://localhost/'))
      const r2 = await app.handle(new Request('http://localhost/'))
      const id1 = r1.headers.get('x-request-id')
      const id2 = r2.headers.get('x-request-id')
      expect(id1).toBeTruthy()
      expect(id2).toBeTruthy()
      expect(id1).not.toBe(id2)

      // Fast static page with load() sees matching ctx.requestId
      const fastLoad = await app.handle(new Request('http://localhost/fast-load'))
      const fastId = fastLoad.headers.get('x-request-id')
      expect(fastId).toBeTruthy()
      expect(await fastLoad.text()).toContain(fastId!)

      // API route sees matching ctx.requestId
      const apiRes = await app.handle(new Request('http://localhost/api/id'))
      const apiId = apiRes.headers.get('x-request-id')
      expect(apiId).toBeTruthy()
      expect(await apiRes.json()).toEqual({ id: apiId })

      // Public static file gets x-request-id
      const pubRes = await app.handle(new Request('http://localhost/robots.txt'))
      expect(pubRes.status).toBe(200)
      expect(pubRes.headers.get('x-request-id')).toBeTruthy()

      // 404 gets x-request-id
      const nfRes = await app.handle(new Request('http://localhost/does-not-exist'))
      expect(nfRes.status).toBe(404)
      expect(nfRes.headers.get('x-request-id')).toBeTruthy()

      // Server action sees matching ctx.requestId
      const actRes = await app.handle(new Request(`http://localhost${actionUrl}`, {
        method: 'POST',
        headers: { origin: 'http://localhost', accept: 'application/json' },
      }))
      const actId = actRes.headers.get('x-request-id')
      expect(actId).toBeTruthy()
      expect(await actRes.json()).toEqual({ ok: true, data: { id: actId } })

      // Unhandled error delivers matching requestId to onError and response header
      const boomRes = await app.handle(new Request('http://localhost/boom'))
      const boomId = boomRes.headers.get('x-request-id') ?? undefined
      expect(boomRes.status).toBe(500)
      expect(boomId).toBeTruthy()
      expect(seenErrors).toEqual([{ source: 'route', requestId: boomId }])
    }
    finally {
      await app.dispose?.()
    }
  })

  it('honors safe incoming x-request-id only when trustProxy is truthy, and logs requestId to stderr by default', async () => {
    const dir = appWith({
      'src/routes/api/id.ts': `export function GET(ctx: { requestId: string, json: (d: unknown) => Response }) { return ctx.json({ id: ctx.requestId }) }\n`,
      'src/routes/boom.tsx': `export default function Boom() { throw new Error('stderr id test') }\n`,
    })
    await build({ root: dir })

    // trustProxy: false ignores incoming x-request-id
    const untrusted = await createServer({ root: dir, trustProxy: false })
    try {
      const res = await untrusted.handle(new Request('http://localhost/api/id', {
        headers: { 'x-request-id': 'proxy-trace-123' },
      }))
      const body = await res.json() as { id: string }
      expect(body.id).not.toBe('proxy-trace-123')
      expect(res.headers.get('x-request-id')).toBe(body.id)
    }
    finally {
      await untrusted.dispose?.()
    }

    // trustProxy: true reuses safe incoming x-request-id and rejects unsafe ones
    const trusted = await createServer({ root: dir, trustProxy: true })
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const validId = 'req-2026:abc_123/45.6'
      const okRes = await trusted.handle(new Request('http://localhost/api/id', {
        headers: { 'x-request-id': validId },
      }))
      expect(okRes.headers.get('x-request-id')).toBe(validId)
      expect(await okRes.json()).toEqual({ id: validId })

      for (const bad of ['', 'bad id with spaces', 'bad"quote', 'a'.repeat(129)]) {
        const res = await trusted.handle(new Request('http://localhost/api/id', {
          headers: { 'x-request-id': bad },
        }))
        const got = res.headers.get('x-request-id')!
        expect(got).toBeTruthy()
        expect(got).not.toBe(bad)
      }

      // Default stderr logging includes the requestId
      const boomRes = await trusted.handle(new Request('http://localhost/boom', {
        headers: { 'x-request-id': 'trace-boom-99' },
      }))
      expect(boomRes.status).toBe(500)
      expect(boomRes.headers.get('x-request-id')).toBe('trace-boom-99')
      expect(log).toHaveBeenCalledTimes(1)
      expect(String(log.mock.calls[0]![0])).toContain('[trace-boom-99]')
    }
    finally {
      log.mockRestore()
      await trusted.dispose?.()
    }
  })
})

describe('dev-only Server-Timing header (#8)', () => {
  const appFiles = {
    'src/routes/index.tsx': `export default function Home() { return <main>static fast</main> }\n`,
    'src/routes/with-load.tsx': `export async function load() { await Bun.sleep(2); return { v: 1 } }\nexport default function WithLoad({ data }: { data: { v: number } }) { return <p>{data.v}</p> }\n`,
    'src/routes/admin/_middleware.ts': `export default async function mw(_ctx: unknown, next: () => Promise<Response>) { await Bun.sleep(2); return next() }\n`,
    'src/routes/admin/index.tsx': `export async function load() { await Bun.sleep(2); return { ok: true } }\nexport default function Admin({ data }: { data: { ok: boolean } }) { return <p>{String(data.ok)}</p> }\n`,
    'src/routes/stream.tsx': `import { Suspense } from 'prunelle'\nasync function Slow() { await Bun.sleep(5); return <span>done</span> }\nexport default function StreamPage() { return <main><Suspense fallback={<p>...</p>}><Slow /></Suspense></main> }\n`,
  }

  it('emits middleware, load, render, and stream phases in dev: true', async () => {
    const t = await testApp({ root: appWith(appFiles), dev: true })

    // Fast static page (no load, no middleware): render only
    const fastRes = await t.get('/')
    const fastTiming = fastRes.headers.get('server-timing') ?? ''
    expect(fastTiming).toMatch(/^render;dur=\d+\.\d{2}$/)

    // Fast static page with load(): load + render
    const loadRes = await t.get('/with-load')
    const loadTiming = loadRes.headers.get('server-timing') ?? ''
    expect(loadTiming).toMatch(/^load;dur=\d+\.\d{2}, render;dur=\d+\.\d{2}$/)

    // Route with middleware + load + render
    const adminRes = await t.get('/admin')
    const adminTiming = adminRes.headers.get('server-timing') ?? ''
    expect(adminTiming).toMatch(/^middleware;dur=\d+\.\d{2}, load;dur=\d+\.\d{2}, render;dur=\d+\.\d{2}$/)

    // Streamed Suspense page includes render + stream
    const streamRes = await t.get('/stream')
    const streamTiming = streamRes.headers.get('server-timing') ?? ''
    await streamRes.text()
    expect(streamTiming).toMatch(/render;dur=\d+\.\d{2}/)
    expect(streamTiming).toMatch(/stream;dur=\d+\.\d{2}/)
  })

  it('devServer sends Server-Timing and x-request-id over HTTP', async () => {
    const srv = await devServer({ root: appWith(appFiles), port: 0 })
    try {
      const res = await fetch(`${srv.url}/admin`)
      expect(res.status).toBe(200)
      expect(res.headers.get('x-request-id')).toBeTruthy()
      const timing = res.headers.get('server-timing') ?? ''
      expect(timing).toContain('middleware;dur=')
      expect(timing).toContain('load;dur=')
      expect(timing).toContain('render;dur=')
    }
    finally {
      srv.stop()
    }
  })

  it('never sends Server-Timing and never calls performance.now() in production', async () => {
    const dir = appWith(appFiles)
    await build({ root: dir })
    const app = await createServer({ root: dir })
    const nowSpy = spyOn(performance, 'now')
    try {
      for (const path of ['/', '/with-load', '/admin', '/stream']) {
        const res = await app.handle(new Request(`http://localhost${path}`))
        expect(res.status).toBe(200)
        expect(res.headers.get('server-timing')).toBeNull()
        expect(res.headers.get('x-request-id')).toBeTruthy()
        await res.text()
      }
      expect(nowSpy).not.toHaveBeenCalled()
    }
    finally {
      nowSpy.mockRestore()
      await app.dispose?.()
    }
  })
})
