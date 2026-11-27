// Prunelle SSR compiler: compiles TSX directly to flat string concatenation, inline for-loops,
// static attribute literal folding, compile-time static island props, and shared balanced hydration markers.

import type {
  JSXChild,
  JSXElement,
  JSXFragment,
  Node,
} from 'oxc-parser'
import type { ModuleAnalysis } from './analyze'
import type { SelectValueBinding } from './ssr-helpers'
import type { PrunelleTagEmitter } from './ssr-prunelle-tags'
import { analyzeModule, parseTsx } from './analyze'
import { walk } from './ast'
import { mistake } from './mistakes'
import { alignLines, lineMarker, SourceEditor } from './patch'
import {
  containsJsx,
  createExprContext,
  decodeHtmlEntities,
  escapeRawText,
  escapeStaticText,
  filterMeaningfulChildren,
  isComponentTag,
  isJsxNode,
  jsxTagName,
  planChildSlots,
  RAW_TEXT_ELEMENTS,
  resolvePrunelleTag,
  unwrapParens,
  VOID_ELEMENTS,
} from './shared'
import {
  emitSsrElementAttrs,
  precomputeSsrSubtreeFlags,
  serializeComponentProps,
  staticLiteralOrTemplate,
  StringParts,
} from './ssr-helpers'
import { emitIsland } from './ssr-island'
import { emitCatch, emitSuspense } from './ssr-prunelle-tags'

const FORM_CONTROL_TAGS = new Set(['input', 'select', 'textarea'])
const FORM_ATTR_BITS: Record<string, number> = {
  type: 1,
  required: 2,
  minlength: 4,
  maxlength: 8,
  min: 16,
  max: 32,
  step: 64,
  pattern: 128,
}

function findDynamicFormAction(node: JSXElement): Node | undefined {
  for (const attr of node.openingElement.attributes) {
    if (attr.type !== 'JSXAttribute' || jsxTagName(attr.name) !== 'action')
      continue
    if (attr.value?.type !== 'JSXExpressionContainer' || attr.value.expression.type === 'JSXEmptyExpression')
      return undefined
    const expr = attr.value.expression
    if (staticLiteralOrTemplate(expr).ok)
      return undefined
    if (expr.type === 'ConditionalExpression' && staticLiteralOrTemplate(expr.consequent).ok && staticLiteralOrTemplate(expr.alternate).ok)
      return undefined
    return expr
  }
  return undefined
}

function emitFormControlAttrs(
  node: JSXElement,
  tag: 'input' | 'select' | 'textarea',
  parts: StringParts,
  use: (name: string) => string,
  compileSubExpression: (node: Node) => string,
): void {
  const attrs = node.openingElement.attributes
  if (attrs.some(a => a.type === 'JSXSpreadAttribute'))
    return
  let nameExpr: string | undefined
  let typeExpr: string | undefined
  let present = 0
  for (const attr of attrs) {
    if (attr.type !== 'JSXAttribute')
      continue
    const attrName = jsxTagName(attr.name).toLowerCase()
    const bit = FORM_ATTR_BITS[attrName]
    if (bit !== undefined)
      present |= bit
    if (attrName === 'name') {
      if (attr.value?.type === 'Literal' && typeof attr.value.value === 'string') {
        nameExpr = JSON.stringify(attr.value.value)
      }
      else if (attr.value?.type === 'JSXExpressionContainer' && attr.value.expression.type !== 'JSXEmptyExpression') {
        const lit = staticLiteralOrTemplate(attr.value.expression)
        nameExpr = lit.ok && typeof lit.value === 'string' ? JSON.stringify(lit.value) : compileSubExpression(attr.value.expression)
      }
    }
    else if (tag === 'input' && attrName === 'type') {
      if (attr.value?.type === 'Literal' && typeof attr.value.value === 'string') {
        typeExpr = JSON.stringify(attr.value.value.toLowerCase())
      }
      else if (attr.value?.type === 'JSXExpressionContainer' && attr.value.expression.type !== 'JSXEmptyExpression') {
        const lit = staticLiteralOrTemplate(attr.value.expression)
        if (lit.ok && typeof lit.value === 'string')
          typeExpr = JSON.stringify(lit.value.toLowerCase())
      }
    }
  }
  if (nameExpr === undefined)
    return
  const typeArg = typeExpr !== undefined ? `, ${typeExpr}` : ''
  parts.pushExpr(`${use('ssrFormAttrs')}(${JSON.stringify(tag)}, ${nameExpr}, ${present}${typeArg})`)
}

