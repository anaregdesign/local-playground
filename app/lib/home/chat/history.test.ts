/**
 * Test module verifying history behavior.
 */
import { describe, expect, it } from "vitest";
import type { McpRpcHistoryEntry } from "~/lib/home/chat/stream";
import {
  buildMcpEntryCopyPayload,
  buildMcpHistoryByTurnId,
  collectSuccessfulSkillGuideLocations,
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

describe("collectSuccessfulSkillGuideLocations", () => {
  it("returns successfully loaded guide locations for currently selected skills", () => {
    const entries = [
      createEntry({
        id: "guide-1",
        operationType: "skill",
        method: "skill_read_guide",
        response: {
          jsonrpc: "2.0",
          id: "guide-1",
          result: {
            ok: true,
            location: "/skills/alpha/SKILL.md",
          },
        },
      }),
      createEntry({
        id: "guide-2",
        operationType: "skill",
        method: "skill_read_guide",
        response: {
          jsonrpc: "2.0",
          id: "guide-2",
          result: {
            ok: true,
            location: "/skills/beta/SKILL.md",
          },
        },
      }),
    ];

    expect(
      collectSuccessfulSkillGuideLocations(entries, [
        { location: "/skills/beta/SKILL.md" },
        { location: "/skills/alpha/SKILL.md" },
      ]),
    ).toEqual(["/skills/beta/SKILL.md", "/skills/alpha/SKILL.md"]);
  });

  it("ignores failed, malformed, and non-selected guide reads", () => {
    const entries = [
      createEntry({
        id: "guide-failed",
        operationType: "skill",
        method: "skill_read_guide",
        isError: true,
      }),
      createEntry({
        id: "guide-malformed",
        operationType: "skill",
        method: "skill_read_guide",
        response: {
          jsonrpc: "2.0",
          id: "guide-malformed",
          result: {
            ok: true,
          },
        },
      }),
      createEntry({
        id: "guide-other-skill",
        operationType: "skill",
        method: "skill_read_guide",
        response: {
          jsonrpc: "2.0",
          id: "guide-other-skill",
          result: {
            ok: true,
            location: "/skills/other/SKILL.md",
          },
        },
      }),
      createEntry({
        id: "list-resources",
        operationType: "skill",
        method: "skill_list_resources",
        response: {
          jsonrpc: "2.0",
          id: "list-resources",
          result: {
            ok: true,
            location: "/skills/alpha/SKILL.md",
          },
        },
      }),
      createEntry({
        id: "guide-success",
        operationType: "skill",
        method: "skill_read_guide",
        response: {
          jsonrpc: "2.0",
          id: "guide-success",
          result: {
            ok: true,
            location: "/skills/alpha/SKILL.md",
          },
        },
      }),
    ];

    expect(
      collectSuccessfulSkillGuideLocations(entries, [
        { location: "/skills/alpha/SKILL.md" },
        { location: "/skills/beta/SKILL.md" },
      ]),
    ).toEqual(["/skills/alpha/SKILL.md"]);
  });
});
