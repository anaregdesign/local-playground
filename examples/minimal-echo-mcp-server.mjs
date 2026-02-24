#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const server = new McpServer({
  name: "local-playground-minimal-echo",
  version: "0.1.0",
});

server.registerTool(
  "local_echo",
  {
    description: "Echo text back. Minimal MCP tool for Local Playground smoke tests.",
    inputSchema: {
      text: z.string().min(1).describe("Text to echo."),
    },
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo: ${text}` }],
    structuredContent: { echoed: text },
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);

// Use stderr for local diagnostics. Stdout is reserved for MCP JSON-RPC frames.
console.error("[local-playground-minimal-echo] ready");
