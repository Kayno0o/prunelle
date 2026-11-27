// `prunelle build --static`: gathers the prerendered pages, client assets and public files into one folder and swaps it in as the output directory.

import type { PrunellePlugin } from '../plugins/index'
import type { ServerEntry } from '../server/app-entry'
import type { PrunelleApp } from '../server/index'
import type { BuildManifest, StatusPageManifestEntry } from './manifest'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { resolvePlugins } from '../plugins/index'
import { createDocumentHooks, createHtmlHeaders } from '../server/document'
import { createFallbackPages } from '../server/errors'
import { resolveParamMatchers } from '../server/param-matchers'
import { prerenderOrigin } from '../server/prerendered'
import { inferRoutesServerPrefix } from '../server/routing'
import { injectMetaCsp } from '../server/security'
import { createNavigation } from '../ssr/navigation'
import { carryPreviousAssets } from './carry'
import { walkAllFiles } from './files'
import { swapStage } from './output'
import { precompressFiles } from './precompress'
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

interface StaticNotFoundTarget {
  outRel: string
  urlPath: string
  routeFile?: string | undefined
}

function staticNotFoundTargets(manifest: BuildManifest, hasNotFoundFile: boolean): StaticNotFoundTarget[] {
  const targets: StaticNotFoundTarget[] = []
  const seen = new Set<string>()
  const statusPages: StatusPageManifestEntry[] = manifest.statusPages ?? []
  for (const entry of statusPages) {
    if (entry.kind !== '404' || entry.inGroup === true)
      continue
    if (entry.dirPattern.includes(':') || entry.dirPattern.includes('*'))
      continue
    const cleanDir = entry.dirPattern === '/' ? '' : entry.dirPattern.replace(LEADING_SLASH_RE, '')
    const outRel = cleanDir === '' ? '404.html' : `${cleanDir}/404.html`
    if (seen.has(outRel))
      continue
    seen.add(outRel)
    targets.push({
      outRel,
      urlPath: cleanDir === '' ? '/404' : `/${cleanDir}/404`,
      routeFile: entry.file,
    })
  }
  if (hasNotFoundFile && !seen.has('404.html'))
    targets.push({ outRel: '404.html', urlPath: '/404' })
  return targets
}

async function emitStaticNotFoundPages(options: StaticExportOptions): Promise<void> {
  const targets = staticNotFoundTargets(options.manifest, options.hasNotFoundFile)
  if (targets.length === 0 || (options.entry === undefined && options.app === undefined))
    return
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
    const routesPrefix = inferRoutesServerPrefix(options.manifest)
    const paramMatchers = resolveParamMatchers(options.manifest.paramMatchers, options.entry.modules)
    const { buildNotFoundResponse } = createFallbackPages({
      manifest: options.manifest,
      modules: options.entry.modules,
      routesPrefix,
      paramMatchers,
      lang,
      alwaysLoadRuntime: plugins.some(p => Boolean(p.clientEntry)),
      navigation: navigation.html,
      dev: options.isDev === true,
      document,
      htmlHeaders,
      notifyError,
      finish: res => res,
    })

    for (const target of targets) {
      renderError = undefined
      const url = new URL(target.urlPath, origin)
      const res = await buildNotFoundResponse(url, new Request(url), undefined, target.routeFile)
      if (renderError !== undefined || res.status >= 500)
        throw pageFailure(`prunelle build: the _404 page "${target.outRel}" of the static export answered HTTP ${res.status}`, renderError)
      const outAbs = join(options.stageDir, target.outRel)
      mkdirSync(dirname(outAbs), { recursive: true })
      writeFileSync(outAbs, injectMetaCsp(await res.text(), res.headers.get('content-security-policy')))
    }
    return
  }

  for (const target of targets) {
    const probePath = target.urlPath.replace(/\/404$/, '/__pru_404__')
    const res = await options.app!.handle(new Request(`${origin}${probePath}`))
    if (res.status >= 500)
      throw pageFailure(`prunelle build: the _404 page "${target.outRel}" of the static export answered HTTP ${res.status}`, undefined)
    const outAbs = join(options.stageDir, target.outRel)
    mkdirSync(dirname(outAbs), { recursive: true })
    writeFileSync(outAbs, injectMetaCsp(await res.text(), res.headers.get('content-security-policy')))
  }
}

export async function exportStatic(options: StaticExportOptions): Promise<void> {
  const { stageDir, finalOutDir, outDir, clientDir, publicFiles } = options
  await emitStaticNotFoundPages(options)

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
