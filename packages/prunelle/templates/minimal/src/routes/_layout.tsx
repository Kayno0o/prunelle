import type { PrunelleChild } from 'prunelle'
import { Head } from 'prunelle'
import '../styles/app.css'

export default function Layout({ children }: { children: PrunelleChild }) {
  return (
    <>
      <Head>
        <title>__APP_NAME__</title>
      </Head>
      <main>{children}</main>
    </>
  )
}
