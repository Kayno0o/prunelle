---
title: Upgrading from kay
description: Move an app written for kay v2 (@kayjs/kay) onto Prunelle with one command, and what changes for its users.
section: production
order: 6
---

Prunelle is kay v2 under a new name. The API is identical, so an app written for kay v2 moves over with one command run in its folder:

```bash
bunx prunelle upgrade
```

It rewrites the app in place, then runs `bun install` (pass `--no-install` to install later). Commit your app first so the migration reads as one clean diff.

Run from the root of a Bun workspace, it rewrites every workspace package that depends on kay v2 and installs once at the root. Packages already on Prunelle are re-checked so a second run catches anything an earlier version missed. Packages on kay v1 (`@kayjs/kay` 1.x) are left untouched with a note: `prunelle upgrade` migrates kay v2 apps only.

## What it rewrites

- **Dependencies**: `@kayjs/kay` becomes `prunelle` and each `@kayjs/<name>` becomes `@prunellejs/<name>` (including kay v2 npm aliases such as `"kay": "npm:@kayjs/kay@^2..."`), all pinned to the current Prunelle version. `kay` commands in `package.json` `scripts` become `prunelle`.
- **Config file**: `kay.config.ts` moves to `prunelle.config.ts`.
- **Imports & symbols**: `@kayjs/kay/server` (and kay v2 aliases like `kay/server`) become `prunelle/server`, and kay-prefixed types and bindings rename in place (`KayPlugin` → `PrunellePlugin`, `KayLocals` → `PrunelleLocals`, including `declare module` blocks). Exported or colliding names keep their old spelling as an alias. Files under `public/` (or `publicDir`) stay untouched.
- **Browser wire names**: `data-kay-*` attributes, `<kay-island>` / `<kay-s>` tags, `/_kay/` paths, `x-kay-*` headers, `kay:navigate` / `kay:region` / `kay:consent` events, and `kay_session` / `kay_consent` cookies take the `pru` prefix (`data-pru-*`, `pru-island`, `/_pru/`).
- **Build & CI files**: `tsconfig.json`, `bunfig.toml`, `.gitignore` (ensuring `.prunelle-cache/` is ignored), `Dockerfile`, `Justfile`, `Makefile`, compose files, and Forgejo/Gitea/GitHub workflows update to Prunelle's package, CLI, config, and cache names.
- **Agent instructions**: `AGENTS.md` and `CLAUDE.md` update to point coding agents at `node_modules/prunelle/llms.txt`.

It also removes stale `.kay-cache` and `.kay-dev` build folders.

## What changes for users

Because the session and consent cookie names change (`pru_session`, `pru_consent`), signed-in users sign in once after deploy and visitors answer the consent prompt again.

Accounts are preserved automatically: the first time `sqliteAuthStore()` opens a database created by kay, it renames `kay_auth_*` tables to `prunelle_auth_*`, keeping every user and OAuth link intact.

## What stays manual

Any import Prunelle cannot serve (such as a removed export or `@kayjs/kay/dom`) is printed with its file and line, and the command exits `1`. Fix those imports, then run `prunelle check`. Until then, `prunelle build` refuses any `@kayjs/*` import and prints the Prunelle spelling so an app cannot mix both.
