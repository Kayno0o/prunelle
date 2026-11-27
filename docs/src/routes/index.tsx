import { join } from 'node:path'
import { shareCard } from '@prunellejs/images'
import { Head } from 'prunelle'
import pkg from '../../../packages/prunelle/package.json'
import { Mark } from '../components/Mark'
import { RunningHead } from '../components/RunningHead'
import { DOCS_ROOT, getNavGroups } from '../content'
import { highlight } from '../highlight'

export const prerender = true

const START = `bunx prunelle new my-app --template app
cd my-app && bun run dev`

const BENCH = [
  { name: 'prunelle', products: '2.62 KB', table: '4.93 KB', ssr: '7,017/s', rows: '219.1 ms', build: '18.8 ms' },
  { name: 'kay v1', products: '11.40 KB', table: '13.80 KB', ssr: '3,983/s', rows: '262.0 ms', build: '460 ms' },
  { name: 'SolidStart', products: '8.20 KB', table: '8.20 KB', ssr: '1,712/s', rows: '226.0 ms', build: '140 ms' },
  { name: 'SvelteKit', products: '22.50 KB', table: '22.50 KB', ssr: '3,861/s', rows: '232.0 ms', build: '90 ms' },
  { name: 'Astro', products: '8.60 KB', table: '9.60 KB', ssr: '1,898/s', rows: '234.0 ms', build: '1,190 ms' },
]

export default function HomePage() {
  const groups = getNavGroups()
  const ogImage = shareCard({
    title: 'prunelle, a web framework for Bun',
    badge: `Version ${pkg.version}`,
    image: join(DOCS_ROOT, 'src/prunelle-card.svg'),
  })

  return (
    <>
      <Head>
        <title>prunelle, a web framework for Bun</title>
        <meta property="og:image" content={ogImage} />
      </Head>
      <RunningHead left="A web framework for Bun" right={`Version ${pkg.version}`} />

      <main class="title-page">
        <div>
          <p class="kicker">
            {`prunelle ${pkg.version} · `}
            <b>la prunelle</b>
            , the pupil of the eye
          </p>
          <h1 class="hero">
            Lets in only what the page
            {' '}
            <em>needs.</em>
          </h1>
          <p class="lead">Write TypeScript and TSX. prunelle decides what reaches the browser: a static page ships 0 KB of JS, and an interactive part becomes an island on its own.</p>
          <div class="actions">
            <a data-ui="button" data-tone="accent" href="/docs/getting-started/quickstart">Get started</a>
            <a class="text-link" href="/docs/getting-started/introduction">Read the docs</a>
          </div>
          <figure class="listing">
            <figcaption><span>Start a site</span></figcaption>
            <div innerHTML={highlight(START, 'bash')} />
          </figure>
        </div>

        <div>
          <div class="eye-note">
            <Mark size="large" />
            <p>A cat's pupil narrows to a slit in daylight and opens wide in the dark. prunelle lets JavaScript through the same way: only where a page needs it.</p>
          </div>
          <nav class="sommaire" aria-labelledby="sommaire-title">
            <h2 id="sommaire-title">Contents</h2>
            <ol>
              {groups.map(group => (
                <li key={group.id}>
                  <a class="ch" href={group.items[0]!.href}>
                    <i>{group.part}</i>
                    <span>
                      {group.label}
                      <small>{group.blurb}</small>
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </main>

      <section class="measured" id="benchmarks" aria-labelledby="measured-title">
        <h2 id="measured-title">Measured</h2>
        <div class="table-scroll">
          <table>
            <caption>Table 1 · Bun 1.4.5, mitata. Lower JS and build times are better.</caption>
            <thead>
              <tr>
                <th scope="col">Framework</th>
                <th scope="col">Products JS (gz)</th>
                <th scope="col">Table JS (gz)</th>
                <th scope="col">SSR</th>
                <th scope="col">Create 10k rows</th>
                <th scope="col">Clean build</th>
              </tr>
            </thead>
            <tbody>
              {BENCH.map(row => (
                <tr key={row.name} data-self={row.name === 'prunelle' ? '' : undefined}>
                  <th scope="row">{row.name}</th>
                  <td>{row.products}</td>
                  <td>{row.table}</td>
                  <td>{row.ssr}</td>
                  <td>{row.rows}</td>
                  <td>{row.build}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
