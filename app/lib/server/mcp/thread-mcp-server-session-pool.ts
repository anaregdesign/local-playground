/**
 * Runtime support module for thread-scoped MCP server session reuse.
 */
import type { MCPServer } from "@openai/agents";
import { THREAD_MCP_SERVER_SESSION_IDLE_TTL_MS } from "~/lib/constants";

export type ThreadMcpServerSessionStatus = "connected" | "reused";

export type ThreadMcpServerSession<RefreshState> = {
  server: MCPServer;
  refreshBeforeUse: (refreshState: RefreshState) => Promise<void>;
};

export type ThreadMcpServerSessionLease = {
  server: MCPServer;
  status: ThreadMcpServerSessionStatus;
  isEphemeral: boolean;
  release: () => Promise<void>;
};

type AcquireThreadMcpServerSessionOptions<RefreshState> = {
  threadId: string | null;
  sessionKey: string;
  refreshState: RefreshState;
  idleTtlMs?: number;
  createSession: (refreshState: RefreshState) => Promise<ThreadMcpServerSession<RefreshState>>;
};

type ThreadMcpServerSessionEntry = {
  key: string;
  session: ThreadMcpServerSession<unknown> | null;
  inUse: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

const threadMcpServerSessionEntryByKey = new Map<string, ThreadMcpServerSessionEntry>();

export async function acquireThreadMcpServerSession<RefreshState>(
  options: AcquireThreadMcpServerSessionOptions<RefreshState>,
): Promise<ThreadMcpServerSessionLease> {
  const idleTtlMs = normalizeIdleTtlMs(options.idleTtlMs);
  if (!options.threadId) {
    const session = await createAndConnectThreadMcpServerSession(
      options.createSession,
      options.refreshState,
    );
    return createEphemeralThreadMcpServerSessionLease(session);
  }

  const key = buildThreadMcpServerSessionEntryKey(options.threadId, options.sessionKey);
  const existingEntry = threadMcpServerSessionEntryByKey.get(key);
  if (!existingEntry) {
    const newEntry: ThreadMcpServerSessionEntry = {
      key,
      session: null,
      inUse: true,
      cleanupTimer: null,
    };
    threadMcpServerSessionEntryByKey.set(key, newEntry);
    return await createPooledThreadMcpServerSession(newEntry, options, idleTtlMs);
  }

  if (existingEntry.inUse || !existingEntry.session) {
    const session = await createAndConnectThreadMcpServerSession(
      options.createSession,
      options.refreshState,
    );
    return createEphemeralThreadMcpServerSessionLease(session);
  }

  return await acquireExistingPooledThreadMcpServerSession(existingEntry, options.refreshState, idleTtlMs);
}

export async function closeAllThreadMcpServerSessions(): Promise<void> {
  const entries = [...threadMcpServerSessionEntryByKey.values()];
  threadMcpServerSessionEntryByKey.clear();
  await Promise.allSettled(
    entries.map(async (entry) => {
      clearThreadMcpServerSessionCleanupTimer(entry);
      if (entry.session) {
        await entry.session.server.close();
      }
    }),
  );
}

function normalizeIdleTtlMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return THREAD_MCP_SERVER_SESSION_IDLE_TTL_MS;
  }

  return value;
}

function buildThreadMcpServerSessionEntryKey(threadId: string, sessionKey: string): string {
  return `${threadId}\u0000${sessionKey}`;
}

async function createPooledThreadMcpServerSession<RefreshState>(
  entry: ThreadMcpServerSessionEntry,
  options: AcquireThreadMcpServerSessionOptions<RefreshState>,
  idleTtlMs: number,
): Promise<ThreadMcpServerSessionLease> {
  try {
    const session = await createAndConnectThreadMcpServerSession(
      options.createSession,
      options.refreshState,
    );
    entry.session = session as ThreadMcpServerSession<unknown>;
    return createPooledThreadMcpServerSessionLease(entry, "connected", idleTtlMs);
  } catch (error) {
    clearThreadMcpServerSessionCleanupTimer(entry);
    threadMcpServerSessionEntryByKey.delete(entry.key);
    throw error;
  }
}

