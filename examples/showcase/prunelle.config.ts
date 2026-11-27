// Prunelle Showcase config: @prunellejs/ui (live grammar switcher serves all 6 CSS grammars) + @prunellejs/auth.

import { createAuth, memoryAuthStore } from '@prunellejs/auth'
import { ui } from '@prunellejs/ui/plugin'
import { defineConfig } from 'prunelle/config'

export const auth = createAuth({
  store: memoryAuthStore(),
  secret: 'showcase-dev-secret-change-in-prod',
  defaultRedirect: '/',
})

export default defineConfig({
  plugins: [auth, ui({ grammar: false, emitGrammars: true })],
})
