// Prunelle v2 Showcase config: @prunelle/ui (live grammar switcher serves all 6 CSS grammars) + @prunelle/auth.

import { createAuth, memoryAuthStore } from '@prunelle/auth'
import { ui } from '@prunelle/ui/plugin'
import { defineConfig } from 'prunelle/config'

export const auth = createAuth({
  store: memoryAuthStore(),
  secret: 'showcase-dev-secret-change-in-prod',
  defaultRedirect: '/',
})

export default defineConfig({
  plugins: [auth, ui({ grammar: false, emitGrammars: true })],
})
