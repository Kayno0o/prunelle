import type { PrunelleChild } from 'prunelle'
import { Mark } from '../components/Mark'
import { SearchIsland } from '../components/SearchIsland'
import { getFlatNav } from '../content'

export default function Layout({ children, url }: { children: PrunelleChild, url: URL }) {
  const pathname = url.pathname
  const searchItems = getFlatNav().map(item => ({
    id: item.slug,
    label: item.title,
    href: item.href,
    section: item.sectionLabel,
  }))

  return (
    <>
      <header class="mast">
        <a class="brand" href="/">
          <Mark />
          prunelle
        </a>
        <nav class="mast-nav" aria-label="Main navigation">
          <a href="/docs/getting-started/introduction" aria-current={pathname.startsWith('/docs') && pathname !== '/docs/production/benchmarks' ? 'page' : undefined}>Docs</a>
          <a class="mast-hide-sm" href="/docs/production/benchmarks" aria-current={pathname === '/docs/production/benchmarks' ? 'page' : undefined}>Benchmarks</a>
          <a href="/grammars" aria-current={pathname === '/grammars' ? 'page' : undefined}>Grammars</a>
          <a class="mast-hide-sm" href="/llms.txt">llms.txt</a>
          <SearchIsland items={searchItems} />
        </nav>
      </header>
      {children}
      <footer class="colophon">
        <a class="brand" href="/">
          <Mark />
          prunelle
        </a>
        <p>
          Titles in Fraunces, text in your system's sans.
          {' '}
          <span data-page-weight=""></span>
          {' '}
          MIT,
          {' '}
          <a href="https://github.com/Kayno0o/prunelle">source on GitHub</a>
          .
        </p>
      </footer>
    </>
  )
}
