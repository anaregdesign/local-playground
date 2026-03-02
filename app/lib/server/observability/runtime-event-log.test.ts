/**
 * Test module verifying runtime-event-log behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensurePersistenceDatabaseReadyMock, runtimeEventLogCreateMock, runtimeEventLogFindFirstMock } = vi.hoisted(() => ({
  ensurePersistenceDatabaseReadyMock: vi.fn(),
  runtimeEventLogCreateMock: vi.fn(),
  runtimeEventLogFindFirstMock: vi.fn(),
}));

vi.mock("~/lib/server/persistence/prisma", () => ({
  ensurePersistenceDatabaseReady: ensurePersistenceDatabaseReadyMock,
  prisma: {
    runtimeEventLog: {
      create: runtimeEventLogCreateMock,
      findFirst: runtimeEventLogFindFirstMock,
    },
  },
}));

import {
  logRuntimeEvent,
  logRuntimeEventWithId,
  logServerRouteEvent,
} from "./runtime-event-log";

describe("logRuntimeEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePersistenceDatabaseReadyMock.mockResolvedValue(undefined);
    runtimeEventLogCreateMock.mockResolvedValue(undefined);
    runtimeEventLogFindFirstMock.mockResolvedValue(null);
  });

  it("writes normalized app event logs to prisma", async () => {
    await logRuntimeEvent({
      source: "server",
      level: "error",
      category: "api",
      eventName: "chat_execution_failed",
      message: "upstream timeout",
      statusCode: 502,
      httpMethod: "POST",
      httpPath: "/api/chat",
      context: {
        attempt: 1,
      },
    });

    expect(ensurePersistenceDatabaseReadyMock).toHaveBeenCalledTimes(1);
    expect(runtimeEventLogCreateMock).toHaveBeenCalledTimes(1);
    const call = runtimeEventLogCreateMock.mock.calls[0]?.[0] as {
      data: { contextJson: string; source: string; level: string; category: string; eventName: string };
    };
    expect(call.data.source).toBe("server");
    expect(call.data.level).toBe("error");
    expect(call.data.category).toBe("api");
    expect(call.data.eventName).toBe("chat_execution_failed");
    expect(JSON.parse(call.data.contextJson)).toEqual({
      attempt: 1,
    });
  });

  it("never throws when database write fails", async () => {
    runtimeEventLogCreateMock.mockRejectedValueOnce(new Error("db failed"));

    await expect(
      logRuntimeEvent({
        source: "server",
        level: "error",
        category: "api",
        eventName: "save_failed",
        message: "save failed",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("logRuntimeEventWithId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePersistenceDatabaseReadyMock.mockResolvedValue(undefined);
    runtimeEventLogCreateMock.mockResolvedValue(undefined);
    runtimeEventLogFindFirstMock.mockResolvedValue(null);
  });

  it("returns created event log id on success", async () => {
    const eventLogId = await logRuntimeEventWithId({
      source: "server",
      level: "info",
      category: "api",
      eventName: "event_log_created",
      message: "created",
    });

    expect(typeof eventLogId).toBe("string");
    expect(eventLogId && eventLogId.length > 0).toBe(true);
    expect(runtimeEventLogCreateMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when database write fails", async () => {
    runtimeEventLogCreateMock.mockRejectedValueOnce(new Error("db failed"));

    await expect(
      logRuntimeEventWithId({
        source: "server",
        level: "error",
        category: "api",
        eventName: "event_log_failed",
        message: "failed",
      }),
    ).resolves.toBeNull();
  });
});

describe("logServerRouteEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePersistenceDatabaseReadyMock.mockResolvedValue(undefined);
    runtimeEventLogCreateMock.mockResolvedValue(undefined);
    runtimeEventLogFindFirstMock.mockResolvedValue(null);
  });

  it("captures route request metadata and error details", async () => {
    const request = new Request("http://localhost/api/chat?stream=1", {
      method: "POST",
    });

    await logServerRouteEvent({
      request,
      route: "/api/chat",
      eventName: "chat_execution_failed",
      action: "execute_chat",
      statusCode: 502,
      error: new Error("Bad gateway"),
      context: {
        turnId: "turn-1",
      },
    });

    const call = runtimeEventLogCreateMock.mock.calls[0]?.[0] as {
      data: {
        httpMethod: string;
        httpPath: string;
        location: string;
        errorName: string | null;
        message: string;
        contextJson: string;
      };
    };

    expect(call.data.httpMethod).toBe("POST");
    expect(call.data.httpPath).toBe("/api/chat");
    expect(call.data.location).toBe("/api/chat");
    expect(call.data.errorName).toBe("Error");
    expect(call.data.message).toBe("Bad gateway");
    expect(JSON.parse(call.data.contextJson)).toEqual({
      turnId: "turn-1",
    });
  });
});

describe("readRuntimeEventLogByIdForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePersistenceDatabaseReadyMock.mockResolvedValue(undefined);
    runtimeEventLogCreateMock.mockResolvedValue(undefined);
    runtimeEventLogFindFirstMock.mockResolvedValue(null);
  });

  it("returns normalized event log when owner matches", async () => {
    runtimeEventLogFindFirstMock.mockResolvedValueOnce({
      id: "event-1",
      createdAt: "2026-03-01T00:00:00.000Z",
      source: "client",
      level: "info",
      category: "frontend",
      eventName: "event_name",
      message: "message",
      errorName: null,
      location: null,
      action: "click",
      statusCode: 200,
      httpMethod: "GET",
      httpPath: "/api/runtime/event-logs/event-1",
      threadId: "thread-1",
      tenantId: "tenant-a",
      principalId: "principal-a",
      userId: 10,
      stack: null,
      contextJson: "{\"source\":\"ui\"}",
    });

    const { readRuntimeEventLogByIdForUser } = await import("./runtime-event-log");
    const eventLog = await readRuntimeEventLogByIdForUser({
      eventLogId: "event-1",
      tenantId: "tenant-a",
      principalId: "principal-a",
      userId: 10,
    });

    expect(eventLog).not.toBeNull();
    expect(eventLog?.id).toBe("event-1");
    expect(eventLog?.context).toEqual({ source: "ui" });
  });

  it("returns null when event log is not found", async () => {
    const { readRuntimeEventLogByIdForUser } = await import("./runtime-event-log");
    const eventLog = await readRuntimeEventLogByIdForUser({
      eventLogId: "missing",
      tenantId: "tenant-a",
      principalId: "principal-a",
      userId: 10,
    });

    expect(eventLog).toBeNull();
  });
});
