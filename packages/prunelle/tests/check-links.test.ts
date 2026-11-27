import type { ModuleAnalysis } from '../src/compiler/analyze'
import type { PrunelleConfig, PrunellePlugin } from '../src/plugins/index'
import { afterAll, describe, expect, it } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createAuth } from '../../plugin-auth/src/index'
import { content, defineCollection } from '../../plugin-content/src/index'
import { i18n } from '../../plugin-i18n/src/index'
import { seo } from '../../plugin-seo/src/index'
import { isNotSourceDir, isTsFile, walkFiles, walkRoutes } from '../src/build/files'
import { ModuleGraph } from '../src/build/graph'
import { checkAppLinks } from '../src/cli/check-links'
import { analyzeModule } from '../src/compiler/analyze'
import { definePlugin, loadConfig, resolvePlugins } from '../src/plugins/index'

const TEMP_ROOTS: string[] = []

afterAll(() => {
  for (const dir of TEMP_ROOTS)
    rmSync(dir, { recursive: true, force: true })
})

function makeTempApp(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'prunelle-check-links-'))
  TEMP_ROOTS.push(root)
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  return root
}

async function runCheckLinksOn(
  root: string,
  options: {
    config?: PrunelleConfig
    plugins?: readonly PrunellePlugin[]
    routesDir?: string
    publicDir?: string
    assetPrefix?: string
    site?: string
  } = {},
): Promise<string[]> {
  const config = options.config ?? {}
  const routesDir = resolve(root, options.routesDir ?? config.routesDir ?? 'src/routes')
  const publicDir = resolve(root, options.publicDir ?? config.publicDir ?? 'public')
  const assetPrefix = (options.assetPrefix ?? config.assetPrefix ?? '/_pru').replace(/\/$/, '')
  const site = options.site ?? config.site
  const plugins = options.plugins ?? resolvePlugins(config.plugins)

  const srcDir = resolve(root, 'src')
  const fileSet = new Set<string>()
  for (const base of [srcDir, routesDir]) {
    if (existsSync(base)) {
      for (const f of walkFiles(base, { skipDir: isNotSourceDir, keep: e => isTsFile(e.name) }))
        fileSet.add(f)
    }
  }
  const analyses = new Map<string, ModuleAnalysis>()
  const sources = new Map<string, string>()
  for (const f of [...fileSet].sort()) {
    const code = readFileSync(f, 'utf8')
    sources.set(f, code)
    analyses.set(f, analyzeModule(f, code))
  }
  const routeFiles = existsSync(routesDir) ? walkRoutes(routesDir).sort() : []
  return await checkAppLinks({
    root,
    routesDir,
    publicDir,
    assetPrefix,
    site,
    config,
    plugins,
    routeFiles,
    analyses,
    sources,
  })
}

async function runCheckLinksFromConfig(root: string): Promise<string[]> {
  const cfg = await loadConfig(root)
  const routesDir = resolve(root, cfg.routesDir ?? 'src/routes')
  const publicDir = resolve(root, cfg.publicDir ?? 'public')
  const assetPrefix = (cfg.assetPrefix ?? '/_pru').replace(/\/$/, '')
  const plugins = resolvePlugins(cfg.plugins)
  const srcDir = resolve(root, 'src')
  const fileSet = new Set<string>()
  for (const base of [srcDir, routesDir]) {
    if (existsSync(base)) {
      for (const f of walkFiles(base, { skipDir: isNotSourceDir, keep: e => isTsFile(e.name) }))
        fileSet.add(f)
    }
  }
  const graph = new ModuleGraph(root)
  const sources = new Map<string, string>()
  const load = (file: string): ModuleAnalysis | undefined => {
    const existing = graph.analyses.get(file)
    if (existing !== undefined)
      return existing
    if (!isTsFile(file))
      return undefined
    const code = readFileSync(file, 'utf8')
    sources.set(file, code)
    const analysis = analyzeModule(file, code)
    graph.analyses.set(file, analysis)
    return analysis
  }
  const pending = [...fileSet].sort()
  for (let i = 0; i < pending.length; i++) {
    if (load(pending[i]!) !== undefined)
      pending.push(...graph.localDeps(pending[i]!).filter(dep => !graph.analyses.has(dep)))
  }
  const routeFiles = existsSync(routesDir) ? walkRoutes(routesDir).sort() : []
  return await checkAppLinks({
    root,
    routesDir,
    publicDir,
    assetPrefix,
    site: cfg.site,
    config: cfg,
    plugins,
    routeFiles,
    analyses: graph.analyses,
    sources,
  })
}

