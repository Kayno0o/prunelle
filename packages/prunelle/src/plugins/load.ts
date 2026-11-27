// Native `prunelle.config.ts` load, for the build, check and dev steps that run beside the bundled app.

import type { AppRuntimeContext } from './context'
import type { PrunelleConfig } from './types'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { assertKnownConfigKeys } from './config'
import { createAppContext, getAppContext, runWithAppContext } from './context'

let configReloadSeq = 0

// In dev the query follows the file content: a save elsewhere reuses the loaded config and its plugin instances instead of re-running every factory.
function configSpecifier(configPath: string, fresh: boolean, isDev: boolean): string {
  if (fresh)
    return `${configPath}?v=fresh-${++configReloadSeq}`
  if (isDev)
    return `${configPath}?v=${Bun.hash(readFileSync(configPath)).toString(36)}`
  return configPath
}

export async function loadConfig(
  root: string,
  options?: { fresh?: boolean | undefined, dev?: boolean | undefined, nodeEnv?: string | undefined, appContext?: AppRuntimeContext | undefined },
): Promise<PrunelleConfig> {
  const absRoot = resolve(root)
  const configPath = join(absRoot, 'prunelle.config.ts')
  if (!existsSync(configPath))
    return {}
  const active = options?.appContext ?? getAppContext()
  const isDev = options?.dev ?? active?.dev ?? (process.env.PRUNELLE_DEV === '1')
  const resolvedNodeEnv = options?.nodeEnv ?? active?.nodeEnv
  const spec = configSpecifier(configPath, options?.fresh === true, isDev)
  const ctx = active !== undefined && active.root === absRoot
    ? active
    : createAppContext({
        root: absRoot,
        outDir: join(absRoot, 'dist'),
        publicDir: join(absRoot, 'dist', 'public'),
        assetPrefix: '/_pru',
        dev: isDev,
        nodeEnv: resolvedNodeEnv,
      })
  let mod: { default?: PrunelleConfig }
  try {
    mod = await runWithAppContext(ctx, () => import(spec)) as { default?: PrunelleConfig }
  }
  catch (error) {
    // Several syntax errors arrive together; the first one names the line to fix.
    const first: unknown = (error as AggregateError).errors?.[0] ?? error
    throw new Error(`prunelle: ${configErrorLocation(first, configPath, absRoot)}: ${first instanceof Error ? first.message : String(first)}`, { cause: error })
  }
  const config = mod.default ?? {}
  assertKnownConfigKeys(config)
  return config
}

const STACK_LOCATION_RE = /:(\d+):(\d+)\)?$/

// Where a config failed: the syntax error's position, else the config's own frame in the stack, which names the line calling a throwing plugin factory.
function configErrorLocation(error: unknown, configPath: string, root: string): string {
  const position = (error as { position?: { file?: string, line: number, column: number } }).position
  if (position?.file !== undefined)
    return `${relative(root, position.file)}:${position.line}:${position.column}`
  for (const frame of String((error as Error).stack ?? '').split('\n')) {
    const match = frame.includes(configPath) ? STACK_LOCATION_RE.exec(frame) : null
    if (match !== null)
      return `prunelle.config.ts:${match[1]}:${match[2]}`
  }
  return 'prunelle.config.ts'
}
