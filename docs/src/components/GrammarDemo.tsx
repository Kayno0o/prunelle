import { signal } from 'prunelle'

const BASE = 'prunelle'

const GRAMMARS = [
  ['prunelle', 'Prunelle', 'Printed book: rules, plum & gold, eye controls'],
  ['orbit', 'Orbit', 'Starry sky, 1px hairlines, amber accent'],
  ['editorial', 'Editorial', 'Warm paper, serif display, top-ruled cards'],
  ['workshop', 'Workshop', '2px ink frames, offset shadow, tactile'],
  ['console', 'Console', 'Dense monospace, crisp gridlines, dark-first'],
  ['soft', 'Soft', 'Borderless tinted surfaces, pill controls'],
  ['bare', 'Bare', 'Behavior & layout floor only'],
] as const

let saved: [CSSStyleSheet, string][] = []

function setSiteKui(on: boolean): void {
  if (!on && !saved.length) {
    for (const s of document.styleSheets) {
      if (!s.href?.includes('/site-'))
        continue
      for (let i = s.cssRules.length; i--;) {
        const r = s.cssRules[i] as CSSLayerBlockRule
        if (r.name === 'kui') {
          saved.push([s, r.cssText])
          s.deleteRule(i)
        }
      }
    }
  }
  else if (on && saved.length) {
    for (const [s, css] of saved.reverse())
      s.insertRule(css, 0)
    saved = []
  }
}

export function GrammarDemo() {
  const active = signal<string>(BASE)

  const pick = (id: string) => {
    active.value = id
    const isBase = id === BASE
    for (const el of document.querySelectorAll<HTMLLinkElement>(`link[href*="/${BASE}-"]`))
      el.disabled = !isBase
    setSiteKui(isBase)

    let live = document.getElementById('kui-live-grammar') as HTMLLinkElement | null
    if (isBase) {
      live?.remove()
      return
    }
    if (!live) {
      live = document.createElement('link')
      live.id = 'kui-live-grammar'
      live.rel = 'stylesheet'
      document.head.appendChild(live)
    }
    live.href = `/grammars/${id}.css`
  }

  return (
    <div data-layout="stack" style="--ui-gap:1rem">
      <div data-layout="cluster" style="--ui-gap:0.45rem">
        {GRAMMARS.map(([id, label, note]) => (
          <button
            key={id}
            type="button"
            data-ui="button"
            data-size="sm"
            data-tone={active.value === id ? 'accent' : undefined}
            data-variant={active.value === id ? 'solid' : 'outline'}
            title={note}
            onClick={() => pick(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <p style="margin:0;font-family:var(--ui-font-mono);font-size:0.78rem;color:var(--ui-muted)">
        Active grammar: <strong style="color:var(--ui-accent)">{active.value}</strong> — eject with{' '}
        <code>prunelle ui-eject {active.value}</code>
      </p>
    </div>
  )
}
