// Static form validation for `prunelle check` and `prunelle build`:
// - Checks `<form action={fn}>` fields against the action's Standard Schema JSON Schema (unknown fields, missing required fields, `<select>` enum options)
// - Warns once per schema vendor lacking JSON Schema output
// - Warns on unguarded public form actions without `protect` / `rateLimit` / `_middleware.ts`

import type { JSXAttribute, JSXElement, Node, Program } from 'oxc-parser'
import type { ModuleGraph } from '../build/graph'
import type { ModuleAnalysis } from '../compiler/analyze'
import type { ServerAction } from '../server/action'
import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { isInNodeModules, isTsFile, relPosix } from '../build/files'
import { isInside } from '../build/is-inside'
import { resolvePrunelleSpecifier } from '../build/resolve'
import { walk } from '../compiler/ast'
import { calleeName, formatDiagnostic, formatLoc, isComponentTag, jsxTagName, resolvePrunelleTag, unwrapTsExpr } from '../compiler/shared'
import { staticLiteralOrTemplate, staticOptionText } from '../compiler/ssr-helpers'
import { closestName } from '../plugins/config'
import { isServerAction } from '../server/action'
import { FORM_TIMESTAMP_FIELD, honeypotFieldName } from '../server/action-protect'
import { extractFormSchema, lookupFieldConstraint } from '../server/form-schema'

export interface FormCheckInput {
  root: string
  routesDir: string
  routeFiles: readonly string[]
  graph: ModuleGraph
  /** Optional pre-read source map (falls back to `graph.source(file)`). */
  sources?: ReadonlyMap<string, string> | undefined
}

export interface FormCheckResult {
  errors: string[]
  warnings: string[]
}

interface ActionRef {
  file: string
  exportName: string
}

interface SelectOptionInfo {
  value: string
  offset: number
}

interface CollectedField {
  name: string
  tag: string
  offset: number
  options?: SelectOptionInfo[] | undefined
}

interface CollectedForm {
  action: ActionRef
  offset: number
  fields: CollectedField[]
  hasOpaqueFields: boolean
}

const PRUNELLE_SPECIFIER_RE = /^prunelle(?:\/|$)/

async function tryDirectImport(file: string, hash: string): Promise<Record<string, unknown> | undefined> {
  try {
    return await import(`${file}?pru-form=${hash}`) as Record<string, unknown>
  }
  catch {
    return undefined
  }
}

