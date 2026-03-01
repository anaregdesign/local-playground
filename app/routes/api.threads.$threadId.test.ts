/**
 * Test module verifying api.threads.$threadId behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readAuthenticatedUser,
  readJsonPayload,
  saveThreadSnapshot,
  logicalDeleteThread,
  logicalRestoreThread,
  isThreadRestorePayload,
  readErrorMessage,
  readThreadSnapshotFromUnknown,
  logServerRouteEvent,
} = vi.hoisted(() => ({
  readAuthenticatedUser: vi.fn(async () => ({ id: 1 })),
  readJsonPayload: vi.fn(async () => ({ ok: true as const, value: {} })),
  saveThreadSnapshot: vi.fn(async () => null),
  logicalDeleteThread: vi.fn<any>(async () => ({ status: "not_found" as const })),
  logicalRestoreThread: vi.fn(async () => ({ status: "not_found" as const })),
  isThreadRestorePayload: vi.fn(() => false),
  readErrorMessage: vi.fn(() => "Unknown error."),
  readThreadSnapshotFromUnknown: vi.fn<any>(() => null),
  logServerRouteEvent: vi.fn(async () => undefined),
}));

vi.mock("./api.threads", () => ({
  readAuthenticatedUser,
  readJsonPayload,
  saveThreadSnapshot,
  logicalDeleteThread,
  logicalRestoreThread,
  isThreadRestorePayload,
  readErrorMessage,
}));

vi.mock("~/lib/home/thread/parsers", () => ({
  readThreadSnapshotFromUnknown,
}));

vi.mock("~/lib/server/observability/app-event-log", () => ({
  installGlobalServerErrorLogging: vi.fn(),
  logServerRouteEvent,
}));

import { action, loader } from "./api.threads.$threadId";

describe("/api/threads/:threadId", () => {
  beforeEach(() => {
    readAuthenticatedUser.mockReset();
    readAuthenticatedUser.mockResolvedValue({ id: 1 });
    readJsonPayload.mockReset();
    readJsonPayload.mockResolvedValue({ ok: true, value: {} });
    saveThreadSnapshot.mockReset();
    saveThreadSnapshot.mockResolvedValue(null);
    logicalDeleteThread.mockReset();
    logicalDeleteThread.mockResolvedValue({ status: "not_found" });
    logicalRestoreThread.mockReset();
    logicalRestoreThread.mockResolvedValue({ status: "not_found" });
    isThreadRestorePayload.mockReset();
    isThreadRestorePayload.mockReturnValue(false);
    readErrorMessage.mockReset();
    readErrorMessage.mockReturnValue("Unknown error.");
    readThreadSnapshotFromUnknown.mockReset();
    readThreadSnapshotFromUnknown.mockReturnValue(null);
    logServerRouteEvent.mockReset();
    logServerRouteEvent.mockResolvedValue(undefined);
  });

  it("returns 405 response with Allow header for loader", async () => {
    const response = loader();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PUT, PATCH, DELETE");
  });

  it("returns 405 for unsupported methods", async () => {
    const response = await action({
      request: new Request("http://localhost/api/threads/thread-a", { method: "GET" }),
      params: { threadId: "thread-a" },
    } as never);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PUT, PATCH, DELETE");
  });

  it("returns 400 when PUT payload thread id does not match path id", async () => {
    readThreadSnapshotFromUnknown.mockReturnValue({
      id: "thread-b",
      messages: [],
      mcpServers: [],
      mcpRpcHistory: [],
      skillSelections: [],
    });

    const response = await action({
      request: new Request("http://localhost/api/threads/thread-a", { method: "PUT" }),
      params: { threadId: "thread-a" },
    } as never);
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("`thread.id` must match path `threadId`.");
  });

  it("returns 409 when deleting an empty thread", async () => {
    logicalDeleteThread.mockResolvedValueOnce({ status: "empty" });

    const response = await action({
      request: new Request("http://localhost/api/threads/thread-a", { method: "DELETE" }),
      params: { threadId: "thread-a" },
    } as never);
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(payload.error).toBe("Threads without messages cannot be deleted.");
  });
});
