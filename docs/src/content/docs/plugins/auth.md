---
title: "@prunellejs/auth"
description: Zero-dependency Bun-native auth — Argon2id passwords, hashed sessions, email verification, magic links, OAuth 2.0 + PKCE, guards, RGPD, and SQLite.
section: plugins
order: 2
---

`@prunellejs/auth` ships a complete authentication layer with **zero external dependencies**, built natively on `Bun.password` (Argon2id), Web Crypto, and `bun:sqlite`.

## Setup

```ts
// src/auth.ts
import { createAuth, github } from '@prunellejs/auth'
import { sqliteAuthStore } from '@prunellejs/auth/sqlite'
import { mail } from './mail'

export const auth = createAuth({
  store: sqliteAuthStore('./data/app.sqlite'),
  secret: process.env.AUTH_SECRET,
  defaultRedirect: '/dashboard',
  sendMail: async m => mail.send({ to: m.to, subject: m.subject, text: m.text, html: m.html }),
  providers: [
    github({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
})
```

- **`secret`**: In `NODE_ENV=production`, `secret` (or `AUTH_SECRET`) is **required** and must be at least **32 UTF-8 bytes**. An empty string is rejected in every environment. In development, omitting `secret` generates an ephemeral key per process.
- **`site`**: Inherited from top-level `site` in `prunelle.config.ts` (or passed directly). Mailed verification/magic links and OAuth callbacks are built from it — never from the client-controlled `Host` header. Without it, mailed links work only on loopback hosts (`localhost` / `127.0.0.1`), and other hosts receive `500`.
- **`minPasswordLength`**: Defaults to `12` (aligned with CNIL recommendations).
- **`requireEmailVerification`**: Defaults to `true`. `POST /auth/signup` creates an unverified account, sends a one-time verification link (`kind: 'verify-email'`), and returns `202 { ok: true, verificationRequired: true }` without opening a session. `POST /auth/signin` refuses unverified accounts with `403`. Set `requireEmailVerification: false` only when intentionally allowing unverified password sessions.
- **`trustProxy`**: Inherited from `prunelle.config.ts` (`false` by default). Rate limiting keys on `ctx.ip` plus the normalized email address across sign-up, sign-in, magic-link, verification, and OAuth endpoints.

The object `createAuth()` returns is both your handle and the plugin. Register it in `prunelle.config.ts`:

```ts
import { defineConfig } from 'prunelle/config'
import { auth } from './src/auth'

export default defineConfig({
  site: 'https://example.com',
  plugins: [auth],
})
```

## Built-in endpoints

| Route | Behavior |
| :--- | :--- |
| `POST /auth/signup` | Argon2id password hash; sends a verification email and returns `202` without opening a session (`201` + session only when `requireEmailVerification: false`). |
| `GET` / `POST /auth/verify-email` | `GET` shows a one-button confirmation page and leaves the token unused so mail scanners cannot burn it; `POST` marks `emailVerified = true` and opens a session cookie. |
| `POST /auth/signin` | Timing-safe Argon2id verify, refuses unverified accounts (`403`) when verification is required, IP + email rate limiting (`429`). |
| `POST /auth/signout` | Revokes hashed session and clears cookie. |
| `GET /auth/session` | Returns the current public user JSON. |
| `POST /auth/magic-link` & `GET` / `POST /auth/magic-link/verify` | One-time email login via `@prunellejs/mail` using the same scanner-safe two-step `GET` → `POST` flow. The first link sign-in verifies the address and clears any prior unverified password, sessions, and provider links. |
| `GET /auth/oauth/:provider` & callback | OAuth 2.0 + PKCE (`S256`) with HMAC-signed state (`github`, `discord`, `google`, or custom `oauthProvider`), rate limited. |

## Protecting routes & actions

Protect any directory with `_middleware.ts`:

```ts
// src/routes/dashboard/_middleware.ts
import { auth } from '../../auth'

export default auth.guard({ redirectTo: '/login' })
```

Inside any route, layout, or server `action()`, `ctx.locals.user` is populated automatically with the signed-in user (or `undefined`).

## Data retention & RGPD helpers

`createAuth()` starts an unref'd background timer (`pruneIntervalMs`, default 15 minutes; set `false` to disable) that calls `store.pruneExpired()` and sweeps expired rate-limit entries. Call `auth.dispose()` in tests or shutdown hooks to stop it.

For session data minimization, configure:

- `storeIp`: `'truncate'` (default — IPv4 `/24`, IPv6 `/48`), `true` (full IP), or `false` (omit IP).
- `storeUserAgent`: `true` (default) or `false` (omit `User-Agent`).

The `Auth` instance exposes RGPD lifecycle methods delegating to your `AuthStore`:

```ts
const sessions = await auth.listSessions(userId)   // Active non-expired sessions
const dump = await auth.exportUser(userId)          // Public profile (no passwordHash), sessions, OAuth links
await auth.deleteUser(userId)                       // Cascades user, sessions, OAuth accounts, and tokens
await auth.pruneExpired()                           // Manual purge of expired sessions, tokens, and rate-limit entries
```

## Custom `AuthStore`

If you implement a custom `AuthStore` instead of `sqliteAuthStore()` or `memoryAuthStore()`, implement all lifecycle methods on the `AuthStore` interface:

- **`deleteUserOAuthAccounts(userId: string)`**: Deletes all OAuth provider links for `userId` (called when an unverified account is claimed via verified magic link or OAuth so a pre-account squatter cannot keep provider access).
- **`deleteUser(userId: string)`**: Permanently deletes the user and cascades sessions, OAuth accounts, and verification tokens (matching both `userId` and email).
- **`exportUser(userId: string)`**: Returns a `UserExport` (`{ user, sessions, oauthAccounts, exportedAt }`) with `passwordHash` stripped and only active non-expired sessions, or `null` if not found.
- **`listSessions(userId: string)`**: Returns active, non-expired `AuthSession` records for `userId`.
- **`pruneExpired()`**: Deletes expired sessions and verification tokens. Invoked automatically on `pruneIntervalMs`.
