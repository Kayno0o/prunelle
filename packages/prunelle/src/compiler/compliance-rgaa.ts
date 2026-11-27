// Static RGAA JSX accessibility checks: WAI-ARIA, headings, controls, tables, fieldsets, and focus.

import type { JSXAttribute, JSXAttributeItem, JSXChild, JSXElement, Node } from 'oxc-parser'
import type { CompilerWarning } from './mistakes'
import { cleanJsxText, isComponentTag, jsxTagName, staticLiteral, unwrapParens, unwrapTsExpr } from './shared'

export const RGAA_JSX_RULES = [
  'rgaa/img-alt',
  'rgaa/form-label',
  'rgaa/accessible-name',
  'rgaa/duplicate-id',
  'rgaa/positive-tabindex',
  'rgaa/nested-control',
  'rgaa/link-as-button',
  'rgaa/unknown-role',
  'rgaa/unknown-aria',
  'rgaa/invalid-aria-value',
  'rgaa/skipped-heading',
  'rgaa/table-without-header',
  'rgaa/fieldset-without-legend',
  'rgaa/click-without-key',
  'rgaa/autofocus',
  'rgaa/meta-refresh',
] as const

export type RgaaJsxRule = (typeof RGAA_JSX_RULES)[number]

const NON_LABELLED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button', 'image'])
export const INTERACTIVE_ANCESTORS = new Set(['a', 'button', 'summary'])
const INTERACTIVE_DESCENDANTS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary'])
const NATIVE_CLICKABLE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'label', 'option', 'dialog', 'area'])
const TABLE_STRUCTURAL_TAGS = new Set(['thead', 'tbody', 'tfoot', 'tr'])
const HEADING_LEVELS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }
const PRESENTATIONAL_ROLES = new Set(['presentation', 'none'])
const INT_RE = /^-?\d+$/
const NUM_RE = /^-?(?:\d+\.?\d*|\.\d+)$/
const TABINDEX_NUM_RE = /^[+-]?\d+(?:\.\d+)?$/

// Concrete WAI-ARIA 1.2 & 1.3 roles (abstract roles excluded).
const VALID_ARIA_ROLES = new Set((
  'alert alertdialog application article associationlist associationlistitemkey associationlistitemvalue '
  + 'banner blockquote button caption cell checkbox code columnheader combobox comment complementary contentinfo '
  + 'definition deletion dialog directory document emphasis feed figure form generic '
  + 'graphics-document graphics-object graphics-symbol grid gridcell group heading image img insertion '
  + 'link list listbox listitem log main mark marquee math menu menubar menuitem menuitemcheckbox menuitemradio '
  + 'meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader '
  + 'scrollbar search searchbox separator slider spinbutton status strong subscript suggestion superscript switch '
  + 'tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem'
).split(' '))

// Valid WAI-ARIA 1.1 / 1.2 / 1.3 attributes.
const VALID_ARIA_ATTRS = new Set((
  'aria-activedescendant aria-atomic aria-autocomplete aria-braillelabel aria-brailleroledescription '
  + 'aria-busy aria-checked aria-colcount aria-colindex aria-colindextext aria-colspan aria-controls '
  + 'aria-current aria-describedby aria-description aria-details aria-disabled aria-dropeffect '
  + 'aria-errormessage aria-expanded aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid '
  + 'aria-keyshortcuts aria-label aria-labelledby aria-level aria-live aria-modal aria-multiline '
  + 'aria-multiselectable aria-orientation aria-owns aria-placeholder aria-posinset aria-pressed '
  + 'aria-readonly aria-relevant aria-required aria-roledescription aria-rowcount aria-rowindex '
  + 'aria-rowindextext aria-rowspan aria-selected aria-setsize aria-sort aria-valuemax aria-valuemin '
  + 'aria-valuenow aria-valuetext'
).split(' '))

