// Diagnostic codes and mechanical quick fixes for the Prunelle TypeScript language-service plugin.

import type { JSXAttribute, Node } from 'oxc-parser'
import type ts from 'typescript'
import { unwrapParens, unwrapTsExpr } from '../compiler/shared'

export const PRUNELLE_CODE = {
  ERROR: 98001,
  WARNING: 98002,
  BARE_SIGNAL: 98101,
  LOWERCASE_EVENT: 98102,
  RENAMED_EVENT: 98103,
  NAMESPACED_EVENT: 98104,
  CLIENT_DIRECTIVE: 98105,
  SET_HTML: 98106,
  STRIP_NAMESPACE: 98107,
  CAMEL_ARIA: 98108,
  CAMEL_SVG: 98109,
  REACT_DEFAULT: 98110,
  BOOLEAN_FALSE_STRING: 98111,
  DANGEROUSLY_SET_HTML: 98112,
  INNER_HTML_OBJECT: 98113,
  HANDLER_MUTATION: 98114,
  DIRECTIVE: 98115,
  NON_BUBBLING_FOCUS: 98116,
  TEXT_INPUT_ONCHANGE: 98117,
  KAY_IMPORT: 98118,
} as const

export const PRUNELLE_FIXABLE_CODES: readonly number[] = [
  PRUNELLE_CODE.BARE_SIGNAL,
  PRUNELLE_CODE.LOWERCASE_EVENT,
  PRUNELLE_CODE.RENAMED_EVENT,
  PRUNELLE_CODE.NAMESPACED_EVENT,
  PRUNELLE_CODE.CLIENT_DIRECTIVE,
  PRUNELLE_CODE.SET_HTML,
  PRUNELLE_CODE.STRIP_NAMESPACE,
  PRUNELLE_CODE.CAMEL_ARIA,
  PRUNELLE_CODE.CAMEL_SVG,
  PRUNELLE_CODE.REACT_DEFAULT,
  PRUNELLE_CODE.BOOLEAN_FALSE_STRING,
  PRUNELLE_CODE.DANGEROUSLY_SET_HTML,
  PRUNELLE_CODE.INNER_HTML_OBJECT,
  PRUNELLE_CODE.HANDLER_MUTATION,
  PRUNELLE_CODE.DIRECTIVE,
  PRUNELLE_CODE.NON_BUBBLING_FOCUS,
  PRUNELLE_CODE.TEXT_INPUT_ONCHANGE,
  PRUNELLE_CODE.KAY_IMPORT,
]

export interface PrunelleFixDescriptor {
  fixName: string
  description: string
  span: { start: number, length: number }
  newText: string
}

export interface ClassifiedFix {
  code: number
  /** Highlight span for the diagnostic itself (may differ from edit span, e.g. handler mutation). */
  diagSpan: { start: number, length: number }
  fix: PrunelleFixDescriptor
}

const CLIENT_HYDRATE_MAP: Record<string, string> = {
  load: 'load',
  visible: 'visible',
  idle: 'idle',
  only: 'client',
}

const WRITE_PROP_RE = /^write ([a-zA-Z0-9_:-]+)=\{\.\.\.\}/
const WRITE_IMPORT_RE = /^write '([^']+)'/
const BUBBLING_FOCUS_RE = /focus does not bubble, write (onFocus(?:In|Out))=\{\.\.\.\}/

function findNode<T extends Node['type']>(nodes: readonly Node[], type: T): Extract<Node, { type: T }> | undefined {
  for (const node of nodes) {
    if (node.type === type)
      return node as Extract<Node, { type: T }>
  }
  return undefined
}

function spanOf(start: number, end: number): { start: number, length: number } {
  return { start, length: Math.max(1, end - start) }
}

function attrRenameFix(
  code: number,
  attr: JSXAttribute,
  fromName: string,
  toName: string,
  fixName: string,
): ClassifiedFix {
  const span = spanOf(attr.name.start, attr.name.end)
  return {
    code,
    diagSpan: span,
    fix: { fixName, description: `Change '${fromName}' to '${toName}'`, span, newText: toName },
  }
}

