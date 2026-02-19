import { describe, expect, it } from "vitest";
import {
  applyInstructionUnifiedDiffPatch,
  buildInstructionDiffLines,
  buildInstructionEnhanceMessage,
  buildInstructionSuggestedFileName,
  detectInstructionLanguage,
  normalizeInstructionDiffPatchResponse,
  resolveInstructionFormatExtension,
  resolveInstructionSourceFileName,
  validateEnhancedInstructionCompleteness,
  validateEnhancedInstructionFormat,
  validateInstructionLanguagePreserved,
} from "./helpers";

describe("instruction enhance helpers", () => {
  it("resolves source file name from loaded file", () => {
    expect(resolveInstructionSourceFileName("prompt.md")).toBe("prompt.md");
    expect(resolveInstructionSourceFileName("  prompt.md  ")).toBe("prompt.md");
    expect(resolveInstructionSourceFileName(null)).toBeNull();
  });

  it("builds suggested save file name from source and content", () => {
    expect(buildInstructionSuggestedFileName("prompt.md", "text")).toBe("prompt.md");
    expect(buildInstructionSuggestedFileName("prompt.bin", '{"a":1}')).toBe("prompt.json");
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
    expect(message).toContain(
      "Correct clear typos and spelling mistakes without changing intended meaning.",
    );
    expect(message).toContain("Preserve the original language (English).");
    expect(message).toContain("Preserve the original file format style for .md.");
    expect(message).toContain("Set fileName to instruction.md.");
    expect(message).toContain("Use hunk lines with op values: context, add, remove.");
    expect(message).toContain("oldStart/newStart must match exact 1-based line numbers");
    expect(message).toContain("<instruction>");
  });

  it("unwraps top-level fenced patch output from model response", () => {
    const normalized = normalizeInstructionDiffPatchResponse("```diff\n@@ -1 +1 @@\n-a\n+b\n```");
    expect(normalized).toBe("@@ -1 +1 @@\n-a\n+b");
  });

  it("applies unified diff patch to instruction text", () => {
    const result = applyInstructionUnifiedDiffPatch(
      "line-1\nline-2\nline-3",
      ["--- a/instruction.txt", "+++ b/instruction.txt", "@@ -1,3 +1,4 @@", " line-1", "-line-2", "+line-2-updated", " line-3", "+line-4"].join("\n"),
    );

    expect(result).toEqual({
      ok: true,
      value: "line-1\nline-2-updated\nline-3\nline-4",
    });
  });

  it("applies patch even when hunk start line is slightly off", () => {
    const result = applyInstructionUnifiedDiffPatch(
      "line-1\nline-2\nline-3\nline-4",
      [
        "--- a/instruction.txt",
        "+++ b/instruction.txt",
        "@@ -1,2 +1,2 @@",
        " line-2",
        "-line-3",
        "+line-3-updated",
      ].join("\n"),
    );

    expect(result).toEqual({
      ok: true,
      value: "line-1\nline-2\nline-3-updated\nline-4",
    });
  });

  it("returns original instruction when patch is empty", () => {
    expect(applyInstructionUnifiedDiffPatch("same\nlines", "   ")).toEqual({
      ok: true,
      value: "same\nlines",
    });
  });

  it("rejects invalid unified diff patch hunks", () => {
    expect(applyInstructionUnifiedDiffPatch("line-1", "line-1")).toEqual({
      ok: false,
      error: "Enhancement patch is not a valid unified diff hunk format.",
    });
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
    expect(diff.map((line) => line.type)).toEqual(["context", "removed", "added", "context"]);
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
