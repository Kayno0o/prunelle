import type { ShikiTransformer, ThemeRegistration } from '@shikijs/core'
import { createHighlighterCore } from '@shikijs/core'
import { createOnigurumaEngine } from '@shikijs/engine-oniguruma'
import wasm from '@shikijs/engine-oniguruma/wasm-inlined'
import langBash from '@shikijs/langs/bash'
import langCss from '@shikijs/langs/css'
import langDiff from '@shikijs/langs/diff'
import langHtml from '@shikijs/langs/html'
import langJavascript from '@shikijs/langs/javascript'
import langJson from '@shikijs/langs/json'
import langTsx from '@shikijs/langs/tsx'
import langTypescript from '@shikijs/langs/typescript'
import langYaml from '@shikijs/langs/yaml'

// Listings sit on the page itself, so every light colour is checked against the paper.
const paper = '#f8f4ee'

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const ch = Number.parseInt(hex.slice(at, at + 2), 16) / 255
    return ch <= 0.039_28 ? ch / 12.92 : ((ch + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function readable(hex: string): string {
  const channels = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16))
  let darker = hex
  for (let scale = 1; (luminance(paper) + 0.05) / (luminance(darker) + 0.05) < 4.5; scale -= 0.01) {
    darker = `#${channels.map(c => Math.round(c * scale).toString(16).padStart(2, '0')).join('')}`
  }
  return darker
}

interface Palette {
  text: string
  comment: string
  keyword: string
  string: string
  tag: string
  fn: string
  type: string
}

function bookTheme(name: string, type: 'light' | 'dark', c: Palette): ThemeRegistration {
  return {
    name,
    type,
    colors: { 'editor.background': 'transparent', 'editor.foreground': c.text },
    tokenColors: [
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: c.comment } },
      { scope: ['keyword', 'storage', 'keyword.operator.new', 'keyword.control'], settings: { foreground: c.keyword } },
      { scope: ['string', 'string.template', 'punctuation.definition.string'], settings: { foreground: c.string } },
      { scope: ['entity.name.tag', 'constant', 'constant.numeric', 'constant.language', 'support.constant'], settings: { foreground: c.tag } },
      { scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function'], settings: { foreground: c.fn } },
      { scope: ['entity.name.type', 'support.type', 'support.class', 'entity.other.attribute-name'], settings: { foreground: c.type } },
      { scope: ['keyword.operator', 'punctuation'], settings: { foreground: c.text } },
    ],
  }
}

const dark = bookTheme('prunelle-dark', 'dark', {
  text: '#f8f4ee',
  comment: '#b5a6c2',
  keyword: '#e5c068',
  string: '#7cc79a',
  tag: '#f2a65a',
  fn: '#8fb8ea',
  type: '#edd085',
})

const light = bookTheme(
  'prunelle-light',
  'light',
  Object.fromEntries(
    Object.entries({
      text: '#18111d',
      comment: '#5a4b63',
      keyword: '#7a3667',
      string: '#2c6b3a',
      tag: '#8a5a00',
      fn: '#2b5c8a',
      type: '#692857',
    }).map(([k, hex]) => [k, readable(hex)]),
  ) as unknown as Palette,
)

const HL_KEY = Symbol.for('pru.docs.shiki')
const g = globalThis as Record<symbol, Awaited<ReturnType<typeof createHighlighterCore>> | undefined>
const highlighter = g[HL_KEY] ??= await createHighlighterCore({
  themes: [light, dark],
  langs: [langTypescript, langTsx, langJavascript, langJson, langYaml, langBash, langCss, langHtml, langDiff],
  engine: createOnigurumaEngine(wasm),
})

const loaded = new Set(highlighter.getLoadedLanguages())

export function highlight(code: string, language: string | undefined): string {
  const lang = language !== undefined && loaded.has(language) ? language : 'text'
  const labelled: ShikiTransformer = {
    pre(node) {
      if (lang !== 'text')
        node.properties['data-language'] = lang
    },
  }
  return highlighter.codeToHtml(code, {
    lang,
    themes: { light: light.name!, dark: dark.name! },
    defaultColor: 'light-dark()',
    transformers: [labelled],
  })
}