function extractHtmlObjectExpr(value: JSXAttribute['value'], source: string): string | undefined {
  if (value?.type !== 'JSXExpressionContainer' || value.expression.type === 'JSXEmptyExpression')
    return undefined
  const obj = unwrapParens(value.expression)
  if (obj.type !== 'ObjectExpression')
    return undefined
  const prop = obj.properties.find(p =>
    p.type === 'Property'
    && ((p.key.type === 'Identifier' && p.key.name === '__html')
      || (p.key.type === 'Literal' && p.key.value === '__html')),
  )
  return prop?.type === 'Property' ? source.slice(prop.value.start, prop.value.end) : undefined
}

function staticLiteralString(value: JSXAttribute['value']): string | undefined {
  if (value?.type === 'Literal' && typeof value.value === 'string')
    return value.value
  if (value?.type === 'JSXExpressionContainer' && value.expression.type !== 'JSXEmptyExpression') {
    const inner = unwrapTsExpr(value.expression)
    if (inner.type === 'Literal' && typeof inner.value === 'string')
      return inner.value
  }
  return undefined
}

function directiveDeleteSpan(code: string, start: number, end: number): { start: number, length: number } {
  let delStart = start
  let lineStart = start
  while (lineStart > 0 && code.charCodeAt(lineStart - 1) !== 10 && code.charCodeAt(lineStart - 1) !== 13)
    lineStart--
  if (/^[ \t]*$/.test(code.slice(lineStart, start)))
    delStart = lineStart

  let delEnd = end
  while (delEnd < code.length && (code.charCodeAt(delEnd) === 32 || code.charCodeAt(delEnd) === 9))
    delEnd++
  if (code.charCodeAt(delEnd) === 13 && code.charCodeAt(delEnd + 1) === 10)
    delEnd += 2
  else if (code.charCodeAt(delEnd) === 10)
    delEnd += 1
  return { start: delStart, length: delEnd - delStart }
}

function classifyNamespacedAttrFix(attr: JSXAttribute, what: string, fixText: string): ClassifiedFix | undefined {
  if (attr.name.type !== 'JSXNamespacedName')
    return undefined
  const ns = attr.name.namespace.name
  const local = attr.name.name.name
  if (ns === 'on') {
    const match = WRITE_PROP_RE.exec(fixText)
    return match !== null ? attrRenameFix(PRUNELLE_CODE.NAMESPACED_EVENT, attr, what, match[1]!, 'prunelle-namespaced-event') : undefined
  }
  if (ns === 'client') {
    let mode = CLIENT_HYDRATE_MAP[local]
    if (mode === undefined && local === 'media') {
      const query = staticLiteralString(attr.value)
      if (query !== undefined && query.trim() !== '')
        mode = `media(${query})`
    }
    if (mode === undefined)
      return undefined
    const span = spanOf(attr.start, attr.end)
    const newText = `$hydrate="${mode}"`
    return {
      code: PRUNELLE_CODE.CLIENT_DIRECTIVE,
      diagSpan: span,
      fix: { fixName: 'prunelle-client-directive', description: `Replace '${what}' with '${newText}'`, span, newText },
    }
  }
  if (what === 'set:html')
    return attrRenameFix(PRUNELLE_CODE.SET_HTML, attr, 'set:html', 'innerHTML', 'prunelle-set-html')
  if (ns === 'prop' || ns === 'attr' || ns === 'bool')
    return attrRenameFix(PRUNELLE_CODE.STRIP_NAMESPACE, attr, what, local, 'prunelle-strip-namespace')
  return undefined
}

