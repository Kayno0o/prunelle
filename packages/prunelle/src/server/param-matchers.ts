// Route parameter matchers (built-in `integer`, `uuid`, `slug` and app-defined `src/params/<name>.ts`) and shared route-pattern segment parsing.

export type ParamMatcher = (value: string) => boolean
export type ParamMatcherMap = Readonly<Record<string, ParamMatcher>>

const INTEGER_RE = /^\d+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const BUILTIN_PARAM_MATCHERS: ParamMatcherMap = {
  integer: value => INTEGER_RE.test(value),
  uuid: value => UUID_RE.test(value),
  slug: value => SLUG_RE.test(value),
}

export const BUILTIN_PARAM_MATCHER_NAMES = ['integer', 'uuid', 'slug'] as const

export function isBuiltinMatcher(name: string): boolean {
  return Object.hasOwn(BUILTIN_PARAM_MATCHERS, name)
}

/** Extracts a matcher function from an app param matcher module (`export function match` or `export default`). */
export function extractMatcherFn(mod: unknown): ParamMatcher | undefined {
  if (typeof mod === 'function')
    return mod as ParamMatcher
  if (mod !== null && typeof mod === 'object') {
    const rec = mod as Record<string, unknown>
    if (typeof rec.match === 'function')
      return rec.match as ParamMatcher
    if (typeof rec.default === 'function')
      return rec.default as ParamMatcher
  }
  return undefined
}

/** Merges built-in matchers with app matchers listed in the build manifest. */
export function resolveParamMatchers(
  manifestMatchers: Readonly<Record<string, string>> | undefined,
  modules: Readonly<Record<string, unknown>>,
): ParamMatcherMap {
  if (manifestMatchers === undefined)
    return BUILTIN_PARAM_MATCHERS
  const merged: Record<string, ParamMatcher> = { ...BUILTIN_PARAM_MATCHERS }
  for (const [name, modKey] of Object.entries(manifestMatchers)) {
    const fn = extractMatcherFn(modules[modKey])
    if (fn !== undefined)
      merged[name] = fn
  }
  return merged
}

export interface ParsedPatternSegment {
  kind: 'static' | 'param' | 'optional' | 'catchall'
  /** Exact literal for static, parameter name for param/optional/catchall. */
  value: string
  matcherName?: string | undefined
}

function splitNameAndMatcher(spec: string, fallbackName?: string): { name: string, matcherName?: string | undefined } {
  const eq = spec.indexOf('=')
  if (eq === -1)
    return { name: spec || fallbackName || '' }
  const name = spec.slice(0, eq) || fallbackName || ''
  const matcherName = spec.slice(eq + 1)
  return matcherName.length > 0 ? { name, matcherName } : { name }
}

/** Parses one segment of a compiled route pattern (`about`, `:id`, `:id=integer`, `:lang?`, `:page=integer?`, `*rest`, `*path=slug`). */
export function parsePatternSegment(seg: string): ParsedPatternSegment {
  if (seg.startsWith('*')) {
    const { name, matcherName } = splitNameAndMatcher(seg.slice(1), 'rest')
    return { kind: 'catchall', value: name, matcherName }
  }
  if (seg.startsWith(':')) {
    const body = seg.slice(1)
    const optional = body.endsWith('?')
    const spec = optional ? body.slice(0, -1) : body
    const { name, matcherName } = splitNameAndMatcher(spec)
    return { kind: optional ? 'optional' : 'param', value: name, matcherName }
  }
  return { kind: 'static', value: seg }
}

/** Lists every param matcher reference in a compiled route pattern (e.g. `'/users/:id=integer'` -> `[{ param: 'id', matcher: 'integer' }]`). */
export function extractPatternMatchers(routePath: string): { param: string, matcher: string }[] {
  const result: { param: string, matcher: string }[] = []
  if (!routePath.includes('='))
    return result
  for (const seg of routePath.split('/')) {
    if (seg === '')
      continue
    const parsed = parsePatternSegment(seg)
    if (parsed.matcherName !== undefined)
      result.push({ param: parsed.value, matcher: parsed.matcherName })
  }
  return result
}

/** Lists optional parameter names in a compiled route pattern (e.g. `'/:lang?/about'` -> `['lang']`). */
export function extractOptionalParams(routePath: string): string[] {
  const result: string[] = []
  if (!routePath.includes('?'))
    return result
  for (const seg of routePath.split('/')) {
    if (seg === '')
      continue
    const parsed = parsePatternSegment(seg)
    if (parsed.kind === 'optional')
      result.push(parsed.value)
  }
  return result
}
