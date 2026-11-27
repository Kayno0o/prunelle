import { Head } from 'prunelle'
import { RunningHead } from '../components/RunningHead'

export default function NotFoundPage() {
  return (
    <>
      <Head>
        <title>Not found</title>
      </Head>
      <RunningHead left="Errata" right="404" />
      <main class="lost">
        <h1>This page isn't here.</h1>
        <p class="lead">It may have moved when the chapters were renumbered, or the link has a typo.</p>
        <div class="actions">
          <a data-ui="button" data-tone="accent" href="/">Back to the contents</a>
          <a class="text-link" href="/docs/getting-started/introduction">Read the docs</a>
        </div>
      </main>
    </>
  )
}
