# Local Playground

`Local Playground` is a desktop-first workbench for testing Azure OpenAI chat flows, MCP servers, and thread-level skills in one place.

## Quick Start

```bash
git clone https://github.com/anaregdesign/local-playground.git
cd local-playground
npm install
npm run dev
```

Open `http://localhost:5173`. If the sign-in-required screen appears, click `Azure Login` and complete browser authentication.

### Optional: Enable Local Codex Skill (Contributors)

If you are developing this repository with Codex and want policy checks from `local-playground-dev`:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
npm run skill:enable
```

After updating the skill link, restart Codex (or start a new session).

## Current Specification

### Layout and navigation

- Two-pane desktop layout:
  - Left: `Playground` chat area (always visible).
  - Right: tab panel with `Threads`, `MCP Servers`, `Skills`, `Settings`.
- Vertical splitter between panes is draggable.
- Width bounds:
  - Left minimum: `560px`
  - Right minimum: `320px`
- On narrow screens (`<= 980px`), layout switches to stacked mode:
  - Top: chat
  - Bottom: side panel
  - Splitter hidden
- `Added MCP Servers`, selected `Skills`, and attachment bubbles are shown below the composer.

### Chat runtime

- Chat execution is powered by Agents SDK (`@openai/agents`, `@openai/agents-openai`).
- Azure auth is required for chat. The app uses `DefaultAzureCredential` flow via interactive browser login.
- When auth is missing, the app shows a dedicated sign-in panel (`Azure Login`) and keeps Playground unavailable until login completes.
- Azure OpenAI endpoint format is normalized to `.../openai/v1/`.
- Project and deployment options are discovered from Azure ARM dynamically.
- Deployment list is filtered to Agents SDK-compatible chat-capable models.
- Streaming progress statuses are shown during requests.
- Assistant responses support Markdown rendering and JSON syntax highlighting.

### Thread model and persistence

- Thread is the unit of state. Each thread stores:
  - metadata/name/archive state
  - instruction text
  - messages
  - connected MCP servers
  - MCP RPC history
  - selected skills
  - reasoning/web-search flags
- Thread changes are autosaved with delayed writes to SQLite.
- Archived threads are read-only and can be restored from `Archives`.

### Instruction workflow

- Edit instruction text in `Threads`.
- Load from local files: `.md`, `.txt`, `.xml`, `.json` (max `1MB`).
- Save instruction with save-picker/download flow.
- Enhance instruction via Utility model, then review unified diff and choose:
  - `Adopt Enhanced`
  - `Keep Original`

### MCP workflow

- Supported transports:
  - `streamable_http`
  - `sse`
  - `stdio`
- Save MCP profiles to SQLite, then attach/detach per thread.
- Duplicate config detection reuses existing entries with warning behavior.
- HTTP MCP always includes `Content-Type: application/json`.
- Optional Azure Bearer token injection per server (`Authorization: Bearer <token>`).
- Timeout range: `1-600` seconds.
- MCP operation logs are shown inline per turn and collapsed by default.
- During local development, the web server `/mcp` endpoint hosts an MCP server and can be used for debugging (including inspecting SQLite tables).

Default saved MCP profiles (created if missing):

- `openai-docs` (`https://developers.openai.com/mcp`)
- `microsoft-learn` (`https://learn.microsoft.com/api/mcp`)
- `workiq` (`npx -y @microsoft/workiq mcp`)
- `azure-mcp` (`npx -y @azure/mcp@latest server start`)
- `playwright` (`npx -y @playwright/mcp@latest`)

### Skills workflow

- Thread-level skill selection from discovered `SKILL.md` files.
- Discovery roots:
  - `$CODEX_HOME/skills/`
  - `<foundry-config-dir>/skills/`
- Registry install/remove flow supports:
  - Workspace local (`skills/default/`)
  - OpenAI curated (`openai/skills`)
  - Anthropic public (`anthropics/skills`)
  - Anaregdesign public (`anaregdesign/skills`, tagged layout)

## Screenshots

### Playground

![Local Playground playground view](docs/images/local-playground-chat-log.png)

### Settings

![Local Playground settings view](docs/images/local-playground-settings.png)

### MCP Servers

![Local Playground MCP servers view](docs/images/local-playground-mcp-servers.png)

## Minimal Code Example (Try MCP Quickly)

Use the included minimal stdio MCP server:

```bash
node examples/minimal-echo-mcp-server.mjs
```

Source: [`examples/minimal-echo-mcp-server.mjs`](examples/minimal-echo-mcp-server.mjs)

Connect it from Local Playground:

1. Open `MCP Servers` tab.
2. Set `Transport` to `stdio`.
3. Set `Command` to `node`.
4. Set `Arguments` to `examples/minimal-echo-mcp-server.mjs`.
5. (Optional) Set `Working directory` to this repository root path.
6. Click `Add Server`.
7. Send a prompt such as: `Use local_echo with text "hello".`

## Desktop (Electron)

```bash
npm run desktop:dev
npm run desktop:start
npm run desktop:package
```

Per-OS packaging:

- `npm run desktop:package:mac`
- `npm run desktop:package:win`

## Data Paths

Configuration directory:

- macOS/Linux: `~/.foundry_local_playground/`
- Windows: `%APPDATA%\\FoundryLocalPlayground\\`
- Windows fallback: `%USERPROFILE%\\.foundry_local_playground\\`

SQLite database:

- `<config-dir>/local-playground.sqlite`

## Common Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run test`
- `npm run quality:gate`
- `npm run desktop:dev`
- `npm run skill:enable`

`quality:gate` runs the same checks as CI:

- `npm audit --omit=dev`
- `npm run prisma:generate`
- `npm run typecheck:core`
- `npm run test:core`
- `npm run build:core`

## License

MIT (`LICENSE`)
