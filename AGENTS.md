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
- Keep both splitters resizable:
  - vertical splitter between left/right panes
  - horizontal splitter inside right pane
- Keep `Added MCP Servers` always visible in the lower half of the right pane.
- Use Fluent UI components and patterns as default. Apply custom CSS only where needed for layout clarity, splitter behavior, and compact desktop spacing.

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
  - save to `~/.foundry_local_playground/prompts`
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

## Quality Gates

- After UI/API changes, run:
  - `npm audit --omit=dev`
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`
