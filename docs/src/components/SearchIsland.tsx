import { CommandPalette } from '@prunellejs/ui'

export interface SearchDocItem {
  id: string
  label: string
  href: string
  section: string
}

export function SearchIsland({ items }: { items: SearchDocItem[] }) {
  return (
    <CommandPalette
      $hydrate="interaction"
      triggerLabel="Search"
      placeholder="Jump to a chapter…"
      items={items.map(item => ({
        id: item.id,
        label: item.label,
        shortcut: item.section,
        href: item.href,
      }))}
    />
  )
}
