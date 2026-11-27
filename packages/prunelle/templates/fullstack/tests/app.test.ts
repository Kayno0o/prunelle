import type { ServerAction } from 'prunelle/server'
import type { TestApp } from 'prunelle/test'
import { beforeAll, describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
import { testApp } from 'prunelle/test'

const root = resolve(import.meta.dir, '..')

describe('__APP_NAME__', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await testApp({ root })
  })

  it('renders the home page and health endpoint', async () => {
    const home = await app.get('/')
    expect(home.status).toBe(200)
    expect(await home.text()).toContain('Welcome to Prunelle')

    const health = await app.get('/api/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true, runtime: 'bun' })
    expect(app.errors).toEqual([])
  })

  it('validates and runs the greet action', async () => {
    const { greet } = await app.import('src/actions/greet.ts') as { greet: ServerAction<{ name: string }, { message: string }> }

    const ok = await app.submit(greet, { name: 'Prunelle' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, data: { message: 'Hello, Prunelle!' } })

    const invalid = await app.submit(greet, { name: 'a' })
    expect(invalid.status).toBe(400)
  })
})
