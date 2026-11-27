import type { RequestContext } from 'prunelle/server'

export function GET(ctx: RequestContext) {
  return ctx.json({ ok: true, runtime: 'bun' })
}
