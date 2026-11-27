import type { PrunelleChild } from 'prunelle'

export function Tabs({ label = 'Code examples', children }: { label?: string, children?: PrunelleChild }) {
  return (
    <div class="md-tabs" role="group" aria-label={label}>
      {children}
    </div>
  )
}
