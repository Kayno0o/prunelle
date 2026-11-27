import type { ContentEntry } from '@prunellejs/content'
import type { RequestContext } from 'prunelle/server'
import { join } from 'node:path'
import { shareCard } from '@prunellejs/images'
import { Head } from 'prunelle'
import { RunningHead } from '../../components/RunningHead'
import { type DocFrontmatter, docs, DOCS_ROOT, getFlatNav, getNavGroups, type NavGroup, type NavItem, numberChapter } from '../../content'

export const prerender = true

const COPY_CODE_SCRIPT = `document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('.listing-copy'):null;if(!b)return;var p=b.closest('.listing');var pre=p&&p.querySelector('pre');var t=pre?pre.textContent||'':'';(navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(t):Promise.reject()).catch(function(){var a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()}).finally(function(){b.textContent='Copied';clearTimeout(b._t);b._t=setTimeout(function(){b.textContent='Copy'},1800)})});`

export function paths(): string[] {
  return docs.paths('/docs')
}

interface DocPageData {
  entry: ContentEntry<DocFrontmatter>
  chapter: NavItem
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
    html: numberChapter(entry.html, chapter.chapter),
    groups: getNavGroups(),
    prev: idx > 0 ? flat[idx - 1] : undefined,
    next: idx < flat.length - 1 ? flat[idx + 1] : undefined,
    ogImage,
  }
}

function Contents({ groups, chapter, sections }: { groups: NavGroup[], chapter: NavItem, sections: Array<{ id: string, text: string }> }) {
  return (
    <>
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
                {item.slug === chapter.slug && sections.length > 0 && (
                  <ol class="sections">
                    {sections.map((h, n) => (
                      <li key={h.id}>
                        <a class="ch" href={`#${h.id}`}>
                          <i>{`${item.chapter}.${n + 1}`}</i>
                          <span>{h.text}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </>
  )
}

export default function DocPage({ data }: { data: DocPageData }) {
  const { entry, chapter, html, groups, prev, next, ogImage } = data
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
        <nav class="contents" aria-label="Contents">
          <Contents groups={groups} chapter={chapter} sections={sections} />
        </nav>

        <article class="chapter">
          <header class="chapter-head">
            <span class="chapter-num" aria-hidden="true">{chapter.chapter}</span>
            <h1>{entry.data.title}</h1>
            <p class="lead">{entry.data.description}</p>
          </header>

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
