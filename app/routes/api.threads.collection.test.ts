/**
 * Test module verifying POST /api/threads behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadSnapshot } from "~/lib/home/thread/types";

const {
  readAzureArmUserContextMock,
  getOrCreateUserByIdentityMock,
  readThreadSnapshotFromUnknownMock,
  installGlobalServerErrorLoggingMock,
  logServerRouteEventMock,
} = vi.hoisted(() => ({
  readAzureArmUserContextMock: vi.fn(),
  getOrCreateUserByIdentityMock: vi.fn(),
  readThreadSnapshotFromUnknownMock: vi.fn(),
  installGlobalServerErrorLoggingMock: vi.fn(),
  logServerRouteEventMock: vi.fn(),
}));

vi.mock("~/lib/server/auth/azure-user", () => ({
  readAzureArmUserContext: readAzureArmUserContextMock,
}));

vi.mock("~/lib/server/persistence/user", () => ({
  getOrCreateUserByIdentity: getOrCreateUserByIdentityMock,
}));

vi.mock("~/lib/home/thread/parsers", () => ({
  readThreadSnapshotFromUnknown: readThreadSnapshotFromUnknownMock,
}));

vi.mock("~/lib/server/observability/runtime-event-log", () => ({
  installGlobalServerErrorLogging: installGlobalServerErrorLoggingMock,
  logServerRouteEvent: logServerRouteEventMock,
}));

import { action, threadCollectionActionHandlers } from "./api.threads";
const createThreadSnapshotSpy = vi.spyOn(threadCollectionActionHandlers, "createThreadSnapshot");

describe("POST /api/threads", () => {
  const thread: ThreadSnapshot = {
    id: "thread-a",
    name: "Thread A",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    reasoningEffort: "medium",
    webSearchEnabled: true,
    agentInstruction: "",
    threadEnvironment: {},
    messages: [],
    mcpServers: [],
    mcpRpcLogs: [],
    skillSelections: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    readAzureArmUserContextMock.mockResolvedValue({
      tenantId: "tenant-a",
      principalId: "principal-a",
    });
    getOrCreateUserByIdentityMock.mockResolvedValue({
      id: 10,
      tenantId: "tenant-a",
      principalId: "principal-a",
    });
    readThreadSnapshotFromUnknownMock.mockReturnValue(thread);
    logServerRouteEventMock.mockResolvedValue(undefined);
    createThreadSnapshotSpy.mockReset();
    createThreadSnapshotSpy.mockResolvedValue({
      status: "created",
      thread,
    });
  });

  it("returns 201 with Location when thread is created", async () => {
    const response = await action({
      request: new Request("http://localhost/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    } as never);

    const payload = (await response.json()) as { thread?: ThreadSnapshot };
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe("/api/threads/thread-a");
    expect(payload.thread?.id).toBe("thread-a");
  });

  it("returns 409 when thread id already exists", async () => {
    createThreadSnapshotSpy.mockResolvedValueOnce({
      status: "conflict",
    });

    const response = await action({
      request: new Request("http://localhost/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    } as never);

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(409);
    expect(payload.error).toBe("Thread id already exists.");
  });

  it("returns 422 when payload is invalid", async () => {
    readThreadSnapshotFromUnknownMock.mockReturnValueOnce(null);

    const response = await action({
      request: new Request("http://localhost/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invalid: true }),
      }),
    } as never);

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(422);
    expect(payload.error).toBe("Invalid thread payload.");
  });

  it("returns 401 when user is not authenticated", async () => {
    readAzureArmUserContextMock.mockResolvedValueOnce(null);

    const response = await action({
      request: new Request("http://localhost/api/threads", {
        method: "POST",
      }),
    } as never);

    const payload = (await response.json()) as { authRequired?: boolean };
    expect(response.status).toBe(401);
    expect(payload.authRequired).toBe(true);
  });
});
