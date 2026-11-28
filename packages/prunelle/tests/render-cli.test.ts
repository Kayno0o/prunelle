// Tests for `prunelle render <url>` (Issue #20): in-process URL rendering with cached build reuse and invalidation.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatRenderResult, renderUrl } from '../src/cli/render'

function makeTempApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'prunelle-render-cli-'))
  mkdirSync(join(root, 'src/routes/api'), { recursive: true })

  writeFileSync(
    join(root, 'src/routes/index.tsx'),
    'export default function Home() {\n  return <main><h1>Hello Render</h1></main>\n}\n',
  )

  writeFileSync(
    join(root, 'src/routes/legal.tsx'),
    'export default function Legal() {\n  return <p>Legal notice</p>\n}\n',
  )

  writeFileSync(
    join(root, 'src/routes/go.ts'),
    'import type { RequestContext } from \'prunelle/server\'\nexport function GET(ctx: RequestContext) {\n  return ctx.redirect(\'/dest\', 302)\n}\n',
  )

  writeFileSync(
    join(root, 'src/routes/boom.ts'),
    'export function GET() {\n  throw new Error(\'kaboom from route\')\n}\n',
  )

  writeFileSync(
    join(root, 'src/routes/api/echo.ts'),
    `import type { RequestContext } from 'prunelle/server'
export async function POST(ctx: RequestContext) {
  const body = await ctx.request.text()
  ctx.cookies.set('seen', 'yes', { path: '/' })
  ctx.cookies.set('theme', 'dark', { path: '/' })
  return ctx.json({
    method: ctx.request.method,
    token: ctx.request.headers.get('x-token'),
    cookie: ctx.request.headers.get('cookie'),
    body,
    query: ctx.url.searchParams.get('q'),
  })
}
`,
  )

  return root
}

describe('prunelle render (#20)', () => {
  test('renders 200 HTML, 302 redirect, 404 not found, and 500 error while never touching dist/', async () => {
    const root = makeTempApp()
    try {
      const home = await renderUrl({ root, url: '/' })
      expect(home.status).toBe(200)
      expect(home.ok).toBe(true)
      expect(home.reusedBuild).toBe(false)
      expect(home.body).toContain('<h1>Hello Render</h1>')
      expect(home.errors).toEqual([])
      expect(existsSync(join(root, 'dist'))).toBe(false)
      expect(existsSync(join(root, '.prunelle-cache/.gitignore'))).toBe(true)

      // Second request reuses cached build
      const redirect = await renderUrl({ root, url: '/go' })
      expect(redirect.status).toBe(302)
      expect(redirect.ok).toBe(true)
      expect(redirect.reusedBuild).toBe(true)
      expect(redirect.headers.location).toBe('/dest')

      const missing = await renderUrl({ root, url: '/does-not-exist' })
      expect(missing.status).toBe(404)
      expect(missing.ok).toBe(false)
      expect(missing.reusedBuild).toBe(true)

      const boom = await renderUrl({ root, url: '/boom' })
      expect(boom.status).toBe(500)
      expect(boom.ok).toBe(false)
      expect(boom.reusedBuild).toBe(true)
      expect(boom.errors.some(e => e.includes('kaboom from route'))).toBe(true)
      expect(existsSync(join(root, 'dist'))).toBe(false)
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('supports POST method, body, custom headers, cookies, and -i header formatting with multiple Set-Cookie headers', async () => {
    const root = makeTempApp()
    try {
      const res = await renderUrl({
        root,
        url: 'api/echo?q=hi',
        method: 'POST',
        body: '{"hello":"world"}',
        headers: ['Content-Type: application/json', 'X-Token: secret-42'],
        cookies: ['session=abc', 'lang=fr'],
        includeHeaders: true,
      })

      expect(res.status).toBe(200)
      expect(res.ok).toBe(true)
      const data = JSON.parse(res.body) as {
        method: string
        token: string | null
        cookie: string | null
        body: string
        query: string | null
      }
      expect(data).toEqual({
        method: 'POST',
        token: 'secret-42',
        cookie: 'session=abc; lang=fr',
        body: '{"hello":"world"}',
        query: 'hi',
      })
      expect(res.setCookies.length).toBe(2)
      expect(res.setCookies.some(c => c.startsWith('seen=yes'))).toBe(true)
      expect(res.setCookies.some(c => c.startsWith('theme=dark'))).toBe(true)

      const withHeaders = formatRenderResult(res, true)
      expect(withHeaders).toStartWith('HTTP/1.1 200 OK\n')
      expect(withHeaders).toContain('content-type: application/json')
      expect(withHeaders).toContain('set-cookie: seen=yes')
      expect(withHeaders).toContain('set-cookie: theme=dark')
      expect(withHeaders).toContain('\n\n{"method":"POST"')

      expect(formatRenderResult(res, false)).toBe(res.body)
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('invalidates cached build when a route file changes and supports fresh rebuilds', async () => {
    const root = makeTempApp()
    try {
      const first = await renderUrl({ root, url: '/' })
      expect(first.reusedBuild).toBe(false)
      expect(first.body).toContain('Hello Render')

      const second = await renderUrl({ root, url: '/' })
      expect(second.reusedBuild).toBe(true)

      // Edit route file and bump mtime slightly so coarse-tick filesystems always see a change
      const indexFile = join(root, 'src/routes/index.tsx')
      writeFileSync(indexFile, 'export default function Home() {\n  return <main><h1>Updated Render Output</h1></main>\n}\n')
      const future = new Date(Date.now() + 2000)
      utimesSync(indexFile, future, future)

      const rebuilt = await renderUrl({ root, url: '/' })
      expect(rebuilt.reusedBuild).toBe(false)
      expect(rebuilt.body).toContain('Updated Render Output')

      const fresh = await renderUrl({ root, url: '/', fresh: true })
      expect(fresh.reusedBuild).toBe(false)
      expect(existsSync(join(root, 'dist'))).toBe(false)
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects malformed headers with a prunelle render: error', async () => {
    const root = makeTempApp()
    try {
      await expect(renderUrl({ root, url: '/', headers: ['NoColonHere'] })).rejects.toThrow(
        'prunelle render: invalid header "NoColonHere" (expected "Name: Value")',
      )
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
