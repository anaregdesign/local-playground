# Local Playground Review Checklist

Use this checklist before finalizing any substantial change in this repository.

## Usage Timing (Mandatory)

Run this checklist repeatedly, not only at the end.

1. Pre-change gate:
   - Run sections 0-4 before editing.
2. In-change gate:
   - Re-run sections 0-4 after each logical change batch.
3. Final gate:
   - Run sections 0-7 before final response.

If any section fails, stop and fix before continuing.

## 0) Scope and Invocation Gate (Mandatory)

### Goal

Ensure this skill is used only for this repository and used for every implementation task.

### Checks

1. Confirm current task is Local Playground development work in the `local-playground` repository.
2. Confirm this skill was invoked before implementation and kept active during the task.
3. If repository scope differs, stop and switch to an appropriate skill.
4. Confirm the development-phase rule is applied: no backward compatibility/fallback implementation unless explicitly requested.

### Pass Criteria

- Task scope is this repository.
- Skill usage is explicit and continuous for the full implementation task.
- No unnecessary compatibility/fallback paths were added.

## 1) Shared Component First (Highest Priority)

### Goal

Prevent duplicated UI patterns and keep behavior consistent.

### Checks

1. Inspect existing shared primitives first.

```bash
rg --files app/components/home/shared
```

2. Verify changed Home UI files import and reuse primitives from the shared directory where applicable.

```bash
rg -n "from ['\\\"]~/components/home/shared|from ['\\\"].*/home/shared" app/components/home
```

3. If new markup pattern appears in 2+ places, extract to `app/components/home/shared/` immediately.
4. If a new copy button, tooltip shell, or status bar was added outside `shared`, treat it as a refactor candidate.

### Pass Criteria

- No avoidable duplicated wrapper patterns in tab/section files.
- Repeated patterns are centralized in `shared`.

## 2) Directory Structure and Naming Integrity

### Goal

Keep the `home` component tree aligned with architecture rules.

### Checks

1. Review changed files.

```bash
git diff --name-only
```

2. Confirm each new/changed file is in the correct folder:
   - Playground panel/renderers -> `app/components/home/playground/`
   - Config panel shell -> `app/components/home/config/`
   - Threads tab/sections -> `app/components/home/config/threads/`
   - MCP tab/sections -> `app/components/home/config/mcp/`
   - Settings tab/sections -> `app/components/home/config/settings/`
   - Reusable primitives -> `app/components/home/shared/`
3. Confirm naming conventions:
   - top-level panes: `*Panel`
   - tab roots: `*Tab`
   - tab subsections: `*Section`

### Pass Criteria

- File placement matches feature ownership.
- Names communicate structural role (`Panel`, `Tab`, `Section`).

## 3) Route vs Controller Ownership

### Goal

Keep route composition lightweight and runtime state centralized.

### Checks

1. Ensure Home route entries under `app/routes/` stay composition focused.

```bash
git diff --name-only | rg "^app/routes/"
```

2. If Home route modules in `app/routes/` changed, verify they are composition-focused (avoid primary runtime state ownership there).

```bash
rg -n "useState|useReducer|useEffect|useMemo|useCallback" app/routes
```

3. Keep thread/runtime ownership and persistence orchestration in `app/lib/home/controller/`.

```bash
git diff --name-only | rg "^app/lib/home/controller/"
```

### Pass Criteria

- Home route entries remain layout wiring only.
- Runtime state ownership is not fragmented across route-level hooks.

## 4) State Persistence Policy (React First, Delayed DB Write)

### Goal

Keep interactive state responsive and persistence stable.

### Checks

1. Confirm persistent state is held in React/controller state first.
2. Confirm DB writes use delayed persistence (debounce/autosave), not eager write-on-every-change.
3. Confirm persistence orchestration lives in controller code (`app/lib/home/controller/`) or controller-adjacent runtime modules.
4. Treat SQLite records as durable snapshots, not as the immediate interaction source.

### Pass Criteria

- No unnecessary eager DB writes on each input mutation.
- React/controller remains the primary state owner during UI interaction.

## 5) Constants and Imports Hygiene

### Goal

Avoid drift in constant ownership and import style.

### Checks

1. Confirm shared constants are centralized under `app/lib/` (constants modules).
2. Avoid new non-local `UPPER_SNAKE_CASE` constants in feature files.
3. Import constants directly from the project constants module under `~/lib/` with original names.

### Pass Criteria

- Shared constants are centralized.
- Constant imports are direct and unaliased.

## 6) UX and Layout Guardrails

### Goal

Preserve desktop-first two-pane UX and responsive behavior.

### Checks

1. Verify layout keeps:
   - left `Playground`, right tabbed panel
   - vertical splitter on desktop
   - stacked layout at narrow widths (`<= 980px`)
2. Verify minimum widths are preserved:
   - right pane min `320px`
   - left pane min `560px`
3. Keep `Added MCP Servers` chips and attachment bubbles under the composer.

### Pass Criteria

- No regression in two-pane behavior, splitter, or narrow-screen fallback.

## 7) Final Quality Gates (Required)

Run all commands:

```bash
npm audit --omit=dev
npm run typecheck
npm run build
npm run test
```

### Pass Criteria

- All required checks pass.
- Any intentional exceptions are documented in the final response.

## Compliance Report Format

Use this format in implementation responses:

1. Pre-change gate: pass/fail and key findings.
2. In-change gate: pass/fail and fixes applied during implementation.
3. Final gate: pass/fail for sections 1-7 and quality gates.
