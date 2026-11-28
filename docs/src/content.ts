import type { StandardSchemaV1 } from 'prunelle/server'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineCollection } from '@prunellejs/content'

export type DocSectionId = 'getting-started' | 'core' | 'plugins' | 'production'

export interface DocFrontmatter {
  title: string
  description: string
  section: DocSectionId
  order: number
}

// Each section is a part of the book, numbered in Roman numerals; its blurb is the line under it on the home page's contents.
export const SECTIONS: ReadonlyArray<{ id: DocSectionId, label: string, part: string, blurb: string }> = [
  { id: 'getting-started', label: 'Getting Started', part: 'I', blurb: 'Install, scaffold, and find your way around a project.' },
  { id: 'core', label: 'Core Concepts', part: 'II', blurb: 'Islands, signals, routes, actions, security, and consent.' },
  { id: 'plugins', label: 'Ecosystem Plugins', part: 'III', blurb: 'UI, auth, content, live, images, SEO, and MCP.' },
  { id: 'production', label: 'Production', part: 'IV', blurb: 'Deploy, benchmarks, eco-design, testing, and the plugin API.' },
]

function findRoot(): string {
  for (const candidate of [
    resolve(import.meta.dir, '..'),
    resolve(import.meta.dir, '../..'),
    resolve(import.meta.dir, '../../..'),
    process.cwd(),
  ]) {
    if (existsSync(join(candidate, 'src/content/docs')))
      return candidate
  }
  return process.cwd()
}

export const DOCS_ROOT = findRoot()

export const docSchema: StandardSchemaV1<unknown, DocFrontmatter> = {
  '~standard': {
    version: 1,
    vendor: 'prunelle-docs',
    validate(raw) {
      if (!raw || typeof raw !== 'object')
        return { issues: [{ message: 'frontmatter must be an object' }] }
      const o = raw as Record<string, unknown>
      if (typeof o.title !== 'string' || !o.title)
        return { issues: [{ message: 'title is required' }] }
      if (typeof o.description !== 'string' || !o.description)
        return { issues: [{ message: 'description is required' }] }
      const section = String(o.section ?? 'getting-started') as DocSectionId
      const order = typeof o.order === 'number' ? o.order : 99
      return { value: { title: o.title, description: o.description, section, order } }
    },
  },
}

const SECTION_RANK = new Map(SECTIONS.map((s, i) => [s.id, i]))

export function sortDocs(a: { slug: string, data: DocFrontmatter }, b: { slug: string, data: DocFrontmatter }): number {
  const sa = SECTION_RANK.get(a.data.section) ?? 99
  const sb = SECTION_RANK.get(b.data.section) ?? 99
  if (sa !== sb)
    return sa - sb
  if (a.data.order !== b.data.order)
    return a.data.order - b.data.order
  return a.slug.localeCompare(b.slug)
}

export const docs = defineCollection<DocFrontmatter>({
  dir: 'src/content/docs',
  schema: docSchema,
  headingLinks: true,
  sort: sortDocs,
  render: async () => {
    const [{ highlight }, { Callout }, { Tabs }, { Tab }] = await Promise.all([
      import('./highlight'),
      import('./components/Callout'),
      import('./components/Tabs'),
      import('./components/Tab'),
    ])
    return {
      highlight(code, language) {
        const pre = highlight(code, language)
        const lang = language && language !== 'text' ? ` · ${language.replace(/[<>&"]/g, '')}` : ''
        // The page fills in the listing number, which depends on the chapter (see `numberChapter`).
        return `<figure class="listing"><figcaption><span>Listing <span data-listing></span>${lang}</span><button type="button" class="listing-copy">Copy</button></figcaption>${pre}</figure>`
      },
      components: { Callout, Tabs, Tab },
    }
  },
})

export interface NavItem {
  slug: string
  href: string
  title: string
  section: DocSectionId
  sectionLabel: string
  /** The chapter number, counted across the whole book. */
  chapter: number
  /** The part's Roman numeral and label, as the running head shows it. */
  partLabel: string
}

export interface NavGroup {
  id: DocSectionId
  label: string
  part: string
  blurb: string
  items: NavItem[]
}

export function getNavGroups(): NavGroup[] {
  const all = docs.all()
  let chapter = 0
  return SECTIONS.map(sec => ({
    id: sec.id,
    label: sec.label,
    part: sec.part,
    blurb: sec.blurb,
    items: all
      .filter(e => e.data.section === sec.id)
      .map(e => ({
        slug: e.slug,
        href: `/docs/${e.slug}`,
        title: e.data.title,
        section: sec.id,
        sectionLabel: sec.label,
        chapter: ++chapter,
        partLabel: `${sec.part}. ${sec.label}`,
      })),
  })).filter(g => g.items.length > 0)
}

const H2_RE = /<h2 id="([^"]+)">/g
const LISTING_RE = /<span data-listing><\/span>/g
const LETTER_START_RE = /^<p>(?=\p{L})/u

// Numbers a chapter's sections (4.1) in the margin of each h2 and its listings in order (Listing 4.1), and gives the opening paragraph its drop cap when it starts with a letter.
export function numberChapter(html: string, chapter: number): string {
  let section = 0
  let listing = 0
  return html
    .replace(LETTER_START_RE, '<p class="drop">')
    .replace(H2_RE, (_, id: string) => `<h2 id="${id}"><span class="sec-num" aria-hidden="true">${chapter}.${++section}</span>`)
    .replace(LISTING_RE, () => `${chapter}.${++listing}`)
}

export function getFlatNav(): NavItem[] {
  return getNavGroups().flatMap(g => g.items)
}
