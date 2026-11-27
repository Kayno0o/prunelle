import { content } from '@prunellejs/content'
import { seo } from '@prunellejs/seo'
import { ui } from '@prunellejs/ui/plugin'
import { defineConfig } from 'prunelle/config'
import { posts } from './src/posts'

export default defineConfig({
  lang: 'en',
  plugins: [
    ui({ grammar: 'editorial' }),
    seo({ site: 'https://example.com', titleTemplate: '%s — __APP_NAME__', description: 'Articles & notes from __APP_NAME__', image: '/og.png' }),
    content({
      feeds: [{
        path: '/rss.xml',
        title: '__APP_NAME__',
        description: 'Articles & notes',
        site: 'https://example.com',
        linkPrefix: '/blog',
        collection: posts,
      }],
    }),
  ],
})
