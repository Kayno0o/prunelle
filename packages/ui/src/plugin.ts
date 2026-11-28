// @prunellejs/ui PrunellePlugin — wires a pure CSS Grammar (`editorial | workshop | console | soft | orbit | prunelle | bare`)
// and adds `prunelle ui-eject <grammar> [dest]` so apps can copy & own the entire look in ONE CSS file.

import type { BuildPluginContext, PrunellePlugin } from 'prunelle/config'
import type { GrammarName, UiComponentPart } from './styles/split'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { definePlugin, minifyCss, serviceKey } from 'prunelle/config'
import { FALLBACK_FILE, FALLBACK_GUARD, FALLBACK_JS, withPlatformFallback } from './platform-fallback'
import { createUiPartScanner } from './styles/scan'
import {
  GRAMMAR_NAMES,
  grammarCssPath,
  renderGrammarBaseCss,
  renderGrammarCss as renderFullGrammarCss,
  renderGrammarPartsCss,
  UI_COMPONENT_PARTS,
  UI_EXPORT_TO_PARTS,
} from './styles/split'

export {
  GRAMMAR_NAMES,
  grammarCssPath,
  renderGrammarBaseCss,
  renderGrammarPartsCss,
  UI_COMPONENT_PARTS,
  UI_EXPORT_TO_PARTS,
}
export type { GrammarName, UiComponentPart }

const UI_KUI_LAYER_SERVICE = serviceKey<boolean>('prunelle.ui.kuiLayer')

/** Returns the self-contained CSS source for a grammar (with `base.css` and component sheets inlined). */
export function renderGrammarCss(grammar: GrammarName, _bareCss?: string): string {
  return renderFullGrammarCss(grammar)
}

/** Ejects a complete, self-contained CSS Grammar file into the app. */
export function ejectGrammar(root: string, grammar: GrammarName = 'editorial', destRel = 'src/styles/ui.css'): string {
  const outPath = resolve(root, destRel)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, renderGrammarCss(grammar))
  return outPath
}

export interface EmitGrammarsOptions {
  /** Public directory relative to `dist/public` (default: `'grammars'`). */
  dir?: string | undefined
  /** Subset of grammars to emit (default: all grammars). */
  grammars?: readonly GrammarName[] | undefined
}

export interface UiPluginOptions {
  /** Which pure CSS Grammar to include (default: 'editorial'). Pass `false` if importing your own CSS. */
  grammar?: GrammarName | false | undefined
  /** Emit standalone self-contained grammar CSS files into `public/grammars/<name>.css` for runtime switching. */
  emitGrammars?: boolean | readonly GrammarName[] | EmitGrammarsOptions | undefined
}

function resolveEmitGrammars(opt: UiPluginOptions['emitGrammars']): { dir: string, grammars: readonly GrammarName[] } | undefined {
  if (!opt)
    return undefined
  if (opt === true)
    return { dir: 'grammars', grammars: GRAMMAR_NAMES }
  if (Array.isArray(opt))
    return { dir: 'grammars', grammars: opt }
  const opts = opt as EmitGrammarsOptions
  const dir = (opts.dir ?? 'grammars').replace(/^\/+|\/+$/g, '')
  return { dir, grammars: opts.grammars ?? GRAMMAR_NAMES }
}

function cssHash(css: string): string {
  return createHash('sha256').update(css).digest('hex').slice(0, 8)
}

function emitGrammarStyles(ctx: BuildPluginContext, grammar: GrammarName): void {
  const prepGlobal = ctx.prependStyle ?? ctx.addStyle
  const prepRoute = ctx.prependRouteStyle ?? ctx.addRouteStyle
  if (prepGlobal === undefined)
    return
  const format = (css: string): string => ctx.minify ? minifyCss(css) : css

  if (ctx.routeSourceFiles === undefined) {
    const full = format(renderGrammarCss(grammar))
    prepGlobal(ctx.emitAsset(`${grammar}-${cssHash(full)}.css`, full))
    return
  }

  const scan = createUiPartScanner()
  const globalParts = scan(ctx.globalSourceFiles ?? [])
  const routes = ctx.routes ?? []
  const perRoute = new Map<string, Set<UiComponentPart>>()
  for (const route of routes)
    perRoute.set(route.path, scan(ctx.routeSourceFiles.get(route.path) ?? []))

  // Any UI component part rendered on every route belongs in the site-wide sheet so it is cached across navigations.
  if (routes.length > 0) {
    const firstParts = perRoute.get(routes[0]!.path)!
    for (const part of firstParts) {
      if (routes.every(r => perRoute.get(r.path)!.has(part)))
        globalParts.add(part)
    }
  }

  const baseSource = globalParts.size > 0
    ? `${renderGrammarBaseCss(grammar)}\n${renderGrammarPartsCss(grammar, globalParts)}`
    : renderGrammarBaseCss(grammar)
  const baseCss = format(baseSource)
  prepGlobal(ctx.emitAsset(`${grammar}-${cssHash(baseCss)}.css`, baseCss))

  if (prepRoute === undefined)
    return
  const routeCache = new Map<string, string>()
  for (const route of routes) {
    const routeParts = perRoute.get(route.path)!
    const extra = UI_COMPONENT_PARTS.filter(p => routeParts.has(p) && !globalParts.has(p))
    if (extra.length === 0)
      continue
    const key = extra.join(',')
    let href = routeCache.get(key)
    if (href === undefined) {
      const partsCss = format(renderGrammarPartsCss(grammar, extra))
      href = ctx.emitAsset(`${grammar}-parts-${cssHash(partsCss)}.css`, partsCss)
      routeCache.set(key, href)
    }
    prepRoute(route.path, href)
  }
}

export function ui(options: UiPluginOptions = {}): PrunellePlugin {
  const grammar = options.grammar === undefined ? 'editorial' : options.grammar
  const emit = resolveEmitGrammars(options.emitGrammars)
  let assetPrefix = '/_pru'
  return definePlugin({
    name: '@prunellejs/ui',
    inlineScripts: [FALLBACK_GUARD],
    build(ctx) {
      ctx.emitAsset(FALLBACK_FILE, FALLBACK_JS)
      if (grammar !== false) {
        ctx.provide?.(UI_KUI_LAYER_SERVICE, true)
        emitGrammarStyles(ctx, grammar)
      }
      if (emit !== undefined) {
        const prefix = emit.dir ? `${emit.dir}/` : ''
        for (const g of emit.grammars) {
          const css = renderGrammarCss(g)
          ctx.emitPublic(`${prefix}${g}.css`, ctx.minify ? minifyCss(css) : css)
        }
      }
    },
    server(api) {
      assetPrefix = api.assetPrefix
    },
    transformHtml: html => withPlatformFallback(html, assetPrefix),
    commands: {
      'ui-eject': (args, root) => {
        const name = (args[0] ?? 'editorial') as GrammarName
        if (!GRAMMAR_NAMES.includes(name)) {
          console.error(`Unknown grammar "${name}". Choose one of: ${GRAMMAR_NAMES.join(', ')}`)
          process.exit(1)
        }
        const dest = args[1] ?? 'src/styles/ui.css'
        const outPath = ejectGrammar(root, name, dest)
        console.log(`Ejected @prunellejs/ui "${name}" grammar to ${outPath}`)
      },
    },
  })
}
