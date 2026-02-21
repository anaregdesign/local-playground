# Commit Messages

- Write commit messages following the Conventional Commits specification: https://www.conventionalcommits.org/
- Use this format: `<type>[optional scope]: <description>`
- Common `type` examples: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

# Implementation Policy

## Product Identity

- App name is `Local Playground`.
- Keep terminology consistent in UI/docs: `Playground`, `Threads`, `MCP Servers`, `Settings`.
- Keep a desktop-first UX while preserving responsive behavior.

## Layout / UX

- Main layout is two-pane:
  - Left pane: always-visible `Playground` chat area.
  - Right pane: tabbed side panel (`Threads`, `MCP Servers`, `Settings`).
- Keep the vertical splitter between left/right panes resizable.
- Keep right-pane width bounded for desktop usability:
  - right pane minimum: `320px`
  - left pane minimum: `560px`
- On narrow screens (`<= 980px`), switch to stacked layout:
  - top: chat
  - bottom: side panel
  - hide vertical splitter
- Keep `Added MCP Servers` visible in the chat footer as bubble chips under the composer (not in the right pane).
- Keep chat attachment bubbles visible under the composer while drafting.
- Keep thread controls in the Playground header:
  - editable active thread name
  - new thread action
- Use Fluent UI components and patterns as default. Apply custom CSS only where needed for layout clarity, splitter behavior, and compact desktop spacing.

## Frontend Component Architecture

- Keep component boundaries aligned with the real DOM tree.
- For `home` UI, preserve this directory structure:
  - `app/components/home/playground/` for left-pane Playground panel and renderers
  - `app/components/home/config/` for right-pane configuration panel
  - `app/components/home/config/threads/` for Threads tab and its sections
  - `app/components/home/config/mcp/` for MCP Servers tab and its sections
  - `app/components/home/config/settings/` for Settings tab and its sections
  - `app/components/home/shared/` for reusable UI primitives and shared types
- Naming conventions:
  - `*Panel`: top-level pane container (`PlaygroundPanel`, `ConfigPanel`)
  - `*Tab`: tab content root under a panel (`ThreadsTab`, `McpServersTab`, `SettingsTab`)
  - `*Section`: vertically segmented form/content block inside a tab (`InstructionSection`, `ThreadsManageSection`, `McpAddServerSection`)
  - Shared primitives should use purpose-based names (`ConfigSection`, `StatusMessageList`, `AutoDismissStatusMessageList`, `LabeledTooltip`, `CopyIconButton`)
- `app/routes/home.tsx` should stay as visual composition only (layout + panel wiring), not runtime state/effects.
- Prefer one-directional dependencies:
  - panel -> tab -> section -> shared
  - avoid cross-importing siblings when a shared primitive is appropriate.

## Home Runtime Structure

- Keep Home runtime state, effects, and API handlers centralized in one controller file:
  - `app/lib/home/controller/use-workspace-controller.ts`
- Do not split primary state ownership across multiple hooks/files unless there is a clear technical need.
- Keep message/MCP renderer helpers outside the route file:
  - `app/components/home/playground/PlaygroundRenderers.tsx`
- `app/routes/home.tsx` must not re-grow into a large logic file; it should only compose `PlaygroundPanel`, splitter, and `ConfigPanel`.
- Prefer extracting pure data transforms into `app/lib/home/*` modules (no React state there).
- Keep per-thread state ownership in the controller:
  - messages
  - active MCP servers
  - MCP RPC history
  - agent instruction
  - thread request status (send/progress/error)

## Constants / Imports

- Define shared static constants in `app/lib/constants.ts`.
- Do not add new `UPPER_SNAKE_CASE` constants in feature files unless they are truly file-local and non-shared.
- Import constants directly from `~/lib/constants` with the same exported name.
  - Avoid alias renaming (`as`) for constants.
- Avoid re-export-only type/constant passthrough files; import from the source module directly.

## Visual Style Baseline (Current UI)

- Theme direction: light Fluent-like desktop UI with compact spacing and flat surfaces.
- Keep root design tokens in `app/app.css` as the style source of truth (font, background, text, accent, danger, bubbles).
- Keep Home-specific shape/typography tokens in `:root` (`--home-*`) and reuse them across components.
- Avoid duplicating hard-coded values for radius/font size/line-height when a token already exists.
- Keep page background as a soft gradient blend (`radial + linear`), not a flat solid color.
- Keep shell surfaces mostly flat:
  - white surfaces
  - minimal/no card shadows
  - tight borders using `--surface-border`
  - square-to-small radii (avoid oversized rounded cards)
- Keep typography stack:
  - UI text: `"Segoe UI", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif`
  - code/JSON: `"IBM Plex Mono", "SFMono-Regular", Menlo, monospace`
- Chat styling rules:
  - user messages are right-aligned tinted bubbles (`--bubble-user`)
  - assistant messages stay visually light/flat to prioritize content readability
  - markdown is rendered with compact spacing; JSON is syntax-highlighted
  - keep copy affordances (`⎘`) on messages and MCP logs
- MCP styling rules:
  - MCP Operation Log is inline per turn and collapsed by default (`<details>`)
  - nested MCP entries stay compact, with clear `ok`/`error` state coloring
  - keep request/response JSON blocks readable in constrained height areas
