import { afterAll, describe, expect, it, spyOn } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrunelleMcpDispatcher, PRUNELLE_MCP_PROTOCOL_VERSION } from '../src/cli/mcp'
import { recordDevCrashError } from '../src/dev/error-log'
import { devServer } from '../src/dev/index'

const PRUNELLE_PKG_DIR = join(import.meta.dir, '..')
const REPO_ROOT = join(import.meta.dir, '../../..')
const tempDirs: string[] = []

function makeTempApp(files: Record<string, string>, plugins: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'prunelle-mcp-cli-'))
  tempDirs.push(dir)
  mkdirSync(join(dir, 'node_modules/@prunellejs'), { recursive: true })
  symlinkSync(PRUNELLE_PKG_DIR, join(dir, 'node_modules/prunelle'), 'dir')
  for (const pkgName of plugins) {
    const folder = pkgName === 'ui' ? 'ui' : `plugin-${pkgName}`
    const target = join(REPO_ROOT, 'packages', folder)
    if (existsSync(target))
      symlinkSync(target, join(dir, 'node_modules/@prunellejs', pkgName), 'dir')
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return dir
}

interface RpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: Record<string, unknown>
  error?: { code: number, message: string }
}

interface ToolCallPayload {
  content: { type: 'text', text: string }[]
  isError?: boolean
}

async function rpc(
  dispatcher: ReturnType<typeof createPrunelleMcpDispatcher>,
  method: string,
  params?: Record<string, unknown>,
  id: number | string = 1,
): Promise<RpcResponse> {
  const res = await dispatcher.handleMessage({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) })
  expect(res).toBeDefined()
  return res as RpcResponse
}

async function callTool<T = Record<string, unknown>>(
  dispatcher: ReturnType<typeof createPrunelleMcpDispatcher>,
  name: string,
  args?: Record<string, unknown>,
): Promise<{ isError: boolean, text: string, data?: T }> {
  const res = await rpc(dispatcher, 'tools/call', { name, ...(args !== undefined ? { arguments: args } : {}) })
  expect(res.error).toBeUndefined()
  const payload = res.result as unknown as ToolCallPayload
  const text = payload.content[0]!.text
  const isError = payload.isError === true
  if (isError)
    return { isError: true, text }
  return { isError: false, text, data: JSON.parse(text) as T }
}

afterAll(() => {
  for (const d of tempDirs)
    rmSync(d, { recursive: true, force: true })
})

const BASE_APP_FILES: Record<string, string> = {
  'src/components/Counter.tsx': `
    import { signal } from 'prunelle'
    export function Counter() {
      const count = signal(0)
      return <button type="button" onClick={() => count.value++}>Count {count.value}</button>
    }
  `,
  'src/actions/greet.ts': `
    import { action } from 'prunelle/server'
    export const greet = action(async () => ({ message: 'hello' }))
  `,
  'src/routes/index.tsx': `
    import { Counter } from '../components/Counter'
    export default function Home() {
      return <main><h1>MCP Home</h1><Counter /></main>
    }
  `,
  'src/routes/api/ping.ts': `
    export function GET() {
      return Response.json({ pong: true })
    }
  `,
}

