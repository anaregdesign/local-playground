# Local Playground

Local Playground is a desktop-first playground UI for Azure OpenAI using Agents SDK.

## Naming

- Application name: `Local Playground`
- Package name: `local-playground`
- Recommended repository name: `local-playground`

## Features

- Tab-based UI: `Playground`, `Settings`, `MCP Servers`
- Azure authentication with `DefaultAzureCredential`
- Dynamic Azure project discovery and deployment reload per selected project
- Agents SDK chat execution via `@openai/agents` and `@openai/agents-openai`
- Azure OpenAI v1 endpoint (`.../openai/v1/`)
- MCP server management (HTTP/SSE/stdio), with saved profiles in `~/.mcp/mcp-servers.json`
- Markdown rendering and JSON syntax highlighting for assistant responses

## Getting Started

### 1. Install

```bash
npm install
```

### 2. Sign in to Azure

Use Azure CLI login in your environment:

```bash
az login
```

The app uses `DefaultAzureCredential`. Azure project/deployment values are discovered dynamically from ARM and selected in `Settings`.

### 3. Start Development Server

```bash
npm run dev
```

Open `http://localhost:5173`.

## Scripts

- `npm run dev` - start development server
- `npm run build` - create production build
- `npm run start` - run production server
- `npm run typecheck` - run TypeScript checks

## API Endpoints

- `POST /api/chat`
- `GET /api/azure-connections`
- `POST /api/azure-login`
- `POST /api/azure-logout`
- `GET/POST /api/mcp-servers`