const ARIA_BOOL_ATTRS = new Set((
  'aria-atomic aria-busy aria-disabled aria-expanded aria-grabbed aria-hidden '
  + 'aria-modal aria-multiline aria-multiselectable aria-readonly aria-required aria-selected'
).split(' '))
const ARIA_TRISTATE_ATTRS = new Set(['aria-checked', 'aria-pressed'])
const ARIA_INT_ATTRS = new Set((
  'aria-level aria-posinset aria-setsize aria-colcount aria-rowcount '
  + 'aria-colindex aria-rowindex aria-colspan aria-rowspan'
).split(' '))
const ARIA_NUM_ATTRS = new Set(['aria-valuemin', 'aria-valuemax', 'aria-valuenow'])
const ARIA_RELEVANT_TOKENS = new Set(['additions', 'removals', 'text', 'all'])
const ARIA_ENUM_ATTRS: Record<string, ReadonlySet<string>> = {
  'aria-live': new Set(['off', 'polite', 'assertive']),
  'aria-orientation': new Set(['horizontal', 'vertical']),
  'aria-sort': new Set(['none', 'ascending', 'descending', 'other']),
  'aria-current': new Set(['page', 'step', 'location', 'date', 'time', 'true', 'false']),
  'aria-haspopup': new Set(['false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog']),
  'aria-invalid': new Set(['grammar', 'false', 'spelling', 'true']),
  'aria-autocomplete': new Set(['inline', 'list', 'both', 'none']),
}

export interface RgaaScope {
  seenIds: Set<string>
  lastHeading: number
}

export interface RgaaElementContext {
  filename: string
  inLabel: boolean
  interactiveAncestor: string | undefined
  labelTargets: ReadonlySet<string>
  scope: RgaaScope
  isIgnored: (rule: RgaaJsxRule, elementStart: number, attrStart?: number) => boolean
  warnings: CompilerWarning[]
}

export function createRgaaScope(): RgaaScope {
  return { seenIds: new Set(), lastHeading: 0 }
}

export function cloneRgaaScope(scope: RgaaScope): RgaaScope {
  return { seenIds: new Set(scope.seenIds), lastHeading: scope.lastHeading }
}

export function mergeRgaaScope(target: RgaaScope, branch: RgaaScope): void {
  for (const id of branch.seenIds)
    target.seenIds.add(id)
  if (branch.lastHeading > target.lastHeading)
    target.lastHeading = branch.lastHeading
}

