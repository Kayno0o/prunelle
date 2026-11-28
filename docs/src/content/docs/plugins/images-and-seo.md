---
title: "@prunellejs/images & @prunellejs/seo"
description: Build-time AVIF/WebP image optimization, OG shareCard() PNG generation, self-hosted fonts, JSON-LD, sitemaps, redirects, and SEO checks.
section: plugins
order: 5
---

## Responsive images & OG `shareCard()` (`@prunellejs/images`)

Add `images()` to `prunelle.config.ts` to compile imported `.png`, `.jpg`, and `.webp` assets into content-hashed AVIF and WebP variants cached in `.prunelle-cache/images/`:

```ts
import { images } from '@prunellejs/images'
import { defineConfig } from 'prunelle/config'

export default defineConfig({
  site: 'https://example.com',
  plugins: [
    images({
      widths: [320, 640, 960, 1280],
      formats: ['avif', 'webp'],
      card: {
        background: '#130e16',
        color: '#f8f4ee',
        accent: '#e5c068',
      },
    }),
  ],
})
```

Variants are encoded with ImageMagick (`magick` on `PATH`). At most half your CPU cores (capped at 8) encode concurrently, each single-threaded with a 512 MiB memory limit and 2-minute timeout so large sites stay within shared CI hosts. Each image is decoded once per format and resized across all widths in a single pass. If encoding fails, Prunelle prints the file, widths, and ImageMagick error, and falls back to the original asset when no variant succeeds.

EXIF orientation is respected automatically: a sideways phone photo reports its displayed width and height, matching its generated variants.

Render responsive images with `<Picture>` or `image()`:

```tsx
import { image, Picture } from '@prunellejs/images'
import hero from '../assets/hero.jpg'

<Picture asset={hero} sizes="(min-width: 48rem) 50vw, 100vw" alt="Hero" priority />
<img {...image(hero, { sizes: '100vw' })} alt="Hero" />
```

Generate 1200×630 OpenGraph PNG cards at build time:

```tsx
import { shareCard } from '@prunellejs/images'

const og = shareCard({ title: post.title, badge: 'Release' })
```

## Metadata, self-hosted fonts & sitemap (`@prunellejs/seo`)

`@prunellejs/seo` inherits top-level `site` from `prunelle.config.ts` and emits immutable hashed `.woff2` files, `<link rel="preload" as="font">` + `@font-face` CSS, `titleTemplate`, canonical URLs, OpenGraph/Twitter tags, `jsonLd()`, redirects, and `/sitemap.xml`:

```ts
import { seo } from '@prunellejs/seo'

seo({
  name: 'My Site',
  titleTemplate: '%s | My Site',
  description: { en: 'English summary', fr: 'Résumé français' },
  favicon: ['src/favicon.svg', 'src/favicon.png'],
  redirects: { '/old-url': '/new-url' },
  fonts: [
    { family: 'Fraunces', src: '@fontsource/fraunces/files/fraunces-latin-500-normal.woff2', weight: 500 },
  ],
})
```

### `prunelle check` SEO validations

When `@prunellejs/seo` is enabled, `prunelle check` warns with file, line, and fix on:

- Missing `site` (`[seo/missing-site]`)
- Pages without a `<title>` or meta description (`[seo/missing-title]`, `[seo/missing-description]`)
- Titles over 60 characters or descriptions over 160 characters (`[seo/long-title]`, `[seo/long-description]`)
- Duplicate titles or descriptions across static or prerendered pages (`[seo/duplicate-title]`, `[seo/duplicate-description]`)
- `noindex` pages still included in the sitemap (`[seo/noindex-in-sitemap]`)
- Missing share image (`og:image` / `seo({ image })`) when `site` is set (`[seo/missing-image]`)
