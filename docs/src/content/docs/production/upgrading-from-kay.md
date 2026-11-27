---
title: Upgrading from kay
description: Move an app written for kay v2 (@kayjs/kay) onto prunelle with one command, and what changes for its users.
section: production
order: 2
---

Prunelle is kay v2 under a new name. The API is the same, so an app written for kay v2 moves over with one command, run in its folder:

```bash
bunx prunelle upgrade
```

It rewrites the app in place, then runs `bun install`. Pass `--no-install` to install later. Commit the app first, so the change reads as one diff.

Run from the root of a bun workspace, it also rewrites each package the `workspaces` field lists, then installs once at the root. A package that depends on kay v1 (`@kayjs/kay` at 1.x) is left as it is, with a line saying so: prunelle moves kay v2 apps only.

## What it rewrites

- **Dependencies.** `@kayjs/kay` becomes `prunelle` and each `@kayjs/<name>` becomes `@prunelle/<name>`, all at the current prunelle version. A `kay` command in the `scripts` becomes `prunelle`.
- **The config file.** `kay.config.ts` moves to `prunelle.config.ts`.
- **Imports and the names they bring.** `@kayjs/kay/server` becomes `prunelle/server`, and every name with kay in it is renamed where the file uses it: `KayPlugin` becomes `PrunellePlugin`, `KayLocals` becomes `PrunelleLocals`, a `declare module` block included. A name the file exports, or one that already exists in it, keeps its old name as an alias.
- **Names the browser receives**, where scripts and styles spell them: `data-kay-*` attributes, the `kay-island` and `kay-s` tags, `/_kay/` paths, `x-kay-*` headers, the `kay:navigate`, `kay:region` and `kay:consent` events, and the `kay_session` and `kay_consent` cookies. Each takes the `pru` prefix: `data-pru-*`, `pru-island`, `/_pru/`.
- **Build and CI files.** In `tsconfig.json`, `bunfig.toml`, `.gitignore`, a `Dockerfile`, `Justfile`, `Makefile`, compose file and the Forgejo, Gitea or GitHub workflows, the package, the CLI, the config file and the cache folders take their new names.

It also deletes the `.kay-cache` and `.kay-dev` folders, which only held build output.

## What changes for the app's users

The session and consent cookies have new names, so after the deploy every signed-in user signs in again and every visitor answers the cookie banner again.

The accounts stay. The first time `sqliteAuthStore()` opens a database kay created, it renames the `kay_auth_*` tables to `prunelle_auth_*`, keeping every user and OAuth link.

## What it leaves to you

An import prunelle cannot serve is printed with its file and line, and the command exits with code 1: a name prunelle no longer exports, or an entry it does not have, such as `@kayjs/kay/dom`. Fix each one, then run `prunelle check`.

Until then, the build refuses any import of `@kayjs/*` it finds and names the prunelle spelling, so an app cannot load both.
