import { describe, expect, it } from "vitest";
import { PROMPT_MAX_CONTENT_BYTES } from "~/lib/constants";
import {
  buildPromptFileName,
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
