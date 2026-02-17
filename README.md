# Local Playground

`Local Playground` is a desktop-first Azure OpenAI + Agents SDK workbench.
It focuses on real-world local debugging workflows, especially for MCP server integration.

## What It Provides

- Two-pane desktop UI:
  - Left: always-visible Playground chat
  - Right: `Settings` / `MCP Servers` tabs
- Resizable layout:
  - Drag left/right pane splitter
  - Drag right-pane top/bottom splitter
- Azure connection flow with `DefaultAzureCredential`:
  - Dynamic Azure project discovery
  - Deployment reload on project change
  - v1 endpoint usage (`.../openai/v1/`)
- Agents SDK chat runtime:
  - `@openai/agents` + `@openai/agents-openai`
  - IME-safe Enter handling
  - concise English error messages
- Instruction workflow:
  - edit / load / clear / save
  - enhance instruction with selected Azure deployment
  - GitHub-style diff review and adopt/original choice
- MCP workflow:
  - transports: `streamable_http`, `sse`, `stdio`
  - saved config load/edit/re-add
  - additional HTTP headers
  - per-server Azure Bearer auth scope + timeout
  - inline MCP Operation Log with JSON-RPC request/response and copy actions
- Message rendering:
  - Markdown rendering
  - JSON syntax highlighting

## Quick Start (Copy & Paste)

```bash
git clone https://github.com/anaregdesign/local-playground.git
cd local-playground
npm install
az login
npm run dev
```

Open `http://localhost:5173`.

## Desktop App (macOS / Windows / Linux)

The repository also ships an Electron desktop shell.

- Dev shell:

```bash
npm run desktop:dev
```

- Production-like local shell:

```bash
npm run desktop:start
```

- Build installers locally:

```bash
npm run desktop:package
```

Per-OS packaging commands:

- `npm run desktop:package:mac`
- `npm run desktop:package:win`
- `npm run desktop:package:linux`

## Release Artifacts

When a `v*.*.*` tag is pushed, GitHub Actions builds and publishes OS installers to GitHub Releases:

- macOS: `.dmg`, `.zip`
- Windows: `.exe` (NSIS)
- Linux: `.AppImage`, `.deb`

## Screenshots (Latest UI)

### Playground

![Local Playground playground view](docs/images/local-playground-chat-log.png)

### Settings

![Local Playground settings view](docs/images/local-playground-settings.png)

### MCP Servers

![Local Playground MCP servers view](docs/images/local-playground-mcp-servers.png)

## Persistence Paths

Configuration is stored under:

- macOS/Linux: `~/.foundry_local_playground/`
- Windows: `%APPDATA%\FoundryLocalPlayground\`

Files:

- Azure selection: `azure-selection.json`
- MCP profiles: `mcp-servers.json`
- Saved prompts: `prompts/`

Legacy Windows fallback is still read from:

- `%USERPROFILE%\.foundry_local_playground\`

## Scripts

- `npm run dev`: start web dev server
- `npm run build`: build web app
- `npm run start`: run built web app
- `npm run desktop:dev`: run web dev + Electron shell
- `npm run desktop:start`: run built app in Electron shell
- `npm run desktop:package`: build desktop installer(s)
- `npm run typecheck`: TypeScript validation
- `npm run test`: unit tests
