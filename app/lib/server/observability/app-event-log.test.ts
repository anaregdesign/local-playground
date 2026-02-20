import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensurePersistenceDatabaseReadyMock, appEventLogCreateMock } = vi.hoisted(() => ({
  ensurePersistenceDatabaseReadyMock: vi.fn(),
  appEventLogCreateMock: vi.fn(),
}));

vi.mock("~/lib/server/persistence/prisma", () => ({
  ensurePersistenceDatabaseReady: ensurePersistenceDatabaseReadyMock,
  prisma: {
    appEventLog: {
      create: appEventLogCreateMock,
    },
  },
}));

import { logAppEvent, logServerRouteEvent } from "./app-event-log";

describe("logAppEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePersistenceDatabaseReadyMock.mockResolvedValue(undefined);
    appEventLogCreateMock.mockResolvedValue(undefined);
  });

  it("writes normalized app event logs to prisma", async () => {
    await logAppEvent({
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
    expect(appEventLogCreateMock).toHaveBeenCalledTimes(1);
    const call = appEventLogCreateMock.mock.calls[0]?.[0] as {
      data: { context: string; source: string; level: string; category: string; eventName: string };
    };
    expect(call.data.source).toBe("server");
    expect(call.data.level).toBe("error");
    expect(call.data.category).toBe("api");
    expect(call.data.eventName).toBe("chat_execution_failed");
    expect(JSON.parse(call.data.context)).toEqual({
      attempt: 1,
    });
  });

  it("never throws when database write fails", async () => {
    appEventLogCreateMock.mockRejectedValueOnce(new Error("db failed"));

    await expect(
      logAppEvent({
        source: "server",
        level: "error",
        category: "api",
        eventName: "save_failed",
        message: "save failed",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("logServerRouteEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePersistenceDatabaseReadyMock.mockResolvedValue(undefined);
    appEventLogCreateMock.mockResolvedValue(undefined);
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

    const call = appEventLogCreateMock.mock.calls[0]?.[0] as {
      data: {
        httpMethod: string;
        httpPath: string;
        location: string;
        errorName: string | null;
        message: string;
        context: string;
      };
    };

    expect(call.data.httpMethod).toBe("POST");
    expect(call.data.httpPath).toBe("/api/chat");
    expect(call.data.location).toBe("/api/chat");
    expect(call.data.errorName).toBe("Error");
    expect(call.data.message).toBe("Bad gateway");
    expect(JSON.parse(call.data.context)).toEqual({
      turnId: "turn-1",
    });
  });
});
