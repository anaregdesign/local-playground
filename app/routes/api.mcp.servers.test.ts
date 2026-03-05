/**
 * Test module verifying api.mcp.servers behavior.
 */
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import {
  MCP_DEFAULT_AZURE_AUTH_SCOPE,
  MCP_DEFAULT_TIMEOUT_SECONDS,
  HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS,
} from "~/lib/constants";
import { resolveFoundryConfigDirectory } from "~/lib/foundry/config";
import { mcpServersRouteTestUtils } from "./api.mcp.servers";

const {
  parseIncomingMcpServer,
  upsertWorkspaceMcpServerProfile,
  deleteWorkspaceMcpServerProfile,
  mergeDefaultWorkspaceMcpServerProfiles,
  resolveDefaultFilesystemWorkingDirectory,
} = mcpServersRouteTestUtils;
type HomeDefaultWorkspaceMcpServerProfileRow =
  (typeof HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS)[number];
type HomeDefaultWorkspaceMcpServerProfileStdioRow = Extract<
  HomeDefaultWorkspaceMcpServerProfileRow,
  { transport: "stdio" }
>;
type HomeDefaultWorkspaceMcpServerProfileHttpRow = Extract<
  HomeDefaultWorkspaceMcpServerProfileRow,
  { transport: "streamable_http" | "sse" }
>;
const defaultOpenaiDocsMcpServerProfile = readDefaultHttpMcpServerProfile("openai-docs");
const defaultMicrosoftLearnMcpServerProfile = readDefaultHttpMcpServerProfile("microsoft-learn");
const defaultSystemMcpServerProfile = readDefaultHttpMcpServerProfile("system");
const defaultCmdMcpServerProfile = readDefaultHttpMcpServerProfile("cmd");
const defaultFilesystemMcpServerProfile = readDefaultStdioMcpServerProfile("filesystem");
const defaultWorkiqMcpServerProfile = readDefaultStdioMcpServerProfile("workiq");
const defaultMemoryMcpServerProfile = readDefaultStdioMcpServerProfile("server-memory");
const defaultEverythingMcpServerProfile = readDefaultStdioMcpServerProfile("server-everything");
const defaultAzureMcpServerProfile = readDefaultStdioMcpServerProfile("azure-mcp");
const defaultPlaywrightMcpServerProfile = readDefaultStdioMcpServerProfile("playwright");
const defaultDrawioMcpServerProfile = readDefaultStdioMcpServerProfile("drawio");
const defaultMermaidMcpServerProfile = readDefaultStdioMcpServerProfile("mcp-mermaid");
const defaultWorkspaceUserId = 42;

function readDefaultStdioMcpServerProfile(name: string): HomeDefaultWorkspaceMcpServerProfileStdioRow {
  const profile = HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS.find(
    (entry): entry is HomeDefaultWorkspaceMcpServerProfileStdioRow =>
      entry.transport === "stdio" && entry.name === name,
  );
  if (!profile) {
    throw new Error(`Missing default stdio MCP server profile: ${name}`);
  }

  return profile;
}

