---
title: "@prunellejs/ui (6 Style Grammars)"
description: Platform-first headless UI primitives and pure CSS @layer kui Style Grammars with zero JS styling runtime and one-file eject.
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
import { defineConfig } from 'prunelle/config'
import { ui } from '@prunellejs/ui/plugin'

export default defineConfig({
  plugins: [ui({ grammar: 'prunelle' })],
})
```

Available grammars: `'prunelle'` · `'orbit'` · `'editorial'` · `'workshop'` · `'console'` · `'soft'` · `'bare'`.

## Primitives

- **0 KB JS static & layout primitives**: `Stack`, `Cluster`, `Grid`, `Sidebar`, `Split`, `Button`, `Card` (`CardHeader`/`CardBody`/`CardFooter`), `Badge`, `Notice`, `Field`, `Switch`, `Checkbox`, `RadioGroup`, `Progress`, `Accordion` (`AccordionItem`), `Popover`, `Dialog`, `Drawer`.
- **Auto-hydrated interactive islands**: `ControlledDialog` and `ControlledDrawer` (a `Dialog` or `Drawer` your code opens and closes through an `open` signal), `Tabs`, `Menu`, `Select`, `CommandPalette` (`⌘K`), `DataTable` (sort, filter, select, paginate), `Toaster` + `toast()`.

`Dialog` and `Drawer` ship no JavaScript. Their trigger opens them with the browser's invoker commands (`commandfor` and `command="show-modal"`), and the browser closes them on Esc, on the close button and on a click on the backdrop (`closedby="any"`). The page behind an open one does not scroll.

`Menu`, `Select` and `Popover` open in the browser's top layer, so a parent with `overflow: hidden` never clips them. CSS anchor positioning places each one below its trigger, and above it or on its other side when the viewport has no room there. An outside click closes them.

A browser that lacks one of these features, such as Safari before 26.2 or Firefox before 147, loads a fallback of about 700 bytes that does their work; other browsers fetch nothing. The `ui()` plugin adds that check to pages with a `commandfor` button, a `Menu`, a `Select` or a `Popover`, so your own `commandfor` buttons get it too.

```tsx
import { Button, Card, CardBody, CardHeader, Switch } from '@prunellejs/ui'

export default function Settings() {
  return (
    <Card>
      <CardHeader>Preferences</CardHeader>
      <CardBody>
        <Switch name="dark" label="Starry dark mode" checked />
        <Button tone="accent">Save</Button>
      </CardBody>
    </Card>
  )
}
```

`Progress` is a native `<progress>` named by its `label`. Without a `value` it is a loader; with one, `max` defaults to 100.

```tsx
<Progress label="Building 48 pages" />
<Progress label="Deploying" value={62} />
```

The `prunelle` grammar draws its controls as an eye, in the accent colour. A radio is a shut eye that opens when checked, and a switch's knob opens its eye when on. A loading `Progress` looks left and right, then blinks; with a value, its pupil widens until it fills the eye. Its titles are set in Fraunces, which the app loads itself, for instance through the `fonts` option of `@prunellejs/seo`; Georgia stands in until then.

## Eject & own your CSS

Because every grammar is a single pure CSS file wrapped in `@layer kui`, you can eject and customize it anytime — and Tailwind or your own stylesheet always wins without `!important`:

```bash
prunelle ui-eject prunelle src/styles/ui.css
```
