/**
 * Test module verifying api.mcp-servers behavior.
 */
import { describe, expect, it } from "vitest";
import {
  MCP_DEFAULT_AZURE_MCP_SERVER_ARGS,
  MCP_DEFAULT_AZURE_MCP_SERVER_COMMAND,
  MCP_DEFAULT_AZURE_MCP_SERVER_NAME,
  MCP_DEFAULT_AZURE_AUTH_SCOPE,
  MCP_DEFAULT_FILESYSTEM_MCP_SERVER_ARGS,
  MCP_DEFAULT_FILESYSTEM_MCP_SERVER_COMMAND,
  MCP_DEFAULT_FILESYSTEM_MCP_SERVER_NAME,
  MCP_DEFAULT_MERMAID_MCP_SERVER_ARGS,
  MCP_DEFAULT_MERMAID_MCP_SERVER_COMMAND,
  MCP_DEFAULT_MERMAID_MCP_SERVER_NAME,
  MCP_DEFAULT_MICROSOFT_LEARN_SERVER_NAME,
  MCP_DEFAULT_MICROSOFT_LEARN_SERVER_URL,
  MCP_DEFAULT_OPENAI_DOCS_SERVER_NAME,
  MCP_DEFAULT_OPENAI_DOCS_SERVER_URL,
  MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_ARGS,
  MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_COMMAND,
  MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_NAME,
  MCP_DEFAULT_TIMEOUT_SECONDS,
  MCP_DEFAULT_WORKIQ_SERVER_ARGS,
  MCP_DEFAULT_WORKIQ_SERVER_COMMAND,
  MCP_DEFAULT_WORKIQ_SERVER_NAME,
} from "~/lib/constants";
import { mcpServersRouteTestUtils } from "./api.mcp-servers";

const {
  parseIncomingMcpServer,
  upsertSavedMcpServer,
  deleteSavedMcpServer,
  mergeDefaultMcpServers,
  resolveDefaultFilesystemWorkingDirectory,
} = mcpServersRouteTestUtils;

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

describe("deleteSavedMcpServer", () => {
  it("deletes a profile when id matches", () => {
    const currentProfiles = [
      {
        id: "profile-1",
        name: "A",
        transport: "streamable_http" as const,
        url: "https://example.com/a",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
      {
        id: "profile-2",
        name: "B",
        transport: "stdio" as const,
        command: "node",
        args: ["server.js"],
        env: {},
      },
    ];

    const result = deleteSavedMcpServer(currentProfiles, "profile-1");

    expect(result.deleted).toBe(true);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].id).toBe("profile-2");
  });

  it("returns unchanged profiles when id does not exist", () => {
    const currentProfiles = [
      {
        id: "profile-1",
        name: "A",
        transport: "streamable_http" as const,
        url: "https://example.com/a",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
    ];

    const result = deleteSavedMcpServer(currentProfiles, "missing-id");

    expect(result.deleted).toBe(false);
    expect(result.profiles).toEqual(currentProfiles);
  });
});