async function loadActionModule(file: string, cache: Map<string, Record<string, unknown> | null>): Promise<Record<string, unknown> | undefined> {
  if (cache.has(file))
    return cache.get(file) ?? undefined

  let hash = '0'
  try {
    hash = Bun.hash(readFileSync(file)).toString(36)
  }
  catch {
    cache.set(file, null)
    return undefined
  }

  const direct = await tryDirectImport(file, hash)
  if (direct !== undefined) {
    cache.set(file, direct)
    return direct
  }

  try {
    const built = await Bun.build({
      entrypoints: [file],
      target: 'bun',
      plugins: [{
        name: 'prunelle-form-check-resolve',
        setup(b) {
          b.onResolve({ filter: PRUNELLE_SPECIFIER_RE }, (args) => {
            const resolved = resolvePrunelleSpecifier(args.path)
            return resolved !== undefined ? { path: resolved, external: true } : undefined
          })
        },
      }],
    })
    const output = built.outputs[0]
    if (!built.success || output === undefined) {
      cache.set(file, null)
      return undefined
    }
    const js = await output.text()
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js, 'utf8').toString('base64')}`) as Record<string, unknown>
    cache.set(file, mod)
    return mod
  }
  catch {
    cache.set(file, null)
    return undefined
  }
}

function isExportedAction(graph: ModuleGraph, target: ActionRef): boolean {
  const analysis = graph.analyses.get(target.file)
  return analysis !== undefined && analysis.exportedActions.includes(target.exportName)
}

interface ModuleActionResolver {
  resolveExpr(node: Node): ActionRef | undefined
}

function safeExportTarget(graph: ModuleGraph, file: string, exportName: string, depth = 0): ActionRef {
  const analysis = depth > 16 ? undefined : graph.analyses.get(file)
  if (analysis === undefined)
    return { file, exportName }
  const direct = analysis.reexports.find(r => r.exported === exportName)
  if (direct !== undefined) {
    const next = graph.resolve(file, direct.source)
    if (next !== undefined && isTsFile(next))
      return safeExportTarget(graph, next, direct.local, depth + 1)
  }
  if (analysis.exportedNames.includes(exportName) || exportName === 'default')
    return { file, exportName }
  for (const re of analysis.reexports) {
    if (re.exported !== '*')
      continue
    const next = graph.resolve(file, re.source)
    if (next !== undefined && isTsFile(next) && graph.analyses.has(next)) {
      const resolved = safeExportTarget(graph, next, exportName, depth + 1)
      if (graph.analyses.get(resolved.file)?.exportedNames.includes(resolved.exportName))
        return resolved
    }
  }
  return { file, exportName }
}

function createActionResolver(file: string, analysis: ModuleAnalysis, graph: ModuleGraph): ModuleActionResolver {
  const directActions = new Map<string, ActionRef>()
  const namespaceImports = new Map<string, string>()
  const useActionVars = new Map<string, ActionRef>()
  const useActionCallees = new Set<string>()
  const prunelleNamespaces = new Set<string>()

  for (const name of analysis.exportedActions)
    directActions.set(name, { file, exportName: name })

  for (const imp of analysis.imports) {
    if (imp.source === 'prunelle') {
      for (const spec of imp.specifiers) {
        if (spec.imported === 'useAction')
          useActionCallees.add(spec.local)
        else if (spec.imported === '*')
          prunelleNamespaces.add(spec.local)
      }
      continue
    }
    const target = graph.resolve(file, imp.source)
    if (target === undefined || !isTsFile(target) || !graph.analyses.has(target))
      continue
    for (const spec of imp.specifiers) {
      if (spec.imported === '*') {
        namespaceImports.set(spec.local, target)
        continue
      }
      const resolved = safeExportTarget(graph, target, spec.imported)
      if (isExportedAction(graph, resolved))
        directActions.set(spec.local, resolved)
    }
  }

  const resolveBase = (node: Node): ActionRef | undefined => {
    const inner = unwrapTsExpr(node)
    if (inner.type === 'Identifier')
      return directActions.get(inner.name)
    if (inner.type === 'MemberExpression' && !inner.computed && inner.object.type === 'Identifier' && inner.property.type === 'Identifier') {
      if (inner.property.name === 'action' && useActionVars.has(inner.object.name))
        return useActionVars.get(inner.object.name)
      const nsFile = namespaceImports.get(inner.object.name)
      if (nsFile !== undefined) {
        const resolved = safeExportTarget(graph, nsFile, inner.property.name)
        if (isExportedAction(graph, resolved))
          return resolved
      }
    }
    return undefined
  }

  const isUseActionCall = (node: Node): boolean => {
    if (node.type !== 'CallExpression')
      return false
    const name = calleeName(node.callee)
    return useActionCallees.has(name) || (name.endsWith('.useAction') && prunelleNamespaces.has(name.slice(0, -'.useAction'.length)))
  }

  walk(analysis.program, (node) => {
    if (node.type !== 'VariableDeclarator' || node.init === null)
      return
    const init = unwrapTsExpr(node.init)
    if (isUseActionCall(init) && init.type === 'CallExpression' && init.arguments.length >= 1) {
      const arg = init.arguments[0]
      if (arg === undefined || arg.type === 'SpreadElement')
        return
      const target = resolveBase(arg)
      if (target === undefined)
        return
      if (node.id.type === 'Identifier') {
        useActionVars.set(node.id.name, target)
      }
      else if (node.id.type === 'ObjectPattern') {
        for (const prop of node.id.properties) {
          if (prop.type === 'Property' && !prop.computed && prop.key.type === 'Identifier' && prop.key.name === 'action' && prop.value.type === 'Identifier')
            directActions.set(prop.value.name, target)
        }
      }
      return
    }
    if (node.id.type === 'Identifier') {
      const ref = resolveBase(init)
      if (ref !== undefined)
        directActions.set(node.id.name, ref)
    }
  })

  return { resolveExpr: resolveBase }
}

function findAttr(attrs: readonly JSXElement['openingElement']['attributes'][number][], name: string): JSXAttribute | undefined {
  for (const attr of attrs) {
    if (attr.type === 'JSXAttribute' && jsxTagName(attr.name).toLowerCase() === name)
      return attr
  }
  return undefined
}

function resolveStaticStringAttr(attr: JSXAttribute | undefined, propBindings: ReadonlyMap<string, string>): { known: true, value: string } | { known: false } {
  if (attr === undefined || attr.value === null)
    return { known: false }
  if (attr.value.type === 'Literal' && typeof attr.value.value === 'string')
    return { known: true, value: attr.value.value }
  if (attr.value.type === 'JSXExpressionContainer' && attr.value.expression.type !== 'JSXEmptyExpression') {
    const expr = unwrapTsExpr(attr.value.expression)
    const lit = staticLiteralOrTemplate(expr)
    if (lit.ok && typeof lit.value === 'string')
      return { known: true, value: lit.value }
    if (expr.type === 'Identifier' && propBindings.has(expr.name))
      return { known: true, value: propBindings.get(expr.name)! }
    if (expr.type === 'MemberExpression' && !expr.computed && expr.object.type === 'Identifier' && expr.property.type === 'Identifier' && propBindings.has(expr.property.name))
      return { known: true, value: propBindings.get(expr.property.name)! }
  }
  return { known: false }
}

function findLocalComponentNode(program: Program, localName: string): Node | undefined {
  for (const stmt of program.body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name === localName)
      return stmt
    if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        if (d.id.type === 'Identifier' && d.id.name === localName && d.init !== null)
          return unwrapTsExpr(d.init)
      }
    }
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration !== null) {
      const decl = stmt.declaration
      if (decl.type === 'FunctionDeclaration' && decl.id?.name === localName)
        return decl
      if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (d.id.type === 'Identifier' && d.id.name === localName && d.init !== null)
            return unwrapTsExpr(d.init)
        }
      }
    }
    if (stmt.type === 'ExportDefaultDeclaration' && localName === 'default')
      return unwrapTsExpr(stmt.declaration)
  }
  return undefined
}

function resolveComponentTarget(
  tag: string,
  file: string,
  analysis: ModuleAnalysis,
  graph: ModuleGraph,
): { file: string, node: Node, key: string } | undefined {
  const local = findLocalComponentNode(analysis.program, tag)
  if (local !== undefined)
    return { file, node: local, key: `${file}\0${tag}` }

  const dotIdx = tag.indexOf('.')
  for (const imp of analysis.imports) {
    const targetFile = graph.resolve(file, imp.source)
    if (targetFile === undefined || !isTsFile(targetFile) || !graph.analyses.has(targetFile))
      continue
    for (const spec of imp.specifiers) {
      let exported: string | undefined
      if (dotIdx === -1 && spec.local === tag && spec.imported !== '*')
        exported = spec.imported
      else if (dotIdx !== -1 && spec.imported === '*' && spec.local === tag.slice(0, dotIdx))
        exported = tag.slice(dotIdx + 1)
      if (exported === undefined)
        continue
      const resolved = graph.exportTarget(targetFile, exported)
      const targetAnalysis = graph.analyses.get(resolved.file)
      if (targetAnalysis === undefined)
        continue
      const localName = targetAnalysis.exportLocals.get(resolved.exportName) ?? resolved.exportName
      const fnNode = findLocalComponentNode(targetAnalysis.program, localName)
      if (fnNode !== undefined)
        return { file: resolved.file, node: fnNode, key: `${resolved.file}\0${localName}` }
    }
  }
  return undefined
}

function collectSelectOptions(selectEl: JSXElement): SelectOptionInfo[] {
  const options: SelectOptionInfo[] = []
  walk(selectEl.children, (node) => {
    if (node.type !== 'JSXElement')
      return undefined
    const tag = jsxTagName(node.openingElement.name)
    if (tag === 'select')
      return false
    if (tag !== 'option')
      return undefined
    const valueAttr = findAttr(node.openingElement.attributes, 'value')
    if (valueAttr !== undefined) {
      if (valueAttr.value?.type === 'Literal' && typeof valueAttr.value.value === 'string')
        options.push({ value: valueAttr.value.value, offset: valueAttr.start })
      else if (valueAttr.value?.type === 'JSXExpressionContainer' && valueAttr.value.expression.type !== 'JSXEmptyExpression') {
        const lit = staticLiteralOrTemplate(valueAttr.value.expression)
        if (lit.ok && (typeof lit.value === 'string' || typeof lit.value === 'number'))
          options.push({ value: String(lit.value), offset: valueAttr.start })
      }
      return false
    }
    const text = staticOptionText(node.children)
    if (text !== undefined)
      options.push({ value: text, offset: node.start })
    return false
  })
  return options
}

function collectFormFields(formNode: JSXElement, rootFile: string, graph: ModuleGraph): { fields: CollectedField[], hasOpaqueFields: boolean } {
  const fields: CollectedField[] = []
  let hasOpaqueFields = false

  const visitTree = (
    target: Node | readonly Node[],
    file: string,
    propBindings: ReadonlyMap<string, string>,
    visited: ReadonlySet<string>,
  ): void => {
    const analysis = graph.analyses.get(file)
    if (analysis === undefined)
      return

    walk(target, (node) => {
      if (node.type !== 'JSXElement')
        return undefined
      const tag = jsxTagName(node.openingElement.name)
      if (tag === 'form')
        return false

      if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button') {
        const attrs = node.openingElement.attributes
        const nameAttr = findAttr(attrs, 'name')
        const hasSpread = attrs.some(a => a.type === 'JSXSpreadAttribute')
        if (tag === 'button') {
          if (nameAttr === undefined)
            return undefined
          const typeVal = resolveStaticStringAttr(findAttr(attrs, 'type'), propBindings)
          if (typeVal.known && (typeVal.value.toLowerCase() === 'button' || typeVal.value.toLowerCase() === 'reset'))
            return undefined
        }
        if (nameAttr === undefined) {
          if (hasSpread && tag !== 'button')
            hasOpaqueFields = true
          return undefined
        }
        const resolvedName = resolveStaticStringAttr(nameAttr, propBindings)
        if (!resolvedName.known) {
          hasOpaqueFields = true
          return undefined
        }
        if (resolvedName.value !== '') {
          fields.push({
            name: resolvedName.value,
            tag,
            offset: nameAttr.start,
            ...(tag === 'select' ? { options: collectSelectOptions(node) } : {}),
          })
        }
        return tag === 'select' ? false : undefined
      }

      if (isComponentTag(tag)) {
        if (node.children.length > 0)
          visitTree(node.children, file, propBindings, visited)
        if (resolvePrunelleTag(tag, analysis.imports) !== undefined)
          return false
        const resolved = resolveComponentTarget(tag, file, analysis, graph)
        if (resolved === undefined) {
          hasOpaqueFields = true
          return false
        }
        if (visited.has(resolved.key))
          return false
        const nextBindings = new Map<string, string>()
        for (const attr of node.openingElement.attributes) {
          if (attr.type !== 'JSXAttribute')
            continue
          const val = resolveStaticStringAttr(attr, propBindings)
          if (val.known)
            nextBindings.set(jsxTagName(attr.name), val.value)
        }
        const nextVisited = new Set(visited)
        nextVisited.add(resolved.key)
        visitTree(resolved.node, resolved.file, nextBindings, nextVisited)
        return false
      }

      return undefined
    })
  }

  visitTree(formNode.children, rootFile, new Map(), new Set())
  return { fields, hasOpaqueFields }
}

function collectModuleForms(file: string, analysis: ModuleAnalysis, graph: ModuleGraph): CollectedForm[] {
  const resolver = createActionResolver(file, analysis, graph)
  const forms: CollectedForm[] = []

  walk(analysis.program, (node) => {
    if (node.type !== 'JSXElement' || jsxTagName(node.openingElement.name) !== 'form')
      return undefined
    const actionAttr = findAttr(node.openingElement.attributes, 'action')
    if (actionAttr?.value?.type !== 'JSXExpressionContainer' || actionAttr.value.expression.type === 'JSXEmptyExpression')
      return undefined
    const actionRef = resolver.resolveExpr(actionAttr.value.expression)
    if (actionRef === undefined)
      return undefined
    const { fields, hasOpaqueFields } = collectFormFields(node, file, graph)
    forms.push({ action: actionRef, offset: node.start, fields, hasOpaqueFields })
    return undefined
  })

  return forms
}

function buildMiddlewareLookup(routesDir: string, routeFiles: readonly string[], graph: ModuleGraph) {
  const middlewareDirs = new Set<string>()
  const pageRouteSet = new Set<string>()
  for (const file of routeFiles) {
    if (basename(file) === '_middleware.ts') {
      middlewareDirs.add(dirname(file))
    }
    else if (!basename(file).startsWith('_') && graph.analyses.get(file)?.exportedNames.includes('default')) {
      pageRouteSet.add(file)
    }
  }

  const hasAncestorMiddleware = (file: string): boolean => {
    if (!isInside(routesDir, file))
      return false
    let dir = dirname(file)
    while (true) {
      if (middlewareDirs.has(dir))
        return true
      if (dir === routesDir)
        return false
      const parent = dirname(dir)
      if (parent === dir || !isInside(routesDir, parent, { orSame: true }))
        return false
      dir = parent
    }
  }

  const importers = new Map<string, Set<string>>()
  for (const file of graph.analyses.keys()) {
    for (const dep of graph.localDeps(file)) {
      let set = importers.get(dep)
      if (set === undefined) {
        set = new Set()
        importers.set(dep, set)
      }
      set.add(file)
    }
  }

  const isOnPublicPage = (file: string): boolean => {
    const seen = new Set<string>([file])
    const queue = [file]
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]!
      if (pageRouteSet.has(cur) && !hasAncestorMiddleware(cur))
        return true
      for (const parent of importers.get(cur) ?? []) {
        if (!seen.has(parent)) {
          seen.add(parent)
          queue.push(parent)
        }
      }
    }
    return false
  }

  return { hasAncestorMiddleware, isOnPublicPage }
}

function checkFormAgainstAction(
  form: CollectedForm,
  act: ServerAction<unknown, unknown>,
  locAt: (offset: number) => string,
  warnedVendors: Set<string>,
  errors: string[],
  warnings: string[],
): void {
  const { exportName } = form.action
  if (act.schema === undefined)
    return

  const extracted = extractFormSchema(act.schema)
  if (!extracted.ok) {
    if (!warnedVendors.has(extracted.vendor)) {
      warnedVendors.add(extracted.vendor)
      warnings.push(formatDiagnostic(
        locAt(form.offset),
        `[form/schema-unsupported] Action "${exportName}" uses a "${extracted.vendor}" schema that has no JSON Schema output; form field checks skipped.`,
        'warning',
      ))
    }
    return
  }

  const hpField = honeypotFieldName(act.protect)
  const knownFields = [...extracted.fields.keys()]
  const checkUnknown = extracted.fields.size > 0 || extracted.jsonSchema.additionalProperties === false
  const sentFields = new Set<string>()

  for (const field of form.fields) {
    if (field.name === FORM_TIMESTAMP_FIELD || (hpField !== undefined && field.name === hpField))
      continue
    const normalized = field.name.endsWith('[]') ? field.name.slice(0, -2) : field.name
    sentFields.add(field.name)
    sentFields.add(normalized)

    const constraint = lookupFieldConstraint(extracted.fields, field.name)
    if (constraint === undefined && checkUnknown) {
      const near = closestName(normalized, knownFields)
      const hint = near !== undefined
        ? `did you mean "${near}"?`
        : knownFields.length > 0 ? `known fields: ${knownFields.join(', ')}.` : 'the schema accepts no fields.'
      errors.push(formatDiagnostic(
        locAt(field.offset),
        `[form/unknown-field] Form field "${field.name}" does not exist on action "${exportName}"'s schema: ${hint}`,
        'error',
      ))
      continue
    }

    if (field.options !== undefined && constraint?.enumValues !== undefined && constraint.enumValues.length > 0) {
      const allowed = new Set(constraint.enumValues)
      for (const opt of field.options) {
        if (opt.value === '' || allowed.has(opt.value))
          continue
        warnings.push(formatDiagnostic(
          locAt(opt.offset),
          `[form/invalid-option] <option value="${opt.value}"> on <select name="${field.name}"> is not allowed by action "${exportName}"'s schema (allowed: ${constraint.enumValues.join(', ')}).`,
          'warning',
        ))
      }
    }
  }

  if (!form.hasOpaqueFields) {
    const sentList = [...sentFields]
    for (const reqField of extracted.required) {
      if (sentFields.has(reqField))
        continue
      const near = closestName(reqField, sentList)
      const hint = near !== undefined ? ` (found "${near}")` : ''
      errors.push(formatDiagnostic(
        locAt(form.offset),
        `[form/missing-field] Form bound to action "${exportName}" never sends required schema field "${reqField}"${hint}.`,
        'error',
      ))
    }
  }
}

