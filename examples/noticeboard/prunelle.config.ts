import { ui } from '@prunellejs/ui/plugin'
import { defineConfig } from 'prunelle/config'
import { auth, board, mail } from './src/services'

export default defineConfig({
  plugins: [ui({ grammar: 'editorial' }), auth, mail, board],
})
