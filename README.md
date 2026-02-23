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
ln -sfn "$(pwd)/skills/.dev/local-playground-dev" "$CODEX_HOME/skills/local-playground-dev"
# restart Codex or start a new session after installation
npm run dev
```

Open `http://localhost:5173`.
Then click `Azure Login` in the app `Settings` tab.

## Main Features

- Two-pane desktop layout with draggable splitter for chat vs. configuration work
- Markdown rendering and JSON syntax highlighting for fast response inspection
- Agent Instruction local file load/save (client-side save dialog) and enhance workflow with diff review
- Skills panel in `Threads` tab for `agentskills`-compatible `SKILL.md` selection
- Dedicated `Utility Model` selection (deployment + reasoning effort) for instruction enhancement workflows
- Per-server MCP headers, Azure auth scope, and timeout controls
- Default saved MCP profiles (not connected by default):
  - `openai-docs` (`https://developers.openai.com/mcp`)
  - `microsoft-learn` (`https://learn.microsoft.com/api/mcp`)
  - `workiq` (`npx -y @microsoft/workiq mcp`)
  - `azure-mcp` (`npx -y @azure/mcp@latest server start`)
  - `playwright` (`npx -y @playwright/mcp@latest`)

## Developer Details

### Home UI Structure

- `app/components/home/authorize/`: auth-only top-level panel(s) for unauthenticated state
- `app/components/home/playground/`: Playground panel and message/MCP renderers
- `app/components/home/config/`: right-side configuration panel and tabs
- Keep top-level panels as sibling directories under `app/components/home/` to match DOM hierarchy.

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

Packaged desktop builds automatically check GitHub Releases for new versions and show an in-app update prompt in English when an update is available or ready to install.

### Release Artifacts

Pushing a `v*.*.*` tag triggers GitHub Actions to publish installers to GitHub Releases:

- macOS: `.dmg`, `.zip`
- Auto-update metadata: `latest-mac.yml` (and related `.blockmap` files when generated)
- Integrity assets: `SHA256SUMS.txt` is always published. `release-signing-key.pem` and detached signatures (`*.sig`) are published when release signing is configured.
- Optional GitHub secrets for release signing: `RELEASE_SIGNING_PRIVATE_KEY_PEM`, `RELEASE_SIGNING_PRIVATE_KEY_PASSPHRASE`

Release builds are signed for OS trust checks:

- macOS: Developer ID code signing + Apple notarization (stapled)
- Release artifacts: SHA-256 checksums are always available. Detached signature verification is available when `release-signing-key.pem` is published.

### Persistence Paths

Configuration directory:

- macOS: `~/.foundry_local_playground/`
- Linux: `~/.foundry_local_playground/`
- Windows: `%APPDATA%\FoundryLocalPlayground\`

SQLite database:

- `local-playground.sqlite`
- Stores Azure selection preferences (Playground/Utility) and saved MCP profiles

Skill directories loaded by the app:

- Workspace default skills: `<workspace>/skills/default/`
- CODEX_HOME shared skills: `$CODEX_HOME/skills/`
- App data shared skills: `<config-directory>/skills/` (created automatically)

Development-only project skills:

- `<workspace>/skills/.dev/` (for example `local-playground-dev`)

If `APPDATA` is unavailable on Windows, path falls back to:

- `%USERPROFILE%\.foundry_local_playground\`

### Common Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run test`

## License

This project is licensed under the MIT License. See `LICENSE`.