export function findAttr(attributes: readonly JSXAttributeItem[], name: string): JSXAttribute | undefined {
  for (const attr of attributes) {
    if (attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier' && attr.name.name === name)
      return attr
  }
  return undefined
}

function findAttrLower(attributes: readonly JSXAttributeItem[], lowerName: string): JSXAttribute | undefined {
  for (const attr of attributes) {
    if (attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier' && attr.name.name.toLowerCase() === lowerName)
      return attr
  }
  return undefined
}

export function hasSpread(attributes: readonly JSXAttributeItem[]): boolean {
  return attributes.some(a => a.type === 'JSXSpreadAttribute')
}

export function staticStringValueOf(value: JSXAttribute['value']): string | undefined {
  if (value === null)
    return undefined
  if (value.type === 'Literal' && typeof value.value === 'string')
    return value.value
  if (value.type === 'JSXExpressionContainer' && value.expression.type !== 'JSXEmptyExpression') {
    const expr = unwrapTsExpr(value.expression)
    if (expr.type === 'Literal' && typeof expr.value === 'string')
      return expr.value
    if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0)
      return expr.quasis[0]?.value.cooked ?? undefined
  }
  return undefined
}

export function attrTargetKey(attr: JSXAttribute | undefined): string | undefined {
  if (attr === undefined || attr.value === null)
    return undefined
  const str = staticStringValueOf(attr.value)
  if (str !== undefined && str.trim() !== '')
    return `s:${str}`
  if (attr.value.type === 'JSXExpressionContainer' && attr.value.expression.type !== 'JSXEmptyExpression') {
    const expr = unwrapTsExpr(attr.value.expression)
    if (expr.type === 'Identifier')
      return `i:${expr.name}`
  }
  return undefined
}

export function hasNonEmptyAttr(attributes: readonly JSXAttributeItem[], name: string): boolean {
  const attr = findAttr(attributes, name)
  if (attr === undefined || attr.value === null)
    return false
  const str = staticStringValueOf(attr.value)
  if (str !== undefined)
    return str.trim() !== ''
  if (attr.value.type === 'JSXExpressionContainer' && attr.value.expression.type !== 'JSXEmptyExpression') {
    const expr = unwrapParens(attr.value.expression)
    if (expr.type === 'Literal' && (expr.value === null || expr.value === false || expr.value === ''))
      return false
    if (expr.type === 'Identifier' && expr.name === 'undefined')
      return false
    return true
  }
  return false
}

function isExplicitlyFalsyExpr(value: JSXAttribute['value']): boolean {
  if (value === null || value.type !== 'JSXExpressionContainer' || value.expression.type === 'JSXEmptyExpression')
    return false
  const expr = unwrapTsExpr(value.expression)
  if (expr.type === 'Literal' && (expr.value === false || expr.value === null))
    return true
  return expr.type === 'Identifier' && expr.name === 'undefined'
}

function hasLabelAttr(attributes: readonly JSXAttributeItem[]): boolean {
  return hasNonEmptyAttr(attributes, 'aria-label')
    || hasNonEmptyAttr(attributes, 'aria-labelledby')
    || hasNonEmptyAttr(attributes, 'title')
}

function isAriaHidden(attributes: readonly JSXAttributeItem[]): boolean {
  const attr = findAttr(attributes, 'aria-hidden')
  if (attr === undefined)
    return false
  if (attr.value === null)
    return true
  if (attr.value.type === 'Literal')
    return attr.value.value === 'true'
  if (attr.value.type === 'JSXExpressionContainer' && attr.value.expression.type !== 'JSXEmptyExpression') {
    const expr = unwrapParens(attr.value.expression)
    return expr.type === 'Literal' && (expr.value === true || expr.value === 'true')
  }
  return false
}

function isPresentational(attributes: readonly JSXAttributeItem[]): boolean {
  const raw = staticStringValueOf(findAttr(attributes, 'role')?.value ?? null)
  return raw !== undefined && raw.trim().split(/\s+/).some(token => PRESENTATIONAL_ROLES.has(token))
}

function hasMeaningfulExpression(expr: Node): boolean {
  const inner = unwrapParens(expr)
  if (inner.type === 'Literal')
    return typeof inner.value === 'string' ? inner.value.trim() !== '' : typeof inner.value === 'number'
  return !(inner.type === 'Identifier' && inner.name === 'undefined')
}

function hasAccessibleName(children: readonly JSXChild[]): boolean {
  for (const child of children) {
    if (child.type === 'JSXText') {
      if (cleanJsxText(child.value).trim() !== '')
        return true
    }
    else if (child.type === 'JSXExpressionContainer') {
      if (child.expression.type !== 'JSXEmptyExpression' && hasMeaningfulExpression(child.expression))
        return true
    }
    else if (child.type === 'JSXFragment') {
      if (hasAccessibleName(child.children))
        return true
    }
    else if (child.type === 'JSXElement') {
      const attrs = child.openingElement.attributes
      if (isAriaHidden(attrs))
        continue
      const tag = jsxTagName(child.openingElement.name)
      if (hasSpread(attrs) || hasLabelAttr(attrs))
        return true
      if (tag === 'img') {
        if (hasNonEmptyAttr(attrs, 'alt'))
          return true
        continue
      }
      if (tag === 'svg') {
        if (child.children.some(c => c.type === 'JSXElement' && jsxTagName(c.openingElement.name) === 'title' && hasAccessibleName(c.children)))
          return true
        continue
      }
      if (isComponentTag(tag)) {
        if (hasNonEmptyAttr(attrs, 'label') || hasAccessibleName(child.children))
          return true
        continue
      }
      if (hasAccessibleName(child.children))
        return true
    }
  }
  return false
}

type StaticAttrVal =
  | { kind: 'bool', value: boolean }
  | { kind: 'number', value: number }
  | { kind: 'string', value: string }

function extractStaticAttrValue(attr: JSXAttribute): StaticAttrVal | undefined {
  if (attr.value === null)
    return { kind: 'bool', value: true }
  if (attr.value.type === 'Literal' && typeof attr.value.value === 'string')
    return { kind: 'string', value: attr.value.value }
  if (attr.value.type !== 'JSXExpressionContainer' || attr.value.expression.type === 'JSXEmptyExpression')
    return undefined
  const expr = unwrapTsExpr(attr.value.expression)
  if (expr.type === 'Identifier' && expr.name === 'undefined')
    return undefined
  if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0)
    return { kind: 'string', value: expr.quasis[0]?.value.cooked ?? '' }
  if (expr.type === 'UnaryExpression' && expr.operator === '+' && expr.argument.type === 'Literal' && typeof expr.argument.value === 'number')
    return { kind: 'number', value: expr.argument.value }
  const lit = staticLiteral(expr)
  if (!lit.ok || lit.value === null)
    return undefined
  if (typeof lit.value === 'boolean')
    return { kind: 'bool', value: lit.value }
  if (typeof lit.value === 'number')
    return { kind: 'number', value: lit.value }
  return { kind: 'string', value: lit.value }
}