describe('checkAppLinks', () => {
  it('warns on broken literal href, action, formaction, formAction, and ctx.redirect with line:col and closest suggestion', async () => {
    const root = makeTempApp({
      'src/routes/index.tsx': [
        'export default function Home() {',
        '  return (',
        '    <main>',
        '      <a href="/about">Valid</a>',
        '      <a href="/abot">Broken href</a>',
        '      <form action="/submt" method="post">',
        '        <button formaction="/contct">Broken formaction</button>',
        '        <button formAction="/abou">Broken formAction</button>',
        '      </form>',
        '    </main>',
        '  )',
        '}',
      ].join('\n'),
      'src/routes/about.tsx': 'export default function About() { return <p>About</p> }\n',
      'src/routes/contact.tsx': 'export default function Contact() { return <p>Contact</p> }\n',
      'src/routes/submit.ts': [
        'export function POST(ctx: { redirect: (to: string) => Response }) {',
        '  if (Math.random() > 0.5) return ctx.redirect("/about")',
        '  return ctx.redirect("/abot")',
        '}',
      ].join('\n'),
    })

    const warnings = await runCheckLinksOn(root)
    expect(warnings).toHaveLength(5)
    expect(warnings[0]).toContain('src/routes/index.tsx:5:')
    expect(warnings[0]).toContain('[link/broken]')
    expect(warnings[0]).toContain('"/abot"')
    expect(warnings[0]).toContain('did you mean "/about"?')

    expect(warnings[1]).toContain('src/routes/index.tsx:6:')
    expect(warnings[1]).toContain('"/submt"')
    expect(warnings[1]).toContain('did you mean "/submit"?')

    expect(warnings[2]).toContain('src/routes/index.tsx:7:')
    expect(warnings[2]).toContain('"/contct"')
    expect(warnings[2]).toContain('did you mean "/contact"?')

    expect(warnings[3]).toContain('src/routes/index.tsx:8:')
    expect(warnings[3]).toContain('"/abou"')
    expect(warnings[3]).toContain('did you mean "/about"?')

    expect(warnings[4]).toContain('src/routes/submit.ts:3:')
    expect(warnings[4]).toContain('"/abot"')
    expect(warnings[4]).toContain('did you mean "/about"?')
  })

  it('strips #hash and ?query and skips external, scheme, hash, query, and relative links', async () => {
    const root = makeTempApp({
      'src/routes/index.tsx': `
export default function Home() {
  return (
    <div>
      <a href="/about#team">Hash</a>
      <a href="/about?ref=home">Query</a>
      <a href="/about/?a=1#top">Slash+Query+Hash</a>
      <a href="https://example.com/nope">HTTPS</a>
      <a href="http://example.com/nope">HTTP</a>
      <a href="//cdn.example.com/script.js">Protocol-relative</a>
      <a href="mailto:hi@example.com">Mail</a>
      <a href="tel:+33123456789">Tel</a>
      <a href="sms:+33123456789">SMS</a>
      <a href="javascript:void(0)">JS</a>
      <a href="data:text/plain,hello">Data</a>
      <a href="blob:https://example.com/123">Blob</a>
      <a href="#section">Pure hash</a>
      <a href="?page=2">Pure query</a>
      <a href="relative/path">Relative</a>
      <a href="./local">Dot relative</a>
      <a href="../parent">Parent relative</a>
      <a href="">Empty</a>
    </div>
  )
}
`,
      'src/routes/about.tsx': 'export default function About() { return <p>About</p> }\n',
    })

    const warnings = await runCheckLinksOn(root)
    expect(warnings).toEqual([])
  })

  it('matches dynamic routes with built-in, custom, optional, and catch-all matchers', async () => {
    const root = makeTempApp({
      'src/params/hex.ts': 'export function match(value: string) { return /^[0-9a-f]+$/i.test(value) }\n',
      'src/routes/posts/[slug].tsx': 'export default function Post() { return <p>Post</p> }\n',
      'src/routes/users/[id=integer].tsx': 'export default function User() { return <p>User</p> }\n',
      'src/routes/colors/[code=hex].tsx': 'export default function Color() { return <p>Color</p> }\n',
      'src/routes/[[lang]]/about.tsx': 'export default function About() { return <p>About</p> }\n',
      'src/routes/docs/[...slug].tsx': 'export default function Docs() { return <p>Docs</p> }\n',
      'src/routes/index.tsx': `
export default function Home() {
  return (
    <div>
      <a href="/posts/anything">Ok slug</a>
      <a href="/users/42">Ok integer</a>
      <a href="/users/abc">Bad integer</a>
      <a href="/colors/ff00aa">Ok custom hex</a>
      <a href="/colors/zzzz">Bad custom hex</a>
      <a href="/about">Ok optional omitted</a>
      <a href="/fr/about">Ok optional present</a>
      <a href="/fr/en/about">Bad extra segment</a>
      <a href="/docs/a/b/c">Ok catch-all</a>
    </div>
  )
}
`,
    })

    const warnings = await runCheckLinksOn(root)
    expect(warnings).toHaveLength(3)
    expect(warnings.some(w => w.includes('"/users/abc"'))).toBe(true)
    expect(warnings.some(w => w.includes('"/colors/zzzz"'))).toBe(true)
    expect(warnings.some(w => w.includes('"/fr/en/about"'))).toBe(true)
  })

  it('checks literal links against dynamic routes exporting static or runtime paths()', async () => {
    const root = makeTempApp({
      'src/routes/posts/[slug].tsx': `
export const prerender = true
export function paths() {
  return ['/posts/hello-world', '/posts/second-post']
}
export default function Post() { return <p>Post</p> }
`,
      'src/routes/posts/new.tsx': 'export default function NewPost() { return <p>New</p> }\n',
      'src/routes/guides/[slug].ts': `
const SLUGS = ['intro', 'deploy']
export function paths() {
  return SLUGS.map(s => '/guides/' + s)
}
export function GET() { return new Response('ok') }
`,
      'src/routes/broken-paths/[slug].ts': `
export function paths(): string[] {
  throw new Error('runtime DB unavailable during check')
}
export function GET() { return new Response('ok') }
`,
      'src/routes/index.tsx': `
export default function Home() {
  return (
    <div>
      <a href="/posts/hello-world">Ok static paths</a>
      <a href="/posts/new">Ok static route beats dynamic</a>
      <a href="/posts/helo-world">Missing from static paths</a>
      <a href="/guides/intro">Ok runtime paths</a>
      <a href="/guides/intr">Missing from runtime paths</a>
      <a href="/broken-paths/anything">Throwing paths() falls back to pattern</a>
    </div>
  )
}
`,
    })

    const warnings = await runCheckLinksOn(root)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('"/posts/helo-world"')
    expect(warnings[0]).toContain('did you mean "/posts/hello-world"?')
    expect(warnings[1]).toContain('"/guides/intr"')
    expect(warnings[1]).toContain('did you mean "/guides/intro"?')
  })

  it('checks template literals by static prefix and exact pathname before ?/#', async () => {
    const root = makeTempApp({
      'src/routes/posts/[slug].tsx': 'export default function Post() { return <p>Post</p> }\n',
      'src/routes/blog/[cat]/[id].tsx': 'export default function Blog() { return <p>Blog</p> }\n',
      'src/routes/users/[id=integer]/[tab].tsx': 'export default function UserTab() { return <p>User</p> }\n',
      'src/routes/about.tsx': 'export default function About() { return <p>About</p> }\n',
      'src/routes/index.tsx': `
export default function Home({ slug, cat, id, tab, ok }: Record<string, string>) {
  return (
    <div>
      <a href={\`/posts/\${slug}\`}>Ok posts prefix</a>
      <a href={\`/blog/\${cat}/\${id}\`}>Ok blog prefix</a>
      <a href={\`/blgo/\${slug}\`}>Typo prefix</a>
      <a href={\`/about?tab=\${tab}\`}>Exact before query</a>
      <a href={\`/abot#\${tab}\`}>Broken exact before hash</a>
      <a href={\`/users/42/\${tab}\`}>Valid matcher in prefix</a>
      <a href={\`/users/abc/\${tab}\`}>Invalid matcher in prefix</a>
      <a href={\`/\${slug}\`}>Bare root prefix skipped</a>
      <a href={ok ? '/about' : '/abot'}>Ternary</a>
      <a href={'/blgo/' + slug}>Concat prefix</a>
    </div>
  )
}
`,
    })

    const warnings = await runCheckLinksOn(root)
    expect(warnings).toHaveLength(5)
    expect(warnings[0]).toContain('"/blgo/..."')
    expect(warnings[0]).toContain('did you mean "/blog"?')
    expect(warnings[1]).toContain('"/abot"')
    expect(warnings[1]).toContain('did you mean "/about"?')
    expect(warnings[2]).toContain('"/users/abc/..."')
    expect(warnings[3]).toContain('"/abot"')
    expect(warnings[4]).toContain('"/blgo/..."')
    expect(warnings[4]).toContain('did you mean "/blog"?')
  })

  it('respects // prunelle-ignore, {/* prunelle-ignore */}, and prunelle-ignore-file directives', async () => {
    const root = makeTempApp({
      'src/routes/index.tsx': `
export default function Home() {
  return (
    <div>
      {/* prunelle-ignore */}
      <a href="/proxy-1">Bare JSX ignore</a>
      {/* prunelle-ignore broken-link */}
      <a
        class="btn"
        href="/proxy-2"
      >Multi-line JSX ignore</a>
      <a href="/proxy-3">Same line</a> {/* prunelle-ignore link */}
      {/* prunelle-ignore rgaa/img-alt */}
      <a href="/still-broken">Unrelated rule does not silence</a>
    </div>
  )
}
`,
      'src/routes/ignored-file.tsx': `// prunelle-ignore-file broken-link
export default function Ignored() {
  return <a href="/totally-missing">Silenced</a>
}
`,
      'src/routes/redirect.ts': `
export function GET(ctx: { redirect: (u: string) => Response }) {
  // prunelle-ignore
  if (Math.random() > 0.5) return ctx.redirect('/external-proxy')
  return ctx.redirect('/another-proxy') // prunelle-ignore broken-link
}
`,
    })

    const warnings = await runCheckLinksOn(root)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"/still-broken"')
  })

  it('handles custom assetPrefix, consent endpoint, public/ files, i18n locales, and plugin routes/emitted files', async () => {
    let shutdownCalled = false
    const customPlugin = definePlugin({
      name: 'test-plugin',
      server(api) {
        api.route('GET', '/custom/ping', () => new Response('pong'))
        api.onShutdown(() => { shutdownCalled = true })
      },
      build(ctx) {
        ctx.emitPublic('llms.txt', '# docs')
      },
    })
    const auth = createAuth({ basePath: '/auth' })

    const root = makeTempApp({
      'public/robots.txt': 'User-agent: *\n',
      'public/logo.png': 'png',
      'public/about.html': '<h1>About</h1>',
      'public/guide/index.html': '<h1>Guide</h1>',
      'public/favicon.svg': '<svg></svg>',
      'src/routes/index.tsx': `
export default function Home({ slug }: { slug: string }) {
  return (
    <div>
      <a href="/robots.txt">Public exact</a>
      <a href="/logo.png">Public png</a>
      <a href="/about.html">Public html</a>
      <a href="/about">Public without .html</a>
      <a href="/guide">Public dir index.html</a>
      <a href="/_assets/action/abc123">Custom assetPrefix action</a>
      <a href="/_assets/health">Custom assetPrefix health</a>
      <a href="/_pru/action/abc123">Wrong assetPrefix</a>
      <form action="/consent-save" method="post" />
      <a href="/fr/pricing">i18n prefixed route</a>
      <a href="/fr">i18n locale home</a>
      <a href="/fr/about">i18n prefixed public</a>
      <a href={\`/fr/posts/\${slug}\`}>i18n prefixed template</a>
      <a href="/fr/pricng">i18n broken route</a>
      <a href="/sitemap.xml">SEO sitemap</a>
      <a href="/manifest.webmanifest">SEO manifest</a>
      <a href="/favicon.svg">SEO favicon</a>
      <a href="/old-pricing">SEO redirect</a>
      <a href="/fr/ancien">SEO localized redirect</a>
      <form action="/auth/signin" method="post" />
      <a href="/custom/ping">Plugin server route</a>
      <a href="/llms.txt">Plugin emitted public</a>
    </div>
  )
}
`,
      'src/routes/pricing.tsx': 'export default function Pricing() { return <p>Pricing</p> }\n',
      'src/routes/posts/[slug].tsx': 'export default function Post() { return <p>Post</p> }\n',
    })

    const warnings = await runCheckLinksOn(root, {
      assetPrefix: '/_assets',
      site: 'https://example.com',
      config: {
        assetPrefix: '/_assets',
        site: 'https://example.com',
        consent: { categories: ['analytics'], endpoint: '/consent-save' },
      },
      plugins: [
        i18n({ locales: ['en', 'fr'], defaultLocale: 'en' }),
        seo({
          site: 'https://example.com',
          favicon: 'public/favicon.svg',
          manifest: { name: 'App' },
          redirects: { '/old-pricing': '/pricing', '/fr/ancien': '/pricing' },
        }),
        auth,
        customPlugin,
      ],
    })

    expect(shutdownCalled).toBe(true)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('"/_pru/action/abc123"')
    expect(warnings[1]).toContain('"/fr/pricng"')
    expect(warnings[1]).toContain('did you mean "/pricing"?')
  })

  it('checks Markdown links and HTML <a> in content collections while ignoring code fences, inline code, frontmatter, and ignore comments', async () => {
    const root = makeTempApp({
      'src/posts.ts': `
import { defineCollection } from '@prunellejs/content'
export const posts = defineCollection({ dir: 'content/posts' })
`,
      'src/routes/index.tsx': 'export default function Home() { return <a href="/rss.xml">RSS</a> }\n',
      'src/routes/about.tsx': 'export default function About() { return <p>About</p> }\n',
      'content/posts/hello.md': [
        '---',
        'title: Hello',
        'notes: "[ignored frontmatter](/does-not-exist)"',
        '---',
        '',
        'Valid [About](/about#team) and [`/about`](/about) and <a href="/about">HTML ok</a>.',
        'External [Site](https://example.com/x) and image ![Pic](/missing-img.png).',
        '',
        'Inline code `[fake](/nope)` and `<a href="/nope">x</a>` and ``[`x`](/nope)``.',
        '',
        '```md',
        '[In fenced backticks](/nope-fence)',
        '<a href="/nope-fence-html">x</a>',
        '```',
        '',
        '~~~html',
        '<a href="/nope-tilde">x</a>',
        '~~~',
        '',
        '<!-- [In HTML comment](/nope-comment) -->',
        '<!-- prunelle-ignore -->',
        'Silenced [Proxy](/ignored-next-line).',
        'Silenced same line [Proxy](/ignored-same-line). <!-- prunelle-ignore broken-link -->',
        '',
        'Broken [About typo](/abot) and <a href="/rss.xm">RSS typo</a>.',
      ].join('\n'),
    })

    const posts = defineCollection({ dir: join(root, 'content/posts') })
    const warnings = await runCheckLinksOn(root, {
      plugins: [content({ feeds: [{ path: '/rss.xml', title: 'Blog', description: 'Feed', site: 'https://example.com', collection: posts }] })],
    })

    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('content/posts/hello.md:25:')
    expect(warnings[0]).toContain('"/abot"')
    expect(warnings[0]).toContain('did you mean "/about"?')
    expect(warnings[1]).toContain('content/posts/hello.md:25:')
    expect(warnings[1]).toContain('"/rss.xm"')
    expect(warnings[1]).toContain('did you mean "/rss.xml"?')
  })

  it('produces zero false positives on all 4 prunelle new templates', async () => {
    const prunellePkgDir = resolve(import.meta.dir, '..')
    const pkgRoot = resolve(prunellePkgDir, '..')
    const templatesDir = join(prunellePkgDir, 'templates')
    const sharedDir = join(templatesDir, '_shared')
    const pkgLinks: Record<string, string> = { auth: 'plugin-auth', content: 'plugin-content', seo: 'plugin-seo', ui: 'ui' }
    for (const name of ['minimal', 'app', 'blog', 'fullstack'] as const) {
      const dir = mkdtempSync(join(tmpdir(), `prunelle-tpl-links-${name}-`))
      TEMP_ROOTS.push(dir)
      cpSync(sharedDir, dir, { recursive: true })
      cpSync(join(templatesDir, name), dir, { recursive: true })
      mkdirSync(join(dir, 'node_modules/@prunellejs'), { recursive: true })
      symlinkSync(prunellePkgDir, join(dir, 'node_modules/prunelle'), 'dir')
      for (const [pkgName, folder] of Object.entries(pkgLinks))
        symlinkSync(join(pkgRoot, folder), join(dir, 'node_modules/@prunellejs', pkgName), 'dir')
      const warnings = await runCheckLinksFromConfig(dir)
      expect(warnings, `template "${name}" should have 0 broken link warnings`).toEqual([])
    }
  })

  it('produces zero false positives on docs/ routes and valid docs Markdown links', async () => {
    const docsRoot = resolve(import.meta.dir, '../../../docs')
    const warnings = await runCheckLinksFromConfig(docsRoot)
    // All TSX routes (including /llms.txt emitted by docsAssets and /docs redirect from seo) must have 0 warnings.
    expect(warnings.filter(w => w.endsWith('.tsx') || w.includes('src/routes/'))).toEqual([])
    // Only genuine broken Markdown links (not false positives) should ever appear.
    for (const w of warnings)
      expect(w).toContain('configuration-and-security.md:42:')
  })
})
