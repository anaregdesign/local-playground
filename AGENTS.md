# Commit Messages

- Write commit messages following the Conventional Commits specification: https://www.conventionalcommits.org/
- Use this format: `<type>[optional scope]: <description>`
- Common `type` examples: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

# Implementation Policy

## Azure / Auth

- Use `DefaultAzureCredential` for Azure authentication.
- Do not rely on environment variables for Azure project or deployment selection.
- Discover accessible Azure OpenAI projects dynamically from Azure Resource Manager.
- Reload deployments when the selected project changes.
- Show only Agents SDK-compatible deployments.
- Use Azure OpenAI v1 endpoint format (`.../openai/v1/`).
- If authentication is unavailable, lock Playground usage and guide users to Settings login.

## Agents SDK / Playground

- Implement chat execution with Agents SDK (`@openai/agents` + `@openai/agents-openai`).
- Keep API error messages concise and in English.
- Preserve IME safety: pressing Enter during composition must not submit messages.
- Keep Playground unavailable while logged out; after successful login, make the Playground tab visually noticeable for guidance.

## UI / Interaction

- Use tab-based main navigation: `Playground`, `Settings`, and `MCP Servers`.
- Keep labels and actions easy to scan; use emojis effectively but avoid overuse.
- Keep login/logout actions visually distinct.
- Prefer simple, desktop-first readability while preserving responsive layout.

## Settings Validation

- `Context Window`: integer input with UI validation (`1` to `200`).
- `Temperature`: optional number input (`0` to `2`), empty means `None`.
- `Reasoning Effort`: support `none`, `low`, `medium`, `high`.
- Agent instruction file loading: allow `.md`, `.txt`, `.xml`, `.json` up to `1MB`.

## MCP Server Management

- Support transports: `streamable_http`, `sse`, `stdio`.
- Persist saved MCP profiles in `~/.mcp/mcp-servers.json`.
- Allow re-adding saved servers by selection.
- Detect duplicate configurations when saving; reuse existing config and return a warning (including rename behavior when name differs).

## Quality Gates

- After UI/API changes, run `npm run typecheck` and `npm run build`.