function validateAriaValue(name: string, val: StaticAttrVal): string | undefined {
  if (ARIA_BOOL_ATTRS.has(name))
    return val.kind === 'bool' || (val.kind === 'string' && (val.value === 'true' || val.value === 'false')) ? undefined : 'expected "true" or "false"'
  if (ARIA_TRISTATE_ATTRS.has(name))
    return val.kind === 'bool' || (val.kind === 'string' && (val.value === 'true' || val.value === 'false' || val.value === 'mixed')) ? undefined : 'expected "true", "false", or "mixed"'
  const enumSet = ARIA_ENUM_ATTRS[name]
  if (enumSet !== undefined) {
    const token = val.kind === 'bool' ? String(val.value) : val.kind === 'string' ? val.value : undefined
    return token !== undefined && enumSet.has(token) ? undefined : `expected one of ${[...enumSet].join(', ')}`
  }
  if (name === 'aria-relevant') {
    const tokens = val.kind === 'string' ? val.value.trim().split(/\s+/).filter(Boolean) : []
    return tokens.length > 0 && tokens.every(t => ARIA_RELEVANT_TOKENS.has(t)) ? undefined : 'expected space-separated tokens from additions, removals, text, all'
  }
  if (ARIA_INT_ATTRS.has(name))
    return (val.kind === 'number' && Number.isInteger(val.value)) || (val.kind === 'string' && INT_RE.test(val.value.trim())) ? undefined : 'expected an integer'
  if (ARIA_NUM_ATTRS.has(name))
    return (val.kind === 'number' && Number.isFinite(val.value)) || (val.kind === 'string' && NUM_RE.test(val.value.trim())) ? undefined : 'expected a number'
  return undefined
}

function emitWarning(ctx: RgaaElementContext, rule: RgaaJsxRule, elementStart: number, message: string, attrStart?: number): void {
  if (!ctx.isIgnored(rule, elementStart, attrStart))
    ctx.warnings.push({ rule, start: attrStart ?? elementStart, message })
}

