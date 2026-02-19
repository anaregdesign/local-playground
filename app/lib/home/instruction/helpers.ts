export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type InstructionLanguage = "japanese" | "english" | "mixed" | "unknown";

export type InstructionDiffLineType = "context" | "added" | "removed";

export type InstructionDiffLine = {
  type: InstructionDiffLineType;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
};

export type SaveInstructionToClientFileResult = {
  fileName: string;
  mode: "picker" | "download";
};

import {
  INSTRUCTION_ALLOWED_EXTENSIONS,
  INSTRUCTION_DEFAULT_EXTENSION,
  INSTRUCTION_DIFF_MAX_MATRIX_CELLS,
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
    "Improve the following agent instruction and return only structured diff hunks.",
    "Requirements:",
    "- Remove contradictions and ambiguity.",
    "- Correct clear typos and spelling mistakes without changing intended meaning.",
    "- Keep original intent, guardrails, and constraints.",
    "- Preserve as much original information as possible; avoid deleting details unless necessary.",
    "- Do not omit, summarize, or truncate sections. Keep all important details and examples.",
    "- Do not add placeholder comments/markers such as '省略', 'omitted', 'same as original', or equivalent.",
    "- Normalize and improve formatting for readability.",
    `- Preserve the original language (${languageLabel}).`,
    `- Preserve the original file format style for .${options.extension}.`,
    "- Return only schema-matching structured output. Do not return the full rewritten instruction.",
    "- Do not include markdown code fences or explanations.",
    `- Set fileName to ${fileName}.`,
    "- Use hunk lines with op values: context, add, remove.",
    "- oldStart/newStart must match exact 1-based line numbers in the source text.",
    "- Context/remove line text must match the original lines exactly.",
    "- Include enough context lines around edits to anchor each hunk reliably.",
    "- If no changes are needed, return an empty hunks array.",
    "",
    "<instruction>",
    options.instruction,
    "</instruction>",
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

export function validateInstructionLanguagePreserved(
  originalInstruction: string,
  enhancedInstruction: string,
): ParseResult<true> {
  const originalLanguage = detectInstructionLanguage(originalInstruction);
  if (originalLanguage === "unknown" || originalLanguage === "mixed") {
    return { ok: true, value: true };
  }

  const enhancedHasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(
    enhancedInstruction,
  );
  const enhancedHasEnglish = /[A-Za-z]/.test(enhancedInstruction);

  if (originalLanguage === "japanese" && !enhancedHasJapanese) {
    return {
      ok: false,
      error: "Enhanced instruction changed language unexpectedly. Please retry.",
    };
  }

  if (originalLanguage === "english" && !enhancedHasEnglish) {
    return {
      ok: false,
      error: "Enhanced instruction changed language unexpectedly. Please retry.",
    };
  }

  return { ok: true, value: true };
}

export function validateEnhancedInstructionCompleteness(
  enhancedInstruction: string,
): ParseResult<true> {
  const omissionMarkerPatterns: RegExp[] = [
    /<!--[\s\S]{0,240}(省略|omitted|omit|same as original|for brevity|truncated|原文どおり)[\s\S]*?-->/i,
    /\[[^\]]{0,180}(省略|omitted|same as original|for brevity|truncated|原文どおり)[^\]]{0,180}\]/i,
    /\([^)]{0,180}(省略|omitted|same as original|for brevity|truncated|原文どおり)[^)]{0,180}\)/i,
    /(?:以下|以降).{0,40}(?:省略|同様)/i,
    /same as (?:original|above)/i,
    /for brevity/i,
  ];

  for (const pattern of omissionMarkerPatterns) {
    if (pattern.test(enhancedInstruction)) {
      return {
        ok: false,
        error:
          "Enhanced instruction appears to omit original content with placeholders/comments. Please retry.",
      };
    }
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

export function buildInstructionDiffLines(
  originalInstruction: string,
  enhancedInstruction: string,
  options: {
    maxMatrixCells?: number;
  } = {},
): InstructionDiffLine[] {
  const originalLines = splitInstructionLines(originalInstruction);
  const enhancedLines = splitInstructionLines(enhancedInstruction);
  const maxMatrixCells = options.maxMatrixCells ?? INSTRUCTION_DIFF_MAX_MATRIX_CELLS;
  const operations = computeInstructionDiffOperations(
    originalLines,
    enhancedLines,
    maxMatrixCells,
  );

  let oldLineNumber = 0;
  let newLineNumber = 0;
  const diffLines: InstructionDiffLine[] = [];
  for (const operation of operations) {
    if (operation.type === "context") {
      oldLineNumber += 1;
      newLineNumber += 1;
      diffLines.push({
        type: "context",
        oldLineNumber,
        newLineNumber,
        content: operation.content,
      });
      continue;
    }

    if (operation.type === "removed") {
      oldLineNumber += 1;
      diffLines.push({
        type: "removed",
        oldLineNumber,
        newLineNumber: null,
        content: operation.content,
      });
      continue;
    }

    newLineNumber += 1;
    diffLines.push({
      type: "added",
      oldLineNumber: null,
      newLineNumber,
      content: operation.content,
    });
  }

  if (diffLines.length > 0) {
    return diffLines;
  }

  return [
    {
      type: "context",
      oldLineNumber: 1,
      newLineNumber: 1,
      content: "",
    },
  ];
}

type InstructionDiffOperation = {
  type: "context" | "added" | "removed";
  content: string;
};

function computeInstructionDiffOperations(
  originalLines: string[],
  enhancedLines: string[],
  maxMatrixCells: number,
): InstructionDiffOperation[] {
  const totalMatrixCells = originalLines.length * enhancedLines.length;
  if (totalMatrixCells <= 0) {
    if (originalLines.length === 0 && enhancedLines.length === 0) {
      return [];
    }

    return [
      ...originalLines.map((content) => ({ type: "removed", content }) as InstructionDiffOperation),
      ...enhancedLines.map((content) => ({ type: "added", content }) as InstructionDiffOperation),
    ];
  }

  if (totalMatrixCells > maxMatrixCells) {
    return computeInstructionDiffOperationsFast(originalLines, enhancedLines);
  }

  const matrix: number[][] = Array.from({ length: originalLines.length + 1 }, () =>
    Array.from({ length: enhancedLines.length + 1 }, () => 0),
  );

  for (let i = originalLines.length - 1; i >= 0; i -= 1) {
    for (let j = enhancedLines.length - 1; j >= 0; j -= 1) {
      if (originalLines[i] === enhancedLines[j]) {
        matrix[i][j] = matrix[i + 1][j + 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }
  }

  const operations: InstructionDiffOperation[] = [];
  let oldCursor = 0;
  let newCursor = 0;
  while (oldCursor < originalLines.length && newCursor < enhancedLines.length) {
    if (originalLines[oldCursor] === enhancedLines[newCursor]) {
      operations.push({
        type: "context",
        content: originalLines[oldCursor],
      });
      oldCursor += 1;
      newCursor += 1;
      continue;
    }

    if (matrix[oldCursor + 1][newCursor] >= matrix[oldCursor][newCursor + 1]) {
      operations.push({
        type: "removed",
        content: originalLines[oldCursor],
      });
      oldCursor += 1;
      continue;
    }

    operations.push({
      type: "added",
      content: enhancedLines[newCursor],
    });
    newCursor += 1;
  }

  while (oldCursor < originalLines.length) {
    operations.push({
      type: "removed",
      content: originalLines[oldCursor],
    });
    oldCursor += 1;
  }

  while (newCursor < enhancedLines.length) {
    operations.push({
      type: "added",
      content: enhancedLines[newCursor],
    });
    newCursor += 1;
  }

  return operations;
}

function computeInstructionDiffOperationsFast(
  originalLines: string[],
  enhancedLines: string[],
): InstructionDiffOperation[] {
  const operations: InstructionDiffOperation[] = [];
  let oldCursor = 0;
  let newCursor = 0;
  while (oldCursor < originalLines.length || newCursor < enhancedLines.length) {
    const hasOld = oldCursor < originalLines.length;
    const hasNew = newCursor < enhancedLines.length;
    if (hasOld && hasNew && originalLines[oldCursor] === enhancedLines[newCursor]) {
      operations.push({
        type: "context",
        content: originalLines[oldCursor],
      });
      oldCursor += 1;
      newCursor += 1;
      continue;
    }

    if (hasOld) {
      operations.push({
        type: "removed",
        content: originalLines[oldCursor],
      });
      oldCursor += 1;
    }

    if (hasNew) {
      operations.push({
        type: "added",
        content: enhancedLines[newCursor],
      });
      newCursor += 1;
    }
  }

  return operations;
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
