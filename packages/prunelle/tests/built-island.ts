import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// An island chunk as `prunelle build` writes it: the component, and the DOM runtime the loader hydrates it with.
export interface BuiltIsland<Args extends unknown[] = []> {
  default: (...args: Args) => Node | null
  hydrate: (el: Element, render: () => unknown) => () => void
}

const DOM_RUNTIME = join(import.meta.dir, '../src/dom/index.ts')

// Writes a hand-made island chunk ending as a built one does, so `<pru-island>` finds `hydrate` and `mount` in it.
export function writeIslandChunk(file: string, code: string): void {
  writeFileSync(file, `${code}\nexport { hydrate, mount } from ${JSON.stringify(DOM_RUNTIME)}\n`)
}
