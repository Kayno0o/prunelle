// Extracts per-field HTML5 constraints and known field names from Standard Schema JSON Schema output.

import type { StandardSchemaV1 } from './standard-schema'

export interface FieldConstraint {
  required?: boolean | undefined
  type?: 'email' | 'url' | 'number' | undefined
  minLength?: number | undefined
  maxLength?: number | undefined
  min?: number | undefined
  max?: number | undefined
  step?: number | 'any' | undefined
  pattern?: string | undefined
  enumValues?: readonly string[] | undefined
  isArray?: boolean | undefined
}

export type ExtractedFormSchema =
  | {
      ok: true
      fields: ReadonlyMap<string, FieldConstraint>
      required: ReadonlySet<string>
      jsonSchema: Record<string, unknown>
    }
  | {
      ok: false
      vendor: string
    }

interface JsonSchemaCapable {
  '~standard'?: {
    vendor?: unknown
    jsonSchema?: {
      input?: (opts: { target: string }) => Record<string, unknown>
    } | undefined
  } | undefined
  toJSONSchema?: (() => Record<string, unknown>) | undefined
  jsonSchema?: Record<string, unknown> | undefined
}

const SAFE_INT_MIN = Number.MIN_SAFE_INTEGER
const SAFE_INT_MAX = Number.MAX_SAFE_INTEGER
const schemaCache = new WeakMap<StandardSchemaV1, ExtractedFormSchema>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readRawJsonSchema(schema: StandardSchemaV1): Record<string, unknown> | undefined {
  const candidate = schema as unknown as JsonSchemaCapable
  const stdJson = candidate['~standard']?.jsonSchema
  if (stdJson !== undefined && typeof stdJson.input === 'function') {
    for (const target of ['draft-2020-12', 'draft-07']) {
      try {
        const out = stdJson.input({ target })
        if (isRecord(out))
          return out
      }
      catch {
        continue
      }
    }
  }
  if (typeof candidate.toJSONSchema === 'function') {
    try {
      const out = candidate.toJSONSchema()
      if (isRecord(out))
        return out
    }
    catch {
      return undefined
    }
  }
  if (isRecord(candidate.jsonSchema))
    return candidate.jsonSchema
  return undefined
}

function resolveRef(node: Record<string, unknown>, root: Record<string, unknown>, seen: Set<string>): Record<string, unknown> {
  const ref = node.$ref
  if (typeof ref !== 'string' || !ref.startsWith('#/') || seen.has(ref))
    return node
  seen.add(ref)
  const segments = ref.slice(2).split('/').map(s => s.replaceAll('~1', '/').replaceAll('~0', '~'))
  let cur: unknown = root
  for (const seg of segments) {
    if (!isRecord(cur) || !Object.hasOwn(cur, seg))
      return node
    cur = cur[seg]
  }
  return isRecord(cur) ? resolveRef(cur, root, seen) : node
}

function isNullSchema(node: Record<string, unknown>): boolean {
  return node.type === 'null' || (Array.isArray(node.enum) && node.enum.length === 1 && node.enum[0] === null)
}

function collectEnumValues(node: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(node.enum)) {
    const vals = node.enum.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String)
    return vals.length > 0 ? vals : undefined
  }
  if (typeof node.const === 'string' || typeof node.const === 'number')
    return [String(node.const)]
  return undefined
}

function branchSpecificity(branch: Record<string, unknown>): number {
  if (branch.type === 'number' || branch.type === 'integer')
    return 4
  if (branch.format === 'email' || branch.format === 'idn-email' || branch.format === 'uri' || branch.format === 'url')
    return 3
  if (branch.enum !== undefined || branch.const !== undefined)
    return 2
  if (branch.type === 'string' && (branch.minLength !== undefined || branch.maxLength !== undefined || branch.pattern !== undefined))
    return 2
  if (branch.type === 'array' || branch.type === 'object')
    return 2
  return 1
}

