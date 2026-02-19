import { describe, expect, it } from "vitest";
import {
  MCP_DEFAULT_AZURE_AUTH_SCOPE,
  MCP_DEFAULT_TIMEOUT_SECONDS,
} from "~/lib/constants";
import { mcpServersRouteTestUtils } from "./api.mcp-servers";

const { parseIncomingMcpServer, upsertSavedMcpServer } = mcpServersRouteTestUtils;

describe("parseIncomingMcpServer", () => {
  it("parses HTTP payload and applies defaults", () => {
    const result = parseIncomingMcpServer({
      transport: "streamable_http",
      url: "https://EXAMPLE.com/mcp",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        name: "example.com",
        transport: "streamable_http",
        url: "https://example.com/mcp",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
    });
  });

  it("parses stdio payload", () => {
    const result = parseIncomingMcpServer({
      transport: "stdio",
      name: "Local FS",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      cwd: " /tmp/work ",
      env: {
        API_KEY: "abc",
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        name: "Local FS",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        cwd: "/tmp/work",
        env: {
          API_KEY: "abc",
        },
      },
    });
  });

  it("rejects invalid HTTP and stdio payloads", () => {
    expect(
      parseIncomingMcpServer({
        transport: "streamable_http",
        url: "ftp://example.com/mcp",
      }),
    ).toEqual({
      ok: false,
      error: "`url` must start with http:// or https://.",
    });

    expect(
      parseIncomingMcpServer({
        transport: "streamable_http",
        url: "https://example.com/mcp",
        headers: {
          "Content-Type": "text/plain",
        },
      }),
    ).toEqual({
      ok: false,
      error: '`headers` must not include "Content-Type". It is fixed to "application/json".',
    });

    expect(
      parseIncomingMcpServer({
        transport: "stdio",
        command: "npx @mcp/server",
      }),
    ).toEqual({
      ok: false,
      error: "`command` must not include spaces.",
    });
  });
});

describe("upsertSavedMcpServer", () => {
  it("reuses duplicate configuration and emits rename warning", () => {
    const currentProfiles = [
      {
        id: "profile-1",
        name: "Original Name",
        transport: "streamable_http" as const,
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
    ];

    const incoming = {
      id: "ignored-id",
      name: "Renamed Server",
      transport: "streamable_http" as const,
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer token" },
      useAzureAuth: false,
      azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
      timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
    };

    const result = upsertSavedMcpServer(currentProfiles, incoming);

    expect(result.profile.id).toBe("profile-1");
    expect(result.profile.name).toBe("Renamed Server");
    expect(result.profiles).toHaveLength(1);
    expect(result.warning).toBe(
      'An MCP server with the same configuration already exists. Renamed it from "Original Name" to "Renamed Server".',
    );
  });

  it("updates by id when configuration changed", () => {
    const currentProfiles = [
      {
        id: "profile-1",
        name: "Server",
        transport: "streamable_http" as const,
        url: "https://example.com/mcp",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
    ];

    const incoming = {
      id: "profile-1",
      name: "Server",
      transport: "streamable_http" as const,
      url: "https://other.example.com/mcp",
      headers: {},
      useAzureAuth: true,
      azureAuthScope: "https://scope/.default",
      timeoutSeconds: 60,
    };

    const result = upsertSavedMcpServer(currentProfiles, incoming);

    expect(result.profiles).toHaveLength(1);
    expect(result.profile).toEqual({
      id: "profile-1",
      name: "Server",
      transport: "streamable_http",
      url: "https://other.example.com/mcp",
      headers: {},
      useAzureAuth: true,
      azureAuthScope: "https://scope/.default",
      timeoutSeconds: 60,
    });
    expect(result.warning).toBeNull();
  });

  it("appends a new profile for unique configuration", () => {
    const currentProfiles = [
      {
        id: "profile-1",
        name: "HTTP",
        transport: "streamable_http" as const,
        url: "https://example.com/mcp",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
    ];

    const incoming = {
      id: "profile-2",
      name: "STDIO",
      transport: "stdio" as const,
      command: "node",
      args: ["server.js"],
      cwd: "/tmp/mcp",
      env: {
        NODE_ENV: "production",
      },
    };

    const result = upsertSavedMcpServer(currentProfiles, incoming);

    expect(result.profiles).toHaveLength(2);
    expect(result.profile.id).toBe("profile-2");
    expect(result.warning).toBeNull();
  });
});
