/**
 * Test module verifying api.runtime.event-logs behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readAzureArmUserContextMock,
  installGlobalServerErrorLoggingMock,
  logRuntimeEventWithIdMock,
  logServerRouteEventMock,
} = vi.hoisted(() => ({
  readAzureArmUserContextMock: vi.fn(),
  installGlobalServerErrorLoggingMock: vi.fn(),
  logRuntimeEventWithIdMock: vi.fn(),
  logServerRouteEventMock: vi.fn(),
}));

vi.mock("~/lib/server/auth/azure-user", () => ({
  readAzureArmUserContext: readAzureArmUserContextMock,
}));

vi.mock("~/lib/server/observability/runtime-event-log", () => ({
  installGlobalServerErrorLogging: installGlobalServerErrorLoggingMock,
  logRuntimeEventWithId: logRuntimeEventWithIdMock,
  logServerRouteEvent: logServerRouteEventMock,
}));

import { action, loader } from "./api.runtime.event-logs";

describe("api.runtime.event-logs loader", () => {
  it("returns 405 response with Allow header", async () => {
    const response = loader();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({
      code: "method_not_allowed",
      error: "Method not allowed.",
    });
    expect(installGlobalServerErrorLoggingMock).toHaveBeenCalledTimes(1);
  });
});

describe("api.runtime.event-logs action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readAzureArmUserContextMock.mockResolvedValue({
      tenantId: "tenant-a",
      principalId: "principal-a",
      token: "token",
    });
    logRuntimeEventWithIdMock.mockResolvedValue("runtime-event-log-1");
    logServerRouteEventMock.mockResolvedValue(undefined);
  });

  it("returns 405 for non-POST requests", async () => {
    const response = await action({
      request: new Request("http://localhost/api/runtime/event-logs", {
        method: "GET",
      }),
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({
      code: "method_not_allowed",
      error: "Method not allowed.",
    });
  });

  it("returns 400 when JSON is invalid and logs warning", async () => {
    const response = await action({
      request: new Request("http://localhost/api/runtime/event-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{invalid-json",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "invalid_json_body",
      error: "Invalid JSON body.",
    });
    expect(logServerRouteEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/api/runtime/event-logs",
        eventName: "invalid_json_body",
        statusCode: 400,
      }),
    );
    expect(logRuntimeEventWithIdMock).not.toHaveBeenCalled();
  });

  it("returns 422 for invalid payload shape and logs warning", async () => {
    const response = await action({
      request: new Request("http://localhost/api/runtime/event-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          level: "error",
          category: "frontend",
          message: "missing event name",
        }),
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "invalid_event_log_payload",
      error: "Invalid event log payload.",
    });
    expect(logServerRouteEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/api/runtime/event-logs",
        eventName: "invalid_client_event_payload",
        statusCode: 422,
      }),
    );
    expect(logRuntimeEventWithIdMock).not.toHaveBeenCalled();
  });

  it("accepts valid payload and forwards structured client log", async () => {
    const response = await action({
      request: new Request("http://localhost/api/runtime/event-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "VitestAgent",
          Referer: "http://localhost/home",
        },
        body: JSON.stringify({
          level: "error",
          category: "frontend",
          eventName: "window_error",
          message: "Unhandled UI error",
          location: "window.error",
          action: "uncaught_exception",
          threadId: "thread-1",
          context: {
            component: "Home",
          },
        }),
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      eventLogId: "runtime-event-log-1",
    });
    expect(response.headers.get("location")).toBe(
      "/api/runtime/event-logs/runtime-event-log-1",
    );
    expect(logServerRouteEventMock).not.toHaveBeenCalled();
    expect(logRuntimeEventWithIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "client",
        level: "error",
        category: "frontend",
        eventName: "window_error",
        message: "Unhandled UI error",
        location: "window.error",
        action: "uncaught_exception",
        threadId: "thread-1",
        tenantId: "tenant-a",
        principalId: "principal-a",
        context: expect.objectContaining({
          component: "Home",
          userAgent: "VitestAgent",
          referer: "http://localhost/home",
        }),
      }),
    );
  });

  it("returns 500 when runtime event log persistence fails", async () => {
    logRuntimeEventWithIdMock.mockResolvedValueOnce(null);

    const response = await action({
      request: new Request("http://localhost/api/runtime/event-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          level: "info",
          category: "frontend",
          eventName: "event_log_failed",
          message: "failed",
        }),
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "create_client_event_log_failed",
      error: "Failed to persist runtime event log.",
    });
    expect(logServerRouteEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/api/runtime/event-logs",
        eventName: "create_client_event_log_failed",
        statusCode: 500,
      }),
    );
  });
});
