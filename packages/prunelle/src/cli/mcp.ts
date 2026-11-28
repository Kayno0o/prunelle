// Built-in `prunelle mcp` stdio JSON-RPC 2.0 server (MCP 2025-03-26, zero external dependencies).

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  callPrunelleTool,
  hasPrunelleTool,
  listPrunelleResources,
  listPrunelleTools,
  readPrunelleResource,
} from './mcp-tools'

export const PRUNELLE_MCP_PROTOCOL_VERSION = '2025-03-26'

export interface PrunelleMcpOptions {
  root: string
  allowWrite?: boolean | undefined
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null | undefined
  method: string
  params?: Record<string, unknown> | undefined
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number, message: string, data?: unknown }
}

function readPrunelleVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../../package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0'
  }
  catch {
    return '0.0.0'
  }
}

const PRUNELLE_VERSION = readPrunelleVersion()

const SERVER_INSTRUCTIONS = [
  'Prunelle development MCP server.',
  'Read `prunelle://llms/*` resources or call `docs` for framework and plugin APIs.',
  'Use `check`, `inspect`, `build_analyze`, `render`, and `dev_errors` to verify and debug the app.',
  'Tools that write build output (`build`, or `build_analyze` with `write: true` / `outDir`) require `--allow-write`.',
].join(' ')

function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function asParamsRecord(params: unknown): Record<string, unknown> | undefined {
  if (params === undefined || params === null)
    return undefined
  if (typeof params === 'object' && !Array.isArray(params))
    return params as Record<string, unknown>
  return undefined
}

/** Creates an in-process JSON-RPC 2.0 dispatcher for `prunelle mcp` (used by both stdio transport and unit tests). */
export function createPrunelleMcpDispatcher(options: PrunelleMcpOptions): {
  handleMessage: (msg: unknown) => Promise<unknown | undefined>
  handleLine: (line: string) => Promise<string | undefined>
} {
  const ctx = {
    root: resolve(options.root),
    allowWrite: options.allowWrite === true,
  }
  const tools = listPrunelleTools()
  const toolNamesHint = tools.map(t => t.name).join(', ')

  async function handleMessage(msg: unknown): Promise<JsonRpcResponse | undefined> {
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg))
      return rpcError(null, -32600, 'Invalid Request')

    const req = msg as Partial<JsonRpcRequest>
    const hasId = 'id' in req && req.id !== undefined
    const id = hasId ? (req.id ?? null) : null

    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string')
      return rpcError(id, -32600, 'Invalid Request')

    // JSON-RPC notifications (no `id`) produce no response.
    if (!hasId)
      return undefined

    switch (req.method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: PRUNELLE_MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: { name: 'prunelle', version: PRUNELLE_VERSION },
          instructions: SERVER_INSTRUCTIONS,
        })

      case 'ping':
        return rpcResult(id, {})

      case 'tools/list':
        return rpcResult(id, { tools })

      case 'tools/call': {
        const params = asParamsRecord(req.params)
        const toolName = typeof params?.name === 'string' ? params.name : undefined
        if (toolName === undefined)
          return rpcError(id, -32602, 'Missing tool name')
        if (!hasPrunelleTool(toolName))
          return rpcError(id, -32602, `Unknown tool: ${toolName} (available: ${toolNamesHint})`)
        const toolResult = await callPrunelleTool(ctx, toolName, params?.arguments)
        return rpcResult(id, toolResult)
      }

      case 'resources/list':
        return rpcResult(id, { resources: listPrunelleResources(ctx.root) })

      case 'resources/read': {
        const params = asParamsRecord(req.params)
        const uri = typeof params?.uri === 'string' ? params.uri : undefined
        if (uri === undefined)
          return rpcError(id, -32602, 'Missing resource uri')
        const content = readPrunelleResource(ctx.root, uri)
        if (content === undefined)
          return rpcError(id, -32002, `Unknown resource: ${uri}`)
        return rpcResult(id, { contents: [content] })
      }

      default:
        return rpcError(id, -32601, `Method not found: ${req.method}`)
    }
  }

  async function handleLine(line: string): Promise<string | undefined> {
    const trimmed = line.trim()
    if (trimmed.length === 0)
      return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    }
    catch {
      return JSON.stringify(rpcError(null, -32700, 'Parse error'))
    }
    const response = await handleMessage(parsed)
    return response !== undefined ? JSON.stringify(response) : undefined
  }

  return { handleMessage, handleLine }
}

/** Runs the `prunelle mcp` stdio JSON-RPC 2.0 loop, redirecting console/stdout logs to stderr so framing stays clean. */
export async function runPrunelleMcpStdio(options: PrunelleMcpOptions): Promise<number> {
  const dispatcher = createPrunelleMcpDispatcher(options)
  const writeFrame = process.stdout.write.bind(process.stdout)
  const origStdoutWrite = process.stdout.write
  const origConsoleLog = console.log
  const origConsoleInfo = console.info
  const origConsoleDebug = console.debug

  process.stdout.write = process.stderr.write.bind(process.stderr)
  console.log = console.error
  console.info = console.error
  console.debug = console.error

  const emit = (line: string | undefined): void => {
    if (line !== undefined)
      writeFrame(`${line}\n`)
  }

  try {
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of process.stdin) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
      let newlineIdx = buffer.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)
        emit(await dispatcher.handleLine(line))
        newlineIdx = buffer.indexOf('\n')
      }
    }
    const trailing = buffer + decoder.decode()
    if (trailing.trim().length > 0)
      emit(await dispatcher.handleLine(trailing))
    return 0
  }
  finally {
    process.stdout.write = origStdoutWrite
    console.log = origConsoleLog
    console.info = origConsoleInfo
    console.debug = origConsoleDebug
  }
}
