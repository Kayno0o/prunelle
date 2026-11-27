// File-based route matcher: static > matched param > param > optional > catch-all priority sorting + param extraction.

import type { ParamMatcher, ParamMatcherMap } from './param-matchers'
import type { RequestPath } from './request-path'
import { BUILTIN_PARAM_MATCHERS, parsePatternSegment } from './param-matchers'
import { decodeRequestPath } from './request-path'

const enum SegmentKind {
  Static = 0,
  Param = 1,
  OptionalParam = 2,
  CatchAll = 3,
}

interface CompiledSegment {
  kind: SegmentKind
  /** Exact literal for Static, parameter name for Param/OptionalParam/CatchAll. */
  value: string
  matcherName?: string | undefined
  matcher?: ParamMatcher | undefined
}

interface RoutePattern<T> {
  path: string
  segments: CompiledSegment[]
  isStatic: boolean
  hasCatchAll: boolean
  /** Number of optional segments omitted to produce this concrete match variant. */
  omittedOptionals: number
  /** The catch-all takes a segment holding an encoded separator, left encoded. */
  encodedSlashes: boolean
  data: T
}

export interface RouteOptions {
  encodedSlashes?: boolean | undefined
}

export interface RouteMatch<T> {
  data: T
  params: Record<string, string>
}

const MAX_OPTIONAL_SEGMENTS = 6

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

/**
 * Segment specificity rank:
 * Static (9) > SpecificMatchedParam (8) > SlugMatchedParam (7) > Param (6) > OptionalSpecificMatched (5) > OptionalSlugMatched (4) > OptionalParam (3) > End (2) > MatchedCatchAll (1) > CatchAll (0).
 * Lexicographic comparison guarantees exact static > matched param > param > optional > catch-all for any shared prefix
 * (e.g. `/docs/:slug` beats `/docs/:section/*rest`, `/docs/:a/:b` beats `/docs/*rest`, and `integer`/`uuid` beat `slug`).
 */
function segmentRank(seg: CompiledSegment | undefined): number {
  if (seg === undefined)
    return 2
  if (seg.kind === SegmentKind.Static)
    return 9
  if (seg.kind === SegmentKind.Param)
    return seg.matcherName === undefined ? 6 : (seg.matcherName === 'slug' ? 7 : 8)
  if (seg.kind === SegmentKind.OptionalParam)
    return seg.matcherName === undefined ? 3 : (seg.matcherName === 'slug' ? 4 : 5)
  return seg.matcherName !== undefined ? 1 : 0
}

function compareRoutes<T>(a: RoutePattern<T>, b: RoutePattern<T>): number {
  const len = Math.max(a.segments.length, b.segments.length)
  for (let i = 0; i < len; i++) {
    const diff = segmentRank(b.segments[i]) - segmentRank(a.segments[i])
    if (diff !== 0)
      return diff
  }
  return a.omittedOptionals - b.omittedOptionals
}

function toCompiledSegment(seg: string, matchers: ParamMatcherMap): CompiledSegment {
  const parsed = parsePatternSegment(seg)
  const matcher = parsed.matcherName !== undefined ? matchers[parsed.matcherName] : undefined
  if (parsed.kind === 'catchall')
    return { kind: SegmentKind.CatchAll, value: parsed.value, matcherName: parsed.matcherName, matcher }
  if (parsed.kind === 'optional')
    return { kind: SegmentKind.OptionalParam, value: parsed.value, matcherName: parsed.matcherName, matcher }
  if (parsed.kind === 'param')
    return { kind: SegmentKind.Param, value: parsed.value, matcherName: parsed.matcherName, matcher }
  return { kind: SegmentKind.Static, value: parsed.value }
}

/** Expands optional segments into concrete flat variants (include-first, omit-second) so matching runs with zero recursion. */
function expandOptionalVariants(base: CompiledSegment[]): { segments: CompiledSegment[], omitted: number }[] {
  const optIndexes: number[] = []
  for (let i = 0; i < base.length; i++) {
    if (base[i]!.kind === SegmentKind.OptionalParam)
      optIndexes.push(i)
  }
  if (optIndexes.length === 0)
    return [{ segments: base, omitted: 0 }]
  if (optIndexes.length > MAX_OPTIONAL_SEGMENTS)
    throw new Error(`prunelle: route pattern has ${optIndexes.length} optional segments (maximum supported is ${MAX_OPTIONAL_SEGMENTS}).`)

  const variants: { segments: CompiledSegment[], omitted: number }[] = []
  const build = (optPos: number, omittedSet: Set<number>): void => {
    if (optPos === optIndexes.length) {
      const segments = omittedSet.size === 0 ? base : base.filter((_, idx) => !omittedSet.has(idx))
      variants.push({ segments, omitted: omittedSet.size })
      return
    }
    build(optPos + 1, omittedSet)
    omittedSet.add(optIndexes[optPos]!)
    build(optPos + 1, omittedSet)
    omittedSet.delete(optIndexes[optPos]!)
  }
  build(0, new Set())
  return variants
}

