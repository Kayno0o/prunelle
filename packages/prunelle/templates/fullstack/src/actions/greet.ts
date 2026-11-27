import type { StandardSchemaV1 } from 'prunelle/server'
import { action } from 'prunelle/server'

const nameSchema: StandardSchemaV1<{ name: string }> = {
  '~standard': {
    version: 1,
    vendor: 'prunelle',
    validate(raw: unknown) {
      const name = String((raw as { name?: unknown })?.name ?? '').trim()
      if (name.length < 2)
        return { issues: [{ message: 'Enter at least 2 characters', path: ['name'] }] }
      return { value: { name } }
    },
  },
}

export const greet = action(nameSchema, async ({ name }) => {
  return { message: `Hello, ${name}!` }
})
