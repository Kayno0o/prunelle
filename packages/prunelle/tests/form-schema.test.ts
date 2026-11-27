import type { StandardSchemaV1 } from '../src/server/standard-schema'
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { walkRoutes } from '../src/build/files'
import { ModuleGraph } from '../src/build/graph'
import { checkAppForms } from '../src/cli/check-forms'
import { extractFormSchema, lookupFieldConstraint } from '../src/server/form-schema'
import { testApp } from '../src/test/index'

const tempDirs: string[] = []
function appWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'prunelle-form-schema-'))
  tempDirs.push(dir)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

afterAll(() => {
  for (const d of tempDirs)
    rmSync(d, { recursive: true, force: true })
})

function mockJsonSchema(jsonSchema: Record<string, unknown>, vendor = 'zod'): StandardSchemaV1 {
  return {
    '~standard': {
      version: 1,
      vendor,
      validate: (value: unknown) => ({ value }),
      jsonSchema: {
        input: () => jsonSchema,
      },
    },
  } as unknown as StandardSchemaV1
}

describe('extractFormSchema (#4)', () => {
  it('extracts types, required, lengths, numeric bounds, patterns, enums, nested objects, arrays, and unions', () => {
    const schema = mockJsonSchema({
      type: 'object',
      required: ['email', 'age', 'role', 'address'],
      properties: {
        email: { type: 'string', format: 'email', maxLength: 120 },
        website: { anyOf: [{ type: 'string', format: 'uri' }, { type: 'null' }] },
        username: { type: 'string', minLength: 3, maxLength: 20, pattern: '^[a-z0-9_]+$' },
        age: { type: 'integer', minimum: 18, maximum: 120 },
        score: { type: 'number', minimum: 0, maximum: 10, multipleOf: 0.5 },
        ratio: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
        role: { anyOf: [{ const: 'user' }, { const: 'editor' }, { const: 'admin' }] },
        tags: { type: 'array', items: { type: 'string', enum: ['news', 'tech', 'design'] } },
        address: {
          type: 'object',
          required: ['city'],
          properties: {
            city: { type: 'string', minLength: 2 },
            zip: { type: 'string', pattern: '^\\d{5}$' },
          },
        },
      },
    })

    const extracted = extractFormSchema(schema)
    expect(extracted.ok).toBe(true)
    if (!extracted.ok)
      return

    expect(extracted.fields.get('email')).toEqual({ required: true, type: 'email', maxLength: 120 })
    expect(extracted.fields.get('website')).toEqual({ type: 'url' })
    expect(extracted.fields.get('username')).toEqual({ minLength: 3, maxLength: 20, pattern: '^[a-z0-9_]+$' })
    expect(extracted.fields.get('age')).toEqual({ required: true, type: 'number', step: 1, min: 18, max: 120 })
    expect(extracted.fields.get('score')).toEqual({ type: 'number', step: 0.5, min: 0, max: 10 })
    expect(extracted.fields.get('ratio')).toEqual({ type: 'number', step: 'any', min: 0, max: 1 })
    expect(extracted.fields.get('role')).toEqual({ required: true, enumValues: ['user', 'editor', 'admin'] })
    expect(extracted.fields.get('tags')).toEqual({ isArray: true, enumValues: ['news', 'tech', 'design'] })
    expect(lookupFieldConstraint(extracted.fields, 'tags[]')).toEqual({ isArray: true, enumValues: ['news', 'tech', 'design'] })
    expect(extracted.fields.get('address.city')).toEqual({ required: true, minLength: 2 })
    expect(extracted.fields.get('address.zip')).toEqual({ pattern: '^\\d{5}$' })
    expect([...extracted.required].sort()).toEqual(['address.city', 'age', 'email', 'role'])
  })

  it('returns vendor info when schema has no JSON Schema output', () => {
    const opaque: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'hand-rolled',
        validate: value => ({ value }),
      },
    }
    expect(extractFormSchema(opaque)).toEqual({ ok: false, vendor: 'hand-rolled' })
  })
})

