import { describe, expect, it } from "vitest";
import {
  buildThreadMcpServerRowId,
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
