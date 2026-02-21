# Local Playground

`Local Playground` is a desktop-first workbench for validating Azure OpenAI agents and MCP servers locally.
It lets you move from prompt testing to MCP request/response debugging in one place, without switching tools.

## At A Glance

- Chat playground powered by Agents SDK
- Thread-level Agent Skills (`SKILL.md`) discovery and activation
- Separate Azure project/deployment defaults for `Playground` and `Utility Model`
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
Configure Azure login, `Playground` model, and `Utility Model` defaults from one place.

### MCP Servers

![Local Playground MCP servers view](docs/images/local-playground-mcp-servers.png)
Load saved configs, adjust transport/auth details, and add servers directly to the active chat session.

## Quick Start (Copy & Paste)

```bash
git clone https://github.com/anaregdesign/local-playground.git
cd local-playground
npm install
# set if CODEX_HOME is not already set
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
# install Local Playground skill with Codex standard setup
mkdir -p "$CODEX_HOME/skills"
ln -sfn "$(pwd)/skills/local-playground-dev" "$CODEX_HOME/skills/local-playground-dev"
# restart Codex or start a new session after installation
az login
npm run dev
```

Open `http://localhost:5173`.

## Main Features

- Two-pane desktop layout with draggable splitter for chat vs. configuration work
- Markdown rendering and JSON syntax highlighting for fast response inspection
- Agent Instruction local file load/save (client-side save dialog) and enhance workflow with diff review
- Skills panel in `Threads` tab for `agentskills`-compatible `SKILL.md` selection
- Dedicated `Utility Model` selection (deployment + reasoning effort) for instruction enhancement workflows
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

Release builds are signed for OS trust checks:

- macOS: Developer ID code signing + Apple notarization (stapled)
- Windows: Authenticode signing (SHA-256 + timestamp)

Configure these GitHub repository secrets for release packaging:

- `MACOS_CERTIFICATE_P12_BASE64` (Developer ID Application certificate in base64)
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_NOTARY_KEY_P8` (App Store Connect API key `.p8` content)
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`
- `WINDOWS_CERTIFICATE_PFX_BASE64` (Code signing certificate in base64)
- `WINDOWS_CERTIFICATE_PASSWORD`

### Persistence Paths

Configuration directory:

- macOS/Linux: `~/.foundry_local_playground/`
- Windows: `%APPDATA%\FoundryLocalPlayground\`

SQLite database:

- `local-playground.sqlite`
- Stores Azure selection preferences (Playground/Utility) and saved MCP profiles

If `APPDATA` is unavailable on Windows, path falls back to:

- `%USERPROFILE%\.foundry_local_playground\`

### Common Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run test`
