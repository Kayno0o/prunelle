import type { Context } from 'prunelle'
import { useContext } from 'prunelle'

export interface FieldControlWiring {
  id: string
  describedBy: string | undefined
  invalid: boolean
  required: boolean
}

export const FIELD_CONTEXT_ID = Symbol.for('pru.ui.field')
const FIELD_CONTEXT_REF = { id: FIELD_CONTEXT_ID, defaultValue: undefined } as Context<FieldControlWiring | undefined>

export function useFieldContext(): FieldControlWiring | undefined {
  try {
    return useContext(FIELD_CONTEXT_REF)
  }
  catch {
    return undefined
  }
}
