import type { ServerAction } from '../src/server/index'
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { walkRoutes } from '../src/build/files'
import { ModuleGraph } from '../src/build/graph'
import { checkAppForms } from '../src/cli/check-forms'
import { action } from '../src/server/action'
import {
  DEFAULT_HONEYPOT_FIELD,
  FORM_TIMESTAMP_FIELD,
  MAX_FORM_AGE_MS,
  renderProtectFields,
  signFormTimestamp,
  verifyActionProtection,
  verifyFormTimestamp,
} from '../src/server/action-protect'
import { testApp } from '../src/test/index'

const tempDirs: string[] = []
function appWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'prunelle-action-protect-'))
  tempDirs.push(dir)
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

describe('action protect helpers (#5)', () => {
  it('signs and verifies form timestamps with minTime and 24h expiry', () => {
    const now = 1_700_000_000_000
    const okToken = signFormTimestamp(now - 2000)
    expect(verifyFormTimestamp(okToken, 1000, now)).toEqual({ ok: true })

    const fastToken = signFormTimestamp(now - 200)
    expect(verifyFormTimestamp(fastToken, 1000, now).ok).toBe(false)

    const futureToken = signFormTimestamp(now + 5000)
    expect(verifyFormTimestamp(futureToken, 0, now).ok).toBe(false)

    const oldToken = signFormTimestamp(now - MAX_FORM_AGE_MS - 1000)
    expect(verifyFormTimestamp(oldToken, 0, now).ok).toBe(false)

    const tampered = `${okToken.slice(0, -1)}${okToken.endsWith('a') ? 'b' : 'a'}`
    expect(verifyFormTimestamp(tampered, 0, now).ok).toBe(false)
    expect(verifyFormTimestamp(undefined, 0, now).ok).toBe(false)
    expect(verifyFormTimestamp('not-a-token', 0, now).ok).toBe(false)
  })

  it('strips internal protection fields and rejects non-empty honeypots', () => {
    const now = Date.now()
    const ts = signFormTimestamp(now - 5000)
    const ok = verifyActionProtection(
      { honeypot: true, minTime: 1000 },
      { email: 'a@b.com', [DEFAULT_HONEYPOT_FIELD]: '', [FORM_TIMESTAMP_FIELD]: ts },
      now,
    )
    expect(ok).toEqual({ ok: true, cleanedBody: { email: 'a@b.com' } })

    const bot = verifyActionProtection(
      { honeypot: true, minTime: 1000 },
      { email: 'a@b.com', [DEFAULT_HONEYPOT_FIELD]: 'spam', [FORM_TIMESTAMP_FIELD]: ts },
      now,
    )
    expect(bot.ok).toBe(false)
    expect(bot.cleanedBody).toEqual({ email: 'a@b.com' })

    const custom = verifyActionProtection(
      { honeypot: 'website' },
      { email: 'a@b.com', website: 'http://spam.example' },
      now,
    )
    expect(custom.ok).toBe(false)
  })

  it('validates protect options eagerly in action()', () => {
    expect(() => action(() => 'ok', { protect: { minTime: -1 } })).toThrow(/protect\.minTime/)
    expect(() => action(() => 'ok', { protect: { honeypot: '   ' } })).toThrow(/protect\.honeypot/)
    expect(() => action(() => 'ok', { protect: { rateLimit: { max: 0, windowMs: 1000 } } })).toThrow(/rateLimit\.max/)
  })

  it('renders accessible visually-hidden honeypot and hidden signed timestamp', () => {
    const html = renderProtectFields({ honeypot: true, minTime: 1500 })
    expect(html).toContain('name="_pru_hp"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('autocomplete="off"')
    expect(html).toContain('name="_pru_ts"')
  })
})

describe('public form action protection end-to-end (#5)', () => {
  it('injects honeypot + signed timestamp on zero-JS form (0 B client JS), enforces all protections, and strips internal fields before strict schema', async () => {
    const dir = appWith({
      'src/actions/contact.ts': `
        import { action } from 'prunelle/server'

        let calls = 0
        export function getCalls() { return calls }

        // Strict schema that rejects any unknown keys (like _pru_hp or _pru_ts if they were not stripped).
        const strictSchema = {
          '~standard': {
            version: 1 as const,
            vendor: 'test',
            validate(raw: unknown) {
              const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
              const keys = Object.keys(obj)
              const extra = keys.filter(k => k !== 'email' && k !== 'message')
              if (extra.length > 0)
                return { issues: [{ message: 'Unexpected keys: ' + extra.join(',') }] }
              if (typeof obj.email !== 'string' || !obj.email.includes('@'))
                return { issues: [{ message: 'Invalid email', path: ['email'] }] }
              if (typeof obj.message !== 'string' || obj.message.length < 3)
                return { issues: [{ message: 'Too short', path: ['message'] }] }
              return { value: { email: obj.email, message: obj.message } }
            },
          },
        }

        export const sendContact = action(strictSchema, async (input) => {
          calls++
          return { received: input }
        }, {
          protect: {
            rateLimit: { max: 2, windowMs: 60_000 },
            honeypot: true,
            minTime: 500,
          },
        })

        let pingCalls = 0
        export function getPingCalls() { return pingCalls }
        export const ping = action(async () => {
          pingCalls++
          return { pong: true }
        }, {
          protect: { honeypot: 'company', minTime: 500 },
        })
      `,
      'src/routes/index.tsx': `
        import type { PageProps } from 'prunelle/server'
        import { getActionError } from 'prunelle/server'
        import { ping, sendContact } from '../actions/contact'

        export default function ContactPage({ locals }: PageProps) {
          const err = getActionError(locals)
          return (
            <main>
              {err && <p class="err">{err.error}|{err.values?.email ?? ''}</p>}
              <form action={sendContact} method="post">
                <label>Email <input name="email" /></label>
                <label>Message <textarea name="message" /></label>
                <button type="submit">Send</button>
              </form>
              <form action={ping} method="post">
                <button type="submit">Ping</button>
              </form>
            </main>
          )
        }
      `,
    })

    const app = await testApp({ root: dir })
    try {
      // Static form page ships 0 B client JS (no islands).
      const homeRoute = app.manifest!.routes.find(r => r.path === '/')!
      expect(homeRoute.islandChunks).toEqual([])

      // SSR automatically injects honeypot and signed _pru_ts right before </form>.
      const html = await (await app.get('/')).text()
      expect(html).toContain('name="_pru_hp"')
      expect(html).toContain('aria-hidden="true"')
      expect(html).toContain('name="_pru_ts"')
      expect(html).toContain('name="company"')
      const tsMatch = /name="_pru_ts" value="(\d+\.[0-9a-f]+)"/.exec(html)
      expect(tsMatch).not.toBeNull()

      const mod = await app.import('src/actions/contact.ts') as {
        sendContact: ServerAction<{ email: string, message: string }, { received: { email: string, message: string } }>
        ping: ServerAction<void, { pong: boolean }>
        getCalls: () => number
        getPingCalls: () => number
      }

      // 1. Filled honeypot is rejected BEFORE handler runs (JSON & zero-JS form).
      const hpRes = await app.submit(mod.sendContact, { email: 'bot@x.com', message: 'hello', _pru_hp: 'gotcha' }, { accept: 'application/json' })
      expect(hpRes.status).toBe(400)
      expect(mod.getCalls()).toBe(0)

      // 2. Too-fast submission (fresh SSR timestamp) is rejected BEFORE handler runs.
      const fastRes = await app.submit(mod.sendContact, { email: 'fast@x.com', message: 'hello', _pru_ts: tsMatch![1]! }, { accept: 'application/json' })
      expect(fastRes.status).toBe(400)
      expect(mod.getCalls()).toBe(0)

      // 3. Zero-JS form submit rejection flashes error + safe values (without _pru_hp/_pru_ts) and redirects 303.
      const noJsBot = await app.submit(
        mod.sendContact,
        { email: 'user@x.com', message: 'hello', _pru_ts: signFormTimestamp(Date.now()) },
        { accept: 'text/html', referer: 'http://localhost/' },
      )
      expect(noJsBot.status).toBe(303)
      const afterFlash = await (await app.get('/')).text()
      expect(afterFlash).toContain('<p class="err">Form submitted too quickly|user@x.com</p>')
      expect(mod.getCalls()).toBe(0)

      // 4. Direct JSON RPC without _pru_ts is rejected with 400.
      const rpcMissingTs = await app.post(mod.sendContact.url, { email: 'a@b.com', message: 'hello' })
      expect(rpcMissingTs.status).toBe(400)
      expect(mod.getCalls()).toBe(0)

      // 5. testApp().submit() auto-fills valid aged _pru_ts + empty honeypot; strict schema sees no internal fields.
      const ok1 = await app.submit(mod.sendContact, { email: 'a@b.com', message: 'hello' }, { accept: 'application/json' })
      expect(ok1.status).toBe(200)
      expect(await ok1.json()).toEqual({ ok: true, data: { received: { email: 'a@b.com', message: 'hello' } } })
      expect(mod.getCalls()).toBe(1)

      const ok2 = await app.submit(mod.sendContact, { email: 'b@b.com', message: 'world' }, { accept: 'application/json' })
      expect(ok2.status).toBe(200)
      expect(mod.getCalls()).toBe(2)

      // 6. Third submission hits protect.rateLimit -> 429 + Retry-After, handler not run.
      const limited = await app.submit(mod.sendContact, { email: 'c@b.com', message: 'again' }, { accept: 'application/json' })
      expect(limited.status).toBe(429)
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(mod.getCalls()).toBe(2)

      // 7. Schema-less action still parses body and enforces custom honeypot & minTime.
      const pingBot = await app.submit(mod.ping, { company: 'SpamCorp' }, { accept: 'application/json' })
      expect(pingBot.status).toBe(400)
      expect(mod.getPingCalls()).toBe(0)

      const pingOk = await app.submit(mod.ping, {}, { accept: 'application/json' })
      expect(pingOk.status).toBe(200)
      expect(await pingOk.json()).toEqual({ ok: true, data: { pong: true } })
      expect(mod.getPingCalls()).toBe(1)
    }
    finally {
      await app.app.dispose?.()
    }
  })

  it('injects protect fields into island forms using useAction(fn).action', async () => {
    const dir = appWith({
      'src/actions/newsletter.ts': `
        import { action } from 'prunelle/server'
        export const subscribe = action(async () => ({ ok: 1 }), {
          protect: { honeypot: true, minTime: 1000 },
        })
      `,
      'src/routes/index.tsx': `
        import { useAction } from 'prunelle'
        import { subscribe } from '../actions/newsletter'

        export default function Newsletter() {
          const form = useAction(subscribe)
          return (
            <form action={form.action} method="post" onSubmit={form.onSubmit}>
              <input name="email" />
              <button type="submit">Join</button>
            </form>
          )
        }
      `,
    })

    const app = await testApp({ root: dir })
    try {
      const html = await (await app.get('/')).text()
      expect(html).toContain('name="_pru_hp"')
      expect(html).toContain('name="_pru_ts"')
      // Hidden fields are injected right before </form> so hydration child indices stay intact.
      expect(html).toMatch(/<button type="submit">Join<\/button><input type="text" name="_pru_hp"[\s\S]*name="_pru_ts"[^>]*><\/form>/)
    }
    finally {
      await app.app.dispose?.()
    }
  })

  it('warns in checkAppForms on unguarded public form actions, but skips protected or middleware-guarded ones', async () => {
    const dir = appWith({
      'src/actions/forms.ts': `
        import { action } from 'prunelle/server'
        export const publicOpen = action(async () => 'open')
        export const publicProtected = action(async () => 'safe', { protect: { honeypot: true } })
        export const publicLimited = action(async () => 'limited', { rateLimit: { max: 5, windowMs: 60_000 } })
      `,
      'src/routes/contact.tsx': `
        import { publicLimited, publicOpen, publicProtected } from '../actions/forms'
        export default function Contact() {
          return (
            <main>
              <form action={publicOpen} method="post"><button>Open</button></form>
              <form action={publicProtected} method="post"><button>Safe</button></form>
              <form action={publicLimited} method="post"><button>Limited</button></form>
            </main>
          )
        }
      `,
      'src/routes/admin/_middleware.ts': `
        import type { Middleware } from 'prunelle/server'
        const guard: Middleware = (_ctx, next) => next()
        export default guard
      `,
      'src/routes/admin/actions.ts': `
        import { action } from 'prunelle/server'
        export const adminAction = action(async () => 'admin')
      `,
      'src/routes/admin/index.tsx': `
        import { publicOpen } from '../../actions/forms'
        import { adminAction } from './actions'
        export default function Admin() {
          return (
            <main>
              <form action={adminAction} method="post"><button>Admin</button></form>
              <form action={publicOpen} method="post"><button>Reuse</button></form>
            </main>
          )
        }
      `,
    })

    const routesDir = join(dir, 'src/routes')
    const routeFiles = walkRoutes(routesDir).sort()
    const graph = new ModuleGraph(dir)
    for (const f of routeFiles)
      graph.load(f)

    const result = await checkAppForms({ root: dir, routesDir, routeFiles, graph })
    expect(result.errors).toEqual([])
    const unguarded = result.warnings.filter(w => w.includes('action/unguarded-public-form'))
    expect(unguarded).toHaveLength(1)
    expect(unguarded[0]).toContain('src/routes/contact.tsx')
    expect(unguarded[0]).toContain('publicOpen')
    expect(unguarded[0]).toContain('protect')
  })
})
