import { describe, expect, it } from "vitest";
import type { McpRpcHistoryEntry } from "~/lib/home/chat/stream";
import {
  buildMcpEntryCopyPayload,
  buildMcpHistoryByTurnId,
  readOperationLogType,
} from "./history";

function createEntry(overrides: Partial<McpRpcHistoryEntry>): McpRpcHistoryEntry {
  return {
    id: "rpc-1",
    sequence: 1,
    operationType: "mcp",
    serverName: "server-a",
    method: "tools/list",
    startedAt: "2026-02-19T00:00:00.000Z",
    completedAt: "2026-02-19T00:00:01.000Z",
    request: {},
    response: {},
    isError: false,
    turnId: "turn-1",
    ...overrides,
  };
}

describe("buildMcpHistoryByTurnId", () => {
  it("groups entries by turnId and skips empty turn ids", () => {
    const grouped = buildMcpHistoryByTurnId([
      createEntry({ id: "a", turnId: "turn-1" }),
      createEntry({ id: "b", turnId: "" }),
      createEntry({ id: "c", turnId: "turn-2" }),
      createEntry({ id: "d", turnId: "turn-1" }),
    ]);

    expect(grouped.size).toBe(2);
    expect(grouped.get("turn-1")?.map((entry) => entry.id)).toEqual(["a", "d"]);
    expect(grouped.get("turn-2")?.map((entry) => entry.id)).toEqual(["c"]);
  });
});

describe("buildMcpEntryCopyPayload", () => {
  it("normalizes request/response to null when undefined", () => {
    const payload = buildMcpEntryCopyPayload(
      createEntry({
        request: undefined,
        response: undefined,
      }),
    );

    expect(payload).toEqual({
      id: "rpc-1",
      sequence: 1,
      operationType: "mcp",
      serverName: "server-a",
      method: "tools/list",
      startedAt: "2026-02-19T00:00:00.000Z",
      completedAt: "2026-02-19T00:00:01.000Z",
      request: null,
      response: null,
      isError: false,
      turnId: "turn-1",
    });
  });
});

describe("readOperationLogType", () => {
  it("classifies skill-prefixed methods as skill operations", () => {
    expect(readOperationLogType({ operationType: "skill", method: "tools/call" })).toBe("skill");
    expect(readOperationLogType({ method: "skill_run_script" })).toBe("skill");
    expect(readOperationLogType({ method: "tools/call" })).toBe("mcp");
  });
});
