# Prunelle Agent Eval Suite

This suite measures real-world coding-agent friction on Prunelle apps: whether an agent can build realistic full-stack features cleanly from `llms.txt` alone, without diving into `@prunelle/*` internals or stalling on unclear compiler/check diagnostics.

## Tasks

| Task ID | Focus | Template | JS Budget |
| --- | --- | --- | ---: |
| `01-static-blog-i18n` | `@prunelle/content` + `@prunelle/i18n` (`en`/`fr`), Standard Schema frontmatter, `/rss.xml`, prerendered posts | `blog` | `0kb` |
| `02-filter-island` | Server `load()` + interactive product filter/sort island (`signal`, `computed`, reactive `.map()`, `useId`) | `minimal` | `15kb` |
| `03-action-form` | Typed `action()` with Standard Schema, progressive `useAction()` form, zero-JS `303` flash redirect, `testApp` tests | `minimal` | `15kb` |
| `04-auth-crud-sqlite` | `@prunelle/auth` (`sqliteAuthStore` + `auth.guard()`), `@prunelle/ui`, `bun:sqlite` notes CRUD, `testApp` tests | `app` | `20kb` |
| `05-streaming-regions` | Streaming `<Suspense>` + `<Region>` partial swaps with `@prunelle/spa` (`regions()`), `x-pru-region` & `Vary`, zero-JS fallback | `minimal` | `15kb` |
| `06-mcp-tools` | `@prunelle/mcp` exposing typed `action()` tools at `/mcp/tools` with bearer auth, validation & strict budget | `minimal` | `15kb` |

## Usage

### 1. List tasks

```bash
bun evals/run.ts list
```

### 2. Initialize a clean task workspace

```bash
bun evals/run.ts init 02-filter-island /tmp/prunelle-eval-02
```

This scaffolds the task's starting template, copies the prompt into `TASK.md`, and symlinks all local `@prunelle/*` workspace packages (including `node_modules/@prunelle/*/llms.txt`) plus `.bin/prunelle` and TypeScript tooling into `node_modules/` with zero network access.

### 3. Run a coding agent

Point your coding agent (Claude Code, Antigravity, Codex, etc.) at `/tmp/prunelle-eval-02` with the contents of `TASK.md` (or `evals/tasks/<id>/prompt.md`) and save its session transcript as JSONL.

### 4. Grade the workspace

```bash
bun evals/run.ts grade 02-filter-island /tmp/prunelle-eval-02
bun evals/run.ts grade 02-filter-island /tmp/prunelle-eval-02 --transcript /tmp/session.jsonl --json > /tmp/grade-02.json
```

Grading automatically runs:
1. `prunelle check --json` (errors, warnings, checked files)
2. `prunelle build --analyze --json --max-js <budget>` (exact gzipped eager JS bytes per route)
3. `bun test` (when the task workspace contains tests)
4. Task-specific functional HTTP/HTML/action/auth/region/MCP assertions via `testApp({ root, prebuilt: true })`

### 5. Aggregate a multi-task summary table

```bash
bun evals/run.ts report /tmp/grades/
```

## Transcript Schema & Friction Metrics

`evals/lib/metrics.ts` parses Claude Code JSONL transcripts, Antigravity JSONL transcripts, and a simple normalized JSONL schema:

```jsonl
{"type":"turn","role":"assistant"}
{"type":"tool_call","tool":"read_file","args":{"path":"node_modules/prunelle/llms.txt"}}
{"type":"tool_call","tool":"read_file","args":{"path":"node_modules/prunelle/src/server/action.ts"}}
{"type":"tool_result","command":"prunelle check","exitCode":1,"output":"src/routes/index.tsx:5:1: error: prunelle compiler: ..."}
{"type":"grade","ok":true}
```

### How to read the friction signals

- **`turnsToGreen`**: Assistant turns until the first passing grade (or `>N` if failed). High turn counts signal API ambiguity or missing examples.
- **`llmsReads`**: Reads of `llms.txt` files (expected to be `>= 1` — confirms the agent discovered the reference).
- **`sourceReads`**: Reads into `node_modules/@prunelle/*/src/`. Any non-zero count points directly to a **`llms.txt` documentation gap** — add the missing signature or trap to that package's `llms.txt`.
- **`repeatedFailures`**: `prunelle check`, `prunelle compiler:`, `prunelle build:`, `prunelle:` runtime, or TypeScript error categories hit `>= 2` times in one session. Highlights **weak or non-actionable diagnostics** that should carry a clearer fix.
- **`eagerJsBytes`**: Peak gzipped eager JS across routes from `prunelle build --analyze --json`, checked against each task's `--max-js` budget.