describe('automatic SSR HTML5 constraints (#4)', () => {
  it('injects HTML5 attributes onto form controls with 0 B client JS and respects author overrides', async () => {
    const dir = appWith({
      'src/actions/signup.ts': `
        import { action } from 'prunelle/server'

        const signupSchema = {
          '~standard': {
            version: 1 as const,
            vendor: 'zod',
            validate: (value: unknown) => ({ value }),
            jsonSchema: {
              input: () => ({
                type: 'object',
                required: ['email', 'website', 'age', 'bio', 'role', 'tags', 'token'],
                properties: {
                  email: { type: 'string', format: 'email', maxLength: 100 },
                  website: { type: 'string', format: 'uri' },
                  age: { type: 'integer', minimum: 18, maximum: 99 },
                  price: { type: 'number', minimum: 1, multipleOf: 0.5 },
                  code: { type: 'string', minLength: 4, maxLength: 8, pattern: '[A-Z0-9]+' },
                  bio: { type: 'string', minLength: 10, maxLength: 500 },
                  role: { type: 'string', enum: ['member', 'admin'] },
                  tags: { type: 'array', items: { type: 'string' } },
                  token: { type: 'string' },
                },
              }),
            },
          },
        }

        export const signup = action(signupSchema, async (input) => input, { protect: { honeypot: true } })
      `,
      'src/components/EmailField.tsx': `
        export function EmailField() {
          return <input name="email" />
        }
        export function SpreadField(props: { name: string, placeholder?: string }) {
          return <input {...props} />
        }
      `,
      'src/routes/index.tsx': `
        import { signup } from '../actions/signup'
        import { EmailField, SpreadField } from '../components/EmailField'

        export default function SignupPage() {
          return (
            <main>
              <form action={signup} method="post">
                <EmailField />
                <SpreadField name="website" placeholder="https://example.com" />
                <input name="age" />
                <input name="price" step="1" />
                <input name="code" type="text" required={false} />
                <textarea name="bio" />
                <select name="role">
                  <option value="">Choose</option>
                  <option value="member">Member</option>
                </select>
                <input type="checkbox" name="tags[]" value="a" />
                <input type="hidden" name="token" value="xyz" />
                <button type="submit">Go</button>
              </form>
              <form action="/search" method="get">
                <input name="email" />
              </form>
            </main>
          )
        }
      `,
    })

    const app = await testApp({ root: dir })
    try {
      // Static page stays 0 B client JS!
      const homeRoute = app.manifest!.routes.find(r => r.path === '/')!
      expect(homeRoute.islandChunks).toEqual([])

      const html = await (await app.get('/')).text()

      // Child component <EmailField /> receives type="email" required maxlength="100".
      expect(html).toContain('<input name="email" type="email" required maxlength="100">')
      // Spread component <SpreadField /> receives type="url" required.
      expect(html).toContain('<input name="website" placeholder="https://example.com" type="url" required>')
      // Integer field gets type="number" required min="18" max="99" step="1".
      expect(html).toContain('<input name="age" type="number" required min="18" max="99" step="1">')
      // Explicit step="1" is NOT duplicated or overridden.
      expect(html).toContain('<input name="price" step="1" type="number" min="1">')
      // Explicit type="text" and required={false} are respected while minlength/maxlength/pattern still apply.
      expect(html).toContain('<input name="code" type="text" minlength="4" maxlength="8" pattern="[A-Z0-9]+">')
      // Textarea gets required minlength maxlength.
      expect(html).toContain('<textarea name="bio" required minlength="10" maxlength="500"></textarea>')
      // Select gets required, and NO implicit <option value="admin"> is injected!
      expect(html).toContain('<select name="role" required>')
      expect(html).not.toContain('value="admin"')
      // Array checkbox does NOT get required; hidden input does NOT get required.
      expect(html).toContain('<input type="checkbox" name="tags[]" value="a">')
      expect(html).toContain('<input type="hidden" name="token" value="xyz">')
      // Plain non-action form is untouched.
      expect(html).toContain('<form action="/search" method="get"><input name="email"></form>')
    }
    finally {
      await app.app.dispose?.()
    }
  })

  it('injects HTML5 constraints on island forms using useAction(fn).action', async () => {
    const dir = appWith({
      'src/actions/login.ts': `
        import { action } from 'prunelle/server'
        const loginSchema = {
          '~standard': {
            version: 1 as const,
            vendor: 'zod',
            validate: (v: unknown) => ({ value: v }),
            jsonSchema: {
              input: () => ({
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              }),
            },
          },
        }
        export const login = action(loginSchema, async v => v, { protect: { honeypot: true } })
      `,
      'src/routes/index.tsx': `
        import { useAction } from 'prunelle'
        import { login } from '../actions/login'
        export default function Login() {
          const form = useAction(login)
          return (
            <form action={form.action} method="post" onSubmit={form.onSubmit}>
              <input name="email" />
              <button type="submit">Log in</button>
            </form>
          )
        }
      `,
    })

    const app = await testApp({ root: dir })
    try {
      const html = await (await app.get('/')).text()
      expect(html).toContain('<input name="email" type="email" required>')
    }
    finally {
      await app.app.dispose?.()
    }
  })
})

