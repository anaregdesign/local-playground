/**
 * Test module verifying api.mcp-servers.$serverId behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readAuthenticatedUser,
  readSavedMcpServers,
  deleteSavedMcpServer,
  writeSavedMcpServers,
  parseIncomingMcpServer,
  mergeDefaultMcpServers,
  upsertSavedMcpServer,
  readErrorMessage,
  logServerRouteEvent,
} = vi.hoisted(() => ({
  readAuthenticatedUser: vi.fn(async () => ({ id: 1 })),
  readSavedMcpServers: vi.fn(async () => []),
  deleteSavedMcpServer: vi.fn(() => ({ profiles: [], deleted: false })),
  writeSavedMcpServers: vi.fn(async () => undefined),
  parseIncomingMcpServer: vi.fn<any>(() => ({
    ok: true as const,
    value: {
      name: "Server",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: {},
    },
  })),
  mergeDefaultMcpServers: vi.fn((profiles: unknown) => profiles),
  upsertSavedMcpServer: vi.fn<any>(() => ({
    profile: { id: "srv-1" },
    profiles: [],
    warning: null,
  })),
  readErrorMessage: vi.fn(() => "Unknown error."),
  logServerRouteEvent: vi.fn(async () => undefined),
}));

vi.mock("./api.mcp-servers", () => ({
  readAuthenticatedUser,
  readSavedMcpServers,
  deleteSavedMcpServer,
  writeSavedMcpServers,
  parseIncomingMcpServer,
  mergeDefaultMcpServers,
  upsertSavedMcpServer,
  readErrorMessage,
}));

vi.mock("~/lib/server/observability/app-event-log", () => ({
  installGlobalServerErrorLogging: vi.fn(),
  logServerRouteEvent,
}));

import { action, loader } from "./api.mcp-servers.$serverId";

describe("/api/mcp-servers/:serverId", () => {
  beforeEach(() => {
    readAuthenticatedUser.mockReset();
    readAuthenticatedUser.mockResolvedValue({ id: 1 });
    readSavedMcpServers.mockReset();
    readSavedMcpServers.mockResolvedValue([]);
    deleteSavedMcpServer.mockReset();
    deleteSavedMcpServer.mockReturnValue({ profiles: [], deleted: false });
    writeSavedMcpServers.mockReset();
    writeSavedMcpServers.mockResolvedValue(undefined);
    parseIncomingMcpServer.mockReset();
    parseIncomingMcpServer.mockReturnValue({
      ok: true,
      value: {
        name: "Server",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: {},
      },
    });
    mergeDefaultMcpServers.mockReset();
    mergeDefaultMcpServers.mockImplementation((profiles: unknown) => profiles);
    upsertSavedMcpServer.mockReset();
    upsertSavedMcpServer.mockReturnValue({
      profile: {
        id: "srv-1",
        name: "Server",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: {},
      },
      profiles: [],
      warning: null,
    });
    readErrorMessage.mockReset();
    readErrorMessage.mockReturnValue("Unknown error.");
    logServerRouteEvent.mockReset();
    logServerRouteEvent.mockResolvedValue(undefined);
  });

  it("returns 405 response with Allow header for loader", async () => {
    const response = loader();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PUT, DELETE");
  });

  it("returns 405 for unsupported methods", async () => {
    const response = await action({
      request: new Request("http://localhost/api/mcp-servers/srv-1", { method: "POST" }),
      params: { serverId: "srv-1" },
    } as never);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PUT, DELETE");
  });

  it("returns 404 when deleting unknown server", async () => {
    deleteSavedMcpServer.mockReturnValueOnce({ profiles: [], deleted: false });

    const response = await action({
      request: new Request("http://localhost/api/mcp-servers/srv-404", { method: "DELETE" }),
      params: { serverId: "srv-404" },
    } as never);
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe("Selected MCP server is not available.");
  });

  it("returns 400 when PUT payload id conflicts with path id", async () => {
    parseIncomingMcpServer.mockReturnValueOnce({
      ok: true,
      value: {
        id: "srv-other",
        name: "Server",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: {},
      },
    });

    const response = await action({
      request: new Request("http://localhost/api/mcp-servers/srv-1", {
        method: "PUT",
        body: JSON.stringify({
          transport: "stdio",
          command: "node",
          args: ["server.js"],
        }),
      }),
      params: { serverId: "srv-1" },
    } as never);
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("`id` must match path `serverId`.");
  });
});
