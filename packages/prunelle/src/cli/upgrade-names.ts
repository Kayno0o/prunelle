// `prunelle upgrade`: renames what a file takes from a kay package, `KayPlugin` becoming `PrunellePlugin`, with every use of it.

import type { AstNode } from '../compiler/ast'
import { parseTsx } from '../compiler/analyze'
import { walk } from '../compiler/ast'
import { SourceEditor } from '../compiler/patch'

const KAY_SOURCE_RE = /^@kayjs\//
const REF_TYPES_RE = /^(\s*\/\/\/\s*<reference\s+types=)(["'])([^"']+)\2(\s*\/>)/gm

type Import = Extract<AstNode, { type: 'ImportDeclaration' }>
type Specifier = Extract<AstNode, { type: 'ImportSpecifier' }>

interface Binding {
  spec: Specifier
  renamed: string
  refs: AstNode[]
  /** Used where a rename would change more than the binding: a shorthand property or an export specifier. */
  pinned: boolean
}

/** What a name kay exported is called in prunelle, or undefined when it kept its name. */
export function prunelleName(name: string): string | undefined {
  const next = name.replace(/KAY/g, 'PRUNELLE').replace(/Kay/g, 'Prunelle').replace(/kay/g, 'prunelle')
  return next === name ? undefined : next
}

const nameOf = (node: { type: string, name?: string, value?: unknown }): string => node.type === 'Identifier' ? node.name! : String(node.value)

function resolveAlias(spec: string, aliases?: ReadonlyMap<string, string>): string | undefined {
  if (aliases === undefined || aliases.size === 0)
    return undefined
  for (const [alias, target] of aliases) {
    if (spec === alias)
      return target
    if (spec.startsWith(`${alias}/`))
      return `${target}${spec.slice(alias.length)}`
  }
  return undefined
}

function hasKaySourceHint(code: string, aliases?: ReadonlyMap<string, string>): boolean {
  if (code.includes('@kayjs/'))
    return true
  if (aliases === undefined || aliases.size === 0)
    return false
  for (const alias of aliases.keys()) {
    if (code.includes(alias))
      return true
  }
  return false
}

function rewriteTripleSlash(code: string, aliases?: ReadonlyMap<string, string>): string {
  if (aliases === undefined || aliases.size === 0 || !code.includes('<reference'))
    return code
  return code.replace(REF_TYPES_RE, (full, pre: string, quote: string, spec: string, post: string) => {
    const target = resolveAlias(spec, aliases)
    return target === undefined ? full : `${pre}${quote}${target}${quote}${post}`
  })
}

/** Rewrites the names `code` imports from `@kayjs/*` (and any npm aliases in `aliases`), plus alias module specifiers, run before `@kayjs/*` specifiers are renamed. */
export function renameKayNames(file: string, code: string, aliases?: ReadonlyMap<string, string>): string {
  if (!hasKaySourceHint(code, aliases))
    return code
  const program = parseTsx(file, code)
  const editor = new SourceEditor(code)
  const bindings = new Map<string, Binding>()
  const namespaces = new Set<string>()
  const skipped = new Set<number>()
  const patchedSources = new Set<number>()
  const fromKay = (source: { value?: unknown } | null | undefined): boolean =>
    typeof source?.value === 'string' && (KAY_SOURCE_RE.test(source.value) || resolveAlias(source.value, aliases) !== undefined)
  const rewriteSource = (source: { start: number, end: number, value?: unknown } | null | undefined): void => {
    if (source === null || source === undefined || typeof source.value !== 'string' || patchedSources.has(source.start))
      return
    const target = resolveAlias(source.value, aliases)
    if (target === undefined)
      return
    patchedSources.add(source.start)
    editor.replace(source.start + 1, source.end - 1, target)
  }
  const rename = (node: AstNode): void => {
    const renamed = node.type === 'Identifier' || node.type === 'JSXIdentifier' ? prunelleName(node.name) : undefined
    if (renamed !== undefined)
      editor.replace(node.start, node.end, renamed)
    skipped.add(node.start)
  }
  for (const stmt of program.body) {
    if (stmt.type === 'ImportDeclaration' && fromKay(stmt.source))
      collectImport(stmt, bindings, namespaces)
    if (stmt.type === 'TSModuleDeclaration' && stmt.id.type === 'Literal') {
      rewriteSource(stmt.id)
      if (fromKay(stmt.id))
        renameAugmented(stmt.body, rename)
    }
  }

  const names = new Set<string>()
  const pin = (name: string): void => {
    const binding = bindings.get(name)
    if (binding !== undefined)
      binding.pinned = true
  }
  walk(program.body, (node) => {
    if (node.type === 'ImportDeclaration') {
      rewriteSource(node.source)
      return false
    }
    if (node.type === 'ExportNamedDeclaration' && node.source !== null) {
      rewriteSource(node.source)
      if (fromKay(node.source))
        reexport(node.specifiers, editor)
      return false
    }
    if (node.type === 'ExportAllDeclaration') {
      rewriteSource(node.source)
      return false
    }
    if (node.type === 'ImportExpression' && node.source.type === 'Literal')
      rewriteSource(node.source)
    // Every keyed node (property, method, class field, type member) names its key, which is no reference.
    const keyed = node as AstNode & { key?: AstNode & { type: string, name?: string }, computed?: boolean, shorthand?: boolean }
    if (keyed.key !== undefined && keyed.computed === false) {
      if (keyed.shorthand === true)
        pin(nameOf(keyed.key))
      skipped.add(keyed.key.start)
    }
    if (node.type === 'MemberExpression' && !node.computed)
      skipped.add(node.property.start)
    if (node.type === 'TSQualifiedName' || node.type === 'JSXMemberExpression') {
      const left = node.type === 'TSQualifiedName' ? node.left : node.object
      const right = node.type === 'TSQualifiedName' ? node.right : node.property
      if ((left.type === 'Identifier' || left.type === 'JSXIdentifier') && namespaces.has(left.name))
        rename(right)
      skipped.add(right.start)
    }
    if (node.type === 'TSImportType') {
      rewriteSource(node.source)
      if (fromKay(node.source) && node.qualifier !== null) {
        let head: AstNode = node.qualifier
        while (head.type === 'TSQualifiedName')
          head = head.left
        rename(head)
      }
    }
    if (node.type === 'ExportSpecifier')
      pin(nameOf(node.local))
    if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
      names.add(node.name)
      if (!skipped.has(node.start))
        bindings.get(node.name)?.refs.push(node)
    }
    return true
  })

  // An aliased import keeps its alias; a name already taken in the file, or one a rename would change outside it, keeps its old one as an alias.
  for (const [local, binding] of bindings) {
    if (local !== nameOf(binding.spec.imported)) {
      editor.replace(binding.spec.imported.start, binding.spec.imported.end, binding.renamed)
      continue
    }
    if (binding.pinned || names.has(binding.renamed)) {
      editor.replace(binding.spec.imported.start, binding.spec.imported.end, `${binding.renamed} as ${local}`)
      continue
    }
    editor.replace(binding.spec.imported.start, binding.spec.imported.end, binding.renamed)
    for (const ref of binding.refs)
      editor.replace(ref.start, ref.end, binding.renamed)
  }
  return rewriteTripleSlash(editor.toString(), aliases)
}

function collectImport(stmt: Import, bindings: Map<string, Binding>, namespaces: Set<string>): void {
  for (const spec of stmt.specifiers) {
    if (spec.type === 'ImportNamespaceSpecifier')
      namespaces.add(spec.local.name)
    if (spec.type !== 'ImportSpecifier')
      continue
    const renamed = prunelleName(nameOf(spec.imported))
    if (renamed !== undefined)
      bindings.set(spec.local.name, { spec, renamed, refs: [], pinned: false })
  }
}

// `declare module '@kayjs/kay/server' { interface KayLocals {} }` augments what prunelle now calls `PrunelleLocals`.
function renameAugmented(body: AstNode | null | undefined, rename: (node: AstNode) => void): void {
  if (body?.type !== 'TSModuleBlock')
    return
  for (const stmt of body.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt
    if (decl?.type === 'TSInterfaceDeclaration' || decl?.type === 'TSTypeAliasDeclaration')
      rename(decl.id)
  }
}

// What the app re-exports keeps its name for the files importing it: `export { KayPlugin }` becomes `export { PrunellePlugin as KayPlugin }`.
function reexport(specifiers: readonly AstNode[], editor: SourceEditor): void {
  for (const spec of specifiers) {
    if (spec.type !== 'ExportSpecifier')
      continue
    const renamed = prunelleName(nameOf(spec.local))
    if (renamed === undefined)
      continue
    const aliased = spec.exported.start !== spec.local.start
    editor.replace(spec.local.start, spec.local.end, aliased ? renamed : `${renamed} as ${nameOf(spec.exported)}`)
  }
}
