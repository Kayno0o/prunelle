// What plugins see of a build: the `build(ctx)` and `afterPrerender(ctx)` hooks, and the shared lists (assets, styles, head tags, public files) those hooks add to.

import type { AppRuntimeContext } from '../plugins/context'
import type { BuildPluginContext, FinalizeBuildContext, PrunellePlugin } from '../plugins/index'
import type { RouteManifestEntry, StatusPageManifestEntry } from './manifest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { precompressFiles } from './precompress'

const LEADING_SLASHES_RE = /^\/+/
const BACKSLASH_RE = /\\/g

function cleanRel(relPath: string): string {
  return relPath.replace(LEADING_SLASHES_RE, '').replace(BACKSLASH_RE, '/')
}

export interface PublicFiles {
  /** Public files known so far, as relative paths in registration order. */
  files: string[]
  /** Records a public file and returns its normalized relative path. */
  register: (relPath: string) => string
}

/** A plugin hook's throw, renamed `prunelle build: plugin "<name>" <hook> failed: <message>` with the original as `cause`. */
export function pluginHookError(plugin: Pick<PrunellePlugin, 'name'>, hook: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`prunelle build: plugin "${plugin.name}" ${hook} failed: ${message}`, { cause: error })
}

/** Runs one plugin hook, so a throw names the plugin and the hook. */
export async function runPluginHook<T>(plugin: Pick<PrunellePlugin, 'name'>, hook: string, run: () => T | Promise<T>): Promise<T> {
  try {
    return await run()
  }
  catch (error) {
    throw pluginHookError(plugin, hook, error)
  }
}

export function createPublicFiles(): PublicFiles {
  const files: string[] = []
  const seen = new Set<string>()
  return {
    files,
    register(relPath) {
      const clean = cleanRel(relPath)
      if (clean !== '' && !seen.has(clean)) {
        seen.add(clean)
        files.push(clean)
      }
      return clean
    },
  }
}

export interface PluginHostOptions {
  plugins: PrunellePlugin[]
  appCtx: AppRuntimeContext
  root: string
  outDir: string
  clientDir: string
  outPublicDir: string
  assetPrefix: string
  site?: string | undefined
  minify: boolean
  isStatic: boolean
  isDev: boolean
  routes: RouteManifestEntry[]
  statusPages?: StatusPageManifestEntry[] | undefined
  routeSourceFiles?: ReadonlyMap<string, readonly string[]> | undefined
  globalSourceFiles?: readonly string[] | undefined
  publicFiles: PublicFiles
  /** Client files already emitted, relative to the client dir. */
  assets: string[]
  styleUrls: string[]
  globalStyles: string[]
}

function createStyleMutators(
  styleUrls: string[],
  globalStyles: string[],
  routes: RouteManifestEntry[],
  statusPages: StatusPageManifestEntry[],
) {
  const styleSet = new Set(styleUrls)
  const globalStyleSet = new Set(globalStyles)
  let prependedGlobalCount = 0

  const addStyleUrl = (href: string): void => {
    if (!styleSet.has(href)) {
      styleSet.add(href)
      styleUrls.push(href)
    }
  }

  return {
    addStyle(href: string) {
      addStyleUrl(href)
      if (!globalStyleSet.has(href)) {
        globalStyleSet.add(href)
        globalStyles.push(href)
      }
      for (const r of routes) {
        if (r.styles !== undefined && !r.styles.includes(href))
          r.styles.push(href)
      }
      for (const sp of statusPages) {
        if (!sp.styles.includes(href))
          sp.styles.push(href)
      }
    },
    prependStyle(href: string) {
      addStyleUrl(href)
      const insertAt = prependedGlobalCount
      if (!globalStyleSet.has(href)) {
        globalStyleSet.add(href)
        globalStyles.splice(insertAt, 0, href)
        prependedGlobalCount++
      }
      for (const r of routes) {
        if (r.styles !== undefined && !r.styles.includes(href))
          r.styles.splice(Math.min(insertAt, r.styles.length), 0, href)
      }
      for (const sp of statusPages) {
        if (!sp.styles.includes(href))
          sp.styles.splice(Math.min(insertAt, sp.styles.length), 0, href)
      }
    },
    addRouteStyle(routePath: string, href: string) {
      addStyleUrl(href)
      const route = routes.find(r => r.path === routePath)
      if (route !== undefined) {
        route.styles ??= [...globalStyles]
        if (!route.styles.includes(href))
          route.styles.push(href)
      }
    },
    prependRouteStyle(routePath: string, href: string) {
      addStyleUrl(href)
      const route = routes.find(r => r.path === routePath)
      if (route !== undefined) {
        route.styles ??= [...globalStyles]
        if (!route.styles.includes(href)) {
          let idx = 0
          while (idx < route.styles.length && globalStyleSet.has(route.styles[idx]!))
            idx++
          route.styles.splice(idx, 0, href)
        }
      }
    },
  }
}