function compileRoutePatterns<T>(path: string, data: T, matchers: ParamMatcherMap, options?: RouteOptions): RoutePattern<T>[] {
  const norm = normalizePath(path)
  const clean = norm === '/' ? '' : norm.replace(/^\/|\/$/g, '')
  const rawSegments = clean === '' ? [] : clean.split('/')
  const baseSegments: CompiledSegment[] = []
  let isStatic = true
  let hasCatchAll = false

  for (let i = 0; i < rawSegments.length; i++) {
    const compiled = toCompiledSegment(rawSegments[i]!, matchers)
    if (compiled.kind !== SegmentKind.Static)
      isStatic = false
    if (compiled.kind === SegmentKind.CatchAll)
      hasCatchAll = true
    baseSegments.push(compiled)
  }

  const encodedSlashes = options?.encodedSlashes === true
  if (isStatic)
    return [{ path: norm, segments: baseSegments, isStatic: true, hasCatchAll: false, omittedOptionals: 0, encodedSlashes, data }]

  return expandOptionalVariants(baseSegments).map(({ segments, omitted }) => ({
    path: norm,
    segments,
    isStatic: false,
    hasCatchAll,
    omittedOptionals: omitted,
    encodedSlashes,
    data,
  }))
}

function segmentMatchesParam(seg: CompiledSegment, value: string): boolean {
  if (seg.matcherName !== undefined)
    return seg.matcher !== undefined && seg.matcher(value)
  return true
}

export class Router<T> {
  readonly #staticRoutes = new Map<string, T>()
  readonly #dynamicRoutes: RoutePattern<T>[] = []
  readonly #matchers: ParamMatcherMap
  #sorted = true

  constructor(matchers: ParamMatcherMap = BUILTIN_PARAM_MATCHERS) {
    this.#matchers = matchers
  }

  /** Adds the route at `path`, or replaces the one already there. */
  add(path: string, data: T, options?: RouteOptions): void {
    const compiled = compileRoutePatterns(path, data, this.#matchers, options)
    const first = compiled[0]!
    if (first.isStatic) {
      this.#staticRoutes.set(first.path, data)
      return
    }
    for (let i = this.#dynamicRoutes.length - 1; i >= 0; i--) {
      if (this.#dynamicRoutes[i]!.path === first.path)
        this.#dynamicRoutes.splice(i, 1)
    }
    for (const pattern of compiled)
      this.#dynamicRoutes.push(pattern)
    this.#sorted = false
  }

  /** Matches a decoded request path; a string is a URL pathname, decoded first. */
  match(input: string | RequestPath): RouteMatch<T> | undefined {
    const path = typeof input === 'string' ? decodeRequestPath(input) : input
    if (path === undefined)
      return undefined

    if (path.staticPath !== undefined) {
      const exact = this.#staticRoutes.get(normalizePath(path.staticPath))
      if (exact !== undefined)
        return { data: exact, params: {} }
    }

    const dynLen = this.#dynamicRoutes.length
    if (dynLen === 0)
      return undefined

    if (!this.#sorted) {
      this.#dynamicRoutes.sort(compareRoutes)
      this.#sorted = true
    }

    const parts = path.segments
    // A param never receives a separator, a NUL or a dot segment, encoded or not: joined into a path, it would walk out of the folder it names.
    const dotSegment = (k: number): boolean => parts[k] === '.' || parts[k] === '..'
    const refused = (k: number): boolean => path.encoded?.has(k) === true || dotSegment(k)

    for (let i = 0; i < dynLen; i++) {
      const route = this.#dynamicRoutes[i]!
      const segs = route.segments

      if (!route.hasCatchAll && parts.length !== segs.length)
        continue
      if (route.hasCatchAll && parts.length < segs.length - 1)
        continue

      let matched = true
      for (let j = 0; j < segs.length; j++) {
        const seg = segs[j]!
        if (seg.kind === SegmentKind.CatchAll) {
          for (let k = j; k < parts.length; k++) {
            if ((route.encodedSlashes ? dotSegment(k) : refused(k)) || !segmentMatchesParam(seg, parts[k]!)) {
              matched = false
              break
            }
          }
          break
        }
        if (seg.kind === SegmentKind.Static) {
          if (seg.value !== parts[j] || path.encoded?.has(j) === true) {
            matched = false
            break
          }
        }
        else if (refused(j) || !segmentMatchesParam(seg, parts[j]!)) {
          matched = false
          break
        }
      }

      if (!matched)
        continue

      // Allocate params only for the winning route.
      const params: Record<string, string> = {}
      for (let j = 0; j < segs.length; j++) {
        const seg = segs[j]!
        if (seg.kind === SegmentKind.CatchAll) {
          params[seg.value] = parts.slice(j).join('/')
          break
        }
        if (seg.kind === SegmentKind.Param || seg.kind === SegmentKind.OptionalParam)
          params[seg.value] = parts[j]!
      }
      return { data: route.data, params }
    }

    return undefined
  }
}
