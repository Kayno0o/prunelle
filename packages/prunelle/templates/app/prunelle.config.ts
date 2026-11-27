import { ui } from '@prunellejs/ui/plugin'
import { defineConfig } from 'prunelle/config'
import { auth } from './src/auth'

export default defineConfig({
  lang: 'en',
  plugins: [
    ui({ grammar: 'editorial' }),
    auth,
  ],
})
