# prunelle v2

This file is for agents working on prunelle itself. Agents writing an app on prunelle read `llms.txt` (`packages/prunelle/llms.txt`, shipped in `prunelle` and linked from the repo root), and people read the docs in `docs/src/content/docs/`. This file does not repeat the API: `llms.txt` holds it.

prunelle v2 is a Bun-native full-stack web framework. You write plain TypeScript and TSX, and prunelle decides what reaches the browser: a static page ships 0 KB of JS, an interactive component becomes an island on its own, and a deploy is one binary or a static export. The aim is to beat what people use today (Astro, Next, Nuxt, Solid) on how little the app writes, how little the browser downloads, how early a mistake is caught, and how much of French law an app gets right without trying.

## Principles

When two principles conflict, the higher one wins.

1. **The app writes as little as possible.** A feature that takes two declarations where one would do, or makes the app wire around it, is not done. A setting shared by several plugins (site, locales, proxy trust) is declared once in `prunelle.config.ts`. Prefer a design that is harder to build inside prunelle over one the app has to work around.
2. **A page ships only what it needs.** Static output is 0 KB of JS. prunelle works out islands, hydration and the data they receive, so the app never declares them. Browser bytes are the hard budget. Server, CLI and binary size do not matter, but their CPU and RAM do: remove work before adding threads.
3. **Every mistake prunelle can detect is reported, as early as it can be.** First in the types, then at compile, then in `prunelle check`, then as a runtime throw. Misuse is an error; a risk that may be intended (accessibility, legal, performance, security) is a warning. Either one names the file and the fix. Habits carried over from React, Solid or Astro are refused, never rendered quietly wrong.
4. **French law holds by default.** An app on prunelle should meet the RGPD and the CNIL's cookie rules, the RGAA (accessibility), the RGESN (eco-design) and the LCEN (legal notices) without extra work: no third-party request or non-essential cookie before consent, personal data kept to the minimum and exportable and deletable, accessible markup from `@prunelle/ui` and the templates. Where prunelle cannot make it true by itself, it warns with the fix (principle 3).
5. **Secure by default.** Strict CSP with hashes, CSRF checks before middleware, a request body limit, loopback binds. Weakening any of them is an explicit opt-out in the app's config.
6. **Standard TS, nothing new to learn.** No directives, no auto-imports, no implicit globals: every name a file uses is imported. The platform comes first: forms work without JS, and handlers take a `Request` and return a `Response`.
7. **A small kernel, plugins for the rest.** `packages/prunelle` holds the compiler, signals, DOM runtime, router, SSR, actions, build and `prunelle/test`. Anything optional is a `PrunellePlugin` package under `packages/`, with no npm dependency where one can be avoided. `prunelle` has two: `oxc-parser`, and `@kaynooo/cli-kit` (itself on `@kaynooo/utils`), which gives the `prunelle` CLI the same help, typo hints, completions and exit codes as the author's other CLIs.
8. **Agents are first-class users.** `llms.txt` fits on one page, errors carry their fix, and `@prunelle/mcp` exposes actions as tools.

Non-goals: React compatibility, Node or Deno as runtimes, a virtual DOM, SPA navigation by default (`@prunelle/spa` opts in), auto-imports, configuration spread over several files.

## Changing prunelle

- Work on the `v2` branch. Never touch `main`, which is prunelle v1.
- Take every change that improves stability, performance or ease of use, small ones included. Drop one only when it costs correctness, stability or ease of use, and say which on its issue.
- A new check comes with a test seen failing first; JSX checks live in `packages/prunelle/src/compiler/mistakes.ts`, tested in `packages/prunelle/tests/mistakes.test.ts`. A compiler error reads `prunelle compiler: <what> in <file>: <fix>.`, a runtime throw starts with `prunelle: `.
- A change an app can see updates `llms.txt`, the docs page covering it and the README in the same commit, figures included.
- Until 2.0.0, a breaking change is allowed when it makes prunelle better, and gets its line in `docs/src/content/docs/production/migrating-from-v1.md`. From 2.0.0, breaks ship as minors, each with an upgrade note and a `prunelle check` warning that offers the fix.
- A change that moves browser bytes or server CPU and RAM shows its before and after: `bun run bench:weight` for page weight, `bun run bench` and `bun run bench:server` for speed and memory. CI fails a page whose eager JS grows more than 100 B past `scripts/bundle-weight.json`: make it lighter, or record the growth or a shrink with `bun run bench:weight --update` and commit the file with the change.
- Keep each file of `src/` under 600 code lines, each function under 150 lines and a complexity of 40. `just check` enforces these caps against `scripts/size-ratchet.json`: an entry already past a cap cannot grow and is split by the first change that would grow it; after splitting or shrinking one, run `bun run check:size --update` and commit `scripts/size-ratchet.json` with the change.
- `just check` also enforces architectural guardrails (`bun run check:guardrails`: browser-pure & cross-plugin import boundaries, zero `as any` / `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, and an empty `catch {}` ratchet in `scripts/guardrails-ratchet.json` updated via `bun run check:guardrails --update`) and copy-paste duplication (`bun run check:dup`: `jscpd packages --pattern "**/src/**/*.{ts,tsx}" --min-lines 15 --min-tokens 70 --threshold 0.5`).
- Accessibility rules for `@prunelle/ui`, the templates and the docs are in `ACCESSIBILITY.md`.
- The `prunelle new` templates are real apps under `packages/prunelle/templates/` (`_shared` plus one folder per template); `__APP_NAME__` and `__PRUNELLE_VERSION__` are filled in on scaffold. The repo's tsconfig typechecks them and `hardening.test.ts` runs `prunelle check` and `prunelle build` on each.

## Workflow

1. Work from a Forgejo issue on `kaynooo/prunelle` (`ft issue <n>`), in a git worktree when other sessions share this checkout.
2. While working, run `just check` and the tests the change reaches: `just test <file>`. CI runs `bun run verify` (the full suite, Chromium included) on every push, so run it locally only before a release.
3. Commit with a Conventional Commit title naming the issue, e.g. `feat(content): validate frontmatter in prunelle check and auto-register collections (#3554)`.
4. After a push, `just ci <sha>` waits for its run and prints what failed. A red run on `v2` is fixed by whoever pushed it.
5. Releases go through `just alpha`, `just beta`, `just rc`, `just patch` or `just minor`: they bump all 13 packages together, run `verify`, then push the branch and its tag at once.
