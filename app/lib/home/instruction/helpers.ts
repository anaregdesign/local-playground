/**
 * Home runtime support module.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type InstructionLanguage = "japanese" | "english" | "mixed" | "unknown";

export type SaveInstructionToClientFileResult = {
  fileName: string;
  mode: "picker" | "download";
};

import {
  INSTRUCTION_ALLOWED_EXTENSIONS,
  INSTRUCTION_DEFAULT_EXTENSION,
  INSTRUCTION_SAVE_FILE_TYPES,
} from "~/lib/constants";
import type { InstructionSaveFileType } from "~/lib/constants";

type SaveFilePickerOptionsCompat = {
  suggestedName?: string;
  types?: InstructionSaveFileType[];
};

type SaveFileWritableStream = {
  write(data: string): Promise<void>;
  close(): Promise<void>;
};

type SaveFileHandleCompat = {
  name: string;
  createWritable(): Promise<SaveFileWritableStream>;
};

type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptionsCompat) => Promise<SaveFileHandleCompat>;
};

export function resolveInstructionSourceFileName(loadedFileName: string | null): string | null {
  const loaded = (loadedFileName ?? "").trim();
  return loaded || null;
}

export function buildInstructionSuggestedFileName(
  sourceFileName: string | null,
  instruction: string,
): string {
  const resolvedExtension = resolveInstructionFormatExtension(sourceFileName, instruction);
  const normalizedSource = normalizeInstructionFileNameCandidate(sourceFileName);
  if (!normalizedSource) {
    return `instruction.${resolvedExtension}`;
  }

  const sourceExtension = getFileExtension(normalizedSource);
  if (INSTRUCTION_ALLOWED_EXTENSIONS.has(sourceExtension)) {
    return normalizedSource;
  }

  const stem = stripFileExtension(normalizedSource);
  return `${stem || "instruction"}.${resolvedExtension}`;
}

export async function saveInstructionToClientFile(
  instruction: string,
  suggestedFileName: string,
): Promise<SaveInstructionToClientFileResult> {
  const savePickerWindow = window as WindowWithSaveFilePicker;
  if (typeof savePickerWindow.showSaveFilePicker === "function") {
    const fileHandle = await savePickerWindow.showSaveFilePicker({
      suggestedName: suggestedFileName,
      types: INSTRUCTION_SAVE_FILE_TYPES,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(instruction);
    await writable.close();
    return {
      fileName: fileHandle.name || suggestedFileName,
      mode: "picker",
    };
  }

  downloadInstructionFile(instruction, suggestedFileName);
  return {
    fileName: suggestedFileName,
    mode: "download",
  };
}

export function isInstructionSaveCanceled(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }

  return error.name === "AbortError";
}

export function resolveInstructionFormatExtension(
  sourceFileName: string | null,
  instruction: string,
): string {
  const sourceExtension = getFileExtension(sourceFileName ?? "");
  if (INSTRUCTION_ALLOWED_EXTENSIONS.has(sourceExtension)) {
    return sourceExtension;
  }

  const trimmedInstruction = instruction.trim();
  if (!trimmedInstruction) {
    return INSTRUCTION_DEFAULT_EXTENSION;
  }

  if (
    (trimmedInstruction.startsWith("{") || trimmedInstruction.startsWith("[")) &&
    canParseJson(trimmedInstruction)
  ) {
    return "json";
  }

  if (looksLikeXmlDocument(trimmedInstruction)) {
    return "xml";
  }

  if (looksLikeMarkdownText(trimmedInstruction)) {
    return "md";
  }

  return INSTRUCTION_DEFAULT_EXTENSION;
}

export function detectInstructionLanguage(value: string): InstructionLanguage {
  const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(value);
  const hasEnglish = /[A-Za-z]/.test(value);
  if (hasJapanese && hasEnglish) {
    return "mixed";
  }
  if (hasJapanese) {
    return "japanese";
  }
  if (hasEnglish) {
    return "english";
  }
  return "unknown";
}

export function buildInstructionEnhanceMessage(options: {
  instruction: string;
  extension: string;
  language: InstructionLanguage;
}): string {
  const languageLabel = describeInstructionLanguage(options.language);
  const normalizedExtension = options.extension.trim().toLowerCase() || "txt";
  const fileName = `instruction.${normalizedExtension}`;
  return [
    "<enhance_request>",
    "  <primary_objective>",
    "    Improve this instruction so the user's intent is realized precisely.",
    "    Remove contradictions, ambiguity, redundancy, and clear typos/spelling mistakes.",
    "  </primary_objective>",
    "  <editing_boundaries>",
    "    <rule>Preserve intended meaning, constraints, and safety boundaries.</rule>",
    "    <rule>Do not add new requirements not implied by the source.</rule>",
    "    <rule>Preserve original information as much as possible.</rule>",
    "    <rule>Remove details only when needed to resolve contradiction, ambiguity, or redundancy.</rule>",
    "    <rule>Do not omit, summarize, truncate, or replace content with placeholders.</rule>",
    "    <rule>Do not add placeholder comments/markers such as '省略', 'omitted', 'same as original', or equivalent.</rule>",
    "    <rule>Normalize and improve formatting for readability.</rule>",
    `    <rule>Preserve the original language (${languageLabel}).</rule>`,
    `    <rule>Preserve the original file format style for .${options.extension}.</rule>`,
    "  </editing_boundaries>",
    "  <diff_contract>",
    "    <rule>Use hunk lines with op values: context, add, remove.</rule>",
    "    <rule>Return hunks sorted by oldStart in strictly ascending order.</rule>",
    "    <rule>Do not return overlapping hunks or duplicate source ranges.</rule>",
    "    <rule>oldStart/newStart must match exact 1-based line numbers in the source text.</rule>",
    "    <rule>Context/remove line text must match the original lines exactly.</rule>",
    "    <rule>Include enough context lines around edits to anchor each hunk reliably.</rule>",
    `    <rule>Set fileName to ${fileName}.</rule>`,
    "  </diff_contract>",
    "  <output_contract>",
    "    <rule>Think step-by-step internally before responding, but do not reveal your reasoning.</rule>",
    "    <rule>Before output, verify objective completion, schema validity, and patch consistency.</rule>",
    "    <rule>If any internal check fails, return the requested fileName with an empty hunks array.</rule>",
    "    <rule>If no changes are needed, return an empty hunks array.</rule>",
    "    <rule>Return only schema-matching structured output. Do not return the full rewritten instruction.</rule>",
    "    <rule>Do not include markdown code fences or explanations.</rule>",
    "  </output_contract>",
    "  <instruction>",
    options.instruction,
    "  </instruction>",
    "</enhance_request>",
  ].join("\n");
}

export function normalizeInstructionDiffPatchResponse(value: string): string {
  const unwrapped = unwrapCodeFence(value).replace(/\r\n/g, "\n");
  if (!unwrapped.trim()) {
    return "";
  }

  return unwrapped.replace(/^\n+/, "").replace(/\n+$/, "");
}

type UnifiedDiffHunkLine = {
  type: "context" | "added" | "removed";
  content: string;
};

type UnifiedDiffHunk = {
  oldStart: number;
  oldLength: number;
  newStart: number;
  newLength: number;
  lines: UnifiedDiffHunkLine[];
};

export function applyInstructionUnifiedDiffPatch(
  originalInstruction: string,
  patch: string,
): ParseResult<string> {
  const parseResult = parseInstructionUnifiedDiffHunks(patch);
  if (!parseResult.ok) {
    return parseResult;
  }

  if (parseResult.value.length === 0) {
    return {
      ok: true,
      value: originalInstruction.replace(/\r\n/g, "\n"),
    };
  }

  const originalLines = splitInstructionLines(originalInstruction);
  const nextLines: string[] = [];
  let oldCursor = 0;

  for (const [hunkIndex, hunk] of parseResult.value.entries()) {
    const resolvedHunkStart = resolveUnifiedDiffHunkStartIndex({
      originalLines,
      oldCursor,
      hunk,
      hunkIndex,
    });
    if (!resolvedHunkStart.ok) {
      return resolvedHunkStart;
    }
    const hunkStartIndex = resolvedHunkStart.value;

    nextLines.push(...originalLines.slice(oldCursor, hunkStartIndex));
    oldCursor = hunkStartIndex;

    for (const [lineIndex, line] of hunk.lines.entries()) {
      if (line.type === "added") {
        nextLines.push(line.content);
        continue;
      }

      const currentOriginalLine = originalLines[oldCursor];
      if (currentOriginalLine !== line.content) {
        return {
          ok: false,
          error:
            `Patch mismatch at hunk #${hunkIndex + 1}, line ${lineIndex + 1}. ` +
            "Please retry enhancement.",
        };
      }

      oldCursor += 1;
      if (line.type === "context") {
        nextLines.push(line.content);
      }
    }
  }

  nextLines.push(...originalLines.slice(oldCursor));
  return {
    ok: true,
    value: nextLines.join("\n"),
  };
}

function parseInstructionUnifiedDiffHunks(patch: string): ParseResult<UnifiedDiffHunk[]> {
  const normalizedPatch = patch.replace(/\r\n/g, "\n");
  if (!normalizedPatch.trim()) {
    return { ok: true, value: [] };
  }

  const lines = normalizedPatch.replace(/^\n+/, "").replace(/\n+$/, "").split("\n");
  const hunks: UnifiedDiffHunk[] = [];
  let cursor = 0;

  while (cursor < lines.length && isUnifiedDiffMetadataLine(lines[cursor])) {
    cursor += 1;
  }

  while (cursor < lines.length) {
    const headerLine = lines[cursor];
    const headerMatch = headerLine.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/,
    );
    if (!headerMatch) {
      return {
        ok: false,
        error: "Enhancement patch is not a valid unified diff hunk format.",
      };
    }

    const oldStart = Number(headerMatch[1]);
    const oldLength = headerMatch[2] ? Number(headerMatch[2]) : 1;
    const newStart = Number(headerMatch[3]);
    const newLength = headerMatch[4] ? Number(headerMatch[4]) : 1;
    if (
      !Number.isSafeInteger(oldStart) ||
      !Number.isSafeInteger(oldLength) ||
      !Number.isSafeInteger(newStart) ||
      !Number.isSafeInteger(newLength)
    ) {
      return {
        ok: false,
        error: "Enhancement patch includes invalid hunk line numbers.",
      };
    }

    cursor += 1;
    const hunkLines: UnifiedDiffHunkLine[] = [];
    let oldCount = 0;
    let newCount = 0;

    while (cursor < lines.length) {
      const currentLine = lines[cursor];
      if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: .*)?$/.test(currentLine)) {
        break;
      }

      if (currentLine === "\\ No newline at end of file") {
        cursor += 1;
        continue;
      }

      const linePrefix = currentLine[0];
      const lineBody = currentLine.slice(1);
      if (linePrefix === " ") {
        oldCount += 1;
        newCount += 1;
        hunkLines.push({ type: "context", content: lineBody });
      } else if (linePrefix === "-") {
        oldCount += 1;
        hunkLines.push({ type: "removed", content: lineBody });
      } else if (linePrefix === "+") {
        newCount += 1;
        hunkLines.push({ type: "added", content: lineBody });
      } else {
        return {
          ok: false,
          error: "Enhancement patch contains unsupported hunk line markers.",
        };
      }

      cursor += 1;
    }

    if (oldCount !== oldLength || newCount !== newLength) {
      return {
        ok: false,
        error: "Enhancement patch hunk counts do not match header metadata.",
      };
    }

    hunks.push({
      oldStart,
      oldLength,
      newStart,
      newLength,
      lines: hunkLines,
    });
  }

  if (hunks.length === 0) {
    return {
      ok: false,
      error: "Enhancement patch does not include any @@ hunk blocks.",
    };
  }

  return { ok: true, value: hunks };
}

function resolveUnifiedDiffHunkStartIndex(options: {
  originalLines: string[];
  oldCursor: number;
  hunk: UnifiedDiffHunk;
  hunkIndex: number;
}): ParseResult<number> {
  const { originalLines, oldCursor, hunk, hunkIndex } = options;
  const sourceLines = hunk.lines
    .filter((line) => line.type !== "added")
    .map((line) => line.content);

  if (sourceLines.length === 0) {
    return {
      ok: true,
      value: clampInstructionLineIndex(hunk.oldStart - 1, oldCursor, originalLines.length),
    };
  }

  const maxStartIndex = originalLines.length - sourceLines.length;
  if (maxStartIndex < oldCursor) {
    return {
      ok: false,
      error: `Patch hunk #${hunkIndex + 1} starts outside the original instruction.`,
    };
  }

  const preferredStartIndex = Math.max(hunk.oldStart - 1, oldCursor);
  if (
    preferredStartIndex <= maxStartIndex &&
    canMatchUnifiedDiffHunkSourceAtIndex(originalLines, sourceLines, preferredStartIndex)
  ) {
    return { ok: true, value: preferredStartIndex };
  }

  const nearbyStartIndex = findUnifiedDiffHunkStartNearPreferred({
    originalLines,
    sourceLines,
    oldCursor,
    maxStartIndex,
    preferredStartIndex,
    radius: 80,
  });
  if (nearbyStartIndex !== null) {
    return { ok: true, value: nearbyStartIndex };
  }

  for (let startIndex = oldCursor; startIndex <= maxStartIndex; startIndex += 1) {
    if (canMatchUnifiedDiffHunkSourceAtIndex(originalLines, sourceLines, startIndex)) {
      return { ok: true, value: startIndex };
    }
  }

  return {
    ok: false,
    error: `Patch mismatch at hunk #${hunkIndex + 1}, line 1. Please retry enhancement.`,
  };
}

function findUnifiedDiffHunkStartNearPreferred(options: {
  originalLines: string[];
  sourceLines: string[];
  oldCursor: number;
  maxStartIndex: number;
  preferredStartIndex: number;
  radius: number;
}): number | null {
  const {
    originalLines,
    sourceLines,
    oldCursor,
    maxStartIndex,
    preferredStartIndex,
    radius,
  } = options;

  const startIndex = Math.max(oldCursor, preferredStartIndex - radius);
  const endIndex = Math.min(maxStartIndex, preferredStartIndex + radius);
  let matchedStartIndex: number | null = null;
  let matchedDistance = Number.POSITIVE_INFINITY;

  for (let candidateIndex = startIndex; candidateIndex <= endIndex; candidateIndex += 1) {
    if (!canMatchUnifiedDiffHunkSourceAtIndex(originalLines, sourceLines, candidateIndex)) {
      continue;
    }

    const distance = Math.abs(candidateIndex - preferredStartIndex);
    if (distance < matchedDistance) {
      matchedDistance = distance;
      matchedStartIndex = candidateIndex;
    }
  }

  return matchedStartIndex;
}

function canMatchUnifiedDiffHunkSourceAtIndex(
  originalLines: string[],
  sourceLines: string[],
  startIndex: number,
): boolean {
  for (let index = 0; index < sourceLines.length; index += 1) {
    if (originalLines[startIndex + index] !== sourceLines[index]) {
      return false;
    }
  }

  return true;
}

function clampInstructionLineIndex(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function isUnifiedDiffMetadataLine(line: string): boolean {
  if (!line) {
    return true;
  }

  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ")
  );
}

export function validateEnhancedInstructionFormat(
  instruction: string,
  extension: string,
): ParseResult<true> {
  const normalizedExtension = extension.trim().toLowerCase();
  if (normalizedExtension === "json" && !canParseJson(instruction.trim())) {
    return {
      ok: false,
      error: "Enhanced instruction is not valid JSON. Please retry.",
    };
  }

  if (normalizedExtension === "xml" && !looksLikeXmlDocument(instruction.trim())) {
    return {
      ok: false,
      error: "Enhanced instruction is not valid XML-like content. Please retry.",
    };
  }

  return { ok: true, value: true };
}

export function describeInstructionLanguage(language: InstructionLanguage): string {
  if (language === "japanese") {
    return "Japanese";
  }
  if (language === "english") {
    return "English";
  }
  if (language === "mixed") {
    return "mixed language";
  }
  return "same language as source";
}

function splitInstructionLines(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n");
  if (!normalized) {
    return [];
  }

  return normalized.split("\n");
}

function normalizeInstructionFileNameCandidate(fileName: string | null): string {
  const candidate = (fileName ?? "").trim();
  if (!candidate) {
    return "";
  }

  const normalized = candidate.replace(/\\/g, "/");
  const lastSegment = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (!lastSegment) {
    return "";
  }

  return lastSegment
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

function stripFileExtension(fileName: string): string {
  const extension = getFileExtension(fileName);
  if (!extension) {
    return fileName;
  }

  return fileName.slice(0, -(extension.length + 1));
}

function canParseJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function looksLikeXmlDocument(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) {
    return false;
  }

  if (/^<([A-Za-z_][A-Za-z0-9:_.-]*)(?:\s[^>]*)?\/>\s*$/.test(trimmed)) {
    return true;
  }

  const firstTag = trimmed.match(/^<([A-Za-z_][A-Za-z0-9:_.-]*)(?:\s[^>]*)?>/);
  if (!firstTag) {
    return false;
  }

  const rootTagName = firstTag[1];
  if (new RegExp(`<\\/${rootTagName}>\\s*$`).test(trimmed)) {
    return true;
  }

  return /\/>\s*$/.test(trimmed);
}

function looksLikeMarkdownText(value: string): boolean {
  if (/^(#{1,6})\s/m.test(value)) {
    return true;
  }
  if (/```/.test(value)) {
    return true;
  }
  return /^\s*[-*+]\s/m.test(value);
}

function unwrapCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fenced) {
    return fenced[1];
  }

  const fencedWithoutTrailingNewLine = trimmed.match(/^```[^\n]*\n([\s\S]*?)```$/);
  if (fencedWithoutTrailingNewLine) {
    return fencedWithoutTrailingNewLine[1];
  }

  return value;
}

function downloadInstructionFile(instruction: string, fileName: string): void {
  const blob = new Blob([instruction], {
    type: resolveInstructionMimeType(fileName),
  });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
}

function resolveInstructionMimeType(fileName: string): string {
  const extension = getFileExtension(fileName);
  if (extension === "json") {
    return "application/json;charset=utf-8";
  }

  if (extension === "xml") {
    return "application/xml;charset=utf-8";
  }

  if (extension === "md") {
    return "text/markdown;charset=utf-8";
  }

  return "text/plain;charset=utf-8";
}

function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}