function unwrapUnion(node: Record<string, unknown>, root: Record<string, unknown>): { primary: Record<string, unknown>, unionEnums?: string[] | undefined } {
  const rawList = Array.isArray(node.anyOf) ? node.anyOf : Array.isArray(node.oneOf) ? node.oneOf : undefined
  if (rawList === undefined || rawList.length === 0)
    return { primary: node }

  const branches = rawList
    .filter(isRecord)
    .map(b => resolveRef(b, root, new Set()))
    .filter(b => !isNullSchema(b))

  if (branches.length === 0)
    return { primary: node }

  // Literal unions like `anyOf: [{ const: 'a' }, { const: 'b' }]`
  const literalVals: string[] = []
  let allLiterals = true
  for (const b of branches) {
    const vals = collectEnumValues(b)
    if (vals === undefined) {
      allLiterals = false
      break
    }
    literalVals.push(...vals)
  }
  if (allLiterals && literalVals.length > 0)
    return { primary: node, unionEnums: literalVals }

  let best = branches[0]!
  let bestScore = branchSpecificity(best)
  for (let i = 1; i < branches.length; i++) {
    const score = branchSpecificity(branches[i]!)
    if (score > bestScore) {
      best = branches[i]!
      bestScore = score
    }
  }
  return { primary: best }
}

function mergeAllOf(node: Record<string, unknown>, root: Record<string, unknown>): Record<string, unknown> {
  const resolved = resolveRef(node, root, new Set())
  if (!Array.isArray(resolved.allOf))
    return resolved
  const merged: Record<string, unknown> = { ...resolved }
  delete merged.allOf
  const props: Record<string, unknown> = isRecord(merged.properties) ? { ...merged.properties } : {}
  const req = new Set<string>(Array.isArray(merged.required) ? merged.required.filter((r): r is string => typeof r === 'string') : [])
  for (const entry of resolved.allOf) {
    if (!isRecord(entry))
      continue
    const sub = mergeAllOf(entry, root)
    if (isRecord(sub.properties)) {
      for (const [k, v] of Object.entries(sub.properties))
        props[k] = v
    }
    if (Array.isArray(sub.required)) {
      for (const r of sub.required) {
        if (typeof r === 'string')
          req.add(r)
      }
    }
    for (const [k, v] of Object.entries(sub)) {
      if (k !== 'properties' && k !== 'required' && merged[k] === undefined)
        merged[k] = v
    }
  }
  if (Object.keys(props).length > 0)
    merged.properties = props
  if (req.size > 0)
    merged.required = [...req]
  return merged
}

function applyNumericConstraints(node: Record<string, unknown>, isInteger: boolean, out: FieldConstraint): void {
  out.type = 'number'
  if (typeof node.multipleOf === 'number' && Number.isFinite(node.multipleOf) && node.multipleOf > 0)
    out.step = node.multipleOf
  else
    out.step = isInteger ? 1 : 'any'
  if (typeof node.minimum === 'number' && Number.isFinite(node.minimum) && node.minimum > SAFE_INT_MIN)
    out.min = node.minimum
  else if (typeof node.exclusiveMinimum === 'number' && Number.isFinite(node.exclusiveMinimum))
    out.min = isInteger ? node.exclusiveMinimum + 1 : node.exclusiveMinimum
  if (typeof node.maximum === 'number' && Number.isFinite(node.maximum) && node.maximum < SAFE_INT_MAX)
    out.max = node.maximum
  else if (typeof node.exclusiveMaximum === 'number' && Number.isFinite(node.exclusiveMaximum))
    out.max = isInteger ? node.exclusiveMaximum - 1 : node.exclusiveMaximum
}

