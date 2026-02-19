# Local Playground

`Local Playground` is a desktop-first workbench for validating Azure OpenAI agents and MCP servers locally.
It lets you move from prompt testing to MCP request/response debugging in one place, without switching tools.

## At A Glance

- Chat playground powered by Agents SDK
- Azure project/deployment selection with `DefaultAzureCredential`
- MCP server testing (`streamable_http`, `sse`, `stdio`)
- Inline MCP operation logs (JSON-RPC request/response)

## Why Teams Use It

- Validate end-to-end behavior quickly: prompt, tool call, MCP payload, and response in one flow
- Keep debugging context on-screen with side-by-side `Playground` and `Settings` / `MCP Servers`
- Reuse MCP configurations safely with per-server headers, Azure auth scope, and timeout controls

## Screenshots

### Playground

![Local Playground playground view](docs/images/local-playground-chat-log.png)
Run practical prompts while keeping deployment controls and active MCP servers visible.

### Settings

![Local Playground settings view](docs/images/local-playground-settings.png)
Tune agent instruction and confirm the active Azure connection before each run.

### MCP Servers

![Local Playground MCP servers view](docs/images/local-playground-mcp-servers.png)
Load saved configs, adjust transport/auth details, and add servers directly to the active chat session.

## Quick Start (Copy & Paste)

```bash
git clone https://github.com/anaregdesign/local-playground.git
cd local-playground
npm install
az login
npm run dev
```

Open `http://localhost:5173`.

## Main Features

- Two-pane desktop layout with draggable splitter for chat vs. configuration work
- Markdown rendering and JSON syntax highlighting for fast response inspection
- Agent Instruction local file load/save (client-side save dialog) and enhance workflow with diff review
- Per-server MCP headers, Azure auth scope, and timeout controls

## Developer Details

### Desktop Shell (Electron)

```bash
# development shell
npm run desktop:dev

# production-like local shell
npm run desktop:start

# build installers
npm run desktop:package
```

Per-OS packaging:

- `npm run desktop:package:mac`
- `npm run desktop:package:win`

### Release Artifacts

Pushing a `v*.*.*` tag triggers GitHub Actions to publish installers to GitHub Releases:

- macOS: `.dmg`, `.zip`
- Windows: `.exe` (NSIS)

### Persistence Paths

Configuration directory:

- macOS/Linux: `~/.foundry_local_playground/`
- Windows: `%APPDATA%\FoundryLocalPlayground\`

Files:

- Azure selection: `azure-selection.json`
- MCP profiles: `mcp-servers.json`

Legacy Windows fallback is also read:

- `%USERPROFILE%\.foundry_local_playground\`

### Common Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run test`
