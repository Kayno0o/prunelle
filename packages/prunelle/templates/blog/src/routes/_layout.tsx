import type { PrunelleChild } from 'prunelle'
import { Head } from 'prunelle'
import '../styles/app.css'

export default function Layout({ children }: { children: PrunelleChild }) {
  return (
    <>
      <Head>
        <title>__APP_NAME__</title>
      </Head>
      <div class="wrap">
        <header data-layout="split" class="site-header">
          <a href="/" class="site-brand">__APP_NAME__</a>
          <a href="/rss.xml" class="site-rss">RSS</a>
        </header>
        <main>{children}</main>
      </div>
    </>
  )
}
