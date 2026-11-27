// @prunellejs/spa — opt-in in-place navigation: `spa()` swaps whole pages and keeps persistent islands (~700 B gzip), `regions()` swaps one <Region> of a page. 0 B when uninstalled.

import type { BuildPluginContext, PrunellePlugin } from 'prunelle/config'
import { resolve } from 'node:path'
import { definePlugin } from 'prunelle/config'
import { checkRegionTargets } from './check'

// Shipped as a same-origin stylesheet so navigating from an island-less page to an island/Suspense page
// never needs to inject an unhashed inline <style> tag blocked by the initial page's strict CSP.
const SPA_ISLAND_CSS = 'pru-island,pru-slot,pru-s{display:contents}'

function emitIslandStylesheet(ctx: BuildPluginContext): void {
  ctx.addStyle(ctx.emitAsset('pru-island.css', SPA_ISLAND_CSS))
}

export function spa(): PrunellePlugin {
  return definePlugin({
    name: '@prunellejs/spa',
    clientEntry: resolve(import.meta.dir, 'client.ts'),
    build: emitIslandStylesheet,
  })
}

export function regions(): PrunellePlugin {
  return definePlugin({
    name: '@prunellejs/spa/regions',
    regionClientEntry: resolve(import.meta.dir, 'regions.ts'),
    build: emitIslandStylesheet,
    check: checkRegionTargets,
  })
}