export function createPluginHost(options: PluginHostOptions) {
  const { plugins, appCtx, outDir, clientDir, outPublicDir, assetPrefix, routes, statusPages = [], assets, styleUrls, globalStyles } = options
  const assetSet = new Set(assets)
  const headTags: string[] = []
  const pluginData: Record<string, Record<string, unknown>> = {}
  const precompressed = new Set<string>()
  const styles = createStyleMutators(styleUrls, globalStyles, routes, statusPages)

  function emitAsset(relPath: string, content: string | Uint8Array): string {
    const clean = cleanRel(relPath)
    const dst = join(clientDir, clean)
    mkdirSync(dirname(dst), { recursive: true })
    writeFileSync(dst, content)
    if (!assetSet.has(clean)) {
      assetSet.add(clean)
      assets.push(clean)
    }
    return `${assetPrefix}/${clean}`
  }

  function emitPublic(relPath: string, content: string | Uint8Array): string {
    const clean = options.publicFiles.register(relPath)
    const dst = join(outPublicDir, clean)
    mkdirSync(dirname(dst), { recursive: true })
    writeFileSync(dst, content)
    return `/${clean}`
  }

  // resolvePlugins() refuses two plugins sharing a name, so each name has one owner.
  const setDataFor = (plugin: PrunellePlugin) => (data: Record<string, unknown>): void => {
    pluginData[plugin.name] = { ...pluginData[plugin.name], ...data }
  }

  const shared = {
    root: options.root,
    outDir,
    assetPrefix,
    ...(options.site !== undefined ? { site: options.site } : {}),
    minify: options.minify,
    isStatic: options.isStatic,
    dev: options.isDev,
    routes,
    emitAsset,
    emitPublic,
    provide: appCtx.provide,
    inject: appCtx.inject,
  }

  const buildCtx = {
    ...shared,
    ...(options.routeSourceFiles !== undefined ? { routeSourceFiles: options.routeSourceFiles } : {}),
    ...(options.globalSourceFiles !== undefined ? { globalSourceFiles: options.globalSourceFiles } : {}),
    ...styles,
    addHead(html: string) {
      if (html !== '')
        headTags.push(html)
    },
    addRouteHead(routePath: string, html: string) {
      const route = html === '' ? undefined : routes.find(r => r.path === routePath)
      if (route !== undefined)
        (route.headTags ??= []).push(html)
    },
  }

  return {
    headTags,
    pluginData,
    /** Runs every plugin's `build(ctx)`, so plugins can emit hashed assets, public files, styles, <head> tags, or services. */
    async runBuild(): Promise<void> {
      for (const plugin of plugins) {
        if (plugin.build !== undefined) {
          const ctx: BuildPluginContext = { ...buildCtx, setData: setDataFor(plugin) }
          await runPluginHook(plugin, 'build', () => plugin.build!(ctx))
        }
      }
    },

    /** Runs every plugin's `afterPrerender(ctx)`, once `route.prerendered` and prerender-emitted public files are known. */
    async runAfterPrerender(): Promise<boolean> {
      let ran = false
      for (const plugin of plugins) {
        if (plugin.afterPrerender !== undefined) {
          ran = true
          const ctx: FinalizeBuildContext = { ...shared, publicFiles: options.publicFiles.files, setData: setDataFor(plugin) }
          await runPluginHook(plugin, 'afterPrerender', () => plugin.afterPrerender!(ctx))
        }
      }
      return ran
    },

    /**
     * Writes `.br`/`.gz` sidecars for the client assets, public files and prerendered pages not compressed yet, so the server never compresses them itself.
     * Production server builds only: `--static` compresses its own output. A public file the app ships with its own sidecar keeps it.
     */
    async precompressOutput(): Promise<void> {
      if (options.isDev || options.isStatic)
        return
      const pending: string[] = []
      const once = (abs: string): void => {
        if (!precompressed.has(abs)) {
          precompressed.add(abs)
          pending.push(abs)
        }
      }
      for (const rel of assets)
        once(join(clientDir, rel))
      const listed = new Set(options.publicFiles.files)
      for (const rel of listed) {
        const abs = join(outPublicDir, rel)
        if (!listed.has(`${rel}.br`) && !listed.has(`${rel}.gz`) && existsSync(abs))
          once(abs)
      }
      for (const route of routes) {
        for (const rel of Object.values(route.prerendered ?? {}))
          once(join(outDir, rel))
      }
      await precompressFiles(pending, 256, options.root)
    },
  }
}
