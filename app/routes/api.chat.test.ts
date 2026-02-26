/**
 * Test module verifying api.chat behavior.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_SKILL_OPERATION_CALLS_PER_SERVER_METHOD,
  CHAT_MAX_SKILL_RUN_SCRIPT_CALLS_PER_SERVER_METHOD,
  MCP_DEFAULT_AZURE_AUTH_SCOPE,
  THREAD_ENVIRONMENT_VARIABLES_MAX,
} from "~/lib/constants";
import { chatRouteTestUtils } from "./api.chat";

const {
  readTemperature,
  readWebSearchEnabled,
  readAttachments,
  readThreadEnvironment,
  hasNonPdfAttachments,
  readSkills,
  readExplicitSkillLocations,
  readMcpServers,
  buildMcpHttpRequestHeaders,
  normalizeMcpMetaNulls,
  normalizeMcpInitializeNullOptionals,
  normalizeMcpListToolsNullOptionals,
  readProgressEventFromRunStreamEvent,
  buildStdioSpawnEnvironment,
  resolveExecutableCommand,
  isSkillOperationErrorResult,
  buildSkillOperationLoopSignature,
  updateSkillOperationLoopState,
  buildRepeatedSkillOperationLoopMessage,
  incrementSkillOperationCount,
  readSkillOperationCallLimit,
  buildSkillOperationCountExceededMessage,
  buildSkillOperationErrorCountExceededMessage,
  applySkillScriptEnvironmentChanges,
} = chatRouteTestUtils;

describe("readWebSearchEnabled", () => {
  it("defaults to false for omitted or invalid values", () => {
    expect(readWebSearchEnabled({})).toBe(false);
    expect(readWebSearchEnabled({ webSearchEnabled: "true" })).toBe(false);
    expect(readWebSearchEnabled({ webSearchEnabled: 1 })).toBe(false);
  });

  it("accepts explicit boolean flags", () => {
    expect(readWebSearchEnabled({ webSearchEnabled: true })).toBe(true);
    expect(readWebSearchEnabled({ webSearchEnabled: false })).toBe(false);
  });
});

describe("attachment tool routing", () => {
  it("treats non-pdf attachments as code-interpreter targets", () => {
    expect(
      hasNonPdfAttachments([
        {
          name: "notes.pdf",
          mimeType: "application/pdf",
          sizeBytes: 9,
          dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
        },
      ]),
    ).toBe(false);

    expect(
      hasNonPdfAttachments([
        {
          name: "sheet.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: 5,
          dataUrl: "data:application/octet-stream;base64,YWJjZA==",
        },
      ]),
    ).toBe(true);
  });
});

describe("readAttachments", () => {
  it("parses valid data-url attachments", () => {
    const result = readAttachments({
      attachments: [
        {
          name: "notes.pdf",
          mimeType: "application/pdf",
          sizeBytes: 9,
          dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: [
        {
          name: "notes.pdf",
          mimeType: "application/pdf",
          sizeBytes: 9,
          dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
        },
      ],
    });
  });

  it("rejects invalid attachment payloads", () => {
    expect(
      readAttachments({
        attachments: [
          {
            name: "broken.pdf",
            dataUrl: "data:application/octet-stream;base64,!!!",
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error: "`attachments[0].dataUrl` contains invalid base64 data.",
    });

    expect(
      readAttachments({
        attachments: [
          {
            name: "mismatch.pdf",
            mimeType: "application/pdf",
            sizeBytes: 99,
            dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error: "`attachments[0].sizeBytes` does not match file data size.",
    });
  });

  it("rejects unsupported formats", () => {
    expect(
      readAttachments({
        attachments: [
          {
            name: "notes.exe",
            dataUrl: "data:application/octet-stream;base64,aGVsbG8=",
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error:
        "`attachments[0].name` must use a supported extension (.c, .cpp, .csv, .docx, .gif, .html, .java, .jpeg, .jpg, .js, .json, .md, .pdf, .php, .pkl, .png, .pptx, .py, .rb, .tar, .tex, .txt, .xlsx, .xml, .zip).",
    });
  });
});

describe("readThreadEnvironment", () => {
  it("parses valid thread environment payloads", () => {
    expect(
      readThreadEnvironment({
        threadEnvironment: {
          VIRTUAL_ENV: "/tmp/.venv",
          PATH: "/tmp/.venv/bin:${PATH}",
        },
      }),
    ).toEqual({
      ok: true,
      value: {
        VIRTUAL_ENV: "/tmp/.venv",
        PATH: "/tmp/.venv/bin:${PATH}",
      },
    });
  });

  it("rejects invalid thread environment payloads", () => {
    expect(
      readThreadEnvironment({
        threadEnvironment: {
          "INVALID-KEY": "value",
        },
      }),
    ).toEqual({
      ok: false,
      error:
        '`threadEnvironment` includes an invalid key "INVALID-KEY". ' +
        "Keys must match /^[A-Za-z_][A-Za-z0-9_]*$/ and be 128 characters or fewer.",
    });
  });
});

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

describe("isSkillOperationErrorResult", () => {
  it("returns true for explicit error payloads and non-zero exit codes", () => {
    expect(isSkillOperationErrorResult({ ok: false, error: "failed" })).toBe(true);
    expect(isSkillOperationErrorResult({ ok: true, exitCode: 1, stderr: "" })).toBe(true);
    expect(isSkillOperationErrorResult({ ok: true, exitCode: null, stderr: "" })).toBe(true);
  });

  it("returns false for successful payloads with exitCode=0 regardless of stderr", () => {
    expect(isSkillOperationErrorResult({ ok: true, exitCode: 0, stderr: "warning" })).toBe(false);
    expect(isSkillOperationErrorResult({ ok: true, stderr: "warning" })).toBe(false);
    expect(isSkillOperationErrorResult({ ok: true })).toBe(false);
  });
});

describe("Skill operation loop guard helpers", () => {
  it("builds stable signatures for equivalent inputs", () => {
    const first = buildSkillOperationLoopSignature("python-venv", "skill_run_script", {
      skill: "python-venv",
      path: "python-venv.bash",
      args: ["path", "3.11.8"],
      options: {
        retries: 2,
        mode: "strict",
      },
    });
    const second = buildSkillOperationLoopSignature("python-venv", "skill_run_script", {
      options: {
        mode: "strict",
        retries: 2,
      },
      args: ["path", "3.11.8"],
      path: "python-venv.bash",
      skill: "python-venv",
    });

    expect(first).toBe(second);
  });

  it("increments repeated counts and resets for different signatures", () => {
    let state = { signature: "", consecutiveCount: 0 };
    state = updateSkillOperationLoopState(state, "sig-1");
    expect(state).toEqual({ signature: "sig-1", consecutiveCount: 1 });
    state = updateSkillOperationLoopState(state, "sig-1");
    expect(state).toEqual({ signature: "sig-1", consecutiveCount: 2 });
    state = updateSkillOperationLoopState(state, "sig-2");
    expect(state).toEqual({ signature: "sig-2", consecutiveCount: 1 });
  });

  it("returns descriptive loop error messages", () => {
    const message = buildRepeatedSkillOperationLoopMessage({
      serverName: "python-venv",
      method: "skill_run_script",
      consecutiveCount: 9,
    });

    expect(message).toContain("python-venv.skill_run_script");
    expect(message).toContain("9 identical consecutive calls");
  });
});

describe("Skill operation budget helpers", () => {
  it("uses a higher call limit for skill_run_script only", () => {
    expect(readSkillOperationCallLimit("skill_run_script")).toBe(
      CHAT_MAX_SKILL_RUN_SCRIPT_CALLS_PER_SERVER_METHOD,
    );
    expect(readSkillOperationCallLimit("skill_read_guide")).toBe(
      CHAT_MAX_SKILL_OPERATION_CALLS_PER_SERVER_METHOD,
    );
  });

  it("tracks counts per server and method key", () => {
    const counts = new Map<string, number>();
    expect(incrementSkillOperationCount(counts, "python-venv", "skill_run_script")).toBe(1);
    expect(incrementSkillOperationCount(counts, "python-venv", "skill_run_script")).toBe(2);
    expect(incrementSkillOperationCount(counts, "pptx", "skill_run_script")).toBe(1);
  });

  it("returns descriptive budget messages", () => {
    const countMessage = buildSkillOperationCountExceededMessage({
      serverName: "python-venv",
      method: "skill_run_script",
      count: 25,
    });
    const errorMessage = buildSkillOperationErrorCountExceededMessage({
      errorCount: 11,
    });

    expect(countMessage).toContain("python-venv.skill_run_script");
    expect(countMessage).toContain("25 calls in one run");
    expect(errorMessage).toContain("11");
    expect(errorMessage).toContain("too many Skill operation errors");
  });
});

describe("applySkillScriptEnvironmentChanges", () => {
  it("applies additions after removals when thread environment is at capacity", () => {
    const threadEnvironment: Record<string, string> = {};
    for (let index = 0; index < THREAD_ENVIRONMENT_VARIABLES_MAX - 1; index += 1) {
      threadEnvironment[`KEY_${index}`] = `${index}`;
    }
    threadEnvironment.REMOVE_ME = "remove";

    const result = applySkillScriptEnvironmentChanges(threadEnvironment, {
      captured: true,
      updated: {
        ADDED_KEY: "added",
      },
      removed: ["REMOVE_ME"],
    });

    expect(result).toEqual({
      captured: true,
      updated: ["ADDED_KEY"],
      removed: ["REMOVE_ME"],
      ignored: [],
    });
    expect(threadEnvironment).toHaveProperty("ADDED_KEY", "added");
    expect(threadEnvironment).not.toHaveProperty("REMOVE_ME");
    expect(Object.keys(threadEnvironment)).toHaveLength(THREAD_ENVIRONMENT_VARIABLES_MAX);
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

describe("stdio command resolution", () => {
  it("builds stdio env with PATH", () => {
    const env = buildStdioSpawnEnvironment({});
    expect(typeof env.PATH).toBe("string");
    expect((env.PATH ?? "").length).toBeGreaterThan(0);
  });

  it("resolves a command from PATH entries", () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "local-playground-chat-"));
    try {
      const commandName = process.platform === "win32" ? "demo-tool.cmd" : "demo-tool";
      const commandPath = path.join(tempDirectory, commandName);
      writeFileSync(
        commandPath,
        process.platform === "win32" ? "@echo off\r\necho demo\r\n" : "#!/bin/sh\necho demo\n",
        "utf8",
      );
      if (process.platform !== "win32") {
        chmodSync(commandPath, 0o755);
      }

      const resolved = resolveExecutableCommand("demo-tool", { PATH: tempDirectory });
      expect(resolved).toBe(commandPath);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});

describe("readSkills", () => {
  it("parses skill selections and de-duplicates locations", () => {
    const result = readSkills({
      skills: [
        {
          name: "local-playground-dev",
          location: "/Users/hiroki/.codex/skills/local-playground-dev/SKILL.md",
        },
        {
          name: "local-playground-dev",
          location: "/Users/hiroki/.codex/skills/local-playground-dev/SKILL.md",
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: [
        {
          name: "local-playground-dev",
          location: "/Users/hiroki/.codex/skills/local-playground-dev/SKILL.md",
        },
      ],
    });
  });

  it("rejects invalid payloads", () => {
    expect(readSkills({ skills: "invalid" })).toEqual({
      ok: false,
      error: "`skills` must be an array.",
    });

    expect(readSkills({ skills: [{ location: "/tmp/SKILL.md" }] })).toEqual({
      ok: false,
      error: "skills[0].name is required.",
    });
  });
});

describe("readExplicitSkillLocations", () => {
  it("parses and de-duplicates explicit skill locations", () => {
    const result = readExplicitSkillLocations({
      explicitSkillLocations: [
        " /Users/hiroki/.codex/skills/local-playground-dev/SKILL.md ",
        "/Users/hiroki/.codex/skills/local-playground-dev/SKILL.md",
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: ["/Users/hiroki/.codex/skills/local-playground-dev/SKILL.md"],
    });
  });

  it("rejects invalid payloads", () => {
    expect(readExplicitSkillLocations({ explicitSkillLocations: "invalid" })).toEqual({
      ok: false,
      error: "`explicitSkillLocations` must be an array.",
    });
    expect(readExplicitSkillLocations({ explicitSkillLocations: [1] })).toEqual({
      ok: false,
      error: "explicitSkillLocations[0] must be a string.",
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

  it("surfaces tool failures in progress messages", () => {
    const toolNameByCallId = new Map<string, string>([["call-2", "skill_run_script"]]);

    const failed = readProgressEventFromRunStreamEvent(
      {
        type: "run_item_stream_event",
        name: "tool_output",
        item: {
          output: JSON.stringify({
            ok: false,
            error: "Plan not found: /private/tmp/plan.json",
          }),
          rawItem: {
            callId: "call-2",
          },
        },
      },
      false,
      toolNameByCallId,
    );

    expect(failed).toEqual({
      message: "Tool failed: skill_run_script (Plan not found: /private/tmp/plan.json)",
      isMcp: false,
    });
    expect(toolNameByCallId.has("call-2")).toBe(false);
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