function classifyInnerHtmlFix(attr: JSXAttribute, what: string, code: string): ClassifiedFix | undefined {
  const isDangerous = what === 'dangerouslySetInnerHTML'
  if (!isDangerous && what !== 'innerHTML={{ __html }}')
    return undefined
  const expr = extractHtmlObjectExpr(attr.value, code)
  if (expr === undefined)
    return undefined
  const span = spanOf(attr.start, attr.end)
  const newText = `innerHTML={${expr}}`
  return {
    code: isDangerous ? PRUNELLE_CODE.DANGEROUSLY_SET_HTML : PRUNELLE_CODE.INNER_HTML_OBJECT,
    diagSpan: span,
    fix: {
      fixName: isDangerous ? 'prunelle-dangerously-set-html' : 'prunelle-inner-html-object',
      description: `Replace with '${newText}'`,
      span,
      newText,
    },
  }
}

function classifyJsxAttrMistake(attr: JSXAttribute, what: string, fixText: string, code: string): ClassifiedFix | undefined {
  if (attr.name.type === 'JSXNamespacedName')
    return classifyNamespacedAttrFix(attr, what, fixText)
  const attrName = attr.name.name
  const htmlFix = classifyInnerHtmlFix(attr, what, code)
  if (htmlFix !== undefined)
    return htmlFix
  if (fixText.includes('prunelle binds camelCase event props only')) {
    const match = WRITE_PROP_RE.exec(fixText)
    return match !== null ? attrRenameFix(PRUNELLE_CODE.LOWERCASE_EVENT, attr, attrName, match[1]!, 'prunelle-lowercase-event') : undefined
  }
  if (fixText.includes('ARIA attributes use kebab-case')) {
    const match = WRITE_PROP_RE.exec(fixText)
    return match !== null ? attrRenameFix(PRUNELLE_CODE.CAMEL_ARIA, attr, attrName, match[1]!, 'prunelle-kebab-aria') : undefined
  }
  if (fixText.includes('SVG attributes are case-sensitive') || what === 'xlinkHref') {
    const target = what === 'xlinkHref' ? 'xlink:href' : WRITE_PROP_RE.exec(fixText)?.[1]
    return target !== undefined ? attrRenameFix(PRUNELLE_CODE.CAMEL_SVG, attr, attrName, target, 'prunelle-kebab-svg') : undefined
  }
  if (what === 'defaultValue' || what === 'defaultChecked') {
    const target = what === 'defaultValue' ? 'value' : 'checked'
    return attrRenameFix(PRUNELLE_CODE.REACT_DEFAULT, attr, attrName, target, 'prunelle-react-default')
  }
  if (fixText.includes('any string turns it on')) {
    const span = spanOf(attr.start, attr.end)
    const newText = `${attrName}={false}`
    return {
      code: PRUNELLE_CODE.BOOLEAN_FALSE_STRING,
      diagSpan: span,
      fix: { fixName: 'prunelle-boolean-false', description: `Change '${what}' to '${newText}'`, span, newText },
    }
  }
  if (what.includes(' runs ') && what.endsWith(' at render') && attr.value?.type === 'JSXExpressionContainer' && attr.value.expression.type !== 'JSXEmptyExpression') {
    const inner = unwrapParens(attr.value.expression)
    const exprSrc = code.slice(inner.start, inner.end)
    const newText = `() => ${exprSrc}`
    return {
      code: PRUNELLE_CODE.HANDLER_MUTATION,
      diagSpan: spanOf(attr.start, attr.end),
      fix: {
        fixName: 'prunelle-wrap-handler',
        description: `Wrap handler in '${newText}'`,
        span: spanOf(attr.value.expression.start, attr.value.expression.end),
        newText,
      },
    }
  }
  const focusMatch = BUBBLING_FOCUS_RE.exec(fixText)
  if (focusMatch !== null)
    return attrRenameFix(PRUNELLE_CODE.NON_BUBBLING_FOCUS, attr, attrName, focusMatch[1]!, 'prunelle-bubbling-focus')
  if (what === attrName && attrName.startsWith('on')) {
    const match = WRITE_PROP_RE.exec(fixText)
    if (match !== null && match[1]!.startsWith('on'))
      return attrRenameFix(PRUNELLE_CODE.RENAMED_EVENT, attr, attrName, match[1]!, 'prunelle-renamed-event')
  }
  return undefined
}

