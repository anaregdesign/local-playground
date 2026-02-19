import { describe, expect, it } from "vitest";
import { MCP_DEFAULT_AZURE_AUTH_SCOPE } from "~/lib/constants";
import { chatRouteTestUtils } from "./api.chat";

const {
  readTemperature,
  readMcpServers,
  buildMcpHttpRequestHeaders,
  normalizeMcpMetaNulls,
  normalizeMcpInitializeNullOptionals,
  normalizeMcpListToolsNullOptionals,
  readProgressEventFromRunStreamEvent,
} = chatRouteTestUtils;

describe("readTemperature", () => {
  it("accepts omitted and numeric values", () => {
    expect(readTemperature({})).toEqual({ ok: true, value: null });
    expect(readTemperature({ temperature: "  " })).toEqual({ ok: true, value: null });
    expect(readTemperature({ temperature: "0.25" })).toEqual({ ok: true, value: 0.25 });
    expect(readTemperature({ temperature: 1.5 })).toEqual({ ok: true, value: 1.5 });
  });

  it("rejects invalid or out-of-range values", () => {
    expect(readTemperature({ temperature: "abc" })).toEqual({
      ok: false,
      error: "`temperature` must be a number between 0 and 2, or omitted (None).",
    });
    expect(readTemperature({ temperature: -0.1 })).toEqual({
      ok: false,
      error: "`temperature` must be between 0 and 2, or omitted (None).",
    });
  });
});

describe("readMcpServers", () => {
  it("parses HTTP MCP servers and de-duplicates equivalent configs", () => {
    const result = readMcpServers({
      mcpServers: [
        {
          transport: "streamable_http",
          name: "Server A",
          url: "https://EXAMPLE.com/mcp",
          headers: { "X-Trace": "abc" },
          useAzureAuth: true,
          azureAuthScope: "  https://scope/.default  ",
          timeoutSeconds: 45,
        },
        {
          transport: "streamable_http",
          name: "Server B",
          url: "https://example.com/mcp",
          headers: { "x-trace": "abc" },
          useAzureAuth: true,
          azureAuthScope: "https://scope/.default",
          timeoutSeconds: 45,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toEqual({
      name: "Server A",
      transport: "streamable_http",
      url: "https://example.com/mcp",
      headers: { "X-Trace": "abc" },
      useAzureAuth: true,
      azureAuthScope: "https://scope/.default",
      timeoutSeconds: 45,
    });
  });

  it("keeps stdio servers with different env values as distinct entries", () => {
    const result = readMcpServers({
      mcpServers: [
        {
          transport: "stdio",
          name: "stdio-a",
          command: "npx",
          args: ["-y", "@demo/server"],
          cwd: "/tmp/mcp",
          env: { API_KEY: "alpha" },
        },
        {
          transport: "stdio",
          name: "stdio-b",
          command: "npx",
          args: ["-y", "@demo/server"],
          cwd: "/tmp/mcp",
          env: { API_KEY: "beta" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toHaveLength(2);
    expect(result.value.map((entry) => entry.name)).toEqual(["stdio-a", "stdio-b"]);
  });

  it("uses MCP defaults for omitted HTTP fields", () => {
    const result = readMcpServers({
      mcpServers: [
        {
          url: "https://example.com/mcp",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value[0]).toEqual({
      name: "example.com",
      transport: "streamable_http",
      url: "https://example.com/mcp",
      headers: {},
      useAzureAuth: false,
      azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
      timeoutSeconds: 30,
    });
  });

  it("rejects reserved Content-Type header", () => {
    expect(
      readMcpServers({
        mcpServers: [
          {
            url: "https://example.com/mcp",
            headers: {
              "Content-Type": "text/plain",
            },
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error:
        'mcpServers[0].headers cannot include "Content-Type". It is fixed to "application/json".',
    });
  });
});

describe("MCP payload normalizers", () => {
  it("normalizes nested _meta: null to empty objects", () => {
    const result = normalizeMcpMetaNulls({
      _meta: null,
      tools: [{ _meta: null }],
    });

    expect(result).toEqual({
      changed: true,
      value: {
        _meta: {},
        tools: [{ _meta: {} }],
      },
    });
  });

  it("removes null optionals from initialize and tools payloads", () => {
    const initializeResult = normalizeMcpInitializeNullOptionals({
      result: {
        protocolVersion: "2025-01-01",
        capabilities: {
          tools: null,
          prompts: {},
        },
        serverInfo: {
          name: "demo",
          title: null,
        },
      },
    });

    expect(initializeResult).toEqual({
      changed: true,
      value: {
        result: {
          protocolVersion: "2025-01-01",
          capabilities: {
            prompts: {},
          },
          serverInfo: {
            name: "demo",
          },
        },
      },
    });

    const toolsResult = normalizeMcpListToolsNullOptionals({
      result: {
        tools: [
          {
            name: "search",
            description: null,
            inputSchema: {
              type: "object",
              properties: null,
            },
          },
        ],
      },
    });

    expect(toolsResult).toEqual({
      changed: true,
      value: {
        result: {
          tools: [
            {
              name: "search",
              inputSchema: {
                type: "object",
              },
            },
          ],
        },
      },
    });
  });
});

describe("MCP progress event reader", () => {
  it("tracks tool call lifecycle messages", () => {
    const toolNameByCallId = new Map<string, string>();

    const called = readProgressEventFromRunStreamEvent(
      {
        type: "run_item_stream_event",
        name: "tool_called",
        item: {
          toolName: "fetch_context",
          rawItem: {
            callId: "call-1",
          },
        },
      },
      true,
      toolNameByCallId,
    );

    expect(called).toEqual({
      message: "Running MCP command: fetch_context",
      isMcp: true,
    });
    expect(toolNameByCallId.get("call-1")).toBe("fetch_context");

    const finished = readProgressEventFromRunStreamEvent(
      {
        type: "run_item_stream_event",
        name: "tool_output",
        item: {
          rawItem: {
            callId: "call-1",
          },
        },
      },
      true,
      toolNameByCallId,
    );

    expect(finished).toEqual({
      message: "MCP command finished: fetch_context",
      isMcp: true,
    });
    expect(toolNameByCallId.has("call-1")).toBe(false);
  });

  it("emits reasoning and message generation progress", () => {
    const toolNameByCallId = new Map<string, string>();

    expect(
      readProgressEventFromRunStreamEvent(
        {
          type: "run_item_stream_event",
          name: "reasoning_item_created",
        },
        false,
        toolNameByCallId,
      ),
    ).toEqual({ message: "Reasoning on your request..." });

    expect(
      readProgressEventFromRunStreamEvent(
        {
          type: "run_item_stream_event",
          name: "message_output_created",
        },
        false,
        toolNameByCallId,
      ),
    ).toEqual({ message: "Generating response..." });
  });
});

describe("buildMcpHttpRequestHeaders", () => {
  it("keeps Content-Type fixed while merging custom headers", () => {
    expect(
      buildMcpHttpRequestHeaders({
        "content-type": "text/plain",
        Authorization: "Bearer token",
      }),
    ).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    });
  });
});
