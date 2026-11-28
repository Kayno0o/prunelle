import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GRAMMAR_NAMES,
  grammarCssPath,
  renderGrammarBaseCss,
  renderGrammarCss,
  renderGrammarPartsCss,
  UI_COMPONENT_PARTS,
  UI_EXPORT_TO_PARTS,
} from '../../ui/src/plugin'

const STYLES_DIR = join(import.meta.dir, '../../ui/src/styles')
const THEMED_GRAMMARS = GRAMMAR_NAMES.filter(g => g !== 'bare')

describe('#32 @prunellejs/ui tokenized grammars, single focus ring & per-component CSS', () => {
  it('defines the focus-visible indicator once in base.css and never suppresses focus outlines in any grammar', () => {
    const baseCss = readFileSync(join(STYLES_DIR, 'base.css'), 'utf8')
    expect(baseCss).toContain('[data-ui] :focus-visible')
    expect(baseCss).toContain('outline: 2px solid var(--ui-focus-color, var(--ui-accent, currentColor))')

    const outlineSuppressRe = /\boutline\s*:\s*(?:none|0(?:px)?)\b/i

    for (const grammar of GRAMMAR_NAMES) {
      const rawFile = readFileSync(grammarCssPath(grammar), 'utf8')
      const rendered = renderGrammarCss(grammar)
      expect(outlineSuppressRe.test(rawFile)).toBe(false)
      expect(outlineSuppressRe.test(rendered)).toBe(false)
    }

    for (const part of UI_COMPONENT_PARTS) {
      const compCss = readFileSync(join(STYLES_DIR, 'components', `${part}.css`), 'utf8')
      expect(outlineSuppressRe.test(compCss)).toBe(false)
    }
  })

  it('keeps grammars thin by layering over shared theme/component sheets without restating structural rules', () => {
    for (const grammar of THEMED_GRAMMARS) {
      const rawFile = readFileSync(grammarCssPath(grammar), 'utf8')
      expect(rawFile).toContain("@import '../theme.css'")
      expect(rawFile).not.toMatch(/(?<!-)\bdisplay\s*:\s*inline-flex\b/)
      expect(rawFile).not.toMatch(/(?<!-)\bflex-direction\s*:\s*column\b/)
      expect(rawFile).not.toContain('border-collapse: collapse')
      expect(rawFile).not.toContain('overflow-x: auto')
    }

    // Tokenized grammars stay dramatically smaller than the old 11-12 KB duplicated sheets.
    for (const grammar of ['editorial', 'workshop', 'console', 'soft'] as const) {
      const rawFile = readFileSync(grammarCssPath(grammar), 'utf8')
      expect(rawFile.length).toBeLessThan(7000)
    }
  })

  it('maps every UI component export to valid UI_COMPONENT_PARTS including transitive dependencies', () => {
    const valid = new Set<string>(UI_COMPONENT_PARTS)
    for (const [exportName, parts] of Object.entries(UI_EXPORT_TO_PARTS)) {
      expect(parts.length, exportName).toBeGreaterThan(0)
      for (const p of parts)
        expect(valid.has(p), `${exportName} -> ${p}`).toBe(true)
    }

    expect(UI_EXPORT_TO_PARTS.Dialog).toEqual(['dialog', 'button', 'layout'])
    expect(UI_EXPORT_TO_PARTS.Drawer).toEqual(['drawer', 'button', 'layout'])
    expect(UI_EXPORT_TO_PARTS.DataTable).toEqual(['datatable', 'layout', 'button'])
    expect(UI_EXPORT_TO_PARTS.CommandPalette).toEqual(['command', 'button'])
    expect(UI_EXPORT_TO_PARTS.Menu).toEqual(['menu', 'button'])
    expect(UI_EXPORT_TO_PARTS.Popover).toEqual(['popover', 'button'])
    expect(UI_EXPORT_TO_PARTS.Button).toEqual(['button'])
    expect(UI_EXPORT_TO_PARTS.Card).toEqual(['card'])
    expect(UI_EXPORT_TO_PARTS.Stack).toEqual(['layout'])
  })

  it('assembles only requested component parts via renderGrammarBaseCss + renderGrammarPartsCss in @layer kui order', () => {
    const subset = ['button', 'card', 'layout'] as const

    for (const grammar of GRAMMAR_NAMES) {
      const base = renderGrammarBaseCss(grammar)
      const parts = renderGrammarPartsCss(grammar, subset)
      const combined = `${base}\n${parts}`

      expect(base).toContain('@layer kui')
      expect(base).toContain('box-sizing: border-box')
      expect(base).toContain('[data-ui] :focus-visible')
      expect(base).not.toContain('[data-ui="button"]')
      expect(base).not.toContain('[data-ui="datatable"]')

      expect(parts).toContain('@layer kui')
      expect(parts).toContain('[data-ui="button"]')
      expect(parts).toContain('[data-ui="card"]')
      expect(parts).toContain('[data-layout="stack"]')

      // Excluded components must NOT be emitted
      for (const omitted of ['datatable', 'command', 'tabs', 'accordion', 'dialog', 'drawer', 'select', 'menu', 'popover', 'toast', 'switch', 'radio-group', 'progress']) {
        expect(combined, `${grammar} should omit ${omitted}`).not.toContain(`[data-ui="${omitted}"]`)
      }

      // Subset is substantially smaller than the full grammar CSS
      const full = renderGrammarCss(grammar)
      expect(combined.length).toBeLessThan(full.length * 0.65)
      expect(full).not.toContain('@import')
      expect(combined).not.toContain('@import')
    }

    // Prunelle eye animations & @property rules are only emitted when their component parts are requested
    const prunelleSubset = `${renderGrammarBaseCss('prunelle')}\n${renderGrammarPartsCss('prunelle', subset)}`
    expect(prunelleSubset).not.toContain('ui-eye-blink')
    expect(prunelleSubset).not.toContain('@property --ui-progress')
    expect(prunelleSubset).not.toContain('@property --ui-lid-ink')

    const prunelleProgress = renderGrammarPartsCss('prunelle', ['progress'])
    expect(prunelleProgress).toContain('@property --ui-progress')
    expect(prunelleProgress).toContain('@keyframes ui-eye-blink')
    expect(prunelleProgress).not.toContain('@property --ui-lid-ink')

    // Shared eye rule in prunelle is emitted once even when both radio-group and switch are requested
    const prunelleEyePair = renderGrammarPartsCss('prunelle', ['radio-group', 'switch'])
    expect(prunelleEyePair.match(/@property --ui-lid-ink/g)?.length).toBe(1)
    expect(prunelleEyePair.match(/--ui-lid:\s*0\.2;/g)?.length).toBe(1)

    // Empty parts list produces empty string
    expect(renderGrammarPartsCss('editorial', [])).toBe('')
  })

  it('preserves cascade order: structural components before themed rules before grammar overrides', () => {
    const css = renderGrammarPartsCss('console', ['badge', 'accordion'])
    const structIdx = css.indexOf('[data-ui="badge"] {\n    display: inline-flex;')
    const themedIdx = css.indexOf('font: var(--ui-badge-f')
    const overrideIdx = css.indexOf("content: '['")
    expect(structIdx).toBeGreaterThan(-1)
    expect(themedIdx).toBeGreaterThan(structIdx)
    expect(overrideIdx).toBeGreaterThan(themedIdx)
  })
})
