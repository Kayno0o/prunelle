// What the generated `dist/server/_entry.js` calls: an app from its bundled config and modules, plus what the caller serves it with.

import type { PrunelleConfig } from '../plugins/index'
import type { EmbeddedServerConfig, PrunelleApp } from './http'
import { resolveServerConfig } from '../plugins/index'
import { createServerFromEmbedded } from './index'

/** The manifest, assets and paths the caller read or embedded; runtime keys set here win over `prunelle.config.ts`. */
export type AppEntryOptions = Omit<EmbeddedServerConfig, 'modules'>

/** The exports of `dist/server/_entry.js`. */
export interface ServerEntry {
  prunelleConfig: PrunelleConfig
  /** Bundled modules by manifest key. */
  modules: Record<string, Record<string, unknown>>
  /** The same modules by root-relative source path. */
  sources: Record<string, Record<string, unknown>>
  createApp: (options: AppEntryOptions) => Promise<PrunelleApp>
}

export function createAppFromEntry(config: PrunelleConfig, modules: Record<string, unknown>, options: AppEntryOptions): Promise<PrunelleApp> {
  return createServerFromEmbedded({ ...options, ...resolveServerConfig(config, options), modules })
}
