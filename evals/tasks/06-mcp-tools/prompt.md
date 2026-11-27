# Task 06: Typed MCP Tools with Bearer Auth & Footprint Budget

Expose typed Prunelle server `action()` endpoints as Model Context Protocol (MCP) tools via `@prunellejs/mcp` at `/mcp/tools`, secured by bearer authentication and verified against the MCP footprint budget.

## Requirements

1. **Typed Actions (`src/actions/items.ts`)**:
   - Export at least 2 top-level named Prunelle `action()` functions:
     - `listItems`: lists items (accepts optional filter or no required input).
     - `createItem`: validates `{ title: string }` (non-empty string, min 2 chars) via a Standard Schema v1 schema and adds an item to an in-memory store, returning the created item.

2. **MCP Plugin Configuration (`prunelle.config.ts`)**:
   - Register `mcp({ ... })` from `@prunellejs/mcp` at the default path `/mcp/tools`.
   - Configure bearer auth via `token: { env: 'MCP_TOKEN' }`.
   - Expose `list_items` (read-only annotation `{ readOnlyHint: true }`) and `create_item` using `mcpTool({ action, description, ... })`.
   - Use compact output formatting (e.g. `formatTable` or `formatLines`) and enable strict budget checking: `budget: { maxToolBytes: 2048, strict: true }`.

3. **Landing Page (`src/routes/index.tsx`)**:
   - Render a simple static status/documentation page listing the available MCP endpoint (`/mcp/tools`) and tools.

4. **Verification**:
   - `prunelle check` passes (including the `@prunellejs/mcp` strict budget check).
   - `prunelle build --analyze --max-js 15kb` succeeds.
   - `POST /mcp/tools` rejects missing/invalid `Authorization: Bearer` headers with `401`.
   - With valid `Authorization: Bearer $MCP_TOKEN`, JSON-RPC `initialize`, `tools/list`, and `tools/call` (both valid and schema-invalid calls) behave according to MCP Streamable HTTP (`2025-03-26`).
