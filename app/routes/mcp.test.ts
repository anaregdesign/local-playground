/**
 * Test module verifying /mcp behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensurePersistenceDatabaseReadyMock,
  installGlobalServerErrorLoggingMock,
  logServerRouteEventMock,
} = vi.hoisted(() => ({
  ensurePersistenceDatabaseReadyMock: vi.fn(),
  installGlobalServerErrorLoggingMock: vi.fn(),
  logServerRouteEventMock: vi.fn(),
}));

vi.mock("~/lib/server/persistence/prisma", () => ({
  ensurePersistenceDatabaseReady: ensurePersistenceDatabaseReadyMock,
}));

vi.mock("~/lib/server/observability/app-event-log", () => ({
  installGlobalServerErrorLogging: installGlobalServerErrorLoggingMock,
  logServerRouteEvent: logServerRouteEventMock,
}));

import { action, loader } from "./mcp";

describe("mcp route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePersistenceDatabaseReadyMock.mockResolvedValue(undefined);
    logServerRouteEventMock.mockResolvedValue(undefined);
  });

  it("returns a method error for GET requests", async () => {
    const response = await loader({
      request: new Request("http://localhost/mcp", {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
        },
      }),
    });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed. Use POST /mcp.",
      },
      id: null,
    });
    expect(installGlobalServerErrorLoggingMock).toHaveBeenCalledTimes(1);
  });

  it("publishes table definitions through tools/list", async () => {
    const response = await action({
      request: new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "tools-1",
          method: "tools/list",
          params: {},
        }),
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.error).toBeUndefined();
    expect(body.result).toBeTruthy();
    expect(Array.isArray(body.result.tools)).toBe(true);

    const appEventTool = body.result.tools.find(
      (entry: { name?: string }) => entry.name === "debug_read_runtime_event_log_table",
    );
    expect(appEventTool).toBeTruthy();
    expect(typeof appEventTool.description).toBe("string");
    expect(appEventTool.description).toContain("Role:");
    expect(appEventTool.description).toContain("Error accumulation note: This table stores error records");
    expect(appEventTool.description).toContain("contextJson (TEXT, required)");
    expect(appEventTool.description).toContain("Query options:");
    expect(appEventTool.inputSchema?.properties?.filters).toBeTruthy();
    expect(appEventTool.inputSchema?.properties?.filterMode).toBeTruthy();

    const latestThreadTool = body.result.tools.find(
      (entry: { name?: string }) => entry.name === "debug_read_latest_thread_snapshot",
    );
    expect(latestThreadTool).toBeTruthy();
    expect(typeof latestThreadTool.description).toBe("string");
    expect(latestThreadTool.description).toContain("Schema source:");
    expect(latestThreadTool.description).toContain("Output fields:");
    expect(latestThreadTool.inputSchema?.properties?.threadId).toBeTruthy();
    expect(latestThreadTool.inputSchema?.properties?.runtimeEventLimit).toBeTruthy();
  });
});