/** Checks every `<form action={fn}>` across the app against its action's schema and public protection config. */
export async function checkAppForms(input: FormCheckInput): Promise<FormCheckResult> {
  const { root, routesDir, routeFiles, graph, sources } = input
  const errors: string[] = []
  const warnings: string[] = []
  const moduleCache = new Map<string, Record<string, unknown> | null>()
  const warnedVendors = new Set<string>()
  const { hasAncestorMiddleware, isOnPublicPage } = buildMiddlewareLookup(routesDir, routeFiles, graph)

  const sourceOf = (file: string): string => sources?.get(file) ?? graph.source(file)

  for (const [file, analysis] of graph.analyses) {
    if (isInNodeModules(file) || !file.endsWith('.tsx') || !analysis.hasJsx)
      continue
    const forms = collectModuleForms(file, analysis, graph)
    if (forms.length === 0)
      continue

    const rel = relPosix(root, file)
    const code = sourceOf(file)
    const locAt = (offset: number): string => formatLoc(rel, code, offset)
    const publicPage = isOnPublicPage(file)

    for (const form of forms) {
      const mod = await loadActionModule(form.action.file, moduleCache)
      const act = mod?.[form.action.exportName]
      if (!isServerAction(act))
        continue

      checkFormAgainstAction(form, act, locAt, warnedVendors, errors, warnings)

      if (publicPage && !hasAncestorMiddleware(form.action.file) && act.protect === undefined && act.rateLimit === undefined) {
        warnings.push(formatDiagnostic(
          locAt(form.offset),
          `[action/unguarded-public-form] Public form action "${form.action.exportName}" has no protection: add { protect: { rateLimit, honeypot, minTime } } to action() or guard it with _middleware.ts.`,
          'warning',
        ))
      }
    }
  }

  return { errors, warnings }
}