export interface IslandBinding {
  id: string
  chunk: string
  defaultHydrate?: string | undefined
}

export interface CompileSsrOptions {
  islands?: ReadonlyMap<string, IslandBinding> | undefined
  isIsland?: boolean | undefined
  /** Hydration markers everywhere, nowhere, or only inside these source spans. */
  emitMarkers?: boolean | readonly (readonly [number, number])[] | undefined
  analysis?: ModuleAnalysis | undefined
}

export interface CompileResult {
  code: string
  analysis: ModuleAnalysis
}

function emitActionFormExpr(
  formAction: Node,
  isAsyncForm: boolean,
  nextId: () => number,
  use: (name: string) => string,
  compileSubExpression: (node: Node) => string,
  emitBody: (bufVar: string, parts: StringParts, flush: () => void, pushStmt: (stmt: string) => void, override: { node: Node, ident: string }) => void,
): string {
  const faVar = `_fa${nextId()}`
  const innerBuf = `_o${nextId()}`
  const innerStmts: string[] = []
  const innerParts = new StringParts()
  const flushInner = () => {
    if (!innerParts.isEmpty()) {
      innerStmts.push(`${innerBuf} += ${innerParts.toExpr()};`)
      innerParts.clear()
    }
  }
  emitBody(innerBuf, innerParts, flushInner, s => innerStmts.push(s), { node: formAction, ident: faVar })
  if (innerStmts.length > 0)
    flushInner()
  const body = innerStmts.length === 0 ? innerParts.toExpr() : `{ let ${innerBuf} = ""; ${innerStmts.join(' ')} return ${innerBuf}; }`
  return isAsyncForm
    ? `await ${use('ssrFormAsync')}(${compileSubExpression(formAction)}, async (${faVar}) => ${body})`
    : `${use('ssrForm')}(${compileSubExpression(formAction)}, (${faVar}) => ${body})`
}

function markerTest(markers: NonNullable<CompileSsrOptions['emitMarkers']>): (offset: number) => boolean {
  return typeof markers === 'boolean' ? () => markers : offset => markers.some(([start, end]) => offset >= start && offset < end)
}

