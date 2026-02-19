import { describe, expect, it } from "vitest";
import {
  buildInstructionEnhanceMessage,
  buildInstructionDiffLines,
  buildInstructionSuggestedFileName,
  detectInstructionLanguage,
  normalizeEnhancedInstructionResponse,
  resolveInstructionFormatExtension,
  resolveInstructionSourceFileName,
  parseAzureAuthScopeInput,
  parseMcpTimeoutSecondsInput,
  parseHttpHeadersInput,
  parseSseDataBlock,
  readChatStreamEvent,
  readMcpRpcHistoryEntryFromUnknown,
  readAzureSelectionFromUnknown,
  readTenantIdFromUnknown,
  upsertMcpRpcHistoryEntry,
  validateEnhancedInstructionCompleteness,
  validateEnhancedInstructionFormat,
  validateInstructionLanguagePreserved,
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

describe("instruction enhance helpers", () => {
  it("resolves source file name from loaded file", () => {
    expect(resolveInstructionSourceFileName("prompt.md")).toBe("prompt.md");
    expect(resolveInstructionSourceFileName("  prompt.md  ")).toBe("prompt.md");
    expect(resolveInstructionSourceFileName(null)).toBeNull();
  });

  it("builds suggested save file name from source and content", () => {
    expect(buildInstructionSuggestedFileName("prompt.md", "text")).toBe("prompt.md");
    expect(buildInstructionSuggestedFileName("prompt.bin", "{\"a\":1}")).toBe("prompt.json");
    expect(buildInstructionSuggestedFileName(null, "<root/>")).toBe("instruction.xml");
  });

  it("resolves extension from file name and content fallback", () => {
    expect(resolveInstructionFormatExtension("prompt.json", "text")).toBe("json");
    expect(resolveInstructionFormatExtension(null, '{"a":1}')).toBe("json");
    expect(resolveInstructionFormatExtension(null, "<root><a>1</a></root>")).toBe("xml");
    expect(resolveInstructionFormatExtension(null, "# Title\n- item")).toBe("md");
    expect(resolveInstructionFormatExtension(null, "plain text")).toBe("txt");
  });

  it("detects language from script usage", () => {
    expect(detectInstructionLanguage("こんにちは")).toBe("japanese");
    expect(detectInstructionLanguage("Hello world")).toBe("english");
    expect(detectInstructionLanguage("Hello こんにちは")).toBe("mixed");
  });

  it("builds enhance message with language and extension constraints", () => {
    const message = buildInstructionEnhanceMessage({
      instruction: "You are concise.",
      extension: "md",
      language: "english",
    });
    expect(message).toContain(
      "Preserve as much original information as possible; avoid deleting details unless necessary.",
    );
    expect(message).toContain(
      "Do not add placeholder comments/markers such as '省略', 'omitted', 'same as original', or equivalent.",
    );
    expect(message).toContain("Preserve the original language (English).");
    expect(message).toContain("Preserve the original file format style for .md.");
    expect(message).toContain("<instruction>");
  });

  it("unwraps top-level fenced output from model response", () => {
    const normalized = normalizeEnhancedInstructionResponse("```markdown\n# title\n```");
    expect(normalized).toBe("# title");
  });

  it("validates enhanced format and language preservation", () => {
    expect(validateEnhancedInstructionFormat('{"a":1}', "json")).toEqual({
      ok: true,
      value: true,
    });
    expect(validateEnhancedInstructionFormat("not-json", "json")).toEqual({
      ok: false,
      error: "Enhanced instruction is not valid JSON. Please retry.",
    });
    expect(validateEnhancedInstructionFormat("<root/>", "xml")).toEqual({
      ok: true,
      value: true,
    });
    expect(validateEnhancedInstructionFormat("root text", "xml")).toEqual({
      ok: false,
      error: "Enhanced instruction is not valid XML-like content. Please retry.",
    });

    expect(validateInstructionLanguagePreserved("日本語で回答してください", "簡潔に回答します。")).toEqual({
      ok: true,
      value: true,
    });
    expect(validateInstructionLanguagePreserved("日本語で回答してください", "Answer briefly.")).toEqual({
      ok: false,
      error: "Enhanced instruction changed language unexpectedly. Please retry.",
    });
    expect(validateInstructionLanguagePreserved("Answer in English.", "こんにちは")).toEqual({
      ok: false,
      error: "Enhanced instruction changed language unexpectedly. Please retry.",
    });
  });

  it("rejects omission-marker placeholders in enhanced content", () => {
    expect(
      validateEnhancedInstructionCompleteness(
        "<!-- 以降のExamplesは原文どおり（長大のため省略せずに保持する想定） -->",
      ),
    ).toEqual({
      ok: false,
      error:
        "Enhanced instruction appears to omit original content with placeholders/comments. Please retry.",
    });

    expect(validateEnhancedInstructionCompleteness("All original examples are fully included.")).toEqual({
      ok: true,
      value: true,
    });
  });

  it("builds github-style line diff entries", () => {
    const diff = buildInstructionDiffLines("line-1\nline-2\nline-3", "line-1\nline-2-updated\nline-3\nline-4");
    expect(diff).toEqual([
      {
        type: "context",
        oldLineNumber: 1,
        newLineNumber: 1,
        content: "line-1",
      },
      {
        type: "removed",
        oldLineNumber: 2,
        newLineNumber: null,
        content: "line-2",
      },
      {
        type: "added",
        oldLineNumber: null,
        newLineNumber: 2,
        content: "line-2-updated",
      },
      {
        type: "context",
        oldLineNumber: 3,
        newLineNumber: 3,
        content: "line-3",
      },
      {
        type: "added",
        oldLineNumber: null,
        newLineNumber: 4,
        content: "line-4",
      },
    ]);
  });

  it("falls back to linear diff strategy when matrix is capped", () => {
    const diff = buildInstructionDiffLines("a\nb\nc", "a\nx\nc", {
      maxMatrixCells: 1,
    });
    expect(diff.map((line) => line.type)).toEqual([
      "context",
      "removed",
      "added",
      "context",
    ]);
  });

  it("returns only context lines for identical instructions", () => {
    const diff = buildInstructionDiffLines("same\nlines", "same\nlines");
    expect(diff).toEqual([
      {
        type: "context",
        oldLineNumber: 1,
        newLineNumber: 1,
        content: "same",
      },
      {
        type: "context",
        oldLineNumber: 2,
        newLineNumber: 2,
        content: "lines",
      },
    ]);
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

describe("parseHttpHeadersInput", () => {
  it("parses valid KEY=value lines", () => {
    expect(
      parseHttpHeadersInput("Authorization=Bearer abc\nX-Trace-Id=trace-1"),
    ).toEqual({
      ok: true,
      value: {
        Authorization: "Bearer abc",
        "X-Trace-Id": "trace-1",
      },
    });
  });

  it("rejects overriding Content-Type", () => {
    expect(parseHttpHeadersInput("Content-Type=text/plain")).toEqual({
      ok: false,
      error: 'Header line cannot override "Content-Type". It is fixed to "application/json".',
    });
  });
});

describe("parseAzureAuthScopeInput", () => {
  it("uses default scope when empty", () => {
    expect(parseAzureAuthScopeInput("")).toEqual({
      ok: true,
      value: "https://cognitiveservices.azure.com/.default",
    });
  });

  it("rejects scope with whitespace", () => {
    expect(parseAzureAuthScopeInput("scope with space")).toEqual({
      ok: false,
      error: "Azure auth scope must not include spaces.",
    });
  });
});

describe("parseMcpTimeoutSecondsInput", () => {
  it("uses default when empty", () => {
    expect(parseMcpTimeoutSecondsInput("")).toEqual({
      ok: true,
      value: 30,
    });
  });

  it("rejects non-integer values", () => {
    expect(parseMcpTimeoutSecondsInput("3.5")).toEqual({
      ok: false,
      error: "MCP timeout must be an integer number of seconds.",
    });
  });

  it("rejects out-of-range values", () => {
    expect(parseMcpTimeoutSecondsInput("0")).toEqual({
      ok: false,
      error: "MCP timeout must be between 1 and 600 seconds.",
    });
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
    expect(entry?.turnId).toBe("");
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
      turnId: "turn-1",
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
      turnId: "turn-1",
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