describe('checkAppForms static form checking (#4)', () => {
  it('reports unknown fields with closest name, missing required fields, and invalid select enum options', async () => {
    const dir = appWith({
      'src/actions/profile.ts': `
        import { action } from 'prunelle/server'
        const schema = {
          '~standard': {
            version: 1 as const,
            vendor: 'zod',
            validate: (v: unknown) => ({ value: v }),
            jsonSchema: {
              input: () => ({
                type: 'object',
                required: ['email', 'role'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  role: { type: 'string', enum: ['user', 'editor'] },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              }),
            },
          },
        }
        export const updateProfile = action(schema, async v => v, { protect: { honeypot: true } })
      `,
      'src/routes/bad.tsx': `
        import { updateProfile } from '../actions/profile'
        export default function BadForm() {
          return (
            <form action={updateProfile} method="post">
              <input name="emial" />
              <select name="role">
                <option value="">Pick one</option>
                <option value="user">User</option>
                <option value="superadmin">Superadmin</option>
              </select>
              <button type="submit">Save</button>
            </form>
          )
        }
      `,
    })

    const routesDir = join(dir, 'src/routes')
    const routeFiles = walkRoutes(routesDir).sort()
    const graph = new ModuleGraph(dir)
    for (const f of routeFiles)
      graph.load(f)

    const res = await checkAppForms({ root: dir, routesDir, routeFiles, graph })
    expect(res.errors.some(e => e.includes('form/unknown-field') && e.includes('"emial"') && e.includes('did you mean "email"'))).toBe(true)
    expect(res.errors.some(e => e.includes('form/missing-field') && e.includes('"email"') && e.includes('found "emial"'))).toBe(true)
    expect(res.warnings.some(w => w.includes('form/invalid-option') && w.includes('"superadmin"') && w.includes('user, editor'))).toBe(true)
    // Empty placeholder <option value=""> must NOT warn.
    expect(res.warnings.some(w => w.includes('value=""'))).toBe(false)
  })

  it('follows local components, handles prop-forwarded field names, array fields, and useAction(fn).action', async () => {
    const dir = appWith({
      'src/actions/order.ts': `
        import { action } from 'prunelle/server'
        const schema = {
          '~standard': {
            version: 1 as const,
            vendor: 'zod',
            validate: (v: unknown) => ({ value: v }),
            jsonSchema: {
              input: () => ({
                type: 'object',
                required: ['email', 'address'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  tags: { type: 'array', items: { type: 'string' } },
                  address: {
                    type: 'object',
                    required: ['city'],
                    properties: { city: { type: 'string' } },
                  },
                },
              }),
            },
          },
        }
        export const placeOrder = action(schema, async v => v, { protect: { honeypot: true } })
      `,
      'src/components/Field.tsx': `
        export function Field({ name }: { name: string }) {
          return <input name={name} />
        }
      `,
      'src/routes/index.tsx': `
        import { useAction } from 'prunelle'
        import { placeOrder } from '../actions/order'
        import { Field } from '../components/Field'

        function AddressFields() {
          return <input name="address.city" />
        }

        export default function OrderPage() {
          const form = useAction(placeOrder)
          return (
            <form action={form.action} method="post" onSubmit={form.onSubmit}>
              <Field name="email" />
              <AddressFields />
              <input type="checkbox" name="tags[]" value="urgent" />
              <button type="submit">Order</button>
            </form>
          )
        }
      `,
    })

    const routesDir = join(dir, 'src/routes')
    const routeFiles = walkRoutes(routesDir).sort()
    const graph = new ModuleGraph(dir)
    for (const f of routeFiles)
      graph.load(f)

    const res = await checkAppForms({ root: dir, routesDir, routeFiles, graph })
    expect(res.errors).toEqual([])
    expect(res.warnings).toEqual([])
  })

  it('emits one warning per schema vendor lacking JSON Schema output', async () => {
    const dir = appWith({
      'src/actions/custom.ts': `
        import { action } from 'prunelle/server'
        const customSchema = { '~standard': { version: 1 as const, vendor: 'superstruct', validate: (v: unknown) => ({ value: v }) } }
        export const first = action(customSchema, async v => v, { protect: { honeypot: true } })
        export const second = action(customSchema, async v => v, { protect: { honeypot: true } })
      `,
      'src/routes/index.tsx': `
        import { first, second } from '../actions/custom'
        export default function Page() {
          return (
            <main>
              <form action={first} method="post"><input name="anything" /></form>
              <form action={second} method="post"><input name="other" /></form>
            </main>
          )
        }
      `,
    })

    const routesDir = join(dir, 'src/routes')
    const routeFiles = walkRoutes(routesDir).sort()
    const graph = new ModuleGraph(dir)
    for (const f of routeFiles)
      graph.load(f)

    const res = await checkAppForms({ root: dir, routesDir, routeFiles, graph })
    expect(res.errors).toEqual([])
    const unsupported = res.warnings.filter(w => w.includes('form/schema-unsupported'))
    expect(unsupported).toHaveLength(1)
    expect(unsupported[0]).toContain('superstruct')
  })
})