describe("mergeDefaultMcpServers", () => {
  it("adds the default vendor profiles when missing", () => {
    const expectedFilesystemWorkingDirectory = resolveDefaultFilesystemWorkingDirectory();
    const result = mergeDefaultMcpServers([]);

    expect(result).toHaveLength(7);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: MCP_DEFAULT_OPENAI_DOCS_SERVER_NAME,
          transport: "streamable_http",
          url: MCP_DEFAULT_OPENAI_DOCS_SERVER_URL,
          headers: {},
          useAzureAuth: false,
          azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
          timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
        }),
        expect.objectContaining({
          name: MCP_DEFAULT_MICROSOFT_LEARN_SERVER_NAME,
          transport: "streamable_http",
          url: MCP_DEFAULT_MICROSOFT_LEARN_SERVER_URL,
          headers: {},
          useAzureAuth: false,
          azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
          timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
        }),
        expect.objectContaining({
          name: MCP_DEFAULT_FILESYSTEM_MCP_SERVER_NAME,
          transport: "stdio",
          command: MCP_DEFAULT_FILESYSTEM_MCP_SERVER_COMMAND,
          args: [...MCP_DEFAULT_FILESYSTEM_MCP_SERVER_ARGS],
          cwd: expectedFilesystemWorkingDirectory,
          env: {},
        }),
        expect.objectContaining({
          name: MCP_DEFAULT_WORKIQ_SERVER_NAME,
          transport: "stdio",
          command: MCP_DEFAULT_WORKIQ_SERVER_COMMAND,
          args: [...MCP_DEFAULT_WORKIQ_SERVER_ARGS],
          env: {},
        }),
        expect.objectContaining({
          name: MCP_DEFAULT_AZURE_MCP_SERVER_NAME,
          transport: "stdio",
          command: MCP_DEFAULT_AZURE_MCP_SERVER_COMMAND,
          args: [...MCP_DEFAULT_AZURE_MCP_SERVER_ARGS],
          env: {},
        }),
        expect.objectContaining({
          name: MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_NAME,
          transport: "stdio",
          command: MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_COMMAND,
          args: [...MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_ARGS],
          env: {},
        }),
        expect.objectContaining({
          name: MCP_DEFAULT_MERMAID_MCP_SERVER_NAME,
          transport: "stdio",
          command: MCP_DEFAULT_MERMAID_MCP_SERVER_COMMAND,
          args: [...MCP_DEFAULT_MERMAID_MCP_SERVER_ARGS],
          cwd: expectedFilesystemWorkingDirectory,
          env: {},
        }),
      ]),
    );
    expect(result.every((entry) => entry.id.length > 0)).toBe(true);
  });

  it("does not duplicate defaults when matching profiles already exist", () => {
    const expectedFilesystemWorkingDirectory = resolveDefaultFilesystemWorkingDirectory();
    const existing = [
      {
        id: "profile-openai-docs",
        name: "OpenAI Docs (Custom Name)",
        transport: "streamable_http" as const,
        url: MCP_DEFAULT_OPENAI_DOCS_SERVER_URL,
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
      {
        id: "profile-workiq",
        name: "Custom WorkIQ",
        transport: "stdio" as const,
        command: MCP_DEFAULT_WORKIQ_SERVER_COMMAND,
        args: [...MCP_DEFAULT_WORKIQ_SERVER_ARGS],
        env: {},
      },
      {
        id: "profile-mslearn",
        name: "Microsoft Learn (Custom Name)",
        transport: "streamable_http" as const,
        url: MCP_DEFAULT_MICROSOFT_LEARN_SERVER_URL,
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
      {
        id: "profile-filesystem",
        name: "Filesystem (Custom Name)",
        transport: "stdio" as const,
        command: MCP_DEFAULT_FILESYSTEM_MCP_SERVER_COMMAND,
        args: [...MCP_DEFAULT_FILESYSTEM_MCP_SERVER_ARGS],
        cwd: resolveDefaultFilesystemWorkingDirectory(),
        env: {},
      },
      {
        id: "profile-azure-mcp",
        name: "Azure MCP (Custom Name)",
        transport: "stdio" as const,
        command: MCP_DEFAULT_AZURE_MCP_SERVER_COMMAND,
        args: [...MCP_DEFAULT_AZURE_MCP_SERVER_ARGS],
        env: {},
      },
      {
        id: "profile-playwright",
        name: "Playwright (Custom Name)",
        transport: "stdio" as const,
        command: MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_COMMAND,
        args: [...MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_ARGS],
        env: {},
      },
      {
        id: "profile-mermaid",
        name: "Mermaid (Custom Name)",
        transport: "stdio" as const,
        command: MCP_DEFAULT_MERMAID_MCP_SERVER_COMMAND,
        args: [...MCP_DEFAULT_MERMAID_MCP_SERVER_ARGS],
        cwd: expectedFilesystemWorkingDirectory,
        env: {},
      },
    ];

    const result = mergeDefaultMcpServers(existing);

    expect(result).toEqual(existing);
  });

  it("adds only missing defaults when some profiles already exist", () => {
    const expectedFilesystemWorkingDirectory = resolveDefaultFilesystemWorkingDirectory();
    const existing = [
      {
        id: "profile-workiq",
        name: "Custom WorkIQ",
        transport: "stdio" as const,
        command: MCP_DEFAULT_WORKIQ_SERVER_COMMAND,
        args: [...MCP_DEFAULT_WORKIQ_SERVER_ARGS],
        env: {},
      },
    ];

    const result = mergeDefaultMcpServers(existing);

    expect(result).toHaveLength(7);
    expect(result).toEqual(
      expect.arrayContaining([
        existing[0],
        expect.objectContaining({
          transport: "streamable_http",
          url: MCP_DEFAULT_OPENAI_DOCS_SERVER_URL,
        }),
        expect.objectContaining({
          transport: "streamable_http",
          url: MCP_DEFAULT_MICROSOFT_LEARN_SERVER_URL,
        }),
        expect.objectContaining({
          transport: "stdio",
          command: MCP_DEFAULT_FILESYSTEM_MCP_SERVER_COMMAND,
          args: [...MCP_DEFAULT_FILESYSTEM_MCP_SERVER_ARGS],
          cwd: resolveDefaultFilesystemWorkingDirectory(),
        }),
        expect.objectContaining({
          transport: "stdio",
          command: MCP_DEFAULT_AZURE_MCP_SERVER_COMMAND,
          args: [...MCP_DEFAULT_AZURE_MCP_SERVER_ARGS],
        }),
        expect.objectContaining({
          transport: "stdio",
          command: MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_COMMAND,
          args: [...MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_ARGS],
        }),
        expect.objectContaining({
          transport: "stdio",
          command: MCP_DEFAULT_MERMAID_MCP_SERVER_COMMAND,
          args: [...MCP_DEFAULT_MERMAID_MCP_SERVER_ARGS],
          cwd: expectedFilesystemWorkingDirectory,
        }),
      ]),
    );
  });

  it("upgrades legacy default mermaid profile without cwd", () => {
    const expectedFilesystemWorkingDirectory = resolveDefaultFilesystemWorkingDirectory();
    const existing = [
      {
        id: "legacy-mermaid",
        name: "Legacy Mermaid",
        transport: "stdio" as const,
        command: MCP_DEFAULT_MERMAID_MCP_SERVER_COMMAND,
        args: [...MCP_DEFAULT_MERMAID_MCP_SERVER_ARGS],
        env: {},
      },
    ];

    const result = mergeDefaultMcpServers(existing);
    const mermaidProfiles = result.filter(
      (entry) =>
        entry.transport === "stdio" &&
        entry.command === MCP_DEFAULT_MERMAID_MCP_SERVER_COMMAND &&
        entry.args.length === MCP_DEFAULT_MERMAID_MCP_SERVER_ARGS.length &&
        entry.args.every((arg, index) => arg === MCP_DEFAULT_MERMAID_MCP_SERVER_ARGS[index]),
    );

    expect(mermaidProfiles).toHaveLength(1);
    expect(mermaidProfiles[0]).toEqual(
      expect.objectContaining({
        id: "legacy-mermaid",
        cwd: expectedFilesystemWorkingDirectory,
      }),
    );
  });

  it("keeps microsoft-learn and azure-mcp profiles when already stored", () => {
    const existing = [
      {
        id: "legacy-mslearn",
        name: MCP_DEFAULT_MICROSOFT_LEARN_SERVER_NAME,
        transport: "streamable_http" as const,
        url: MCP_DEFAULT_MICROSOFT_LEARN_SERVER_URL,
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
      {
        id: "legacy-azure-mcp",
        name: MCP_DEFAULT_AZURE_MCP_SERVER_NAME,
        transport: "stdio" as const,
        command: MCP_DEFAULT_AZURE_MCP_SERVER_COMMAND,
        args: [...MCP_DEFAULT_AZURE_MCP_SERVER_ARGS],
        env: {},
      },
      {
        id: "custom-stdio",
        name: "custom-local",
        transport: "stdio" as const,
        command: "node",
        args: ["server.js"],
        env: {},
      },
    ];

    const result = mergeDefaultMcpServers(existing);
    const names = result.map((entry) => entry.name);
    expect(names).toContain(MCP_DEFAULT_MICROSOFT_LEARN_SERVER_NAME);
    expect(names).toContain(MCP_DEFAULT_AZURE_MCP_SERVER_NAME);
    expect(names).toContain("custom-local");
  });
});
