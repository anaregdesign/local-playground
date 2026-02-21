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
      agentInstruction: "You are concise.",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Hi",
          turnId: "turn-1",
          attachments: [],
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
      mcpRpcHistory: [
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
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe("thread-1");
    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.mcpServers).toHaveLength(1);
    expect(parsed?.mcpRpcHistory).toHaveLength(1);
  });

  it("returns null for invalid payload", () => {
    expect(readThreadSnapshotFromUnknown({ id: "thread-1" })).toBeNull();
    expect(readThreadSnapshotFromUnknown("invalid")).toBeNull();
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
        agentInstruction: "Instruction",
      },
      {
        id: "thread-1",
        name: "Duplicate",
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
        agentInstruction: "Instruction",
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
      agentInstruction: "Instruction",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "Hello",
          turnId: "turn-1",
          attachments: [],
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
      mcpRpcHistory: [],
    });

    expect(summary).toEqual({
      id: "thread-1",
      name: "Thread 1",
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
      messageCount: 1,
      mcpServerCount: 1,
    });
  });
});
