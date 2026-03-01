/**
 * Test module verifying server-ids behavior.
 */
import { describe, expect, it } from "vitest";
import {
  buildThreadMessageSkillActivationRowId,
  buildThreadOperationLogRowId,
  buildThreadMcpServerRowId,
  buildThreadSkillActivationRowId,
  normalizeThreadOperationLogSourceRpcId,
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

describe("normalizeThreadOperationLogSourceRpcId", () => {
  it("keeps plain source ids unchanged", () => {
    expect(normalizeThreadOperationLogSourceRpcId("rpc-123", 0)).toBe("rpc-123");
  });

  it("unwraps persisted row-id prefixes recursively", () => {
    const nested =
      "thread:thread-1:rpc:0:thread:thread-1:rpc:0:thread:thread-1:rpc:0:rpc-origin";
    expect(normalizeThreadOperationLogSourceRpcId(nested, 0)).toBe("rpc-origin");
  });

  it("falls back when source id is blank", () => {
    expect(normalizeThreadOperationLogSourceRpcId("  ", 1)).toBe("rpc-2");
  });
});

describe("buildThreadOperationLogRowId", () => {
  it("produces stable row ids even when source id already contains a row prefix", () => {
    const threadId = "thread-1";
    const sourceId = "rpc-origin";
    const first = buildThreadOperationLogRowId(threadId, sourceId, 0);
    const second = buildThreadOperationLogRowId(threadId, first, 0);

    expect(first).toBe("thread:thread-1:rpc:0:rpc-origin");
    expect(second).toBe(first);
  });
});

describe("buildThreadSkillActivationRowId", () => {
  it("builds deterministic row ids from thread id and order", () => {
    expect(buildThreadSkillActivationRowId("thread-1", 0)).toBe("thread:thread-1:skill:0");
    expect(buildThreadSkillActivationRowId("thread-1", 3)).toBe("thread:thread-1:skill:3");
  });
});

describe("buildThreadMessageSkillActivationRowId", () => {
  it("builds deterministic row ids from message id and order", () => {
    expect(buildThreadMessageSkillActivationRowId("message-1", 0)).toBe(
      "message:message-1:skill:0",
    );
    expect(buildThreadMessageSkillActivationRowId("message-1", 2)).toBe(
      "message:message-1:skill:2",
    );
  });
});
