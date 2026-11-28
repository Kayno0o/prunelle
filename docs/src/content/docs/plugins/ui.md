---
title: "@prunellejs/ui (6 Style Grammars)"
description: Platform-first headless UI primitives and pure CSS @layer kui Style Grammars with zero JS styling runtime, tokenized per-component CSS, and one-file eject.
section: plugins
order: 1
---

`@prunellejs/ui` pairs **platform-first headless TSX primitives** (zero-JS native HTML wherever the platform suffices: `<details name>`, `<dialog>`, `popover`, `<input type="checkbox">`) with **6 structurally distinct pure CSS `@layer kui` Style Grammars**.

<Callout title="Try all 6 grammars live" tone="tip">
Visit the interactive [UI Grammars sandbox](/grammars) to switch this site between **Prunelle**, **Orbit**, **Editorial**, **Workshop**, **Console**, **Soft**, and **Bare** in real time.
</Callout>

## Setup

```ts
// prunelle.config.ts
import { ui } from '@prunellejs/ui/plugin'
import { defineConfig } from 'prunelle/config'

export default defineConfig({
  plugins: [ui({ grammar: 'prunelle' })],
})
```

Available grammars: `'prunelle'` · `'orbit'` · `'editorial'` · `'workshop'` · `'console'` · `'soft'` · `'bare'`.

## Primitives

- **0 KB JS static & layout primitives**: `Stack`, `Cluster`, `Grid`, `Sidebar`, `Split`, `Button`, `Card` (`CardHeader`, `CardBody`, `CardFooter`), `Badge`, `Notice`, `Field`, `Switch`, `Checkbox`, `RadioGroup`, `Progress`, `Accordion` (`AccordionItem`), `Popover`, `Dialog`, `Drawer`.
- **Auto-hydrated interactive islands**: `ControlledDialog` and `ControlledDrawer` (opened and closed programmatically through an `open` signal), `Tabs`, `Menu`, `Select`, `CommandPalette` (`⌘K`), `DataTable` (sort, filter, select, paginate), `Toaster` + `toast()`.

`Dialog` and `Drawer` ship **0 KB** of JavaScript. Their trigger opens them via native browser invoker commands (`commandfor` and `command="show-modal"`), and the browser closes them on `Esc`, the close button, or a backdrop click (`closedby="any"`).

`Menu`, `Select`, and `Popover` open in the browser's top layer so an ancestor with `overflow: hidden` never clips them. CSS anchor positioning places each menu below its trigger and flips it automatically when the viewport runs out of room.

Browsers that lack invoker commands or anchor positioning (such as Safari before 26.2 or Firefox before 147) dynamically load a ~700-byte fallback; modern browsers fetch nothing. The `ui()` plugin wires this check automatically on any page using `commandfor`, `Menu`, `Select`, or `Popover`.

```tsx
import { Button, Card, CardBody, CardHeader, Switch } from '@prunellejs/ui'

export default function Settings() {
  return (
    <Card>
      <CardHeader>Preferences</CardHeader>
      <CardBody>
        <Switch name="dark" label="Dark mode" checked />
        <Button tone="accent">Save</Button>
      </CardBody>
    </Card>
  )
}
```

`Progress` renders a native `<progress>` named by its `label`. Omit `value` for an indeterminate loader; pass `value` for a determinate bar (`max` defaults to `100`):

```tsx
<Progress label="Building 48 pages" />
<Progress label="Deploying" value={62} />
```

In the `prunelle` grammar, the eye is the sole ornament: a radio is a shut eye that opens when checked, a switch knob opens its eye when on, an indeterminate `Progress` looks left, right, and blinks, and a determinate `Progress` widens its pupil to fill the eye. Titles use Fraunces (loaded via `@prunellejs/seo`'s `fonts`, with Georgia as fallback).

## Tokenized architecture & per-route CSS

Every grammar is built on three layers inside `@layer kui`:

1. **`base.css`**: `box-sizing`, `.kui-sr-only`, `prefers-reduced-motion`, `[hidden]`, and one consistent `:focus-visible` ring (`outline: 2px solid var(--ui-focus-color, var(--ui-accent, currentColor))`). No grammar ever removes focus outlines, preserving RGAA 10.7 across every theme.
2. **Per-component sheets (`components/<part>.css` + `themed/<part>.css`)**: structural layout, top-layer positioning, 44px mobile touch targets, and `--ui-*` token rules split into 20 component parts (`layout`, `button`, `card`, `badge`, `notice`, `field`, `checkbox`, `switch`, `radio-group`, `progress`, `accordion`, `tabs`, `dialog`, `drawer`, `command`, `popover`, `menu`, `select`, `toast`, `datatable`).
3. **Thin grammar sheets (`grammars/<name>.css`)**: `:root` CSS custom properties plus the small rules a token cannot express (Prunelle's eye controls, Orbit's starfield, Console's `[badge]` brackets).

At build time, `ui()` scans each route's reachable imports so pages ship CSS only for the components they render, and `prunelle build` consolidates local stylesheets into at most one site-wide cached sheet plus one per-route sheet. Across apps and this docs site, that cuts shipped CSS by **19%–45%** gzip (dropping docs pages from 3 linked sheets to 1). See [Benchmarks](/docs/production/benchmarks).

For custom tooling, `@prunellejs/ui/plugin` also exports `renderGrammarBaseCss(grammar)`, `renderGrammarPartsCss(grammar, parts)`, `UI_COMPONENT_PARTS`, and `UI_EXPORT_TO_PARTS`.

## Eject & own your CSS

Because every grammar compiles to pure CSS wrapped in `@layer kui`, you can eject it into one standalone file anytime — and Tailwind utilities or your own stylesheet always win without `!important`:

```bash
prunelle ui-eject prunelle src/styles/ui.css
```
