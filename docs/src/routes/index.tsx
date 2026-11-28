import { join } from 'node:path'
import { shareCard } from '@prunellejs/images'
import { Head } from 'prunelle'
import pkg from '../../../packages/prunelle/package.json'
import { Mark } from '../components/Mark'
import { RunningHead } from '../components/RunningHead'
import { DOCS_ROOT, getNavGroups } from '../content'
import { COPY_CODE_SCRIPT } from '../copy-code'
import { highlight } from '../highlight'

export const prerender = true

const START = `bunx prunelle new my-app --template app
cd my-app && bun run dev`

const PILLARS = [
  {
    num: '01',
    title: 'Zero directives',
    body: 'Write plain TypeScript and TSX. Static routes ship 0 KB of JS, and components that use signals or events become islands automatically.',
  },
  {
    num: '02',
    title: 'Mistakes caught early',
    body: 'Types, compile checks, and prunelle check refuse broken links, server imports in islands, bad form fields, and React/Solid habits before deploy.',
  },
  {
    num: '03',
    title: 'Secure & compliant by default',
    body: 'Strict hashed CSP, CSRF verification, RGAA accessibility checks, EcoIndex budgets, and zero-JS CNIL consent gating out of the box.',
  },
  {
    num: '04',
    title: 'One binary or static HTML',
    body: 'Deploy a Bun server, a CDN-ready static export with brotli-11 sidecars, or a standalone --compile executable that boots in ~15 ms.',
  },
]

const HIGHLIGHTS = [
  { value: '15.1 ms', label: 'Compiled cold boot', detail: '9.3 MiB anonymous RSS' },
  { value: '329k/s', label: 'Cached SSR (gzip)', detail: 'export const cache = \'1h\'' },
  { value: '26.4 ms', label: 'Clean build', detail: 'Single Bun.build() pass' },
  { value: '−45% CSS', label: 'Per-route UI styles', detail: 'Consolidated into 1 sheet' },
]

const BENCH = [
  { name: 'prunelle', products: '3.82 KB', table: '6.91 KB', ssr: '5,484/s', rows: '219.1 ms', build: '26.4 ms' },
  { name: 'kay v1', products: '9.90 KB', table: '12.50 KB', ssr: '3,983/s', rows: '262.0 ms', build: '460 ms' },
  { name: 'SolidStart', products: '8.20 KB', table: '8.20 KB', ssr: '1,712/s', rows: '226.0 ms', build: '140 ms' },
  { name: 'SvelteKit', products: '22.50 KB', table: '22.50 KB', ssr: '3,861/s', rows: '232.0 ms', build: '90 ms' },
  { name: 'Astro', products: '8.60 KB', table: '9.60 KB', ssr: '1,898/s', rows: '234.0 ms', build: '1,190 ms' },
  { name: 'Next.js', products: '133.4 KB', table: '134.3 KB', ssr: '—', rows: '360.0 ms', build: '2,180 ms' },
  { name: 'Nuxt', products: '76.4 KB', table: '72.3 KB', ssr: '583/s', rows: '266.0 ms', build: '2,580 ms' },
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
          <p class="lead">Write plain TypeScript and TSX. Prunelle decides what reaches the browser: static pages ship 0 KB of JS, interactive parts become islands on their own, and production deploys as one binary or a static export.</p>
          <div class="actions">
            <a data-ui="button" data-tone="accent" href="/docs/getting-started/quickstart">Get started</a>
            <a class="text-link" href="/docs/getting-started/introduction">Read the docs</a>
          </div>
          <figure class="listing">
            <figcaption>
              <span>Start a site · bash</span>
              <button type="button" class="listing-copy">Copy</button>
            </figcaption>
            <div innerHTML={highlight(START, 'bash')} />
          </figure>
        </div>

        <div>
          <div class="eye-note">
            <Mark size="large" />
            <p>A cat's pupil narrows to a slit in daylight and opens wide in the dark. Prunelle lets JavaScript through the same way: only where a page needs it.</p>
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

      <section class="pillars" aria-label="Core principles">
        <ol>
          {PILLARS.map(p => (
            <li key={p.num}>
              <span class="pillar-num" aria-hidden="true">{p.num}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section class="measured" id="benchmarks" aria-labelledby="measured-title">
        <div class="measured-head">
          <h2 id="measured-title">Measured</h2>
          <a class="text-link" href="/docs/production/benchmarks">Full v0.3.0 &amp; real-app benchmarks</a>
        </div>

        <dl class="figures">
          {HIGHLIGHTS.map(h => (
            <div key={h.label}>
              <dt>{h.label}</dt>
              <dd class="figure-val">{h.value}</dd>
              <dd class="figure-detail">{h.detail}</dd>
            </div>
          ))}
        </dl>

        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Framework</th>
                <th scope="col">Products JS (gz)</th>
                <th scope="col">Table JS (gz)</th>
                <th scope="col">Uncached SSR</th>
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
        <p class="table-caption">Table 1 · Linux x64, Bun 1.4.5, headless Chromium. Uncached SSR of 500 products (with export const cache = '1h', Prunelle reaches 329,749 req/s gzip). Lower JS, row creation, and build times are better.</p>
      </section>
      <script>{COPY_CODE_SCRIPT}</script>
    </>
  )
}