- Tab/side-panel styling rules:
  - use compact subtle tabs with clear selected-state border/background
  - keep setting groups vertically segmented with thin separators
  - preserve compact desktop-first spacing density

## Azure / Auth

- Use `DefaultAzureCredential` for Azure authentication.
- Do not rely on environment variables for Azure project/deployment selection.
- Discover accessible Azure OpenAI projects dynamically from Azure Resource Manager.
- Reload deployments when selected project changes.
- Show only Agents SDK-compatible deployments.
- Use Azure OpenAI v1 endpoint format (`.../openai/v1/`).
- Keep Playground locked while auth is unavailable and guide users to `Settings` login.
- Persist last-used Azure project/deployment per `tenantId` + `principalId`:
  - SQLite database: `local-playground.sqlite`
  - macOS/Linux default location: `~/.foundry_local_playground/local-playground.sqlite`
  - Windows default location: `%APPDATA%\\FoundryLocalPlayground\\local-playground.sqlite`
  - Windows fallback when `APPDATA` is unavailable: `%USERPROFILE%\\.foundry_local_playground\\local-playground.sqlite`

## Agents SDK / Chat Runtime

- Implement chat execution with Agents SDK (`@openai/agents` + `@openai/agents-openai`).
- Keep API error messages concise and in English.
- Preserve IME safety: Enter during composition must not submit.
- Do not expose `temperature` in UI settings; keep it optional at API boundary only.
- Render Markdown responses and apply syntax highlighting to JSON responses.
- Show concrete streaming progress states (not only generic `Thinking...`).
- Support chat attachments for Code Interpreter-compatible files with current validation limits from `app/lib/constants.ts`.

## Threads / Instruction Behavior

- Keep `Threads` as the default right-pane tab.
- Keep thread switching in `Threads` tab and quick new-thread flow in Playground header.
- Persist each thread snapshot in SQLite with:
  - thread metadata
  - instruction
  - messages
  - connected MCP servers
  - MCP RPC history
- Save active thread changes from controller logic (debounced/autosave where implemented).
- Agent instruction workflow lives in `Threads` tab and supports:
  - text edit
  - clear
  - load file (`.md`, `.txt`, `.xml`, `.json`, max `1MB`)
  - save on client side using save picker/download flow
  - AI enhancement using currently selected Azure project/deployment
  - diff review (adopt enhanced vs keep original)

## MCP Server Management

- Support transports: `streamable_http`, `sse`, `stdio`.
- Persist saved MCP profiles:
  - SQLite database: `local-playground.sqlite`
  - macOS/Linux default location: `~/.foundry_local_playground/local-playground.sqlite`
  - Windows default location: `%APPDATA%\\FoundryLocalPlayground\\local-playground.sqlite`
  - Windows fallback when `APPDATA` is unavailable: `%USERPROFILE%\\.foundry_local_playground\\local-playground.sqlite`
- Saved MCP profiles are selectable in `MCP Servers` tab and can be connected directly to the current thread.
- Adding a new MCP server should:
  - validate inputs by transport
  - save/update profile in DB
  - connect the resulting server to the active thread
- Detect duplicate configurations when saving:
  - reuse existing config
  - emit warning
  - allow rename behavior when incoming name differs
- For HTTP MCP:
  - always include `Content-Type: application/json`
  - allow additional custom headers
  - support per-server timeout and per-server Azure token scope
  - when Azure auth is enabled, inject `Authorization: Bearer <token>` at request time from `DefaultAzureCredential`

## MCP Debugging UX

- Keep MCP visibility high; this app is an MCP debugging workbench.
- Show MCP Operation Log inline in Playground per dialog turn.
- Do not render MCP log blocks when a turn has no MCP operations.
- Default MCP log panels to collapsed.
- Preserve request/response order and show JSON-RPC payloads.
- Show MCP communication logs on success and error paths.
- Provide copy actions for:
  - dialog content
  - whole MCP operation entry
  - request/response payload parts
- Use shared copy UI primitives for copy affordances to keep behavior and appearance consistent.

## Shared UI Primitives

- Reuse shared components in `app/components/home/shared/` instead of duplicating markup:
  - `ConfigSection` for section header/title/description shell
  - `StatusMessageList` for grouped status/error/success bars
  - `AutoDismissStatusMessageList` for timed dismissible status bars
  - `LabeledTooltip` for titled multiline tooltips
  - `CopyIconButton` for copy icon action buttons
- When adding new repeated UI patterns, extract to `shared` first if used in 2+ places.

## Build / Release

- Release trigger is tag push: `v*.*.*`.
- GitHub Actions should build OS installers and attach them to GitHub Release assets:
  - macOS (`.dmg`, `.zip`)
  - Windows (`.exe` via NSIS)
- Keep local packaging scripts aligned with workflow (`desktop:package*`).

## Documentation

- Keep `README.md` aligned with implemented behavior and script names.
- Keep screenshot assets in `docs/images/` current with the latest UI.
- When layout/UX changes are introduced, refresh screenshot files referenced by README.
- Prefer screenshots that show realistic usage value (meaningful prompt/response and relevant panel state), not empty UI.

## Quality Gates

- After UI/API changes, run:
  - `npm audit --omit=dev`
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`
- After refactors, remove dead code:
  - unused components/files
  - unused CSS selectors in `app/app.css`
  - stale/obsolete tests or old-name references
