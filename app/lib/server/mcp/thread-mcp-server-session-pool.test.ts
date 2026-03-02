/**
 * Test module verifying thread MCP server session pool behavior.
 */
import type { MCPServer } from "@openai/agents";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireThreadMcpServerSession,
  threadMcpServerSessionPoolTestUtils,
  type ThreadMcpServerSession,
} from "~/lib/server/mcp/thread-mcp-server-session-pool";

type RefreshState = {
  turnId: string;
};

type MockServerCounters = {
  connectCalls: number;
  closeCalls: number;
};

afterEach(async () => {
  await threadMcpServerSessionPoolTestUtils.closeAllSessions();
  expect(threadMcpServerSessionPoolTestUtils.readSessionCount()).toBe(0);
});

describe("acquireThreadMcpServerSession", () => {
  it("reuses pooled sessions for the same thread and key", async () => {
    const counters: MockServerCounters = { connectCalls: 0, closeCalls: 0 };
    const refreshedTurnIds: string[] = [];
    let createCalls = 0;

    const createSession = async (): Promise<ThreadMcpServerSession<RefreshState>> => {
      createCalls += 1;
      return {
        server: createMockServer(counters),
        refreshBeforeUse: async (refreshState) => {
          refreshedTurnIds.push(refreshState.turnId);
        },
      };
    };

    const firstLease = await acquireThreadMcpServerSession({
      threadId: "thread-1",
      sessionKey: "filesystem",
      refreshState: { turnId: "turn-1" },
      createSession,
      idleTtlMs: 10_000,
    });
    expect(firstLease.status).toBe("connected");
    expect(firstLease.isEphemeral).toBe(false);
    await firstLease.release();

    const secondLease = await acquireThreadMcpServerSession({
      threadId: "thread-1",
      sessionKey: "filesystem",
      refreshState: { turnId: "turn-2" },
      createSession,
      idleTtlMs: 10_000,
    });
    expect(secondLease.status).toBe("reused");
    expect(secondLease.isEphemeral).toBe(false);
    await secondLease.release();

    expect(createCalls).toBe(1);
    expect(counters.connectCalls).toBe(1);
    expect(counters.closeCalls).toBe(0);
    expect(refreshedTurnIds).toEqual(["turn-1", "turn-2"]);
  });

  it("evicts idle sessions after TTL and reconnects on next acquire", async () => {
    const counters: MockServerCounters = { connectCalls: 0, closeCalls: 0 };
    let createCalls = 0;
    const createSession = async (): Promise<ThreadMcpServerSession<RefreshState>> => {
      createCalls += 1;
      return {
        server: createMockServer(counters),
        refreshBeforeUse: async () => {},
      };
    };

    const firstLease = await acquireThreadMcpServerSession({
      threadId: "thread-2",
      sessionKey: "cmd",
      refreshState: { turnId: "turn-a" },
      createSession,
      idleTtlMs: 20,
    });
    await firstLease.release();

    await waitFor(50);
    expect(threadMcpServerSessionPoolTestUtils.readSessionCount()).toBe(0);
    expect(counters.closeCalls).toBe(1);

    const secondLease = await acquireThreadMcpServerSession({
      threadId: "thread-2",
      sessionKey: "cmd",
      refreshState: { turnId: "turn-b" },
      createSession,
      idleTtlMs: 20,
    });
    expect(secondLease.status).toBe("connected");
    await secondLease.release();

    expect(createCalls).toBe(2);
    expect(counters.connectCalls).toBe(2);
  });

  it("creates an ephemeral session when the pooled session is already in use", async () => {
    const counters: MockServerCounters = { connectCalls: 0, closeCalls: 0 };
    let createCalls = 0;
    const createSession = async (): Promise<ThreadMcpServerSession<RefreshState>> => {
      createCalls += 1;
      return {
        server: createMockServer(counters),
        refreshBeforeUse: async () => {},
      };
    };

    const firstLease = await acquireThreadMcpServerSession({
      threadId: "thread-3",
      sessionKey: "shared",
      refreshState: { turnId: "turn-1" },
      createSession,
      idleTtlMs: 10_000,
    });
    expect(firstLease.status).toBe("connected");
    expect(firstLease.isEphemeral).toBe(false);

    const secondLease = await acquireThreadMcpServerSession({
      threadId: "thread-3",
      sessionKey: "shared",
      refreshState: { turnId: "turn-2" },
      createSession,
      idleTtlMs: 10_000,
    });
    expect(secondLease.status).toBe("connected");
    expect(secondLease.isEphemeral).toBe(true);

    await secondLease.release();
    await firstLease.release();

    expect(createCalls).toBe(2);
    expect(counters.connectCalls).toBe(2);
    expect(counters.closeCalls).toBe(1);
  });

  it("does not cache failed sessions and retries with a fresh connection", async () => {
    const counters: MockServerCounters = { connectCalls: 0, closeCalls: 0 };
    let createCalls = 0;
    const createSession = async (): Promise<ThreadMcpServerSession<RefreshState>> => {
      createCalls += 1;
      const shouldFailConnect = createCalls === 1;
      return {
        server: createMockServer(counters, { connectErrorMessage: shouldFailConnect ? "connect failed" : null }),
        refreshBeforeUse: async () => {},
      };
    };

    await expect(
      acquireThreadMcpServerSession({
        threadId: "thread-4",
        sessionKey: "filesystem",
        refreshState: { turnId: "turn-fail" },
        createSession,
        idleTtlMs: 10_000,
      }),
    ).rejects.toThrow("connect failed");

    const retryLease = await acquireThreadMcpServerSession({
      threadId: "thread-4",
      sessionKey: "filesystem",
      refreshState: { turnId: "turn-retry" },
      createSession,
      idleTtlMs: 10_000,
    });
    expect(retryLease.status).toBe("connected");
    expect(retryLease.isEphemeral).toBe(false);
    await retryLease.release();

    expect(createCalls).toBe(2);
    expect(counters.connectCalls).toBe(2);
    expect(counters.closeCalls).toBe(1);
  });
});

function createMockServer(
  counters: MockServerCounters,
  options: {
    connectErrorMessage?: string | null;
  } = {},
): MCPServer {
  const connectErrorMessage = options.connectErrorMessage ?? null;
  const server = {
    name: "mock",
    connect: async () => {
      counters.connectCalls += 1;
      if (connectErrorMessage) {
        throw new Error(connectErrorMessage);
      }
    },
    close: async () => {
      counters.closeCalls += 1;
    },
    listTools: async () => [],
    callTool: async () => [],
    invalidateToolsCache: () => undefined,
  };
  return server as unknown as MCPServer;
}

async function waitFor(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
