import type { ContentEntry } from '@prunellejs/content'
import type { RequestContext } from 'prunelle/server'
import { join } from 'node:path'
import { shareCard } from '@prunellejs/images'
import { Head } from 'prunelle'
import { RunningHead } from '../../components/RunningHead'
import { type DocFrontmatter, docs, DOCS_ROOT, getFlatNav, getNavGroups, type NavGroup, type NavItem, numberChapter } from '../../content'
import { COPY_CODE_SCRIPT } from '../../copy-code'

export const prerender = true

export function paths(): string[] {
  return docs.paths('/docs')
}

interface DocPageData {
  entry: ContentEntry<DocFrontmatter>
  chapter: NavItem
  totalChapters: number
  html: string
  groups: NavGroup[]
  prev: NavItem | undefined
  next: NavItem | undefined
  ogImage: string
}

export async function load(ctx: RequestContext): Promise<DocPageData | Response> {
  const slug = ctx.params.slug ?? ''
  const entry = docs.get(slug)
  if (!entry)
    return new Response('Doc page not found', { status: 404 })

  await entry.render()
  const flat = getFlatNav()
  const idx = flat.findIndex(item => item.slug === entry.slug)
  const chapter = flat[idx]!
  const ogImage = shareCard({
    title: entry.data.title,
    badge: chapter.partLabel,
    image: join(DOCS_ROOT, 'src/prunelle-card.svg'),
  })

  return {
    entry,
    chapter,
    totalChapters: flat.length,
    html: numberChapter(entry.html, chapter.chapter),
    groups: getNavGroups(),
    prev: idx > 0 ? flat[idx - 1] : undefined,
    next: idx < flat.length - 1 ? flat[idx + 1] : undefined,
    ogImage,
  }
}

export default function DocPage({ data }: { data: DocPageData }) {
  const { entry, chapter, totalChapters, html, groups, prev, next, ogImage } = data
  const sections = entry.headings.filter(h => h.level === 2)

  return (
    <>
      <Head>
        <title>{entry.data.title}</title>
        <meta name="description" content={entry.data.description} />
        <meta property="og:image" content={ogImage} />
      </Head>
      <RunningHead left={chapter.partLabel} right={entry.data.title} />

      <div class="book">
        <input type="checkbox" id="toc-open" class="toc-check" aria-label="Toggle chapter contents" />
        <label for="toc-open" class="toc-toggle">
          <span>Contents</span>
          <small>{`Ch. ${chapter.chapter} / ${totalChapters}`}</small>
        </label>

        <nav class="contents" aria-label="Contents" data-pru-keep-scroll="contents">
          {groups.map(group => (
            <div key={group.id}>
              <div class="part">{`${group.part}. ${group.label}`}</div>
              <ol>
                {group.items.map(item => (
                  <li key={item.slug}>
                    <a class="ch" href={item.href} aria-current={item.slug === chapter.slug ? 'page' : undefined}>
                      <i>{item.chapter}</i>
                      <span>{item.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </nav>

        <article class="chapter">
          <header class="chapter-head">
            <span class="chapter-num" aria-hidden="true">{chapter.chapter}</span>
            <h1>{entry.data.title}</h1>
            <p class="lead">{entry.data.description}</p>
          </header>
          {sections.length > 0 && (
            <nav class="note in-chapter" aria-labelledby="in-chapter">
              <b id="in-chapter">In this chapter</b>
              <ol>
                {sections.map((h, n) => (
                  <li key={h.id}>
                    <a class="ch" href={`#${h.id}`}>
                      <i>{`${chapter.chapter}.${n + 1}`}</i>
                      <span>{h.text}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <div class="prose" innerHTML={html} />
          <script>{COPY_CODE_SCRIPT}</script>

          <nav class="turn" aria-label="Previous and next chapters">
            {prev !== undefined
              ? (
                  <a href={prev.href} rel="prev">
                    Previous
                    <b>{`${prev.chapter} ${prev.title}`}</b>
                  </a>
                )
              : <span />}
            {next !== undefined && (
              <a href={next.href} rel="next">
                Next
                <b>{`${next.chapter} ${next.title}`}</b>
              </a>
            )}
          </nav>
        </article>
      </div>
    </>
  )
}