function extractLeafConstraint(rawNode: Record<string, unknown>, root: Record<string, unknown>, required: boolean): FieldConstraint {
  const merged = mergeAllOf(rawNode, root)
  const { primary, unionEnums } = unwrapUnion(merged, root)
  const out: FieldConstraint = required ? { required: true } : {}

  const type = Array.isArray(primary.type)
    ? primary.type.find(t => t !== 'null')
    : primary.type

  if (type === 'array') {
    out.isArray = true
    if (isRecord(primary.items)) {
      const itemConstraint = extractLeafConstraint(primary.items, root, false)
      if (itemConstraint.type !== undefined)
        out.type = itemConstraint.type
      if (itemConstraint.minLength !== undefined)
        out.minLength = itemConstraint.minLength
      if (itemConstraint.maxLength !== undefined)
        out.maxLength = itemConstraint.maxLength
      if (itemConstraint.min !== undefined)
        out.min = itemConstraint.min
      if (itemConstraint.max !== undefined)
        out.max = itemConstraint.max
      if (itemConstraint.step !== undefined)
        out.step = itemConstraint.step
      if (itemConstraint.pattern !== undefined)
        out.pattern = itemConstraint.pattern
      if (itemConstraint.enumValues !== undefined)
        out.enumValues = itemConstraint.enumValues
    }
    return out
  }

  const format = typeof primary.format === 'string' ? primary.format.toLowerCase() : undefined
  if (format === 'email' || format === 'idn-email')
    out.type = 'email'
  else if (format === 'uri' || format === 'url' || format === 'iri')
    out.type = 'url'
  else if (type === 'integer' || type === 'number')
    applyNumericConstraints(primary, type === 'integer', out)

  if (typeof primary.minLength === 'number' && Number.isFinite(primary.minLength) && primary.minLength > 0)
    out.minLength = Math.trunc(primary.minLength)
  if (typeof primary.maxLength === 'number' && Number.isFinite(primary.maxLength) && primary.maxLength >= 0 && primary.maxLength < SAFE_INT_MAX)
    out.maxLength = Math.trunc(primary.maxLength)
  if (typeof primary.pattern === 'string' && primary.pattern.length > 0)
    out.pattern = primary.pattern

  const enums = unionEnums ?? collectEnumValues(primary)
  if (enums !== undefined)
    out.enumValues = enums

  return out
}

function walkObjectSchema(
  node: Record<string, unknown>,
  root: Record<string, unknown>,
  prefix: string,
  parentRequired: boolean,
  fields: Map<string, FieldConstraint>,
  requiredSet: Set<string>,
  depth = 0,
): void {
  if (depth > 8)
    return
  const merged = mergeAllOf(node, root)
  const { primary } = unwrapUnion(merged, root)
  if (!isRecord(primary.properties))
    return

  const ownRequired = new Set<string>(
    Array.isArray(primary.required) ? primary.required.filter((r): r is string => typeof r === 'string') : [],
  )

  for (const [key, propSchema] of Object.entries(primary.properties)) {
    const path = prefix !== '' ? `${prefix}.${key}` : key
    const isReq = parentRequired && ownRequired.has(key)
    if (!isRecord(propSchema)) {
      fields.set(path, isReq ? { required: true } : {})
      if (isReq)
        requiredSet.add(path)
      continue
    }
    const resolved = mergeAllOf(propSchema, root)
    const { primary: propPrimary } = unwrapUnion(resolved, root)
    if (isRecord(propPrimary.properties) && Object.keys(propPrimary.properties).length > 0) {
      walkObjectSchema(propPrimary, root, path, isReq, fields, requiredSet, depth + 1)
      continue
    }
    const constraint = extractLeafConstraint(propSchema, root, isReq)
    fields.set(path, constraint)
    if (isReq)
      requiredSet.add(path)
  }
}

/** Looks up a form field constraint by HTML `name`, normalizing `name[]` array notation. */
export function lookupFieldConstraint(
  fields: ReadonlyMap<string, FieldConstraint>,
  name: string,
): FieldConstraint | undefined {
  const direct = fields.get(name)
  if (direct !== undefined)
    return direct
  if (name.endsWith('[]'))
    return fields.get(name.slice(0, -2))
  return undefined
}

/** Extracts HTML5 form constraints and required field names from a Standard Schema (cached per schema instance). */
export function extractFormSchema(schema: StandardSchemaV1): ExtractedFormSchema {
  const cached = schemaCache.get(schema)
  if (cached !== undefined)
    return cached

  const raw = readRawJsonSchema(schema)
  if (raw === undefined) {
    const rawVendor = (schema as unknown as JsonSchemaCapable)['~standard']?.vendor
    const vendor = typeof rawVendor === 'string' && rawVendor.trim() !== '' ? rawVendor : 'unknown'
    const result: ExtractedFormSchema = { ok: false, vendor }
    schemaCache.set(schema, result)
    return result
  }

  const fields = new Map<string, FieldConstraint>()
  const required = new Set<string>()
  walkObjectSchema(raw, raw, '', true, fields, required)

  const result: ExtractedFormSchema = { ok: true, fields, required, jsonSchema: raw }
  schemaCache.set(schema, result)
  return result
}
