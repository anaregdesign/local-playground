---
name: local-playground-dev
description: Mandatory policy compliance workflow for Local Playground implementation tasks. Use only for development work in the local-playground repository, and use for every code change in that repository to run repeated AGENTS.md conformance checks before, during, and after implementation.
---

# Local Playground Compliance Workflow

## 0) Enforce Scope and Mandatory Invocation

- Use this skill only for Local Playground development work in this repository.
- Invoke this skill for every development task before editing code.
- Keep this skill active through implementation and final verification.
- Do not apply this skill to other repositories; stop and switch skills if repository scope differs.

## 1) Run Mandatory Compliance Loop

Run this loop for every implementation task.

1. Pre-change gate:
   - Read `AGENTS.md`.
   - Map expected policy constraints before editing.
   - Run quick checks from `references/review-checklist.md` sections 0-4.
2. In-change gate:
   - Implement in small batches.
   - Re-run sections 0-4 after each batch that touches UI/runtime architecture.
   - Fix policy drift immediately before continuing.
3. Final gate:
   - Run full checklist (`references/review-checklist.md` sections 0-7).
   - Run required quality gates before final response.
4. Report gate:
   - Report policy conformance status explicitly.
   - If a rule is intentionally violated, explain reason and scope.
   - For naming/API refactors, include whether static drift checks reached zero findings.

### Development Phase Override

- This repository is currently in active development mode.
- Do not introduce backward compatibility layers or fallback paths unless the user explicitly asks for them.
- Prefer replacing old contracts and state shapes directly.

## 2) Enforce Core Architecture Constraints

- Keep UI terminology consistent: `Playground`, `Threads`, `MCP Servers`, `Skills`, `Settings`.
- Treat Prisma schema entity/field terminology as the canonical domain vocabulary.
- Keep a single term per domain concept across schema references, runtime types, API contracts, component props, tests, and docs.
- When terminology changes, perform an end-to-end rename in one batch and remove legacy aliases (unless explicitly requested).
- Enforce REST API contract standards for `app/routes/api.*`:
  - resource-first collection/item routing
  - noun-based resource paths (verb paths only for explicit command-style exceptions)
  - mutation resource IDs in path params (not query params)
  - query params only for read concerns (filtering/pagination/sorting/projection)
  - side-effect-free `GET` handlers
  - method semantics: `POST` create/non-idempotent, `PUT`/`PATCH` updates, `DELETE` idempotent delete
  - status codes: `200`/`201`/`204` success semantics, `409` state conflicts, `422` validation failures
  - `methodNotAllowedResponse` for `405` responses with `Allow`
  - structured JSON error payloads with stable machine-readable code and concise message
- Keep command-style API exceptions scoped to Agents SDK runtime endpoints only:
  - `/api/chat`
  - `/api/instruction-patches`
  - `/api/threads/title-suggestions`
- When any `app/routes/api.*` file changes, run REST compliance verification in the same batch:
  - static checks for raw `405`, mutation query-contract drift, and status-code usage consistency
  - `npm run test:core -- app/routes/api.*.test.ts`
  - `npm run typecheck:core`
- When `prisma/schema.prisma` changes for persisted models/fields, update `/mcp/debug` schema design descriptions in `app/lib/server/persistence/mcp-debug-database.ts` in the same change batch:
  - `tableDefinitions` metadata entries
  - latest-thread schema-source model list (`buildDatabaseDebugLatestThreadToolDescription`)
  - affected MCP debug tool descriptions derived from metadata
- Keep `app/lib/server/persistence/mcp-debug-database.test.ts` aligned with metadata changes.
- Use semantic naming for ordering and log concepts:
  - same behavior -> same identifier family
  - different behavior -> different identifier family
  - avoid protocol- or storage-specific names when the app-level concept is broader
- Keep Home route modules in `app/routes/` as visual composition and panel wiring only.
- Keep Home runtime ownership in `app/lib/home/controller/`.
- Map each change to the approved `home` structure:
  - `app/components/home/authorize/`: auth-only top-level panel(s) for sign-in-required states.
  - `app/components/home/playground/`: left-pane Playground panel and renderers.
  - `app/components/home/config/`: right-pane panel shell and tab wiring.
  - `app/components/home/config/threads/`: Threads tab and sections.
  - `app/components/home/config/mcp/`: MCP Servers tab and sections.
  - `app/components/home/config/skills/`: Skills tab and sections.
  - `app/components/home/config/settings/`: Settings tab and sections.
  - `app/components/home/shared/`: reusable primitives and shared types.
  - `app/lib/home/*`: runtime helpers and pure transforms.
- Keep top-level panels as siblings under `app/components/home/` to match DOM hierarchy.
  - Never place one top-level panel under another panel directory.
- Preserve dependency direction: panel -> tab -> section -> shared.

## 3) Enforce State Persistence Policy

- Keep persistent application state in React runtime first (controller-owned state in `app/lib/home/controller/`).
- Persist that state to SQLite via delayed writes (debounced/autosave), not eager write-on-every-change.
- Treat DB as durable snapshot storage; treat React state as the immediate source of truth during interaction.
- Implement persistence from controller logic under `app/lib/home/controller/`.
- Local development debugging may use the web server MCP endpoint at `/mcp/debug`, including DB table inspection, but keep that workflow development-only.

## 4) Enforce Shared-Component-First Policy

- Check `app/components/home/shared/` before creating new UI wrappers or repeated markup.
- Reuse existing shared primitives from `app/components/home/shared/` first.
- If a pattern is used or expected in 2+ places, extract it to `shared` instead of duplicating.
- Keep shared static constants centralized under `app/lib/` (constants modules).
- Import constants directly from the project constants module under `~/lib/` without alias renaming.

## 5) Execute Compliance Checklist Every Time

- Use `references/review-checklist.md` at pre-change, in-change, and final gates.
- Treat sections 0-4 as continuous guardrails during implementation.
- For naming/contract refactors, run repeated static drift checks plus dynamic gates until findings are zero.

## 6) Run Mandatory Quality Gates

After UI/API changes, run:

```bash
npm run quality:gate
```

Equivalent expanded checks for troubleshooting:

```bash
npm audit --omit=dev
npm run prisma:generate
npm run typecheck:core
npm run test:core
npm run build:core
```

After refactors:

- Remove dead files, selectors, and stale tests.
- Refresh `README.md` and `docs/images/` when user-facing UX/layout changes.
- If `app/routes/api.*` changed, run:
  - `npm run test:core -- app/routes/api.*.test.ts`
  - REST static checks from `references/review-checklist.md` section 2 API contract items
- If persisted Prisma models/fields changed, run:
  - `npm run test:core -- app/lib/server/persistence/mcp-debug-database.test.ts`

## 7) Keep Commits Consistent

- Use Conventional Commits: `<type>[optional scope]: <description>`.
- Keep scope aligned with the subsystem being changed (`home`, `threads`, `mcp`, `settings`, `docs`).

## References

- `references/review-checklist.md`