/** Splits a standard `prunelle compiler: <what> in <file>: <fix>.` message. */
function parseMistakeParts(message: string, fileName: string): { what: string, fixText: string } | undefined {
  const prefix = 'prunelle compiler: '
  if (!message.startsWith(prefix))
    return undefined
  const marker = ` in ${fileName}: `
  const idx = message.indexOf(marker, prefix.length)
  if (idx === -1)
    return undefined
  const what = message.slice(prefix.length, idx)
  const rawFix = message.slice(idx + marker.length)
  const fixText = rawFix.endsWith('.') ? rawFix.slice(0, -1) : rawFix
  return { what, fixText }
}

/** Classifies a compiler mistake and builds a mechanical quick fix when one exists. */
export function classifyMistakeFix(
  message: string,
  fileName: string,
  nodesAtStart: readonly Node[],
  code: string,
): ClassifiedFix | undefined {
  const parts = parseMistakeParts(message, fileName)
  if (parts === undefined)
    return undefined
  const { what, fixText } = parts

  if (what.endsWith(' without .value')) {
    const name = what.slice(0, -' without .value'.length)
    const node = name.includes('.') ? findNode(nodesAtStart, 'MemberExpression') : findNode(nodesAtStart, 'Identifier')
    if (node === undefined)
      return undefined
    const span = spanOf(node.start, node.end)
    const exprText = code.slice(node.start, node.end)
    return {
      code: PRUNELLE_CODE.BARE_SIGNAL,
      diagSpan: span,
      fix: { fixName: 'prunelle-add-signal-value', description: `Add '.value' to '${name}'`, span, newText: `${exprText}.value` },
    }
  }

  if (what === "'use client'" || what === "'use server'") {
    const stmt = findNode(nodesAtStart, 'ExpressionStatement')
    if (stmt === undefined)
      return undefined
    return {
      code: PRUNELLE_CODE.DIRECTIVE,
      diagSpan: spanOf(stmt.start, stmt.end),
      fix: {
        fixName: 'prunelle-remove-directive',
        description: `Remove ${what} directive`,
        span: directiveDeleteSpan(code, stmt.start, stmt.end),
        newText: '',
      },
    }
  }

  if (what.startsWith("import from '@kayjs/")) {
    const lit = findNode(nodesAtStart, 'Literal')
    const match = WRITE_IMPORT_RE.exec(fixText)
    if (lit === undefined || match === null)
      return undefined
    const quote = code[lit.start] === '"' ? '"' : "'"
    const replacement = match[1]!
    const span = spanOf(lit.start, lit.end)
    return {
      code: PRUNELLE_CODE.KAY_IMPORT,
      diagSpan: span,
      fix: {
        fixName: 'prunelle-rewrite-kay-import',
        description: `Replace import with '${replacement}'`,
        span,
        newText: `${quote}${replacement}${quote}`,
      },
    }
  }

  const attr = findNode(nodesAtStart, 'JSXAttribute')
  if (attr !== undefined)
    return classifyJsxAttrMistake(attr, what, fixText, code)
  return undefined
}

/** Classifies a compiler warning and builds a mechanical quick fix when one exists. */
export function classifyWarningFix(message: string, nodesAtStart: readonly Node[]): ClassifiedFix | undefined {
  if (message.includes('fires when the field loses focus, not per keystroke; write onInput={...}')) {
    const attr = findNode(nodesAtStart, 'JSXAttribute')
    if (attr !== undefined)
      return attrRenameFix(PRUNELLE_CODE.TEXT_INPUT_ONCHANGE, attr, 'onChange', 'onInput', 'prunelle-text-input-oninput')
  }
  return undefined
}

/** Converts a Prunelle quick fix descriptor into a TypeScript `CodeFixAction`. */
export function toCodeFixAction(fileName: string, fix: PrunelleFixDescriptor): ts.CodeFixAction {
  return {
    fixName: fix.fixName,
    description: fix.description,
    changes: [{
      fileName,
      textChanges: [{
        span: { start: fix.span.start, length: fix.span.length },
        newText: fix.newText,
      }],
    }],
  }
}