describe('prunelle mcp protocol & dispatcher (#19)', () => {
  it('handles initialize, notifications, ping, unknown method, and parse errors', async () => {
    const root = makeTempApp(BASE_APP_FILES)
    const dispatcher = createPrunelleMcpDispatcher({ root })

    const init = await rpc(dispatcher, 'initialize', { protocolVersion: PRUNELLE_MCP_PROTOCOL_VERSION, clientInfo: { name: 'test', version: '1.0' } }, 1)
    expect(init.error).toBeUndefined()
    expect(init.result).toMatchObject({
      protocolVersion: PRUNELLE_MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: { name: 'prunelle' },
    })

    // Notifications without `id` return undefined (no response emitted)
    const notif = await dispatcher.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(notif).toBeUndefined()
    const cancelled = await dispatcher.handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99 } })
    expect(cancelled).toBeUndefined()

    // Blank lines are ignored
    expect(await dispatcher.handleLine('   ')).toBeUndefined()

    // Ping
    const ping = await rpc(dispatcher, 'ping', undefined, 2)
    expect(ping.result).toEqual({})

    // Unknown method -> -32601
    const unknown = await rpc(dispatcher, 'nonexistent/method', undefined, 3)
    expect(unknown.error?.code).toBe(-32601)

    // Invalid JSON line -> -32700
    const parseErrLine = await dispatcher.handleLine('{not-json')
    expect(parseErrLine).toBeDefined()
    const parseErr = JSON.parse(parseErrLine!) as RpcResponse
    expect(parseErr.error?.code).toBe(-32700)
    expect(parseErr.id).toBeNull()

    // Invalid request object -> -32600
    const badReq = await dispatcher.handleMessage({ jsonrpc: '1.0', id: 4, method: 'ping' }) as RpcResponse
    expect(badReq.error?.code).toBe(-32600)
  })

  it('lists all expected tools with schemas and annotations', async () => {
    const root = makeTempApp(BASE_APP_FILES)
    const dispatcher = createPrunelleMcpDispatcher({ root })
    const res = await rpc(dispatcher, 'tools/list')
    const tools = (res.result as { tools: { name: string, annotations: { readOnlyHint?: boolean } }[] }).tools
    const names = tools.map(t => t.name)
    expect(names).toEqual(['check', 'inspect', 'build_analyze', 'build', 'render', 'docs', 'dev_errors'])
    expect(tools.find(t => t.name === 'check')?.annotations.readOnlyHint).toBe(true)
    expect(tools.find(t => t.name === 'build_analyze')?.annotations.readOnlyHint).toBe(true)
    expect(tools.find(t => t.name === 'build')?.annotations.readOnlyHint).toBe(false)
  })

  it('exposes llms.txt of prunelle and installed @prunellejs/* packages as MCP resources', async () => {
    const root = makeTempApp(BASE_APP_FILES, ['ui', 'auth'])
    const dispatcher = createPrunelleMcpDispatcher({ root })

    const listRes = await rpc(dispatcher, 'resources/list')
    const resources = (listRes.result as { resources: { uri: string, name: string, mimeType: string }[] }).resources
    const uris = resources.map(r => r.uri)
    expect(uris).toContain('prunelle://llms/prunelle')
    expect(uris).toContain('prunelle://llms/@prunellejs/ui')
    expect(uris).toContain('prunelle://llms/@prunellejs/auth')
    expect(resources.every(r => r.mimeType === 'text/markdown')).toBe(true)

    const readCore = await rpc(dispatcher, 'resources/read', { uri: 'prunelle://llms/prunelle' })
    const contents = (readCore.result as { contents: { uri: string, mimeType: string, text: string }[] }).contents
    expect(contents).toHaveLength(1)
    expect(contents[0]!.uri).toBe('prunelle://llms/prunelle')
    expect(contents[0]!.mimeType).toBe('text/markdown')
    expect(contents[0]!.text).toContain('prunelle')

    const readUi = await rpc(dispatcher, 'resources/read', { uri: 'prunelle://llms/@prunellejs/ui' })
    const uiContents = (readUi.result as { contents: { text: string }[] }).contents
    expect(uiContents[0]!.text.length).toBeGreaterThan(50)

    const unknown = await rpc(dispatcher, 'resources/read', { uri: 'prunelle://llms/@prunellejs/does-not-exist' })
    expect(unknown.error?.code).toBe(-32002)
  })
})

