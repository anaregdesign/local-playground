import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolveFoundryConfigDirectory } from "~/lib/foundry/config";
import type { Route } from "./+types/api.instruction-prompts";

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PROMPTS_SUBDIRECTORY_NAME = "prompts";
const DEFAULT_PROMPT_FILE_STEM = "instruction";
const DEFAULT_PROMPT_FILE_EXTENSION = ".md";
const MAX_PROMPT_FILE_STEM_LENGTH = 64;
const MAX_PROMPT_FILE_NAME_LENGTH = 128;
const MAX_PROMPT_CONTENT_BYTES = 1_000_000;
const ALLOWED_PROMPT_FILE_EXTENSIONS = new Set([".md", ".txt", ".xml", ".json"]);

export function loader({ request }: Route.LoaderArgs) {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  return Response.json({
    error: "Use POST /api/instruction-prompts to save the current instruction.",
  });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const instructionResult = parseInstructionContent(payload);
  if (!instructionResult.ok) {
    return Response.json({ error: instructionResult.error }, { status: 400 });
  }

  const requestedPromptFileNameResult = parseRequestedPromptFileName(payload);
  if (!requestedPromptFileNameResult.ok) {
    return Response.json({ error: requestedPromptFileNameResult.error }, { status: 400 });
  }

  const sourceFileName = readOptionalSourceFileName(payload);
  const promptFileName =
    requestedPromptFileNameResult.value ?? buildPromptFileName(sourceFileName);
  const promptsDirectoryPath = joinPathSegments(
    resolveFoundryConfigDirectory(),
    PROMPTS_SUBDIRECTORY_NAME,
  );
  const promptFilePath = joinPathSegments(promptsDirectoryPath, promptFileName);

  try {
    await mkdir(promptsDirectoryPath, { recursive: true });
    await writeFile(promptFilePath, instructionResult.value, "utf8");
  } catch (error) {
    return Response.json(
      {
        error: `Failed to save instruction file: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }

  return Response.json({
    fileName: promptFileName,
    savedPath: toDisplayPath(promptFilePath),
  });
}

export function parseInstructionContent(payload: unknown): ParseResult<string> {
  if (!isRecord(payload)) {
    return { ok: false, error: "Invalid instruction payload." };
  }

  if (typeof payload.instruction !== "string") {
    return { ok: false, error: "`instruction` must be a string." };
  }

  const instruction = payload.instruction;
  if (!instruction.trim()) {
    return { ok: false, error: "Instruction is empty." };
  }

  const byteLength = Buffer.byteLength(instruction, "utf8");
  if (byteLength > MAX_PROMPT_CONTENT_BYTES) {
    return {
      ok: false,
      error: `Instruction is too large. Max ${MAX_PROMPT_CONTENT_BYTES} bytes.`,
    };
  }

  return { ok: true, value: instruction };
}

export function parseRequestedPromptFileName(
  payload: unknown,
): ParseResult<string | null> {
  if (!isRecord(payload)) {
    return { ok: true, value: null };
  }

  const rawFileName = payload.fileName;
  if (rawFileName === undefined || rawFileName === null) {
    return { ok: true, value: null };
  }

  if (typeof rawFileName !== "string") {
    return { ok: false, error: "`fileName` must be a string." };
  }

  const trimmed = rawFileName.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  return normalizeRequestedPromptFileName(trimmed);
}

export function normalizeRequestedPromptFileName(fileName: string): ParseResult<string> {
  const baseName = getBaseName(fileName.trim());
  if (!baseName) {
    return { ok: false, error: "File name is invalid." };
  }

  const extension = getFileExtension(baseName);
  if (extension && !ALLOWED_PROMPT_FILE_EXTENSIONS.has(extension)) {
    return { ok: false, error: "File extension must be .md, .txt, .xml, or .json." };
  }

  const stemCandidate = extension ? baseName.slice(0, -extension.length) : baseName;
  const normalizedStem = normalizeFileStem(stemCandidate);
  if (!normalizedStem) {
    return { ok: false, error: "File name is invalid." };
  }

  const normalizedExtension = extension || DEFAULT_PROMPT_FILE_EXTENSION;
  const normalizedFileName = `${normalizedStem}${normalizedExtension}`;
  if (normalizedFileName.length > MAX_PROMPT_FILE_NAME_LENGTH) {
    return {
      ok: false,
      error: `File name must be ${MAX_PROMPT_FILE_NAME_LENGTH} characters or fewer.`,
    };
  }

  return { ok: true, value: normalizedFileName };
}

export function buildPromptFileName(
  sourceFileName: string | null,
  options: {
    now?: Date;
    randomSuffix?: string;
  } = {},
): string {
  const now = options.now ?? new Date();
  const randomSuffix = normalizeRandomSuffix(options.randomSuffix);

  const { stem, extension } = parseSourceFileName(sourceFileName);
  const timestamp = formatTimestamp(now);
  return `${stem}-${timestamp}-${randomSuffix}${extension}`;
}

function parseSourceFileName(sourceFileName: string | null): {
  stem: string;
  extension: string;
} {
  const candidate = (sourceFileName ?? "").trim();
  if (!candidate) {
    return {
      stem: DEFAULT_PROMPT_FILE_STEM,
      extension: DEFAULT_PROMPT_FILE_EXTENSION,
    };
  }

  const baseName = getBaseName(candidate);
  const extension = getFileExtension(baseName);
  const normalizedExtension = ALLOWED_PROMPT_FILE_EXTENSIONS.has(extension)
    ? extension
    : DEFAULT_PROMPT_FILE_EXTENSION;
  const fileStem = extension ? baseName.slice(0, -extension.length) : baseName;
  const normalizedStem = normalizeFileStem(fileStem);

  return {
    stem: normalizedStem || DEFAULT_PROMPT_FILE_STEM,
    extension: normalizedExtension,
  };
}

function normalizeFileStem(rawStem: string): string {
  const normalized = rawStem
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");

  if (!normalized) {
    return "";
  }

  return normalized.slice(0, MAX_PROMPT_FILE_STEM_LENGTH);
}

function normalizeRandomSuffix(source: string | undefined): string {
  const candidate = typeof source === "string" ? source : Math.random().toString(36).slice(2, 8);
  const normalized = candidate
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 8);
  return normalized || "prompt";
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function readOptionalSourceFileName(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.sourceFileName !== "string") {
    return null;
  }

  const trimmed = payload.sourceFileName.trim();
  return trimmed || null;
}

function toDisplayPath(fullPath: string): string {
  const home = homedir();
  if (!home) {
    return fullPath;
  }

  if (fullPath === home) {
    return "~";
  }

  const separator = determinePathSeparatorFromPath(home);
  const homeWithSeparator = `${home}${separator}`;
  if (fullPath.startsWith(homeWithSeparator)) {
    return `~${separator}${fullPath.slice(homeWithSeparator.length)}`;
  }

  return fullPath;
}

function joinPathSegments(basePath: string, nextSegment: string): string {
  const separator = determinePathSeparatorFromPath(basePath);
  const normalizedBase = basePath.replace(/[\\/]+$/, "");
  const normalizedSegment = nextSegment.replace(/^[\\/]+/, "");
  return `${normalizedBase}${separator}${normalizedSegment}`;
}

function determinePathSeparatorFromPath(value: string): string {
  return value.includes("\\") ? "\\" : "/";
}

function getBaseName(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex < 0) {
    return normalized;
  }

  return normalized.slice(lastSlashIndex + 1);
}

function getFileExtension(value: string): string {
  const lastDotIndex = value.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === value.length - 1) {
    return "";
  }

  return value.slice(lastDotIndex).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
