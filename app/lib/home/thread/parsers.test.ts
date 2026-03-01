/**
 * Test module verifying parsers behavior.
 */
import { describe, expect, it } from "vitest";
import {
  buildThreadSummary,
  readThreadSnapshotFromUnknown,
  readThreadSnapshotList,
} from "~/lib/home/thread/parsers";

describe("readThreadSnapshotFromUnknown", () => {
  it("parses a valid thread payload", () => {
    const parsed = readThreadSnapshotFromUnknown({
      id: "thread-1",
      name: "Thread 1",
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
      deletedAt: null,
      reasoningEffort: "none",
      webSearchEnabled: false,
      agentInstruction: "You are concise.",
      threadEnvironment: {
        VIRTUAL_ENV: "/tmp/thread-1/.venv",
      },
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Hi",
          createdAt: "2026-02-20T00:00:00.000Z",
          turnId: "turn-1",
          attachments: [],
          skillActivations: [
            {
              name: "doc-retriever",
              location: "/skills/doc-retriever/SKILL.md",
            },
          ],
        },
      ],
      mcpServers: [
        {
          id: "mcp-1",
          name: "Local MCP",
          transport: "streamable_http",
          url: "https://example.com/mcp",
          headers: {},
          useAzureAuth: false,
          azureAuthScope: "https://cognitiveservices.azure.com/.default",
          timeoutSeconds: 30,
        },
      ],
      mcpRpcLogs: [
        {
          id: "rpc-1",
          sequence: 1,
          serverName: "Local MCP",
          method: "tools/list",
          startedAt: "2026-02-20T00:00:01.000Z",
          completedAt: "2026-02-20T00:00:02.000Z",
          request: { jsonrpc: "2.0" },
          response: { jsonrpc: "2.0" },
          isError: false,
          turnId: "turn-1",
        },
      ],
      skillSelections: [
        {
          name: "local-playground-dev",
          location: "/Users/hiroki/.codex/skills/local-playground-dev/SKILL.md",
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe("thread-1");
    expect(parsed?.reasoningEffort).toBe("none");
    expect(parsed?.webSearchEnabled).toBe(false);
    expect(parsed?.threadEnvironment).toEqual({
      VIRTUAL_ENV: "/tmp/thread-1/.venv",
    });
    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.messages[0]?.skillActivations).toEqual([
      {
        name: "doc-retriever",
        location: "/skills/doc-retriever/SKILL.md",
      },
    ]);
    expect(parsed?.mcpServers).toHaveLength(1);
    expect(parsed?.mcpRpcLogs).toHaveLength(1);
  });

  it("returns null for invalid payload", () => {
    expect(readThreadSnapshotFromUnknown({ id: "thread-1" })).toBeNull();
    expect(readThreadSnapshotFromUnknown("invalid")).toBeNull();
    expect(
      readThreadSnapshotFromUnknown({
        id: "thread-1",
        name: "Thread 1",
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
        deletedAt: "",
        reasoningEffort: "none",
        webSearchEnabled: false,
      }),
    ).toBeNull();
  });
});

describe("readThreadSnapshotList", () => {
  it("filters invalid entries and deduplicates ids", () => {
    const list = readThreadSnapshotList([
      {
        id: "thread-1",
        name: "Thread 1",
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
        deletedAt: null,
        reasoningEffort: "none",
        webSearchEnabled: false,
        agentInstruction: "Instruction",
        threadEnvironment: {},
        skillSelections: [],
      },
      {
        id: "thread-1",
        name: "Duplicate",
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
        deletedAt: null,
        reasoningEffort: "none",
        webSearchEnabled: false,
        agentInstruction: "Instruction",
        threadEnvironment: {},
        skillSelections: [],
      },
      {
        id: "",
      },
    ]);

    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Thread 1");
  });
});

describe("buildThreadSummary", () => {
  it("builds summary counts", () => {
    const summary = buildThreadSummary({
      id: "thread-1",
      name: "Thread 1",
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
      deletedAt: null,
      reasoningEffort: "none",
      webSearchEnabled: false,
      agentInstruction: "Instruction",
      threadEnvironment: {},
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "Hello",
          createdAt: "2026-02-20T00:00:00.000Z",
          turnId: "turn-1",
          attachments: [],
          skillActivations: [],
        },
      ],
      mcpServers: [
        {
          id: "mcp-1",
          name: "Local MCP",
          transport: "stdio",
          command: "npx",
          args: ["-y"],
          env: {},
        },
      ],
      mcpRpcLogs: [],
      skillSelections: [],
    });

    expect(summary).toEqual({
      id: "thread-1",
      name: "Thread 1",
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
      deletedAt: null,
      messageCount: 1,
      mcpServerCount: 1,
    });
  });
});