describe('prunelle mcp tools (#19)', () => {
  it('check returns JSON diagnostics for clean and broken apps', async () => {
    const cleanRoot = makeTempApp(BASE_APP_FILES)
    const cleanDisp = createPrunelleMcpDispatcher({ root: cleanRoot })
    const clean = await callTool<{ ok: boolean, checkedFiles: number, errors: unknown[], warnings: unknown[] }>(
      cleanDisp,
      'check',
      { skipTypecheck: true },
    )
    expect(clean.isError).toBe(false)
    expect(clean.data?.ok).toBe(true)
    expect(clean.data?.checkedFiles).toBeGreaterThanOrEqual(4)
    expect(clean.data?.errors).toEqual([])

    const brokenRoot = makeTempApp({
      'src/routes/index.tsx': `export default function Home() { return <button type="button" onclick={() => {}}>bad</button> }`,
    })
    const brokenDisp = createPrunelleMcpDispatcher({ root: brokenRoot })
    const broken = await callTool<{ ok: boolean, errors: { file?: string, line?: number, col?: number, message: string }[] }>(
      brokenDisp,
      'check',
      { skipTypecheck: true },
    )
    expect(broken.isError).toBe(false)
    expect(broken.data?.ok).toBe(false)
    expect(broken.data?.errors.length).toBeGreaterThan(0)
    expect(broken.data?.errors[0]?.file).toBe('src/routes/index.tsx')
    expect(broken.data?.errors[0]?.line).toBeGreaterThan(0)
    expect(broken.data?.errors[0]?.col).toBeGreaterThan(0)
    expect(broken.data?.errors[0]?.message).toContain('onClick')
  })

  it('inspect returns routes, islands, actions, and plugins as JSON', async () => {
    const root = makeTempApp(BASE_APP_FILES)
    const dispatcher = createPrunelleMcpDispatcher({ root })
    const res = await callTool<{
      routes: { path: string }[]
      islands: { exportName: string, file: string }[]
      actions: { exportName: string }[]
      plugins: unknown[]
    }>(dispatcher, 'inspect')
    expect(res.isError).toBe(false)
    expect(res.data?.routes.map(r => r.path).sort()).toEqual(['/', '/api/ping'])
    expect(res.data?.islands.some(i => i.exportName === 'Counter')).toBe(true)
    expect(Array.isArray(res.data?.actions)).toBe(true)
    expect(Array.isArray(res.data?.plugins)).toBe(true)
  })

  it('build_analyze returns BundleReport JSON without creating dist/ when allowWrite is false', async () => {
    const root = makeTempApp(BASE_APP_FILES)
    const dispatcher = createPrunelleMcpDispatcher({ root, allowWrite: false })

    const res = await callTool<{
      routes: { path: string, jsGzip: number, islands: { name: string }[] }[]
      totalJsGzip: number
      totalCssGzip: number
      topModules: unknown[]
    }>(dispatcher, 'build_analyze')

    expect(res.isError).toBe(false)
    expect(res.data?.routes.some(r => r.path === '/')).toBe(true)
    expect(typeof res.data?.totalJsGzip).toBe('number')
    expect(existsSync(join(root, 'dist'))).toBe(false)
    const leftoverTempDirs = existsSync(join(root, '.prunelle-cache'))
      ? readdirSync(join(root, '.prunelle-cache')).filter(name => name.startsWith('mcp-analyze-'))
      : []
    expect(leftoverTempDirs).toEqual([])

    // Requesting write=true without --allow-write is refused
    const refused = await callTool(dispatcher, 'build_analyze', { write: true })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('--allow-write')
    expect(existsSync(join(root, 'dist'))).toBe(false)
  })

  it('build is refused without --allow-write and writes dist/ when allowWrite is true', async () => {
    const root = makeTempApp(BASE_APP_FILES)

    const roDisp = createPrunelleMcpDispatcher({ root, allowWrite: false })
    const refused = await callTool(roDisp, 'build')
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('--allow-write')
    expect(existsSync(join(root, 'dist'))).toBe(false)

    const rwDisp = createPrunelleMcpDispatcher({ root, allowWrite: true })
    const built = await callTool<{ ok: boolean, routeCount: number, routes: string[] }>(rwDisp, 'build')
    expect(built.isError).toBe(false)
    expect(built.data?.ok).toBe(true)
    expect(built.data?.routes).toContain('/')
    expect(existsSync(join(root, 'dist/manifest.json'))).toBe(true)
  })

  it('render renders / and /missing in-process without binding a port or creating dist/', async () => {
    const root = makeTempApp(BASE_APP_FILES)
    const dispatcher = createPrunelleMcpDispatcher({ root })

    const home = await callTool<{ status: number, ok: boolean, body: string }>(dispatcher, 'render', { url: '/' })
    expect(home.isError).toBe(false)
    expect(home.data?.status).toBe(200)
    expect(home.data?.ok).toBe(true)
    expect(home.data?.body).toContain('MCP Home')
    expect(existsSync(join(root, 'dist'))).toBe(false)

    const api = await callTool<{ status: number, body: string, reusedBuild: boolean }>(
      dispatcher,
      'render',
      { url: '/api/ping', headers: { accept: 'application/json' } },
    )
    expect(api.isError).toBe(false)
    expect(api.data?.status).toBe(200)
    expect(api.data?.reusedBuild).toBe(true)
    expect(JSON.parse(api.data!.body)).toEqual({ pong: true })

    const missing = await callTool<{ status: number, ok: boolean }>(dispatcher, 'render', { url: '/does-not-exist' })
    expect(missing.isError).toBe(false)
    expect(missing.data?.status).toBe(404)
    expect(missing.data?.ok).toBe(false)
  })

  it('docs searches sections across prunelle and installed plugins', async () => {
    const root = makeTempApp(BASE_APP_FILES, ['ui'])
    const dispatcher = createPrunelleMcpDispatcher({ root })

    const res = await callTool<{
      packages: { name: string }[]
      matches: { packageName: string, heading: string }[]
    }>(dispatcher, 'docs', { query: 'signal', limit: 5 })

    expect(res.isError).toBe(false)
    expect(res.data?.packages.map(p => p.name)).toContain('prunelle')
    expect(res.data?.packages.map(p => p.name)).toContain('@prunellejs/ui')
    expect(res.data?.matches.length).toBeGreaterThan(0)
  })

  it('dev_errors reports recorded build, runtime, and crash errors and clears after rebuild', async () => {
    const root = makeTempApp({
      'src/routes/index.tsx': `export default function Home() { return <h1>OK</h1> }`,
      'src/routes/api/boom.ts': `export function GET(): Response { throw new Error('boom from dev') }`,
    })
    const dispatcher = createPrunelleMcpDispatcher({ root })

    // Before dev server starts
    const empty = await callTool<{ hasErrors: boolean, runtimeErrors: unknown[] }>(dispatcher, 'dev_errors')
    expect(empty.isError).toBe(false)
    expect(empty.data?.hasErrors).toBe(false)
    expect(empty.data?.runtimeErrors).toEqual([])

    const srv = await devServer({ root, port: 0 })
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      // Trigger a runtime error
      const boomRes = await fetch(`${srv.url}/api/boom`, { headers: { accept: 'application/json' } })
      expect(boomRes.status).toBe(500)

      const afterRuntime = await callTool<{
        hasErrors: boolean
        buildError?: string
        runtimeErrors: { kind: string, message: string, method?: string, path?: string }[]
      }>(dispatcher, 'dev_errors')
      expect(afterRuntime.data?.hasErrors).toBe(true)
      expect(afterRuntime.data?.buildError).toBeUndefined()
      expect(afterRuntime.data?.runtimeErrors.length).toBe(1)
      expect(afterRuntime.data?.runtimeErrors[0]?.message).toContain('boom from dev')
      expect(afterRuntime.data?.runtimeErrors[0]?.method).toBe('GET')
      expect(afterRuntime.data?.runtimeErrors[0]?.path).toBe('/api/boom')

      // Trigger a build error
      writeFileSync(join(root, 'src/routes/index.tsx'), `export default function Home( { return <h1>Broken</h1> }`)
      await srv.rebuild()

      const afterBuildErr = await callTool<{ hasErrors: boolean, buildError?: string }>(dispatcher, 'dev_errors')
      expect(afterBuildErr.data?.hasErrors).toBe(true)
      expect(afterBuildErr.data?.buildError).toBeDefined()

      // Fix the build error -> buildError clears
      writeFileSync(join(root, 'src/routes/index.tsx'), `export default function Home() { return <h1>Fixed</h1> }`)
      await srv.rebuild()

      const afterFix = await callTool<{ hasErrors: boolean, buildError?: string }>(dispatcher, 'dev_errors')
      expect(afterFix.data?.buildError).toBeUndefined()

      // Record & clear crash error
      recordDevCrashError(root, 'prunelle dev: child exited with code 1')
      const withCrash = await callTool<{ hasErrors: boolean, crashError?: string }>(dispatcher, 'dev_errors')
      expect(withCrash.data?.hasErrors).toBe(true)
      expect(withCrash.data?.crashError).toContain('exited with code 1')

      recordDevCrashError(root, undefined)
      const clearedCrash = await callTool<{ crashError?: string }>(dispatcher, 'dev_errors')
      expect(clearedCrash.data?.crashError).toBeUndefined()
    }
    finally {
      errSpy.mockRestore()
      await srv.stop()
    }
  })

  it('rejects path traversal and symlink escapes across all path-accepting tools', async () => {
    const root = makeTempApp(BASE_APP_FILES)
    const outside = mkdtempSync(join(tmpdir(), 'prunelle-mcp-outside-'))
    tempDirs.push(outside)
    symlinkSync(outside, join(root, 'escape-link'), 'dir')

    const dispatcher = createPrunelleMcpDispatcher({ root, allowWrite: true })

    for (const tool of ['check', 'inspect', 'build_analyze', 'build', 'dev_errors'] as const) {
      const parentEsc = await callTool(dispatcher, tool, { dir: '../../etc' })
      expect(parentEsc.isError).toBe(true)
      expect(parentEsc.text).toContain('escapes the project root')

      const symlinkEsc = await callTool(dispatcher, tool, { dir: 'escape-link' })
      expect(symlinkEsc.isError).toBe(true)
      expect(symlinkEsc.text).toContain('escapes the project root')
    }

    const renderEsc = await callTool(dispatcher, 'render', { url: '/', dir: '../../etc' })
    expect(renderEsc.isError).toBe(true)
    expect(renderEsc.text).toContain('escapes the project root')

    for (const tool of ['build_analyze', 'build'] as const) {
      const outEsc = await callTool(dispatcher, tool, { outDir: '../escape' })
      expect(outEsc.isError).toBe(true)
      expect(outEsc.text).toContain('escapes the project root')

      const symlinkOutEsc = await callTool(dispatcher, tool, { outDir: 'escape-link/sub-dist' })
      expect(symlinkOutEsc.isError).toBe(true)
      expect(symlinkOutEsc.text).toContain('escapes the project root')
    }
  })

  it('runs cleanly end-to-end over stdio with newline-delimited JSON-RPC and zero stdout pollution', async () => {
    const root = makeTempApp(BASE_APP_FILES, ['ui'])
    const mcpPath = join(PRUNELLE_PKG_DIR, 'src/cli/mcp.ts')
    const runner = `import { runPrunelleMcpStdio } from ${JSON.stringify(mcpPath)}; await runPrunelleMcpStdio({ root: ${JSON.stringify(root)}, allowWrite: false });`

    const proc = Bun.spawn([process.execPath, '-e', runner], {
      cwd: root,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const requests = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PRUNELLE_MCP_PROTOCOL_VERSION, clientInfo: { name: 'smoke', version: '1.0' } } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'resources/list' }),
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'docs', arguments: { query: 'signal', limit: 3 } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'build_analyze', arguments: {} } }),
    ]

    proc.stdin.write(`${requests.join('\n')}\n`)
    proc.stdin.end()

    const [stdoutText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ])
    expect(exitCode).toBe(0)

    const lines = stdoutText.trim().split('\n').filter(Boolean)
    // 5 requests with `id` (the notification produces no line)
    expect(lines).toHaveLength(5)
    const responses = lines.map(l => JSON.parse(l) as RpcResponse)
    expect(responses.map(r => r.id)).toEqual([1, 2, 3, 4, 5])
    expect(responses[0]?.result).toMatchObject({ protocolVersion: PRUNELLE_MCP_PROTOCOL_VERSION })
    expect((responses[1]?.result as { tools: unknown[] }).tools).toHaveLength(7)
    expect((responses[2]?.result as { resources: { uri: string }[] }).resources.some(r => r.uri === 'prunelle://llms/prunelle')).toBe(true)
    expect((responses[3]?.result as unknown as ToolCallPayload).isError).not.toBe(true)
    expect((responses[4]?.result as unknown as ToolCallPayload).isError).not.toBe(true)
    expect(existsSync(join(root, 'dist'))).toBe(false)
  })
})