async function acquireExistingPooledThreadMcpServerSession<RefreshState>(
  entry: ThreadMcpServerSessionEntry,
  refreshState: RefreshState,
  idleTtlMs: number,
): Promise<ThreadMcpServerSessionLease> {
  const session = entry.session as ThreadMcpServerSession<RefreshState>;
  entry.inUse = true;
  clearThreadMcpServerSessionCleanupTimer(entry);
  try {
    await session.refreshBeforeUse(refreshState);
  } catch (error) {
    entry.inUse = false;
    scheduleThreadMcpServerSessionCleanup(entry, idleTtlMs);
    throw error;
  }

  return createPooledThreadMcpServerSessionLease(entry, "reused", idleTtlMs);
}

async function createAndConnectThreadMcpServerSession<RefreshState>(
  createSession: (refreshState: RefreshState) => Promise<ThreadMcpServerSession<RefreshState>>,
  refreshState: RefreshState,
): Promise<ThreadMcpServerSession<RefreshState>> {
  const session = await createSession(refreshState);
  try {
    await session.refreshBeforeUse(refreshState);
    await session.server.connect();
    return session;
  } catch (error) {
    await closeThreadMcpServerSession(session);
    throw error;
  }
}

async function closeThreadMcpServerSession<RefreshState>(
  session: ThreadMcpServerSession<RefreshState>,
): Promise<void> {
  try {
    await session.server.close();
  } catch {
    // Best-effort close when session creation or refresh fails.
  }
}

function createPooledThreadMcpServerSessionLease(
  entry: ThreadMcpServerSessionEntry,
  status: ThreadMcpServerSessionStatus,
  idleTtlMs: number,
): ThreadMcpServerSessionLease {
  const session = entry.session;
  if (!session) {
    throw new Error("Thread MCP server session is not initialized.");
  }

  let released = false;
  return {
    server: session.server,
    status,
    isEphemeral: false,
    release: async () => {
      if (released) {
        return;
      }
      released = true;

      const current = threadMcpServerSessionEntryByKey.get(entry.key);
      if (!current || current !== entry) {
        return;
      }

      current.inUse = false;
      scheduleThreadMcpServerSessionCleanup(current, idleTtlMs);
    },
  };
}

function createEphemeralThreadMcpServerSessionLease<RefreshState>(
  session: ThreadMcpServerSession<RefreshState>,
): ThreadMcpServerSessionLease {
  let released = false;
  return {
    server: session.server,
    status: "connected",
    isEphemeral: true,
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      await closeThreadMcpServerSession(session);
    },
  };
}

function clearThreadMcpServerSessionCleanupTimer(entry: ThreadMcpServerSessionEntry): void {
  if (!entry.cleanupTimer) {
    return;
  }

  clearTimeout(entry.cleanupTimer);
  entry.cleanupTimer = null;
}

function scheduleThreadMcpServerSessionCleanup(
  entry: ThreadMcpServerSessionEntry,
  idleTtlMs: number,
): void {
  clearThreadMcpServerSessionCleanupTimer(entry);
  entry.cleanupTimer = setTimeout(() => {
    void closeIdleThreadMcpServerSession(entry.key, entry);
  }, idleTtlMs);
  if (hasUnrefTimer(entry.cleanupTimer)) {
    entry.cleanupTimer.unref();
  }
}

async function closeIdleThreadMcpServerSession(
  key: string,
  entry: ThreadMcpServerSessionEntry,
): Promise<void> {
  const current = threadMcpServerSessionEntryByKey.get(key);
  if (!current || current !== entry || current.inUse || !current.session) {
    return;
  }

  clearThreadMcpServerSessionCleanupTimer(current);
  threadMcpServerSessionEntryByKey.delete(key);
  await current.session.server.close();
}

function hasUnrefTimer(timer: unknown): timer is { unref: () => void } {
  if (!timer || typeof timer !== "object") {
    return false;
  }

  const timerWithUnref = timer as { unref?: unknown };
  return typeof timerWithUnref.unref === "function";
}

export const threadMcpServerSessionPoolTestUtils = {
  readSessionCount(): number {
    return threadMcpServerSessionEntryByKey.size;
  },
  closeAllSessions: closeAllThreadMcpServerSessions,
};
