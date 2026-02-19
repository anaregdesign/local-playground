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

type SaveFilePickerFileType = {
  description?: string;
  accept: Record<string, string[]>;
};

type SaveFilePickerOptionsCompat = {
  suggestedName?: string;
  types?: SaveFilePickerFileType[];
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

export const ALLOWED_INSTRUCTION_EXTENSIONS = new Set(["md", "txt", "xml", "json"]);
const INSTRUCTION_SAVE_FILE_TYPES: SaveFilePickerFileType[] = [
  {
    description: "Instruction files",
    accept: {
      "text/markdown": [".md"],
      "text/plain": [".txt"],
      "application/json": [".json"],
      "application/xml": [".xml"],
      "text/xml": [".xml"],
    },
  },
];

export const DEFAULT_INSTRUCTION_EXTENSION = "txt";
const MAX_INSTRUCTION_DIFF_MATRIX_CELLS = 250_000;

export const ENHANCE_INSTRUCTION_SYSTEM_PROMPT = [
  "You are an expert editor for agent system instructions.",
  "Rewrite the provided instruction to remove contradictions and ambiguity.",
  "Keep the original intent, constraints, and safety boundaries.",
  "Preserve as much of the original information as possible and avoid removing details unless necessary.",
  "Do not omit, summarize, truncate, or replace any part with placeholders.",
  "Do not insert comments like 'omitted', '省略', 'same as original', or similar markers.",
  "Even if the instruction is long, return the complete revised text.",
  "Preserve the language and file-format style requested by the user.",
  "Return only the revised instruction text with no explanations.",
].join(" ");

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
  if (ALLOWED_INSTRUCTION_EXTENSIONS.has(sourceExtension)) {
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
  if (ALLOWED_INSTRUCTION_EXTENSIONS.has(sourceExtension)) {
    return sourceExtension;
  }

  const trimmedInstruction = instruction.trim();
  if (!trimmedInstruction) {
    return DEFAULT_INSTRUCTION_EXTENSION;
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

  return DEFAULT_INSTRUCTION_EXTENSION;
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
  return [
    "Improve the following agent instruction.",
    "Requirements:",
    "- Remove contradictions and ambiguity.",
    "- Keep original intent, guardrails, and constraints.",
    "- Preserve as much original information as possible; avoid deleting details unless necessary.",
    "- Do not omit, summarize, or truncate sections. Keep all important details and examples.",
    "- Do not add placeholder comments/markers such as '省略', 'omitted', 'same as original', or equivalent.",
    "- Normalize and improve formatting for readability.",
    `- Preserve the original language (${languageLabel}).`,
    `- Preserve the original file format style for .${options.extension}.`,
    "- Return only the revised instruction text.",
    "",
    "<instruction>",
    options.instruction,
    "</instruction>",
  ].join("\n");
}

export function normalizeEnhancedInstructionResponse(value: string): string {
  return unwrapCodeFence(value).trim();
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
  const maxMatrixCells = options.maxMatrixCells ?? MAX_INSTRUCTION_DIFF_MATRIX_CELLS;
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
