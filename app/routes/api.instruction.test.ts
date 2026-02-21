import { describe, expect, it } from "vitest";
import { PROMPT_MAX_CONTENT_BYTES } from "~/lib/constants";
import {
  buildPromptFileName,
  extractInstructionDiffPatch,
  parseInstructionReasoningEffort,
  normalizeRequestedPromptFileName,
  parseInstructionContent,
  parseRequestedPromptFileName,
} from "./api.instruction";

describe("parseInstructionContent", () => {
  it("accepts a non-empty instruction string", () => {
    const result = parseInstructionContent({
      instruction: "You are a concise assistant.",
    });

    expect(result.ok).toBe(true);
  });

  it("rejects empty instruction content", () => {
    const result = parseInstructionContent({
      instruction: "   ",
    });

    expect(result).toEqual({
      ok: false,
      error: "Instruction is empty.",
    });
  });

  it("rejects oversized instruction content", () => {
    const result = parseInstructionContent({
      instruction: "a".repeat(PROMPT_MAX_CONTENT_BYTES + 1),
    });

    expect(result).toEqual({
      ok: false,
      error: `Instruction is too large. Max ${PROMPT_MAX_CONTENT_BYTES} bytes.`,
    });
  });
});

describe("parseInstructionReasoningEffort", () => {
  it("defaults to high when omitted", () => {
    expect(parseInstructionReasoningEffort({})).toEqual({ ok: true, value: "high" });
    expect(parseInstructionReasoningEffort("invalid")).toEqual({ ok: true, value: "high" });
  });

  it("accepts valid values", () => {
    expect(parseInstructionReasoningEffort({ reasoningEffort: "none" })).toEqual({
      ok: true,
      value: "none",
    });
    expect(parseInstructionReasoningEffort({ reasoningEffort: "medium" })).toEqual({
      ok: true,
      value: "medium",
    });
  });

  it("rejects invalid values", () => {
    expect(parseInstructionReasoningEffort({ reasoningEffort: "fast" })).toEqual({
      ok: false,
      error: "`reasoningEffort` must be one of: none, low, medium, high.",
    });
    expect(parseInstructionReasoningEffort({ reasoningEffort: 1 })).toEqual({
      ok: false,
      error: "`reasoningEffort` must be a string.",
    });
  });
});

describe("buildPromptFileName", () => {
  it("uses sanitized source name and extension when supported", () => {
    const name = buildPromptFileName("My Prompt File.md", {
      now: new Date(2026, 1, 16, 12, 34, 56),
      randomSuffix: "a1b2c3",
    });

    expect(name).toBe("My-Prompt-File-20260216-123456-a1b2c3.md");
  });

  it("falls back to default stem and extension for unsupported source", () => {
    const name = buildPromptFileName("../strange name.bin", {
      now: new Date(2026, 1, 16, 12, 34, 56),
      randomSuffix: "xyz987",
    });

    expect(name).toBe("strange-name-20260216-123456-xyz987.md");
  });
});

describe("parseRequestedPromptFileName", () => {
  it("returns null when fileName is omitted", () => {
    const result = parseRequestedPromptFileName({});

    expect(result).toEqual({
      ok: true,
      value: null,
    });
  });

  it("normalizes requested fileName with extension", () => {
    const result = parseRequestedPromptFileName({
      fileName: " Team Prompt .json ",
    });

    expect(result).toEqual({
      ok: true,
      value: "Team-Prompt.json",
    });
  });

  it("appends default extension when missing", () => {
    const result = parseRequestedPromptFileName({
      fileName: "my prompt file",
    });

    expect(result).toEqual({
      ok: true,
      value: "my-prompt-file.md",
    });
  });

  it("rejects unsupported extension", () => {
    const result = parseRequestedPromptFileName({
      fileName: "prompt.csv",
    });

    expect(result).toEqual({
      ok: false,
      error: "File extension must be .md, .txt, .xml, or .json.",
    });
  });

  it("rejects non-string fileName", () => {
    const result = parseRequestedPromptFileName({
      fileName: 123,
    });

    expect(result).toEqual({
      ok: false,
      error: "`fileName` must be a string.",
    });
  });
});

describe("normalizeRequestedPromptFileName", () => {
  it("ignores path segments and normalizes the basename", () => {
    const result = normalizeRequestedPromptFileName("../nested/folder/prompt file.md");

    expect(result).toEqual({
      ok: true,
      value: "prompt-file.md",
    });
  });

  it("rejects invalid basename", () => {
    const result = normalizeRequestedPromptFileName("..");

    expect(result).toEqual({
      ok: false,
      error: "File name is invalid.",
    });
  });
});

describe("extractInstructionDiffPatch", () => {
  it("rejects unsupported patch file names", () => {
    expect(() =>
      extractInstructionDiffPatch({
        fileName: "../instruction.md",
        hunks: [
          {
            oldStart: 1,
            newStart: 1,
            lines: [{ op: "context", text: "line-1" }],
          },
        ],
      }),
    ).toThrow("required patch schema");
  });

  it("rejects hunks with empty lines array", () => {
    expect(() =>
      extractInstructionDiffPatch({
        fileName: "instruction.md",
        hunks: [
          {
            oldStart: 1,
            newStart: 1,
            lines: [],
          },
        ],
      }),
    ).toThrow("required patch schema");
  });

  it("preserves hunk order from model output", () => {
    const patch = extractInstructionDiffPatch({
      fileName: "instruction.md",
      hunks: [
        {
          oldStart: 2,
          newStart: 2,
          lines: [{ op: "context", text: "line-2" }],
        },
        {
          oldStart: 5,
          newStart: 5,
          lines: [
            { op: "context", text: "line-5" },
            { op: "remove", text: "line-6" },
            { op: "add", text: "line-6-updated" },
          ],
        },
      ],
    });

    expect(patch).toBe(
      [
        "--- a/instruction.md",
        "+++ b/instruction.md",
        "@@ -2,1 +2,1 @@",
        " line-2",
        "@@ -5,2 +5,2 @@",
        " line-5",
        "-line-6",
        "+line-6-updated",
      ].join("\n"),
    );
  });
});