export function compileSsr(filename: string, code: string, options: CompileSsrOptions = {}): CompileResult {
  const program = options.analysis?.program ?? parseTsx(filename, code)
  const analysis = options.analysis ?? analyzeModule(filename, code, program)

  if (!analysis.hasJsx)
    return { code, analysis }

  const editor = new SourceEditor(code)
  // Generated code keeps each expression on its source line: Bun maps a stack trace by the code this compiler hands it, not by a source map of its own.
  const mark = lineMarker(code)
  const used = new Set<string>()
  let loopCounter = 0
  let activeSelectValue: SelectValueBinding | undefined

  const use = (name: string): string => {
    used.add(name)
    return `__${name}`
  }

  const islands = options.islands
  const markersAt = markerTest(options.emitMarkers ?? options.isIsland ?? analysis.isInteractive)
  const jsxNodes = analysis.jsxNodes
  const exprContext = createExprContext(program, jsxNodes)
  const { directAwaitNodes, dynamicChildNodes } = precomputeSsrSubtreeFlags(program)
  const prunelleTags: PrunelleTagEmitter = { use, compileSubExpression, compileChildren: compileChildrenListToStringExpr, compileJsx: compileJsxToStringExpr, markersAt, directAwaitNodes }

  function compileSubExpression(node: Node): string {
    if (!containsJsx(node, jsxNodes))
      return mark(node.start) + code.slice(node.start, node.end)

    const sub = new SourceEditor(code.slice(node.start, node.end))
    const offset = node.start
    walk(node, (child) => {
      if (isJsxNode(child)) {
        sub.replace(child.start - offset, child.end - offset, compileRootJsx(child) + mark(child.end))
        return false
      }
      return undefined
    })
    return mark(node.start) + sub.toString()
  }

  function compileChildrenListToStringExpr(children: readonly JSXChild[], slotMarkers = markersAt(children[0]?.start ?? 0), inFragment = false, rawTextTag?: 'style' | 'script'): string {
    const bufVar = `_o${loopCounter++}`
    const stmts: string[] = []
    const parts = new StringParts()
    const flush = () => {
      if (!parts.isEmpty()) {
        stmts.push(`${bufVar} += ${parts.toExpr()};`)
        parts.clear()
      }
    }
    emitChildrenIntoBuffer(children, bufVar, parts, flush, s => stmts.push(s), rawTextTag, slotMarkers, inFragment)
    if (stmts.length === 0)
      return parts.toExpr()
    flush()
    const hasAwait = children.some(c => directAwaitNodes.has(c))
    if (hasAwait)
      return `(await (async () => { let ${bufVar} = ""; ${stmts.join(' ')} return ${bufVar}; })())`
    return `(() => { let ${bufVar} = ""; ${stmts.join(' ')} return ${bufVar}; })()`
  }

  // Emits JSX directly into a string accumulator variable `_out` (zero closures on nested `.map()` loops!)
  function emitIntoBuffer(node: JSXElement | JSXFragment, bufVar: string, parts: StringParts, flushParts: () => void, pushStmt: (stmt: string) => void, actionOverride?: { node: Node, ident: string }): void {
    if (node.type === 'JSXFragment') {
      emitChildrenIntoBuffer(node.children, bufVar, parts, flushParts, pushStmt, undefined, markersAt(node.start), true)
      return
    }

    const tag = jsxTagName(node.openingElement.name)
    if (isComponentTag(tag)) {
      emitComponent(node, tag, parts)
      return
    }

    if (tag === 'form' && actionOverride === undefined) {
      const formAction = findDynamicFormAction(node)
      if (formAction !== undefined) {
        parts.pushExpr(emitActionFormExpr(formAction, directAwaitNodes.has(node), () => loopCounter++, use, compileSubExpression, (b, p, f, ps, ov) => emitIntoBuffer(node, b, p, f, ps, ov)))
        return
      }
    }

    parts.pushStatic(`<${tag}`)
    const isTextarea = tag === 'textarea'
    const isSelect = tag === 'select'
    const compileAttrExpr = actionOverride !== undefined ? (n: Node) => (n === actionOverride.node ? actionOverride.ident : compileSubExpression(n)) : compileSubExpression
    const { innerHtmlExpr, textareaValue, nextSelectValue } = emitSsrElementAttrs({ node, tag, parts, activeSelectValue, flushParts, pushStmt, nextId: () => loopCounter++, use, compileSubExpression: compileAttrExpr })
    if (FORM_CONTROL_TAGS.has(tag))
      emitFormControlAttrs(node, tag as 'input' | 'select' | 'textarea', parts, use, compileSubExpression)
    parts.pushStatic('>')
    if (VOID_ELEMENTS.has(tag))
      return

    const prevSelectValue = activeSelectValue
    if (isSelect)
      activeSelectValue = nextSelectValue

    try {
      if (innerHtmlExpr !== undefined)
        parts.pushExpr(innerHtmlExpr)
      else if (isTextarea && textareaValue !== undefined && filterMeaningfulChildren(node.children).length === 0)
        textareaValue.staticText !== undefined ? parts.pushStatic(escapeStaticText(textareaValue.staticText)) : textareaValue.expr !== undefined && parts.pushExpr(`${use('esc')}(${textareaValue.expr})`)
      else if (tag === 'style') {
        const styleExpr = compileChildrenListToStringExpr(node.children, false, false, 'style')
        if (styleExpr !== '""')
          parts.pushExpr(`${use('ssrStyleBlock')}(${styleExpr})`)
      }
      else
        emitChildrenIntoBuffer(node.children, bufVar, parts, flushParts, pushStmt, RAW_TEXT_ELEMENTS.has(tag) ? tag as 'style' | 'script' : undefined)
    }
    finally {
      activeSelectValue = prevSelectValue
    }
    if (actionOverride === undefined)
      parts.pushStatic(`</${tag}>`)
  }

  function emitChildrenIntoBuffer(
    children: readonly JSXChild[],
    bufVar: string,
    parts: StringParts,
    flushParts: () => void,
    pushStmt: (stmt: string) => void,
    rawTextTag?: 'style' | 'script',
    slotMarkers = markersAt(children[0]?.start ?? 0),
    inFragment = false,
  ): void {
    const planned = planChildSlots(children, { jsxNodes, exprContext, emitMarkers: slotMarkers, inFragment })

    for (const { child, slot, open, close } of planned) {
      if (slot.kind === 'static-text') {
        if (rawTextTag !== undefined)
          parts.pushStatic(escapeRawText(slot.text, rawTextTag))
        else
          parts.pushStatic(escapeStaticText(slot.fromLiteral ? slot.text : decodeHtmlEntities(slot.text)))
        continue
      }

      if (rawTextTag !== undefined) {
        if (child.type === 'JSXExpressionContainer' && child.expression.type !== 'JSXEmptyExpression') {
          const expr = child.expression
          if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0 && expr.quasis.length === 1) {
            const cooked = expr.quasis[0]?.value.cooked
            if (typeof cooked === 'string') {
              parts.pushStatic(escapeRawText(cooked, rawTextTag))
              continue
            }
          }
          parts.pushExpr(`${use('ssrRawText')}(${JSON.stringify(rawTextTag)}, ${compileSubExpression(expr)})`)
          continue
        }
      }

      if (slot.kind === 'element') {
        emitIntoBuffer(slot.node, bufVar, parts, flushParts, pushStmt)
        continue
      }

      if (open !== '')
        parts.pushStatic(open)

      if (slot.kind === 'component' || slot.kind === 'fragment') {
        emitIntoBuffer(slot.node, bufVar, parts, flushParts, pushStmt)
      }
      else if (slot.kind === 'loop') {
        const { match } = slot
        const itemParam = match.params[0]?.type === 'Identifier' ? match.params[0].name : undefined
        const idxParam = match.params[1]?.type === 'Identifier' ? match.params[1].name : undefined

        if (match.isJsxBody && itemParam !== undefined && match.params.length <= 2 && (match.params.length < 2 || idxParam !== undefined)) {
          flushParts()
          const n = loopCounter++
          const arrVar = `_a${n}`
          const idxVar = idxParam ?? `_i${n}`
          const innerStmts: string[] = []
          const innerParts = new StringParts()
          const flushInner = () => {
            if (!innerParts.isEmpty()) {
              innerStmts.push(`${bufVar} += ${innerParts.toExpr()};`)
              innerParts.clear()
            }
          }
          emitIntoBuffer(match.body as JSXElement | JSXFragment, bufVar, innerParts, flushInner, s => innerStmts.push(s))
          flushInner()

          const target = compileSubExpression(match.target)
          pushStmt(
            `const ${arrVar} = ${target}; if (${arrVar}) for (let ${idxVar} = 0; ${idxVar} < ${arrVar}.length; ${idxVar}++) { const ${itemParam} = ${arrVar}[${idxVar}]; ${innerStmts.join(' ')} }`,
          )
        }
        else if (match.isJsxBody) {
          const target = compileSubExpression(match.target)
          const params = match.params.map(p => code.slice(p.start, p.end)).join(', ')
          parts.pushExpr(`${use('ssrLoop')}(${target}, (${params}) => ${compileJsxToStringExpr(match.body as JSXElement | JSXFragment)})`)
        }
        else {
          parts.pushExpr(`${use('esc')}(${compileSubExpression(match.call)})`)
        }
      }
      else if (slot.kind === 'and-show') {
        const left = compileSubExpression(slot.expr.left)
        const right = compileJsxToStringExpr(slot.right)
        parts.pushExpr(`((${left}) ? (${right}) : "")`)
      }
      else if (slot.kind === 'ternary-show') {
        const test = compileSubExpression(slot.expr.test)
        const cons = compileExpressionAsString(slot.cons)
        const alt = compileExpressionAsString(slot.alt)
        parts.pushExpr(`((${test}) ? (${cons}) : (${alt}))`)
      }
      else {
        parts.pushExpr(`${use('esc')}(${compileSubExpression(slot.expr)})`)
      }

      if (close !== '')
        parts.pushStatic(close)
    }
  }

  function compileExpressionAsString(expr: Node): string {
    if (isJsxNode(expr))
      return compileJsxToStringExpr(expr)
    if (expr.type === 'LogicalExpression' && expr.operator === '&&') {
      const right = unwrapParens(expr.right)
      if (isJsxNode(right))
        return `((${compileSubExpression(expr.left)}) ? (${compileJsxToStringExpr(right)}) : "")`
    }
    if (expr.type === 'ConditionalExpression') {
      const consNode = unwrapParens(expr.consequent)
      const altNode = unwrapParens(expr.alternate)
      if (isJsxNode(consNode) || isJsxNode(altNode))
        return `((${compileSubExpression(expr.test)}) ? (${compileExpressionAsString(consNode)}) : (${compileExpressionAsString(altNode)}))`
    }
    return `${use('esc')}(${compileSubExpression(expr)})`
  }

  function emitComponent(node: JSXElement, tag: string, parts: StringParts): void {
    const { propEntries, allStaticProps, staticPropsObj, hydrateExpr, staticHydrate } = serializeComponentProps(node.openingElement.attributes, compileSubExpression)
    const childNodes = node.children
    const meaningfulChildren = filterMeaningfulChildren(childNodes)
    const hasChildren = meaningfulChildren.length > 0
    // The call sits on the line of its tag, so a component that throws names that line in the caller's frame.
    const call = `${mark(node.start)}${tag}`

    const prunelleTag = resolvePrunelleTag(tag, analysis.imports)
    if (prunelleTag === 'Suspense' || prunelleTag === 'Catch') {
      ;(prunelleTag === 'Suspense' ? emitSuspense : emitCatch)(prunelleTags, node, tag, propEntries, parts)
      return
    }

    const islandInfo = islands?.get(tag)
    if (islandInfo === undefined && islands !== undefined && hydrateExpr !== undefined)
      throw mistake(`$hydrate on <${tag}>`, filename, `${tag} is not an island, so it never hydrates; drop $hydrate, or give ${tag} state or handlers`)

    const childrenHaveAwait = hasChildren && childNodes.some(c => directAwaitNodes.has(c))
    const childMarkers = islandInfo === undefined && markersAt(node.start)
    const childExpr = hasChildren ? compileChildrenListToStringExpr(childNodes, childMarkers, childMarkers && meaningfulChildren.length > 1) : '""'

    if (islandInfo !== undefined) {
      emitIsland({ use, nextId: () => loopCounter++, markersAt }, { island: islandInfo, tag, call, start: node.start, propEntries, allStaticProps, staticPropsObj, hydrateExpr, staticHydrate, hasChildren, childExpr, childrenHaveAwait }, parts)
      return
    }

    const childrenHaveDynamic = hasChildren && childNodes.some(c => dynamicChildNodes.has(c))

    // Lazy memoized getter for non-async dynamic/component children so Providers & context components run before their children!
    if (childrenHaveDynamic && !childrenHaveAwait) {
      const cVar = `_c${loopCounter++}`
      const propsWithGetter = [...propEntries, `get children() { return ${cVar} === undefined ? (${cVar} = ${use('raw')}(${childExpr})) : ${cVar} }`].join(', ')
      parts.pushExpr(`${use('ssrChild')}(${call}((() => { let ${cVar}; return { ${propsWithGetter} }; })()))`)
      return
    }

    if (hasChildren)
      propEntries.push(`children: ${use('raw')}(${childExpr})`)

    const propsObj = propEntries.length > 0 ? `{ ${propEntries.join(', ')} }` : '{}'
    parts.pushExpr(`${use('ssrChild')}(${call}(${propsObj}))`)
  }

  function compileJsxToStringExpr(node: JSXElement | JSXFragment): string {
    const bufVar = `_o${loopCounter++}`
    const stmts: string[] = []
    const parts = new StringParts()

    const flush = () => {
      if (!parts.isEmpty()) {
        stmts.push(`${bufVar} += ${parts.toExpr()};`)
        parts.clear()
      }
    }

    emitIntoBuffer(node, bufVar, parts, flush, s => stmts.push(s))

    // If no inline `for` statements were emitted, stay a pure flat concatenation expression!
    if (stmts.length === 0)
      return parts.toExpr()

    flush()
    if (directAwaitNodes.has(node))
      return `(await (async () => { let ${bufVar} = ""; ${stmts.join(' ')} return ${bufVar}; })())`
    return `(() => { let ${bufVar} = ""; ${stmts.join(' ')} return ${bufVar}; })()`
  }

  function compileRootJsx(node: JSXElement | JSXFragment): string {
    return `${use('raw')}(${compileJsxToStringExpr(node)})`
  }

  walk(program, (node) => {
    if (isJsxNode(node)) {
      editor.replace(node.start, node.end, compileRootJsx(node) + mark(node.end))
      return false
    }
    return undefined
  })

  if (used.size > 0) {
    const specifiers = [...used].sort().map(name => `${name} as __${name}`).join(', ')
    // Last, where it moves no line: an import is hoisted wherever it is written.
    editor.append(`\nimport { ${specifiers} } from 'prunelle/internal/ssr';\n`)
  }

  return { code: alignLines(editor.toString()), analysis }
}
