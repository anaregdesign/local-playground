# Commit Messages

- Write commit messages following the Conventional Commits specification: https://www.conventionalcommits.org/
- Use this format: `<type>[optional scope]: <description>`
- Common `type` examples: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

# Implementation Policy

## Product Identity

- App name is `Local Playground`.
- Keep terminology consistent in UI/docs (`Playground`, `Settings`, `MCP Servers`).
- Preserve desktop-first readability while keeping responsive behavior.

## Azure / Auth

- Use `DefaultAzureCredential` for Azure authentication.
- Do not rely on environment variables for Azure project/deployment selection.
- Discover accessible Azure OpenAI projects dynamically from Azure Resource Manager.
- Reload deployments when the selected project changes.
- Show only Agents SDK-compatible deployments.
- Use Azure OpenAI v1 endpoint format (`.../openai/v1/`).
- Keep Playground locked while authentication is unavailable, and guide users to Settings login.
- Persist last-used Azure project/deployment per `tenantId`:
  - macOS/Linux: `~/.foundry_local_playground/azure-selection.json`
  - Windows: `%APPDATA%\\FoundryLocalPlayground\\azure-selection.json`
  - Legacy read fallback: `%USERPROFILE%\\.foundry_local_playground\\azure-selection.json`

## Agents SDK / Chat Runtime

- Implement chat execution with Agents SDK (`@openai/agents` + `@openai/agents-openai`).
- Keep API error messages concise and in English.
- Preserve IME safety: pressing Enter during composition must not submit messages.
- Do not expose `temperature` in Settings; keep it omitted in requests.
- Render Markdown responses.
- Apply syntax highlighting to JSON responses in Playground.
- Show concrete streaming progress states (not only generic "thinking").

## UI / Fluent UI

- Follow Fluent UI design patterns across the app.
- Prefer Fluent UI components/layout/theme tokens over custom HTML/CSS controls.
- Keep custom CSS minimal and focused on layout/scoping; avoid visual overrides unless required for accessibility or critical UX.
- Use tab-based main navigation: `Playground`, `Settings`, `MCP Servers`.
- Keep login/logout actions visually distinct.
- After successful login, make the `Playground` tab visually noticeable.

## Settings Behavior

- `Reasoning Effort`: support `none`, `low`, `medium`, `high`.
- `Context Window`: integer input with UI validation (`1` to `200`).
- Agent instruction supports:
  - direct text editing
  - clear action
  - file loading for `.md`, `.txt`, `.xml`, `.json` up to `1MB`

## MCP Server Management

- Support transports: `streamable_http`, `sse`, `stdio`.
- Persist saved MCP profiles:
  - macOS/Linux: `~/.foundry_local_playground/mcp-servers.json`
  - Windows: `%APPDATA%\\FoundryLocalPlayground\\mcp-servers.json`
  - Legacy read fallback: `%USERPROFILE%\\.foundry_local_playground\\mcp-servers.json`
- Saved configs are loaded into the Add form first, then added by user action.
- Detect duplicate configurations when saving, reuse existing config, and return a warning (including rename behavior when name differs).
- For HTTP MCP:
  - `Content-Type: application/json` is always included
  - allow additional custom headers
  - allow per-server timeout and per-server Azure token scope
  - when Azure auth is enabled, inject `Authorization: Bearer <token>` at request time from `DefaultAzureCredential`

## MCP Debugging UX

- This app is an MCP debugging workbench; keep MCP visibility high.
- Show MCP Operation Log inline in Playground tied to dialog turns.
- Show MCP logs for active thinking and error turns as well.
- Keep JSON-RPC request/response visible in order.
- Provide copy actions for dialog text and MCP log payloads.
- Keep JSON syntax highlighting for MCP JSON payloads.
- In `MCP Servers` tab, keep `Added MCP Servers` visually prominent on the left for desktop layouts, while preserving responsive stacking on narrow screens.

## Quality Gates

- After UI/API changes, run:
  - `npm run typecheck`
  - `npm run build`
  - `npm run test`
