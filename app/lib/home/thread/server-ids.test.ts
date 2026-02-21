import { describe, expect, it } from "vitest";
import {
  buildThreadMcpRpcLogRowId,
  buildThreadMcpServerRowId,
  buildThreadSkillSelectionRowId,
  normalizeThreadMcpRpcLogSourceId,
  normalizeThreadMcpServerSourceId,
} from "~/lib/home/thread/server-ids";

describe("normalizeThreadMcpServerSourceId", () => {
  it("keeps plain source ids unchanged", () => {
    expect(normalizeThreadMcpServerSourceId("mcp-123", 0)).toBe("mcp-123");
  });

  it("unwraps persisted row-id prefixes recursively", () => {
    const nested =
      "thread:thread-1:mcp:0:thread:thread-1:mcp:0:thread:thread-1:mcp:0:mcp-profile-1";
    expect(normalizeThreadMcpServerSourceId(nested, 0)).toBe("mcp-profile-1");
  });

  it("falls back when source id is blank", () => {
    expect(normalizeThreadMcpServerSourceId("   ", 2)).toBe("server-3");
  });
});

describe("buildThreadMcpServerRowId", () => {
  it("produces stable row ids even when source id already contains a row prefix", () => {
    const threadId = "thread-1";
    const sourceId = "mcp-profile-1";
    const first = buildThreadMcpServerRowId(threadId, sourceId, 0);
    const second = buildThreadMcpServerRowId(threadId, first, 0);

    expect(first).toBe("thread:thread-1:mcp:0:mcp-profile-1");
    expect(second).toBe(first);
  });
});

describe("normalizeThreadMcpRpcLogSourceId", () => {
  it("keeps plain source ids unchanged", () => {
    expect(normalizeThreadMcpRpcLogSourceId("rpc-123", 0)).toBe("rpc-123");
  });

  it("unwraps persisted row-id prefixes recursively", () => {
    const nested =
      "thread:thread-1:rpc:0:thread:thread-1:rpc:0:thread:thread-1:rpc:0:rpc-origin";
    expect(normalizeThreadMcpRpcLogSourceId(nested, 0)).toBe("rpc-origin");
  });

  it("falls back when source id is blank", () => {
    expect(normalizeThreadMcpRpcLogSourceId("  ", 1)).toBe("rpc-2");
  });
});

describe("buildThreadMcpRpcLogRowId", () => {
  it("produces stable row ids even when source id already contains a row prefix", () => {
    const threadId = "thread-1";
    const sourceId = "rpc-origin";
    const first = buildThreadMcpRpcLogRowId(threadId, sourceId, 0);
    const second = buildThreadMcpRpcLogRowId(threadId, first, 0);

    expect(first).toBe("thread:thread-1:rpc:0:rpc-origin");
    expect(second).toBe(first);
  });
});

describe("buildThreadSkillSelectionRowId", () => {
  it("builds deterministic row ids from thread id and order", () => {
    expect(buildThreadSkillSelectionRowId("thread-1", 0)).toBe("thread:thread-1:skill:0");
    expect(buildThreadSkillSelectionRowId("thread-1", 3)).toBe("thread:thread-1:skill:3");
  });
});
