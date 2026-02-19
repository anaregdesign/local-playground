# Commit Messages

- Write commit messages following the Conventional Commits specification: https://www.conventionalcommits.org/
- Use this format: `<type>[optional scope]: <description>`
- Common `type` examples: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

# Implementation Policy

## Product Identity

- App name is `Local Playground`.
- Keep terminology consistent in UI/docs: `Playground`, `Settings`, `MCP Servers`.
- Keep a desktop-first UX while preserving responsive behavior.

## Layout / UX

- Main layout is two-pane:
  - Left pane: always-visible `Playground` chat area
  - Right pane: `Settings` / `MCP Servers` tabs
- Keep the vertical splitter between left/right panes resizable.
- Keep right-pane width bounded for desktop usability:
  - right pane minimum: `320px`
  - left pane minimum: `560px`
- On narrow screens (`<= 980px`), switch to stacked layout:
  - top: chat
  - bottom: side panel
  - hide vertical splitter
- Keep `Added MCP Servers` visible in the chat footer as bubble chips under the composer (not in the right pane).
- Right-pane horizontal splitter styles may exist in CSS, but the current implementation uses a single scrollable panel area.
- Use Fluent UI components and patterns as default. Apply custom CSS only where needed for layout clarity, splitter behavior, and compact desktop spacing.

## Frontend Component Architecture

- Keep component boundaries aligned with the real DOM tree.
- For `home` UI, preserve this directory structure:
  - `app/components/home/playground/` for left-pane Playground panel
  - `app/components/home/config/` for right-pane configuration panel
  - `app/components/home/config/settings/` for Settings tab and its sections
  - `app/components/home/config/mcp/` for MCP Servers tab and its sections
  - `app/components/home/shared/` for reusable UI primitives and shared types
- Naming conventions:
  - `*Panel`: top-level pane container (`PlaygroundPanel`, `ConfigPanel`)
  - `*Tab`: tab content root under a panel (`SettingsTab`, `McpServersTab`)
  - `*Section`: vertically segmented form/content block inside a tab
  - Shared primitives should use purpose-based names (`ConfigSection`, `StatusMessageList`, `LabeledTooltip`, `CopyIconButton`)
- `app/routes/home.tsx` should focus on state orchestration and composition, not large inline UI markup.
- Prefer one-directional dependencies:
  - panel -> tab -> section -> shared
  - avoid cross-importing siblings when a shared primitive is appropriate.

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
- Persist last-used Azure project/deployment per `tenantId`:
  - macOS/Linux: `~/.foundry_local_playground/azure-selection.json`
  - Windows: `%APPDATA%\\FoundryLocalPlayground\\azure-selection.json`
  - legacy read fallback: `%USERPROFILE%\\.foundry_local_playground\\azure-selection.json`

## Agents SDK / Chat Runtime

- Implement chat execution with Agents SDK (`@openai/agents` + `@openai/agents-openai`).
- Keep API error messages concise and in English.
- Preserve IME safety: Enter during composition must not submit.
- Do not expose `temperature` in Settings; omit it from requests.
- Render Markdown responses and apply syntax highlighting to JSON responses.
- Show concrete streaming progress states (not only generic `Thinking...`).

## Settings Behavior

- `Reasoning Effort`: support `none`, `low`, `medium`, `high`.
- `Context Window`: integer input with UI validation (`1` to `200`).
- Agent instruction supports:
  - text edit
  - clear
  - load file (`.md`, `.txt`, `.xml`, `.json`, max `1MB`)
  - save on the client side using save picker/download flow (user chooses destination and file name)
  - AI enhancement using currently selected Azure project/deployment
  - diff review (adopt enhanced vs keep original)

## MCP Server Management

- Support transports: `streamable_http`, `sse`, `stdio`.
- Persist saved MCP profiles:
  - macOS/Linux: `~/.foundry_local_playground/mcp-servers.json`
  - Windows: `%APPDATA%\\FoundryLocalPlayground\\mcp-servers.json`
  - legacy read fallback: `%USERPROFILE%\\.foundry_local_playground\\mcp-servers.json`
- Saved configs must load into the Add form first, then be added explicitly.
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