function readDefaultHttpMcpServerProfile(name: string): HomeDefaultWorkspaceMcpServerProfileHttpRow {
  const profile = HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS.find(
    (entry): entry is HomeDefaultWorkspaceMcpServerProfileHttpRow =>
      entry.transport !== "stdio" && entry.name === name,
  );
  if (!profile) {
    throw new Error(`Missing default HTTP MCP server profile: ${name}`);
  }

  return profile;
}

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

  it("parses relative HTTP endpoint payloads", () => {
    const result = parseIncomingMcpServer({
      transport: "streamable_http",
      url: "/mcp/system",
      name: "system",
      connectOnThreadCreate: true,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        name: "system",
        connectOnThreadCreate: true,
        transport: "streamable_http",
        url: "/mcp/system",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
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
      error: "`url` must start with http://, https://, or /.",
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

describe("upsertWorkspaceMcpServerProfile", () => {
  it("reuses duplicate configuration and emits rename warning", () => {
    const currentProfiles = [
      {
        id: "profile-1",
        name: "Original Name",
        connectOnThreadCreate: false,
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
      connectOnThreadCreate: false,
      transport: "streamable_http" as const,
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer token" },
      useAzureAuth: false,
      azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
      timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
    };

    const result = upsertWorkspaceMcpServerProfile(currentProfiles, incoming);

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
        connectOnThreadCreate: false,
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
      connectOnThreadCreate: false,
      transport: "streamable_http" as const,
      url: "https://other.example.com/mcp",
      headers: {},
      useAzureAuth: true,
      azureAuthScope: "https://scope/.default",
      timeoutSeconds: 60,
    };

    const result = upsertWorkspaceMcpServerProfile(currentProfiles, incoming);

    expect(result.profiles).toHaveLength(1);
    expect(result.profile).toEqual({
      id: "profile-1",
      name: "Server",
      connectOnThreadCreate: false,
      transport: "streamable_http",
      url: "https://other.example.com/mcp",
      headers: {},
      useAzureAuth: true,
      azureAuthScope: "https://scope/.default",
      timeoutSeconds: 60,
    });
    expect(result.warning).toBeNull();
  });

  it("preserves connectOnThreadCreate when incoming payload omits it", () => {
    const currentProfiles = [
      {
        id: "profile-1",
        name: "System",
        connectOnThreadCreate: true,
        transport: "streamable_http" as const,
        url: "/mcp/system",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
    ];

    const incoming = {
      id: "profile-1",
      name: "System Updated",
      transport: "streamable_http" as const,
      url: "/mcp/system",
      headers: {},
      useAzureAuth: false,
      azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
      timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
    };

    const result = upsertWorkspaceMcpServerProfile(currentProfiles, incoming);
    expect(result.profile.connectOnThreadCreate).toBe(true);
  });

  it("appends a new profile for unique configuration", () => {
    const currentProfiles = [
      {
        id: "profile-1",
        name: "HTTP",
        connectOnThreadCreate: false,
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
      connectOnThreadCreate: false,
      transport: "stdio" as const,
      command: "node",
      args: ["server.js"],
      cwd: "/tmp/mcp",
      env: {
        NODE_ENV: "production",
      },
    };

    const result = upsertWorkspaceMcpServerProfile(currentProfiles, incoming);

    expect(result.profiles).toHaveLength(2);
    expect(result.profile.id).toBe("profile-2");
    expect(result.warning).toBeNull();
  });
});

describe("deleteWorkspaceMcpServerProfile", () => {
  it("deletes a profile when id matches", () => {
    const currentProfiles = [
      {
        id: "profile-1",
        name: "A",
        connectOnThreadCreate: false,
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
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: "node",
        args: ["server.js"],
        env: {},
      },
    ];

    const result = deleteWorkspaceMcpServerProfile(currentProfiles, "profile-1");

    expect(result.deleted).toBe(true);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].id).toBe("profile-2");
  });

  it("returns unchanged profiles when id does not exist", () => {
    const currentProfiles = [
      {
        id: "profile-1",
        name: "A",
        connectOnThreadCreate: false,
        transport: "streamable_http" as const,
        url: "https://example.com/a",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
    ];

    const result = deleteWorkspaceMcpServerProfile(currentProfiles, "missing-id");

    expect(result.deleted).toBe(false);
    expect(result.profiles).toEqual(currentProfiles);
  });
});

describe("mergeDefaultWorkspaceMcpServerProfiles", () => {
  it("resolves user-scoped absolute default filesystem working directory", () => {
    const resolved = resolveDefaultFilesystemWorkingDirectory(defaultWorkspaceUserId);
    expect(nodePath.isAbsolute(resolved)).toBe(true);
    expect(resolved.replaceAll("\\", "/")).toContain("/users/42");
  });

  it("adds the default vendor profiles when missing", () => {
    const expectedFilesystemWorkingDirectory = resolveDefaultFilesystemWorkingDirectory(
      defaultWorkspaceUserId,
    );
    const result = mergeDefaultWorkspaceMcpServerProfiles([], defaultWorkspaceUserId);

    expect(result).toHaveLength(HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS.length);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: defaultOpenaiDocsMcpServerProfile.name,
          transport: "streamable_http",
          url: defaultOpenaiDocsMcpServerProfile.url,
          headers: {},
          useAzureAuth: false,
          azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
          timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
        }),
        expect.objectContaining({
          name: defaultMicrosoftLearnMcpServerProfile.name,
          transport: "streamable_http",
          url: defaultMicrosoftLearnMcpServerProfile.url,
          headers: {},
          useAzureAuth: false,
          azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
          timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
          connectOnThreadCreate: false,
        }),
        expect.objectContaining({
          name: defaultSystemMcpServerProfile.name,
          transport: "streamable_http",
          url: defaultSystemMcpServerProfile.url,
          headers: {},
          useAzureAuth: false,
          azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
          timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
          connectOnThreadCreate: true,
        }),
        expect.objectContaining({
          name: defaultCmdMcpServerProfile.name,
          transport: "streamable_http",
          url: defaultCmdMcpServerProfile.url,
          headers: {},
          useAzureAuth: false,
          azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
          timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
          connectOnThreadCreate: defaultCmdMcpServerProfile.connectOnThreadCreate,
        }),
        expect.objectContaining({
          name: defaultFilesystemMcpServerProfile.name,
          transport: "stdio",
          command: defaultFilesystemMcpServerProfile.command,
          args: [...defaultFilesystemMcpServerProfile.args],
          cwd: expectedFilesystemWorkingDirectory,
          env: {},
          connectOnThreadCreate: true,
        }),
        expect.objectContaining({
          name: defaultWorkiqMcpServerProfile.name,
          transport: "stdio",
          command: defaultWorkiqMcpServerProfile.command,
          args: [...defaultWorkiqMcpServerProfile.args],
          env: {},
        }),
        expect.objectContaining({
          name: defaultMemoryMcpServerProfile.name,
          transport: "stdio",
          command: defaultMemoryMcpServerProfile.command,
          args: [...defaultMemoryMcpServerProfile.args],
          env: {},
        }),
        expect.objectContaining({
          name: defaultEverythingMcpServerProfile.name,
          transport: "stdio",
          command: defaultEverythingMcpServerProfile.command,
          args: [...defaultEverythingMcpServerProfile.args],
          env: {},
        }),
        expect.objectContaining({
          name: defaultAzureMcpServerProfile.name,
          transport: "stdio",
          command: defaultAzureMcpServerProfile.command,
          args: [...defaultAzureMcpServerProfile.args],
          env: {},
        }),
        expect.objectContaining({
          name: defaultPlaywrightMcpServerProfile.name,
          transport: "stdio",
          command: defaultPlaywrightMcpServerProfile.command,
          args: [...defaultPlaywrightMcpServerProfile.args],
          env: {},
        }),
        expect.objectContaining({
          name: defaultDrawioMcpServerProfile.name,
          transport: "stdio",
          command: defaultDrawioMcpServerProfile.command,
          args: [...defaultDrawioMcpServerProfile.args],
          cwd: expectedFilesystemWorkingDirectory,
          env: {},
          connectOnThreadCreate: false,
        }),
        expect.objectContaining({
          name: defaultMermaidMcpServerProfile.name,
          transport: "stdio",
          command: defaultMermaidMcpServerProfile.command,
          args: [...defaultMermaidMcpServerProfile.args],
          cwd: expectedFilesystemWorkingDirectory,
          env: {},
        }),
      ]),
    );
    expect(result.every((entry) => entry.id.length > 0)).toBe(true);
  });

  it("does not duplicate defaults when matching profiles already exist", () => {
    const expectedFilesystemWorkingDirectory = resolveDefaultFilesystemWorkingDirectory(
      defaultWorkspaceUserId,
    );
    const existing = [
      {
        id: "profile-openai-docs",
        name: "OpenAI Docs (Custom Name)",
        connectOnThreadCreate: false,
        transport: "streamable_http" as const,
        url: defaultOpenaiDocsMcpServerProfile.url,
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
      {
        id: "profile-workiq",
        name: "Custom WorkIQ",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: defaultWorkiqMcpServerProfile.command,
        args: [...defaultWorkiqMcpServerProfile.args],
        env: {},
      },
      {
        id: "profile-server-memory",
        name: "Server Memory (Custom Name)",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: defaultMemoryMcpServerProfile.command,
        args: [...defaultMemoryMcpServerProfile.args],
        env: {},
      },
      {
        id: "profile-server-everything",
        name: "Server Everything (Custom Name)",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: defaultEverythingMcpServerProfile.command,
        args: [...defaultEverythingMcpServerProfile.args],
        env: {},
      },
      {
        id: "profile-mslearn",
        name: "Microsoft Learn (Custom Name)",
        connectOnThreadCreate: false,
        transport: "streamable_http" as const,
        url: defaultMicrosoftLearnMcpServerProfile.url,
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
      {
        id: "profile-system",
        name: "System (Custom Name)",
        connectOnThreadCreate: true,
        transport: "streamable_http" as const,
        url: defaultSystemMcpServerProfile.url,
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
      {
        id: "profile-cmd",
        name: "Cmd (Custom Name)",
        connectOnThreadCreate: defaultCmdMcpServerProfile.connectOnThreadCreate,
        transport: "streamable_http" as const,
        url: defaultCmdMcpServerProfile.url,
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
      {
        id: "profile-filesystem",
        name: "Filesystem (Custom Name)",
        connectOnThreadCreate: true,
        transport: "stdio" as const,
        command: defaultFilesystemMcpServerProfile.command,
        args: [...defaultFilesystemMcpServerProfile.args],
        cwd: resolveDefaultFilesystemWorkingDirectory(defaultWorkspaceUserId),
        env: {},
      },
      {
        id: "profile-azure-mcp",
        name: "Azure MCP (Custom Name)",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: defaultAzureMcpServerProfile.command,
        args: [...defaultAzureMcpServerProfile.args],
        env: {},
      },
      {
        id: "profile-playwright",
        name: "Playwright (Custom Name)",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: defaultPlaywrightMcpServerProfile.command,
        args: [...defaultPlaywrightMcpServerProfile.args],
        env: {},
      },
      {
        id: "profile-drawio",
        name: "drawio (Custom Name)",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: defaultDrawioMcpServerProfile.command,
        args: [...defaultDrawioMcpServerProfile.args],
        cwd: expectedFilesystemWorkingDirectory,
        env: {},
      },
      {
        id: "profile-mermaid",
        name: "Mermaid (Custom Name)",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: defaultMermaidMcpServerProfile.command,
        args: [...defaultMermaidMcpServerProfile.args],
        cwd: expectedFilesystemWorkingDirectory,
        env: {},
      },
    ];

    const result = mergeDefaultWorkspaceMcpServerProfiles(existing, defaultWorkspaceUserId);

    expect(result).toEqual(existing);
  });

  it("adds only missing defaults when some profiles already exist", () => {
    const expectedFilesystemWorkingDirectory = resolveDefaultFilesystemWorkingDirectory(
      defaultWorkspaceUserId,
    );
    const existing = [
      {
        id: "profile-workiq",
        name: "Custom WorkIQ",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: defaultWorkiqMcpServerProfile.command,
        args: [...defaultWorkiqMcpServerProfile.args],
        env: {},
      },
    ];

    const result = mergeDefaultWorkspaceMcpServerProfiles(existing, defaultWorkspaceUserId);

    expect(result).toHaveLength(HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS.length);
    expect(result).toEqual(
      expect.arrayContaining([
        existing[0],
        expect.objectContaining({
          transport: "streamable_http",
          url: defaultOpenaiDocsMcpServerProfile.url,
        }),
        expect.objectContaining({
          transport: "streamable_http",
          url: defaultMicrosoftLearnMcpServerProfile.url,
        }),
        expect.objectContaining({
          transport: "streamable_http",
          url: defaultSystemMcpServerProfile.url,
          connectOnThreadCreate: true,
        }),
        expect.objectContaining({
          transport: "streamable_http",
          url: defaultCmdMcpServerProfile.url,
          connectOnThreadCreate: defaultCmdMcpServerProfile.connectOnThreadCreate,
        }),
        expect.objectContaining({
          transport: "stdio",
          command: defaultFilesystemMcpServerProfile.command,
          args: [...defaultFilesystemMcpServerProfile.args],
          cwd: resolveDefaultFilesystemWorkingDirectory(defaultWorkspaceUserId),
        }),
        expect.objectContaining({
          transport: "stdio",
          command: defaultMemoryMcpServerProfile.command,
          args: [...defaultMemoryMcpServerProfile.args],
        }),
        expect.objectContaining({
          transport: "stdio",
          command: defaultEverythingMcpServerProfile.command,
          args: [...defaultEverythingMcpServerProfile.args],
        }),
        expect.objectContaining({
          transport: "stdio",
          command: defaultAzureMcpServerProfile.command,
          args: [...defaultAzureMcpServerProfile.args],
        }),
        expect.objectContaining({
          transport: "stdio",
          command: defaultPlaywrightMcpServerProfile.command,
          args: [...defaultPlaywrightMcpServerProfile.args],
        }),
        expect.objectContaining({
          transport: "stdio",
          command: defaultDrawioMcpServerProfile.command,
          args: [...defaultDrawioMcpServerProfile.args],
          cwd: expectedFilesystemWorkingDirectory,
        }),
        expect.objectContaining({
          transport: "stdio",
          command: defaultMermaidMcpServerProfile.command,
          args: [...defaultMermaidMcpServerProfile.args],
          cwd: expectedFilesystemWorkingDirectory,
        }),
      ]),
    );
  });

  it("removes legacy unavailable modelcontextprotocol default profiles", () => {
    const existing = [
      {
        id: "legacy-server-http",
        name: "server-http",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-http"],
        env: {},
      },
      {
        id: "legacy-server-shell",
        name: "server-shell",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-shell"],
        env: {},
      },
      {
        id: "custom-stdio",
        name: "custom-local",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: "node",
        args: ["server.js"],
        env: {},
      },
    ];

    const result = mergeDefaultWorkspaceMcpServerProfiles(existing, defaultWorkspaceUserId);
    const names = result.map((entry) => entry.name);
    expect(names).not.toContain("server-http");
    expect(names).not.toContain("server-shell");
    expect(names).toContain("custom-local");
  });

  it("upgrades legacy default mermaid profile without cwd", () => {
    const expectedFilesystemWorkingDirectory = resolveDefaultFilesystemWorkingDirectory(
      defaultWorkspaceUserId,
    );
    const existing = [
      {
        id: "legacy-mermaid",
        name: "Legacy Mermaid",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: defaultMermaidMcpServerProfile.command,
        args: [...defaultMermaidMcpServerProfile.args],
        env: {},
      },
    ];

    const result = mergeDefaultWorkspaceMcpServerProfiles(existing, defaultWorkspaceUserId);
    const mermaidProfiles = result.filter(
      (entry) =>
        entry.transport === "stdio" &&
        entry.command === defaultMermaidMcpServerProfile.command &&
        entry.args.length === defaultMermaidMcpServerProfile.args.length &&
        entry.args.every((arg, index) => arg === defaultMermaidMcpServerProfile.args[index]),
    );

    expect(mermaidProfiles).toHaveLength(1);
    expect(mermaidProfiles[0]).toEqual(
      expect.objectContaining({
        id: "legacy-mermaid",
        cwd: expectedFilesystemWorkingDirectory,
      }),
    );
  });

  it("upgrades legacy default filesystem profile with shared working directory", () => {
    const expectedFilesystemWorkingDirectory = resolveDefaultFilesystemWorkingDirectory(
      defaultWorkspaceUserId,
    );
    const legacyFilesystemWorkingDirectory = resolveFoundryConfigDirectory();
    const existing = [
      {
        id: "legacy-filesystem",
        name: "Legacy Filesystem",
        connectOnThreadCreate: true,
        transport: "stdio" as const,
        command: defaultFilesystemMcpServerProfile.command,
        args: [...defaultFilesystemMcpServerProfile.args],
        cwd: legacyFilesystemWorkingDirectory,
        env: {},
      },
    ];

    const result = mergeDefaultWorkspaceMcpServerProfiles(existing, defaultWorkspaceUserId);
    const filesystemProfiles = result.filter(
      (entry) =>
        entry.transport === "stdio" &&
        entry.command === defaultFilesystemMcpServerProfile.command &&
        entry.args.length === defaultFilesystemMcpServerProfile.args.length &&
        entry.args.every((arg, index) => arg === defaultFilesystemMcpServerProfile.args[index]),
    );

    expect(filesystemProfiles).toHaveLength(1);
    expect(filesystemProfiles[0]).toEqual(
      expect.objectContaining({
        id: "legacy-filesystem",
        cwd: expectedFilesystemWorkingDirectory,
      }),
    );
  });

  it("keeps microsoft-learn and azure-mcp profiles when already stored", () => {
    const existing = [
      {
        id: "legacy-mslearn",
        name: defaultMicrosoftLearnMcpServerProfile.name,
        connectOnThreadCreate: false,
        transport: "streamable_http" as const,
        url: defaultMicrosoftLearnMcpServerProfile.url,
        headers: {},
        useAzureAuth: false,
        azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
        timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
      },
      {
        id: "legacy-azure-mcp",
        name: defaultAzureMcpServerProfile.name,
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: defaultAzureMcpServerProfile.command,
        args: [...defaultAzureMcpServerProfile.args],
        env: {},
      },
      {
        id: "custom-stdio",
        name: "custom-local",
        connectOnThreadCreate: false,
        transport: "stdio" as const,
        command: "node",
        args: ["server.js"],
        env: {},
      },
    ];

    const result = mergeDefaultWorkspaceMcpServerProfiles(existing, defaultWorkspaceUserId);
    const names = result.map((entry) => entry.name);
    expect(names).toContain(defaultMicrosoftLearnMcpServerProfile.name);
    expect(names).toContain(defaultAzureMcpServerProfile.name);
    expect(names).toContain("custom-local");
  });
});