function checkRoleAndAria(element: JSXElement, tag: string, ctx: RgaaElementContext): void {
  const attrs = element.openingElement.attributes
  const roleAttr = findAttr(attrs, 'role')
  if (roleAttr !== undefined) {
    const raw = staticStringValueOf(roleAttr.value)
    if (raw !== undefined) {
      const tokens = raw.trim().split(/\s+/).filter(Boolean)
      const invalid = tokens.filter(t => !VALID_ARIA_ROLES.has(t))
      if (tokens.length === 0 || invalid.length > 0) {
        const detail = tokens.length === 0 ? 'an empty role' : `unknown WAI-ARIA role "${invalid[0]}"`
        emitWarning(ctx, 'rgaa/unknown-role', element.start, `[rgaa/unknown-role] <${tag} role="${raw}"> in ${ctx.filename} uses ${detail}: use a valid WAI-ARIA role or remove the attribute.`, roleAttr.start)
      }
    }
  }
  for (const attr of attrs) {
    if (attr.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier' || !attr.name.name.startsWith('aria-'))
      continue
    const name = attr.name.name
    if (!VALID_ARIA_ATTRS.has(name)) {
      emitWarning(ctx, 'rgaa/unknown-aria', element.start, `[rgaa/unknown-aria] <${tag} ${name}> in ${ctx.filename} is not a valid WAI-ARIA attribute: check the spelling or remove it.`, attr.start)
      continue
    }
    const val = extractStaticAttrValue(attr)
    if (val === undefined)
      continue
    const err = validateAriaValue(name, val)
    if (err !== undefined) {
      const shown = val.kind === 'string' ? `"${val.value}"` : String(val.value)
      emitWarning(ctx, 'rgaa/invalid-aria-value', element.start, `[rgaa/invalid-aria-value] <${tag} ${name}=${shown}> in ${ctx.filename} has an invalid value (${err}).`, attr.start)
    }
  }
}

function checkExprForChild(expr: Node, checkElement: (el: JSXElement) => boolean, checkFragment: (children: readonly JSXChild[]) => boolean): boolean {
  const inner = unwrapTsExpr(expr)
  if (inner.type === 'Literal' || (inner.type === 'Identifier' && inner.name === 'undefined'))
    return false
  if (inner.type === 'JSXElement')
    return checkElement(inner)
  if (inner.type === 'JSXFragment')
    return checkFragment(inner.children)
  if (inner.type === 'LogicalExpression') {
    return inner.operator === '&&'
      ? checkExprForChild(inner.right, checkElement, checkFragment)
      : checkExprForChild(inner.left, checkElement, checkFragment) || checkExprForChild(inner.right, checkElement, checkFragment)
  }
  if (inner.type === 'ConditionalExpression')
    return checkExprForChild(inner.consequent, checkElement, checkFragment) || checkExprForChild(inner.alternate, checkElement, checkFragment)
  return true
}

function tableMayHaveHeader(children: readonly JSXChild[]): boolean {
  const checkEl = (el: JSXElement): boolean => {
    const tag = jsxTagName(el.openingElement.name)
    if (tag === 'th' || isComponentTag(tag))
      return true
    return TABLE_STRUCTURAL_TAGS.has(tag) && tableMayHaveHeader(el.children)
  }
  for (const child of children) {
    if (child.type === 'JSXElement' && checkEl(child))
      return true
    if (child.type === 'JSXFragment' && tableMayHaveHeader(child.children))
      return true
    if (child.type === 'JSXExpressionContainer' && child.expression.type !== 'JSXEmptyExpression' && checkExprForChild(child.expression, checkEl, tableMayHaveHeader))
      return true
  }
  return false
}

function fieldsetMayHaveLegend(children: readonly JSXChild[], isDirect: boolean): boolean {
  const checkEl = (el: JSXElement): boolean => {
    const tag = jsxTagName(el.openingElement.name)
    if (tag === 'legend')
      return true
    if (tag === 'fieldset')
      return false
    return (isDirect && isComponentTag(tag)) || fieldsetMayHaveLegend(el.children, false)
  }
  for (const child of children) {
    if (child.type === 'JSXElement' && checkEl(child))
      return true
    if (child.type === 'JSXFragment' && fieldsetMayHaveLegend(child.children, isDirect))
      return true
    if (isDirect && child.type === 'JSXExpressionContainer' && child.expression.type !== 'JSXEmptyExpression' && checkExprForChild(child.expression, checkEl, cs => fieldsetMayHaveLegend(cs, true)))
      return true
  }
  return false
}

function checkFocusAndInteraction(element: JSXElement, tag: string, spread: boolean, ctx: RgaaElementContext): void {
  const attrs = element.openingElement.attributes

  const tabAttr = findAttrLower(attrs, 'tabindex')
  if (tabAttr !== undefined) {
    const val = extractStaticAttrValue(tabAttr)
    const num = val?.kind === 'number' ? val.value : val?.kind === 'string' && TABINDEX_NUM_RE.test(val.value.trim()) ? Number(val.value.trim()) : undefined
    if (num !== undefined && Number.isFinite(num) && num > 0) {
      const attrName = tabAttr.name.type === 'JSXIdentifier' ? tabAttr.name.name : 'tabindex'
      emitWarning(ctx, 'rgaa/positive-tabindex', element.start, `[rgaa/positive-tabindex] <${tag} ${attrName}={${num}}> in ${ctx.filename} uses a positive tabindex: use 0, -1, or reorder the DOM to preserve natural keyboard order.`, tabAttr.start)
    }
  }

  const autoFocusAttr = findAttrLower(attrs, 'autofocus')
  if (autoFocusAttr !== undefined && !isExplicitlyFalsyExpr(autoFocusAttr.value)) {
    const attrName = autoFocusAttr.name.type === 'JSXIdentifier' ? autoFocusAttr.name.name : 'autofocus'
    emitWarning(ctx, 'rgaa/autofocus', element.start, `[rgaa/autofocus] <${tag} ${attrName}> in ${ctx.filename} steals focus on load and can disorient keyboard and screen-reader users: remove ${attrName} or manage focus explicitly.`, autoFocusAttr.start)
  }

  if (ctx.interactiveAncestor !== undefined && INTERACTIVE_DESCENDANTS.has(tag)) {
    const inputType = tag === 'input' ? staticStringValueOf(findAttr(attrs, 'type')?.value ?? null)?.toLowerCase() : undefined
    if (inputType !== 'hidden')
      emitWarning(ctx, 'rgaa/nested-control', element.start, `[rgaa/nested-control] <${tag}> in ${ctx.filename} is nested inside <${ctx.interactiveAncestor}>: interactive controls must not be nested; place them as siblings.`)
  }

  const onClickAttr = findAttr(attrs, 'onClick')
  const hasClick = onClickAttr !== undefined && !isExplicitlyFalsyExpr(onClickAttr.value)
  if (tag === 'a' && !spread && hasClick && !hasNonEmptyAttr(attrs, 'href'))
    emitWarning(ctx, 'rgaa/link-as-button', element.start, `[rgaa/link-as-button] <a> with onClick and no href in ${ctx.filename}: use <button type="button"> for actions, or add a valid href for navigation.`)

  if (hasClick && !spread && !NATIVE_CLICKABLE_TAGS.has(tag) && !isPresentational(attrs)) {
    const hasKey = findAttr(attrs, 'onKeyDown') !== undefined || findAttr(attrs, 'onKeyUp') !== undefined || findAttr(attrs, 'onKeyPress') !== undefined
    if (!hasKey)
      emitWarning(ctx, 'rgaa/click-without-key', element.start, `[rgaa/click-without-key] <${tag} onClick={...}> in ${ctx.filename} is not keyboard-accessible: use <button type="button">, or add onKeyDown/onKeyUp with an appropriate role and tabIndex.`, onClickAttr.start)
  }
}

function checkStructureAndIdentity(element: JSXElement, tag: string, spread: boolean, ctx: RgaaElementContext): void {
  const attrs = element.openingElement.attributes

  const idAttr = findAttr(attrs, 'id')
  const id = idAttr !== undefined ? staticStringValueOf(idAttr.value) : undefined
  if (id !== undefined && id !== '') {
    if (ctx.scope.seenIds.has(id))
      emitWarning(ctx, 'rgaa/duplicate-id', element.start, `[rgaa/duplicate-id] Duplicate id="${id}" on <${tag}> in ${ctx.filename}: every id in a document must be unique.`, idAttr!.start)
    else
      ctx.scope.seenIds.add(id)
  }

  const headingLevel = HEADING_LEVELS[tag]
  if (headingLevel !== undefined) {
    if (ctx.scope.lastHeading > 0 && headingLevel > ctx.scope.lastHeading + 1)
      emitWarning(ctx, 'rgaa/skipped-heading', element.start, `[rgaa/skipped-heading] <h${headingLevel}> in ${ctx.filename} skips heading level(s) after <h${ctx.scope.lastHeading}>: use <h${ctx.scope.lastHeading + 1}> to keep the heading hierarchy continuous.`)
    ctx.scope.lastHeading = headingLevel
  }

  if (tag === 'table' && !isPresentational(attrs) && !(element.children.length === 0 && spread) && !tableMayHaveHeader(element.children))
    emitWarning(ctx, 'rgaa/table-without-header', element.start, `[rgaa/table-without-header] <table> in ${ctx.filename} has no <th> header cell: add <th> headers or role="presentation" if used for layout.`)

  if (tag === 'fieldset' && !(element.children.length === 0 && spread) && !fieldsetMayHaveLegend(element.children, true))
    emitWarning(ctx, 'rgaa/fieldset-without-legend', element.start, `[rgaa/fieldset-without-legend] <fieldset> in ${ctx.filename} has no <legend>: add a <legend> child to label the form group.`)

  if (tag === 'meta') {
    const httpEquivAttr = findAttrLower(attrs, 'http-equiv') ?? findAttrLower(attrs, 'httpequiv')
    if (httpEquivAttr !== undefined && staticStringValueOf(httpEquivAttr.value)?.trim().toLowerCase() === 'refresh')
      emitWarning(ctx, 'rgaa/meta-refresh', element.start, `[rgaa/meta-refresh] <meta http-equiv="refresh"> in ${ctx.filename} redirects or reloads without user control: use an HTTP redirect or an explicit user action.`, httpEquivAttr.start)
  }
}

/** Runs all static RGAA JSX compliance checks on an intrinsic HTML element. */
export function checkRgaaElement(element: JSXElement, tag: string, ctx: RgaaElementContext): void {
  const attrs = element.openingElement.attributes
  const spread = hasSpread(attrs)

  if (tag === 'img' && !spread && findAttr(attrs, 'alt') === undefined)
    emitWarning(ctx, 'rgaa/img-alt', element.start, `[rgaa/img-alt] <img> in ${ctx.filename} is missing an alt attribute: add alt="description" or alt="" for decorative images.`)

  if ((tag === 'input' || tag === 'select' || tag === 'textarea') && !spread && !ctx.inLabel && !hasLabelAttr(attrs)) {
    const inputType = tag === 'input' ? staticStringValueOf(findAttr(attrs, 'type')?.value ?? null)?.toLowerCase() : undefined
    const idKey = attrTargetKey(findAttr(attrs, 'id'))
    const linked = idKey !== undefined && ctx.labelTargets.has(idKey)
    if ((inputType === undefined || !NON_LABELLED_INPUT_TYPES.has(inputType)) && !linked)
      emitWarning(ctx, 'rgaa/form-label', element.start, `[rgaa/form-label] <${tag}> in ${ctx.filename} has no associated label: wrap it in <label>, link <label for="id">, or add aria-label="..." / aria-labelledby="...".`)
  }

  if ((tag === 'button' || tag === 'a') && !spread && !hasLabelAttr(attrs) && !hasAccessibleName(element.children))
    emitWarning(ctx, 'rgaa/accessible-name', element.start, `[rgaa/accessible-name] <${tag}> in ${ctx.filename} has no accessible name: add visible text or aria-label="...".`)

  checkRoleAndAria(element, tag, ctx)
  checkFocusAndInteraction(element, tag, spread, ctx)
  checkStructureAndIdentity(element, tag, spread, ctx)
}
