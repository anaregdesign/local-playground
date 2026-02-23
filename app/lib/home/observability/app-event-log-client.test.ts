/**
 * Test module verifying app-event-log-client behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("app-event-log-client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns a no-op uninstall when window is unavailable", async () => {
    const module = await import("./app-event-log-client");
    const uninstall = module.installGlobalClientErrorLogging();
    expect(typeof uninstall).toBe("function");
    uninstall();
  });

  it("deduplicates repeated events within the debounce window", async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const module = await import("./app-event-log-client");

    const payload = {
      level: "error" as const,
      category: "frontend",
      eventName: "dedupe_event",
      message: "same payload",
    };

    module.reportClientEvent(payload);
    module.reportClientEvent(payload);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts old dedupe signatures to keep cache bounded", async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const module = await import("./app-event-log-client");

    const firstPayload = {
      level: "warning" as const,
      category: "frontend",
      eventName: "bounded_cache_first",
      message: "first payload",
    };

    module.reportClientEvent(firstPayload);
    for (let index = 0; index < 540; index += 1) {
      module.reportClientEvent({
        level: "warning",
        category: "frontend",
        eventName: `bounded_cache_${index}`,
        message: `message_${index}`,
      });
    }
    module.reportClientEvent(firstPayload);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(542);
  });

  it("sends structured payload for reportClientError", async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const module = await import("./app-event-log-client");

    module.reportClientError("client_error_event", new Error("boom"), {
      category: "frontend",
      location: "home.send",
      action: "send_message",
      statusCode: 500,
      threadId: "thread-1",
      context: {
        turnId: "turn-1",
      },
    });
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe("POST");
    const payload = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        level: "error",
        category: "frontend",
        eventName: "client_error_event",
        message: "boom",
        errorName: "Error",
        location: "home.send",
        action: "send_message",
        statusCode: 500,
        threadId: "thread-1",
      }),
    );
  });
});
