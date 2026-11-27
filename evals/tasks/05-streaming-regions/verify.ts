import type { AssertionResult, VerifyContext } from '../../lib/types'
import { assert, AssertionCollector, extractLinks, readAppSourceFiles } from '../../lib/assertions'

export async function verify({ dir, app }: VerifyContext): Promise<AssertionResult[]> {
  const c = new AssertionCollector()

  let fullHtml = ''
  await c.run('GET / renders full HTML document with Region, data-pru-target, and streamed items', async () => {
    const res = await app.get('/')
    assert(res.status === 200, `expected 200, got ${res.status}`)
    fullHtml = await res.text()
    assert(/<!doctype html>/i.test(fullHtml), 'expected full HTML document on GET /')
    assert(/data-pru-region=["']results["']/i.test(fullHtml), 'missing data-pru-region="results"')
    assert(/data-pru-target=["']results["']/i.test(fullHtml), 'missing data-pru-target="results"')
  })

  await c.run('partial swap header x-pru-region: results returns fragment + Vary header', async () => {
    const res = await app.get('/', { 'x-pru-region': 'results' })
    assert(res.status === 200, `expected 200 for region request, got ${res.status}`)
    const vary = res.headers.get('vary') ?? ''
    assert(/x-pru-region/i.test(vary), `expected Vary header to include x-pru-region, got "${vary}"`)
    const fragment = await res.text()
    assert(!/<!doctype html>/i.test(fragment), 'partial region response must not wrap full <!DOCTYPE html> document')
    assert(fragment.trim().length > 0, 'partial region response is empty')
  })

  await c.run('query filtering works both without JS (full page) and via x-pru-region partial swap', async () => {
    // Pick a query term from a link on the page (e.g. /?q=...) or fall back to an unmatched probe
    const queryLink = extractLinks(fullHtml).find(href => /[?&]q=[^&]+/.test(href))
    const probePath = queryLink ?? '/?q=nonexistent-probe-xyz-999'

    const fullFiltered = await app.get(probePath)
    assert(fullFiltered.status === 200, `expected 200 for ${probePath}, got ${fullFiltered.status}`)
    const fullFilteredHtml = await fullFiltered.text()
    assert(/<!doctype html>/i.test(fullFilteredHtml), 'expected full HTML document for non-JS GET query')
    assert(fullFilteredHtml !== fullHtml, `filtering via ${probePath} produced identical HTML to unfiltered /`)

    const partialFiltered = await app.get(probePath, { 'x-pru-region': 'results' })
    assert(partialFiltered.status === 200, `expected 200 for partial ${probePath}, got ${partialFiltered.status}`)
    const vary = partialFiltered.headers.get('vary') ?? ''
    assert(/x-pru-region/i.test(vary), `missing Vary: x-pru-region on filtered partial response`)
    const partialHtml = await partialFiltered.text()
    assert(!/<!doctype html>/i.test(partialHtml), 'filtered partial response must not contain <!DOCTYPE html>')
  })

  await c.run('source uses <Suspense>, <Region>, and regions() from @prunellejs/spa', async () => {
    const sources = [...readAppSourceFiles(dir).values()].join('\n')
    const cfgPath = `${dir}/prunelle.config.ts`
    const cfg = await Bun.file(cfgPath).exists() ? await Bun.file(cfgPath).text() : ''
    assert(/<Suspense\b/.test(sources), 'missing <Suspense> in src/')
    assert(/<Region\b/.test(sources), 'missing <Region> in src/')
    assert(/regions\s*\(/.test(cfg), 'missing regions() plugin in prunelle.config.ts')
    assert(/@prunellejs\/spa/.test(cfg), 'missing @prunellejs/spa import in prunelle.config.ts')
  })

  return c.results
}
