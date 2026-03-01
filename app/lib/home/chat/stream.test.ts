/**
 * Test module verifying stream behavior.
 */
import { describe, expect, it } from "vitest";
import {
  parseSseDataBlock,
  readChatStreamEvent,
  readThreadOperationLogEntryFromUnknown,
  upsertThreadOperationLogEntry,
} from "./stream";

describe("parseSseDataBlock", () => {
  it("extracts data payload lines", () => {
    const block = ["event: message", 'data: {"type":"progress","message":"step 1"}', ""].join("\n");

    expect(parseSseDataBlock(block)).toBe('{"type":"progress","message":"step 1"}');
  });

  it("returns null when no data line exists", () => {
    expect(parseSseDataBlock("event: ping\nid: 1")).toBeNull();
  });
});

describe("readChatStreamEvent", () => {
  it("parses operation_log record payload", () => {
    const event = readChatStreamEvent(
      JSON.stringify({
        type: "operation_log",
        record: {
          id: "rpc-1",
          sequence: 1,
          operationType: "mcp",
          serverName: "workiq",
          method: "tools/call",
          startedAt: "2026-02-16T00:00:00.000Z",
          completedAt: "2026-02-16T00:00:01.000Z",
          request: { jsonrpc: "2.0", id: "rpc-1", method: "tools/call", params: {} },
          response: { jsonrpc: "2.0", id: "rpc-1", result: {} },
          isError: false,
        },
      }),
    );

    expect(event).not.toBeNull();
    expect(event?.type).toBe("operation_log");
  });

  it("parses final payload with thread environment", () => {
    const event = readChatStreamEvent(
      JSON.stringify({
        type: "final",
        message: "done",
        threadEnvironment: {
          VIRTUAL_ENV: "/tmp/.venv",
        },
      }),
    );

    expect(event).toEqual({
      type: "final",
      message: "done",
      threadEnvironment: {
        VIRTUAL_ENV: "/tmp/.venv",
      },
    });
  });
});

describe("readThreadOperationLogEntryFromUnknown", () => {
  it("accepts valid MCP JSON-RPC history entries", () => {
    const entry = readThreadOperationLogEntryFromUnknown({
      id: "rpc-2",
      sequence: 2,
      operationType: "mcp",
      serverName: "workiq",
      method: "tools/list",
      startedAt: "2026-02-16T00:00:00.000Z",
      completedAt: "2026-02-16T00:00:01.000Z",
      request: { jsonrpc: "2.0", id: "rpc-2", method: "tools/list", params: {} },
      response: { jsonrpc: "2.0", id: "rpc-2", result: {} },
      isError: false,
    });

    expect(entry).not.toBeNull();
    expect(entry?.sequence).toBe(2);
    expect(entry?.serverName).toBe("workiq");
    expect(entry?.turnId).toBe("");
  });

  it("rejects invalid entries", () => {
    expect(readThreadOperationLogEntryFromUnknown({ id: "", sequence: 1 })).toBeNull();
  });
});

describe("upsertThreadOperationLogEntry", () => {
  it("keeps history sorted by sequence and replaces duplicate ids", () => {
    const first = {
      id: "rpc-1",
      sequence: 2,
      operationType: "mcp" as const,
      serverName: "srv",
      method: "tools/call",
      startedAt: "2026-02-16T00:00:00.000Z",
      completedAt: "2026-02-16T00:00:01.000Z",
      request: {},
      response: {},
      isError: false,
      turnId: "turn-1",
    };
    const second = {
      id: "rpc-0",
      sequence: 1,
      operationType: "mcp" as const,
      serverName: "srv",
      method: "tools/list",
      startedAt: "2026-02-16T00:00:00.000Z",
      completedAt: "2026-02-16T00:00:01.000Z",
      request: {},
      response: {},
      isError: false,
      turnId: "turn-1",
    };

    const next = upsertThreadOperationLogEntry([], first);
    const sorted = upsertThreadOperationLogEntry(next, second);
    expect(sorted.map((entry) => entry.id)).toEqual(["rpc-0", "rpc-1"]);

    const replaced = upsertThreadOperationLogEntry(sorted, {
      ...first,
      method: "tools/call-updated",
    });
    expect(replaced.find((entry) => entry.id === "rpc-1")?.method).toBe("tools/call-updated");
  });

  it("repositions existing entries when ordering fields change", () => {
    const first = {
      id: "rpc-1",
      sequence: 1,
      operationType: "mcp" as const,
      serverName: "srv",
      method: "tools/call",
      startedAt: "2026-02-16T00:00:00.000Z",
      completedAt: "2026-02-16T00:00:01.000Z",
      request: {},
      response: {},
      isError: false,
      turnId: "turn-1",
    };
    const second = {
      id: "rpc-2",
      sequence: 1,
      operationType: "mcp" as const,
      serverName: "srv",
      method: "tools/list",
      startedAt: "2026-02-16T00:00:02.000Z",
      completedAt: "2026-02-16T00:00:03.000Z",
      request: {},
      response: {},
      isError: false,
      turnId: "turn-1",
    };

    const initial = upsertThreadOperationLogEntry(upsertThreadOperationLogEntry([], first), second);
    expect(initial.map((entry) => entry.id)).toEqual(["rpc-1", "rpc-2"]);

    const moved = upsertThreadOperationLogEntry(initial, {
      ...second,
      startedAt: "2026-02-15T23:59:59.000Z",
    });
    expect(moved.map((entry) => entry.id)).toEqual(["rpc-2", "rpc-1"]);
  });
});
