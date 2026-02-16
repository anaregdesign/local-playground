import { describe, expect, it } from "vitest";
import {
  parseSseDataBlock,
  readChatStreamEvent,
  readMcpRpcHistoryEntryFromUnknown,
  readAzureSelectionFromUnknown,
  readTenantIdFromUnknown,
  upsertMcpRpcHistoryEntry,
  validateContextWindowInput,
} from "./home";

describe("validateContextWindowInput", () => {
  it("accepts integers in the allowed range", () => {
    expect(validateContextWindowInput("10")).toEqual({
      isValid: true,
      value: 10,
      message: null,
    });
  });

  it("rejects non-integer input", () => {
    expect(validateContextWindowInput("1.5")).toEqual({
      isValid: false,
      value: null,
      message: "Context window must be an integer.",
    });
  });

  it("rejects values outside range", () => {
    expect(validateContextWindowInput("0")).toEqual({
      isValid: false,
      value: null,
      message: "Context window must be between 1 and 200.",
    });
    expect(validateContextWindowInput("201")).toEqual({
      isValid: false,
      value: null,
      message: "Context window must be between 1 and 200.",
    });
  });
});

describe("readTenantIdFromUnknown", () => {
  it("returns trimmed tenantId for string values", () => {
    expect(readTenantIdFromUnknown(" tenant-a ")).toBe("tenant-a");
  });

  it("returns empty string for non-string values", () => {
    expect(readTenantIdFromUnknown(100)).toBe("");
    expect(readTenantIdFromUnknown(null)).toBe("");
  });
});

describe("readAzureSelectionFromUnknown", () => {
  it("returns normalized selection when tenant matches", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: " tenant-a ",
          projectId: " project-a ",
          deploymentName: " deploy-a ",
        },
        "tenant-a",
      ),
    ).toEqual({
      tenantId: "tenant-a",
      projectId: "project-a",
      deploymentName: "deploy-a",
    });
  });

  it("returns null when tenant does not match expected tenant", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: "tenant-a",
          projectId: "project-a",
          deploymentName: "deploy-a",
        },
        "tenant-b",
      ),
    ).toBeNull();
  });

  it("returns null for invalid payload", () => {
    expect(readAzureSelectionFromUnknown({}, "tenant-a")).toBeNull();
    expect(readAzureSelectionFromUnknown("invalid", "tenant-a")).toBeNull();
  });
});

describe("parseSseDataBlock", () => {
  it("extracts data payload lines", () => {
    const block = [
      "event: message",
      'data: {"type":"progress","message":"step 1"}',
      "",
    ].join("\n");

    expect(parseSseDataBlock(block)).toBe('{"type":"progress","message":"step 1"}');
  });

  it("returns null when no data line exists", () => {
    expect(parseSseDataBlock("event: ping\nid: 1")).toBeNull();
  });
});

describe("readChatStreamEvent", () => {
  it("parses mcp_rpc record payload", () => {
    const event = readChatStreamEvent(
      JSON.stringify({
        type: "mcp_rpc",
        record: {
          id: "rpc-1",
          sequence: 1,
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
    expect(event?.type).toBe("mcp_rpc");
  });
});

describe("readMcpRpcHistoryEntryFromUnknown", () => {
  it("accepts valid MCP JSON-RPC history entries", () => {
    const entry = readMcpRpcHistoryEntryFromUnknown({
      id: "rpc-2",
      sequence: 2,
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
  });

  it("rejects invalid entries", () => {
    expect(readMcpRpcHistoryEntryFromUnknown({ id: "", sequence: 1 })).toBeNull();
  });
});

describe("upsertMcpRpcHistoryEntry", () => {
  it("keeps history sorted by sequence and replaces duplicate ids", () => {
    const first = {
      id: "rpc-1",
      sequence: 2,
      serverName: "srv",
      method: "tools/call",
      startedAt: "2026-02-16T00:00:00.000Z",
      completedAt: "2026-02-16T00:00:01.000Z",
      request: {},
      response: {},
      isError: false,
    };
    const second = {
      id: "rpc-0",
      sequence: 1,
      serverName: "srv",
      method: "tools/list",
      startedAt: "2026-02-16T00:00:00.000Z",
      completedAt: "2026-02-16T00:00:01.000Z",
      request: {},
      response: {},
      isError: false,
    };

    const next = upsertMcpRpcHistoryEntry([], first);
    const sorted = upsertMcpRpcHistoryEntry(next, second);
    expect(sorted.map((entry) => entry.id)).toEqual(["rpc-0", "rpc-1"]);

    const replaced = upsertMcpRpcHistoryEntry(sorted, {
      ...first,
      method: "tools/call-updated",
    });
    expect(replaced.find((entry) => entry.id === "rpc-1")?.method).toBe("tools/call-updated");
  });
});
