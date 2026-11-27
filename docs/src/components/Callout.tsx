import type { PrunelleChild } from 'prunelle'

// A margin note: beside the text on wide screens, after its paragraph on narrow ones.
export function Callout({ title, tone = 'info', children }: {
  title: string
  tone?: 'info' | 'tip' | 'warning' | undefined
  children?: PrunelleChild
}) {
  return (
    <aside class="note" data-tone={tone}>
      <b>{title}</b>
      {children}
    </aside>
  )
}
