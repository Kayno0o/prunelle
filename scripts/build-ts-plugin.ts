// Bundles `packages/prunelle/src/ts-plugin/index.ts` into a Node.js-compatible CJS plugin (`packages/prunelle/ts-plugin.cjs`)
// whose `module.exports` is directly the callable `init({ typescript })` factory expected by `tsserver`.

import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const ENTRY = join(ROOT, 'packages/prunelle/src/ts-plugin/index.ts')
const OUT_FILE = join(ROOT, 'packages/prunelle/ts-plugin.cjs')

// `tsserver` requires `typeof require('prunelle/ts-plugin') === 'function'`, while ESM/CJS consumers may also read named exports or `.default`.
const CJS_FACTORY_FOOTER = `
;(function () {
  const exported = module.exports;
  if (exported && typeof exported.default === 'function') {
    const factory = exported.default;
    for (const key of Object.keys(exported)) {
      if (key !== 'default' && !(key in factory))
        factory[key] = exported[key];
    }
    factory.default = factory;
    module.exports = factory;
  }
})();
`

const result = await Bun.build({
  entrypoints: [ENTRY],
  target: 'node',
  format: 'cjs',
  external: ['oxc-parser', 'typescript'],
  minify: false,
})

if (!result.success) {
  for (const log of result.logs)
    console.error(log)
  process.exit(1)
}

const output = result.outputs[0]
if (output === undefined) {
  console.error('build-ts-plugin: Bun.build produced no output')
  process.exit(1)
}

const bundled = await output.text()
await Bun.write(OUT_FILE, `${bundled}\n${CJS_FACTORY_FOOTER}`)
console.log(`built packages/prunelle/ts-plugin.cjs (${Math.round((bundled.length + CJS_FACTORY_FOOTER.length) / 1024)} KB)`)
