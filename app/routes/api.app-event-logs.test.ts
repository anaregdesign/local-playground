/**
 * Test module verifying api.app-event-logs behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readAzureArmUserContextMock,
  installGlobalServerErrorLoggingMock,
  logAppEventMock,
  logServerRouteEventMock,
} = vi.hoisted(() => ({
  readAzureArmUserContextMock: vi.fn(),
  installGlobalServerErrorLoggingMock: vi.fn(),
  logAppEventMock: vi.fn(),
  logServerRouteEventMock: vi.fn(),
}));

vi.mock("~/lib/server/auth/azure-user", () => ({
  readAzureArmUserContext: readAzureArmUserContextMock,
}));

vi.mock("~/lib/server/observability/app-event-log", () => ({
  installGlobalServerErrorLogging: installGlobalServerErrorLoggingMock,
  logAppEvent: logAppEventMock,
  logServerRouteEvent: logServerRouteEventMock,
}));

import { action, loader } from "./api.app-event-logs";

describe("api.app-event-logs loader", () => {
  it("returns 405 response with Allow header", async () => {
    const response = loader();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({ error: "Method not allowed." });
    expect(installGlobalServerErrorLoggingMock).toHaveBeenCalledTimes(1);
  });
});

describe("api.app-event-logs action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readAzureArmUserContextMock.mockResolvedValue({
      tenantId: "tenant-a",
      principalId: "principal-a",
      token: "token",
    });
    logAppEventMock.mockResolvedValue(undefined);
    logServerRouteEventMock.mockResolvedValue(undefined);
  });

  it("returns 405 for non-POST requests", async () => {
    const response = await action({
      request: new Request("http://localhost/api/app-event-logs", {
        method: "GET",
      }),
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({ error: "Method not allowed." });
  });

  it("returns 400 when JSON is invalid and logs warning", async () => {
    const response = await action({
      request: new Request("http://localhost/api/app-event-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{invalid-json",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body." });
    expect(logServerRouteEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/api/app-event-logs",
        eventName: "invalid_json_body",
        statusCode: 400,
      }),
    );
    expect(logAppEventMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid payload shape and logs warning", async () => {
    const response = await action({
      request: new Request("http://localhost/api/app-event-logs", {
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

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid event log payload." });
    expect(logServerRouteEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/api/app-event-logs",
        eventName: "invalid_client_event_payload",
        statusCode: 400,
      }),
    );
    expect(logAppEventMock).not.toHaveBeenCalled();
  });

  it("accepts valid payload and forwards structured client log", async () => {
    const response = await action({
      request: new Request("http://localhost/api/app-event-logs", {
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
    expect(await response.json()).toEqual({ ok: true });
    expect(logServerRouteEventMock).not.toHaveBeenCalled();
    expect(logAppEventMock).toHaveBeenCalledWith(
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
});
