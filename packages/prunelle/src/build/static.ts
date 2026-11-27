// `prunelle build --static`: gathers the prerendered pages, client assets and public files into one folder and swaps it in as the output directory.

import type { PrunellePlugin } from '../plugins/index'
import type { ServerEntry } from '../server/app-entry'
import type { PrunelleApp } from '../server/index'
import type { BuildManifest } from './manifest'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { resolvePlugins } from '../plugins/index'
import { createDocumentHooks, createHtmlHeaders } from '../server/document'
import { injectMetaCsp } from '../server/security'
import { createNavigation } from '../ssr/navigation'
import { createFallbackPages } from '../server/errors'
import { walkAllFiles } from './files'
import { precompressFiles } from './precompress'
import { carryPreviousAssets } from './carry'
import { swapStage } from './output'
import { prerenderOrigin } from '../server/prerendered'
import { pageFailure } from './prerender'

const LEADING_SLASH_RE = /^\//

export interface StaticExportOptions {
  /** The app's folder, whose `.prunelle-cache/` keeps the brotli of what was compressed before. */
  root: string
  /** The folder the site is assembled in; it becomes `finalOutDir`. */
  stageDir: string
  finalOutDir: string
  /** The regular build output the assets and public files are copied from. */
  outDir: string
  clientDir: string
  assetPrefix: string
  site?: string | undefined
  isDev?: boolean | undefined
  manifest: BuildManifest
  entry: ServerEntry | undefined
  pluginOverride?: PrunellePlugin[] | undefined
  assets: string[]
  publicFiles: { files: string[], register: (relPath: string) => string }
  /** The server the pages were prerendered with, fallback if `entry` is absent. */
  app: PrunelleApp | undefined
  hasNotFoundFile: boolean
  stageSuffix: string
}

function copyInto(dstRoot: string, rel: string, src: string): void {
  const dst = join(dstRoot, rel)
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(src, dst)
}

async function renderStaticNotFound(options: StaticExportOptions): Promise<string> {
  const origin = prerenderOrigin(options.site)
  if (options.entry !== undefined) {
    const plugins = resolvePlugins(options.pluginOverride ?? options.entry.prunelleConfig.plugins)
    const lang = options.entry.prunelleConfig.lang ?? 'en'
    const trustProxy = options.entry.prunelleConfig.trustProxy ?? false
    let renderError: unknown
    const notifyError = (err: unknown): void => {
      renderError ??= err
    }
    const document = createDocumentHooks({ plugins, lang, trustProxy, notifyError })
    const navigation = createNavigation(options.entry.prunelleConfig.navigation)
    const htmlHeaders = createHtmlHeaders(options.entry.prunelleConfig.security, {}, navigation, plugins)
    const { buildNotFoundResponse } = createFallbackPages({
      manifest: options.manifest,
      modules: options.entry.modules,
      lang,
      alwaysLoadRuntime: plugins.some(p => Boolean(p.clientEntry)),
      navigation: navigation.html,
      dev: options.isDev === true,
      document,
      htmlHeaders,
      notifyError,
      finish: res => res,
    })
    const url = new URL('/404', origin)
    const res = await buildNotFoundResponse(url, new Request(url))
    if (renderError !== undefined || res.status >= 500)
      throw pageFailure(`prunelle build: the _404 page of the static export answered HTTP ${res.status}`, renderError)
    return injectMetaCsp(await res.text(), res.headers.get('content-security-policy'))
  }
  const res = await options.app!.handle(new Request(`${origin}/__pru_404__`))
  if (res.status >= 500)
    throw pageFailure(`prunelle build: the _404 page of the static export answered HTTP ${res.status}`, undefined)
  return injectMetaCsp(await res.text(), res.headers.get('content-security-policy'))
}

export async function exportStatic(options: StaticExportOptions): Promise<void> {
  const { stageDir, finalOutDir, outDir, clientDir, publicFiles } = options
  if (options.hasNotFoundFile && (options.entry !== undefined || options.app !== undefined))
    writeFileSync(join(stageDir, '404.html'), await renderStaticNotFound(options))

  // Client assets go to <stage>/_pru/..., public files to <stage>/...
  const assetDir = join(stageDir, options.assetPrefix.replace(LEADING_SLASH_RE, ''))
  for (const rel of options.assets)
    copyInto(assetDir, rel, join(clientDir, rel))
  // Also pick up files written directly into the public folder without registering them.
  const outPublicDir = join(outDir, 'public')
  for (const abs of walkAllFiles(outPublicDir))
    publicFiles.register(relative(outPublicDir, abs))
  for (const rel of publicFiles.files)
    copyInto(stageDir, rel, join(outPublicDir, rel))
  await precompressFiles(walkAllFiles(stageDir), 128, options.root)
  if (!options.isDev)
    carryPreviousAssets(finalOutDir, stageDir, relative(stageDir, assetDir), options.assets)

  // Swap the stage in only after every page and asset succeeded.
  swapStage(stageDir, finalOutDir, options.stageSuffix)
}
