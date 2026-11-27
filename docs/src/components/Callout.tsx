import type { PrunelleChild } from 'prunelle'

export function Callout({ title, tone = 'info', children }: {
  title: string
  tone?: 'info' | 'tip' | 'warning' | undefined
  children?: PrunelleChild
}) {
  return (
    <aside class="docs-callout" data-tone={tone}>
      <div class="docs-callout-title">{title}</div>
      <div>{children}</div>
    </aside>
  )
}
