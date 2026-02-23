/**
 * API route module for /api/instruction.
 */
import type { Route } from "./+types/api.instruction";
import { Agent, run, user } from "@openai/agents";
import { OpenAIResponsesModel } from "@openai/agents-openai";
import {
  getAzureDependencies,
  normalizeAzureOpenAIBaseURL,
} from "~/lib/azure/dependencies";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import {
  CHAT_MAX_AGENT_INSTRUCTION_LENGTH,
  HOME_REASONING_EFFORT_OPTIONS,
  INSTRUCTION_DIFF_PATCH_FILE_NAME_PATTERN,
  INSTRUCTION_DIFF_PATCH_MAX_HUNK_LINES,
  INSTRUCTION_DIFF_PATCH_MAX_HUNKS,
  INSTRUCTION_DIFF_PATCH_MAX_LINE_TEXT_LENGTH,
  INSTRUCTION_DIFF_PATCH_OUTPUT_TYPE,
  INSTRUCTION_ENHANCE_SYSTEM_PROMPT,
  PROMPT_ALLOWED_FILE_EXTENSIONS,
  PROMPT_DEFAULT_FILE_EXTENSION,
  PROMPT_DEFAULT_FILE_STEM,
  PROMPT_MAX_CONTENT_BYTES,
  PROMPT_MAX_FILE_NAME_LENGTH,
  PROMPT_MAX_FILE_STEM_LENGTH,
} from "~/lib/constants";
import type { ReasoningEffort } from "~/lib/home/shared/view-types";

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type ResolvedAzureConfig = {
  projectName: string;
  baseUrl: string;
  apiVersion: string;
  deploymentName: string;
};

type UpstreamErrorPayload = {
  error: string;
  errorCode?: "azure_login_required";
};

type InstructionEnhanceOptions = {
  message: string;
  enhanceAgentInstruction: string;
  azureConfig: ResolvedAzureConfig;
  reasoningEffort: ReasoningEffort;
};

type InstructionDiffPatchLineOutput = {
  op: "context" | "add" | "remove";
  text: string;
};

type InstructionDiffPatchHunkOutput = {
  oldStart: number;
  newStart: number;
  lines: InstructionDiffPatchLineOutput[];
};

type InstructionDiffPatchOutput = {
  fileName: string;
  hunks: InstructionDiffPatchHunkOutput[];
};

export function loader({}: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  return Response.json(
    {
      error:
        "Use POST /api/instruction with { message, azureConfig, ... } to enhance instructions.",
    },
    { status: 405 },
  );
}

export async function action({ request }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await logServerRouteEvent({
      request,
      route: "/api/instruction",
      eventName: "invalid_json_body",
      action: "parse_request_body",
      level: "warning",
      statusCode: 400,
      message: "Invalid JSON body.",
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (isInstructionPromptSavePayload(payload)) {
    return Response.json(
      {
        error: "Instruction file save/load must be handled on the client side.",
      },
      { status: 400 },
    );
  }

  const message = readMessage(payload);
  if (!message) {
    await logServerRouteEvent({
      request,
      route: "/api/instruction",
      eventName: "missing_message",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: "`message` is required.",
    });

    return Response.json({ error: "`message` is required." }, { status: 400 });
  }

  const enhanceAgentInstruction = readEnhanceAgentInstruction(payload);
  const reasoningEffortResult = parseInstructionReasoningEffort(payload);
  if (!reasoningEffortResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/instruction",
      eventName: "invalid_reasoning_effort",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: reasoningEffortResult.error,
    });

    return Response.json({ error: reasoningEffortResult.error }, { status: 400 });
  }
  const reasoningEffort = reasoningEffortResult.value;
  const azureConfigResult = readAzureConfig(payload);
  if (!azureConfigResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/instruction",
      eventName: "invalid_azure_config",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: azureConfigResult.error,
    });

    return Response.json({ error: azureConfigResult.error }, { status: 400 });
  }
  const azureConfig = azureConfigResult.value;

  if (!azureConfig.baseUrl) {
    return Response.json({
      message: "Azure OpenAI base URL is missing.",
      placeholder: true,
    });
  }
  if (!azureConfig.deploymentName) {
    return Response.json(
      {
        error: "Azure deployment name is missing.",
      },
      { status: 400 },
    );
  }
  if (azureConfig.apiVersion && azureConfig.apiVersion !== "v1") {
    return Response.json(
      {
        error: "Azure OpenAI v1 endpoint requires `apiVersion` to be `v1`.",
      },
      { status: 400 },
    );
  }

  try {
    const patch = await enhanceInstruction({
      message,
      enhanceAgentInstruction,
      azureConfig,
      reasoningEffort,
    });
    return Response.json({ message: patch });
  } catch (error) {
    const upstreamError = buildUpstreamErrorPayload(error, azureConfig.deploymentName);
    await logServerRouteEvent({
      request,
      route: "/api/instruction",
      eventName: "enhance_instruction_failed",
      action: "enhance_instruction",
      statusCode: upstreamError.status,
      error,
      context: {
        projectName: azureConfig.projectName,
        deploymentName: azureConfig.deploymentName,
      },
    });

    return Response.json(upstreamError.payload, { status: upstreamError.status });
  }
}

async function enhanceInstruction(options: InstructionEnhanceOptions): Promise<string> {
  const azureDependencies = getAzureDependencies();
  const model = new OpenAIResponsesModel(
    azureDependencies.getAzureOpenAIClient(options.azureConfig.baseUrl),
    options.azureConfig.deploymentName,
  );

  const agent = new Agent({
    name: "LocalPlaygroundInstructionAgent",
    instructions: options.enhanceAgentInstruction,
    model,
    modelSettings: {
      reasoning: {
        effort: options.reasoningEffort,
      },
    },
    outputType: INSTRUCTION_DIFF_PATCH_OUTPUT_TYPE,
  });

  const result = await run(agent, [user(options.message)]);
  return extractInstructionDiffPatch(result.finalOutput);
}

export function extractInstructionDiffPatch(finalOutput: unknown): string {
  if (isRecord(finalOutput)) {
    const output = readInstructionDiffPatchOutput(finalOutput);
    if (output) {
      return buildInstructionDiffPatchText(output);
    }
  }

  if (typeof finalOutput === "string") {
    const trimmed = finalOutput.trim();
    if (!trimmed) {
      throw new Error("Enhancement response is empty.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Enhancement response is not valid JSON.");
    }

    const output = readInstructionDiffPatchOutput(parsed);
    if (output) {
      return buildInstructionDiffPatchText(output);
    }
  }

  throw new Error("Enhancement response does not match the required patch schema.");
}

function buildInstructionDiffPatchText(output: InstructionDiffPatchOutput): string {
  if (output.hunks.length === 0) {
    return "";
  }

  const fileName = normalizeInstructionPatchFileName(output.fileName);
  const patchLines: string[] = [`--- a/${fileName}`, `+++ b/${fileName}`];

  for (const hunk of output.hunks) {
    let oldLength = 0;
    let newLength = 0;
    const hunkLines: string[] = [];

    for (const line of hunk.lines) {
      if (line.op === "context") {
        oldLength += 1;
        newLength += 1;
        hunkLines.push(` ${line.text}`);
        continue;
      }

      if (line.op === "remove") {
        oldLength += 1;
        hunkLines.push(`-${line.text}`);
        continue;
      }

      newLength += 1;
      hunkLines.push(`+${line.text}`);
    }

    patchLines.push(`@@ -${hunk.oldStart},${oldLength} +${hunk.newStart},${newLength} @@`);
    patchLines.push(...hunkLines);
  }

  return patchLines.join("\n");
}

function normalizeInstructionPatchFileName(value: string): string {
  const normalizedSlashes = value.trim().replace(/\\/g, "/");
  const fileName = normalizedSlashes.slice(normalizedSlashes.lastIndexOf("/") + 1);
  const safeFileName = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return safeFileName || "instruction.txt";
}

function readInstructionDiffPatchOutput(
  value: unknown,
): InstructionDiffPatchOutput | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.fileName !== "string" || !Array.isArray(value.hunks)) {
    return null;
  }

  if (
    !INSTRUCTION_DIFF_PATCH_FILE_NAME_PATTERN.test(value.fileName) ||
    value.fileName.length > 128 ||
    value.hunks.length > INSTRUCTION_DIFF_PATCH_MAX_HUNKS
  ) {
    return null;
  }

  const hunks: InstructionDiffPatchHunkOutput[] = [];
  for (const hunk of value.hunks) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) {
      return null;
    }

    if (hunk.lines.length === 0 || hunk.lines.length > INSTRUCTION_DIFF_PATCH_MAX_HUNK_LINES) {
      return null;
    }

    const oldStart = hunk.oldStart;
    const newStart = hunk.newStart;
    if (
      typeof oldStart !== "number" ||
      !Number.isSafeInteger(oldStart) ||
      oldStart < 0 ||
      typeof newStart !== "number" ||
      !Number.isSafeInteger(newStart) ||
      newStart < 0
    ) {
      return null;
    }

    const lines: InstructionDiffPatchLineOutput[] = [];
    for (const line of hunk.lines) {
      if (
        !isRecord(line) ||
        typeof line.text !== "string" ||
        line.text.length > INSTRUCTION_DIFF_PATCH_MAX_LINE_TEXT_LENGTH
      ) {
        return null;
      }

      const op = line.op;
      if (op !== "context" && op !== "add" && op !== "remove") {
        return null;
      }

      lines.push({
        op,
        text: line.text,
      });
    }

    hunks.push({
      oldStart,
      newStart,
      lines,
    });
  }

  return {
    fileName: value.fileName,
    hunks,
  };
}

function readMessage(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  const message = payload.message;
  if (typeof message !== "string") {
    return "";
  }
  return message.trim();
}

function readEnhanceAgentInstruction(payload: unknown): string {
  if (!isRecord(payload)) {
    return INSTRUCTION_ENHANCE_SYSTEM_PROMPT;
  }

  const value = payload.enhanceAgentInstruction;
  if (typeof value !== "string") {
    return INSTRUCTION_ENHANCE_SYSTEM_PROMPT;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return INSTRUCTION_ENHANCE_SYSTEM_PROMPT;
  }

  return trimmed.slice(0, CHAT_MAX_AGENT_INSTRUCTION_LENGTH);
}

export function parseInstructionReasoningEffort(payload: unknown): ParseResult<ReasoningEffort> {
  if (!isRecord(payload)) {
    return { ok: true, value: "high" };
  }

  const value = payload.reasoningEffort;
  if (value === undefined || value === null) {
    return { ok: true, value: "high" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "`reasoningEffort` must be a string." };
  }

  const normalized = value.trim();
  if (HOME_REASONING_EFFORT_OPTIONS.includes(normalized as ReasoningEffort)) {
    return { ok: true, value: normalized as ReasoningEffort };
  }

  return {
    ok: false,
    error: "`reasoningEffort` must be one of: none, low, medium, high.",
  };
}

function readAzureConfig(payload: unknown): ParseResult<ResolvedAzureConfig> {
  if (!isRecord(payload)) {
    return { ok: false, error: "`azureConfig` is required." };
  }

  const value = payload.azureConfig;
  if (value === undefined || value === null) {
    return { ok: false, error: "`azureConfig` is required." };
  }

  if (!isRecord(value)) {
    return { ok: false, error: "`azureConfig` must be an object." };
  }

  if (value.projectName !== undefined && typeof value.projectName !== "string") {
    return { ok: false, error: "`azureConfig.projectName` must be a string." };
  }

  if (value.baseUrl !== undefined && typeof value.baseUrl !== "string") {
    return { ok: false, error: "`azureConfig.baseUrl` must be a string." };
  }

  if (value.apiVersion !== undefined && typeof value.apiVersion !== "string") {
    return { ok: false, error: "`azureConfig.apiVersion` must be a string." };
  }

  if (value.deploymentName !== undefined && typeof value.deploymentName !== "string") {
    return { ok: false, error: "`azureConfig.deploymentName` must be a string." };
  }

  const baseUrl =
    typeof value.baseUrl === "string" ? normalizeAzureOpenAIBaseURL(value.baseUrl) : "";
  const apiVersion =
    typeof value.apiVersion === "string" && value.apiVersion.trim()
      ? value.apiVersion.trim()
      : "v1";
  const deploymentName =
    typeof value.deploymentName === "string" ? value.deploymentName.trim() : "";

  if (!baseUrl) {
    return { ok: false, error: "`azureConfig.baseUrl` is required." };
  }

  if (!deploymentName) {
    return { ok: false, error: "`azureConfig.deploymentName` is required." };
  }

  return {
    ok: true,
    value: {
      projectName: typeof value.projectName === "string" ? value.projectName.trim() : "",
      baseUrl,
      apiVersion,
      deploymentName,
    },
  };
}

function isInstructionPromptSavePayload(payload: unknown): boolean {
  return isRecord(payload) && typeof payload.instruction === "string";
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
  if (byteLength > PROMPT_MAX_CONTENT_BYTES) {
    return {
      ok: false,
      error: `Instruction is too large. Max ${PROMPT_MAX_CONTENT_BYTES} bytes.`,
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
  if (extension && !PROMPT_ALLOWED_FILE_EXTENSIONS.has(extension)) {
    return { ok: false, error: "File extension must be .md, .txt, .xml, or .json." };
  }

  const stemCandidate = extension ? baseName.slice(0, -extension.length) : baseName;
  const normalizedStem = normalizeFileStem(stemCandidate);
  if (!normalizedStem) {
    return { ok: false, error: "File name is invalid." };
  }

  const normalizedExtension = extension || PROMPT_DEFAULT_FILE_EXTENSION;
  const normalizedFileName = `${normalizedStem}${normalizedExtension}`;
  if (normalizedFileName.length > PROMPT_MAX_FILE_NAME_LENGTH) {
    return {
      ok: false,
      error: `File name must be ${PROMPT_MAX_FILE_NAME_LENGTH} characters or fewer.`,
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
      stem: PROMPT_DEFAULT_FILE_STEM,
      extension: PROMPT_DEFAULT_FILE_EXTENSION,
    };
  }

  const baseName = getBaseName(candidate);
  const extension = getFileExtension(baseName);
  const normalizedExtension = PROMPT_ALLOWED_FILE_EXTENSIONS.has(extension)
    ? extension
    : PROMPT_DEFAULT_FILE_EXTENSION;
  const fileStem = extension ? baseName.slice(0, -extension.length) : baseName;
  const normalizedStem = normalizeFileStem(fileStem);

  return {
    stem: normalizedStem || PROMPT_DEFAULT_FILE_STEM,
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

  return normalized.slice(0, PROMPT_MAX_FILE_STEM_LENGTH);
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

function getBaseName(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return "";
  }
  return fileName.slice(lastDot).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function buildUpstreamErrorPayload(error: unknown, deploymentName: string): {
  payload: UpstreamErrorPayload;
  status: number;
} {
  if (isAzureCredentialError(error)) {
    return {
      payload: {
        error:
          "Azure authentication failed. Click \"Azure Login\", complete sign-in, and try again.",
        errorCode: "azure_login_required",
      },
      status: 401,
    };
  }

  const message = buildUpstreamErrorMessage(error, deploymentName);
  return {
    payload: { error: message },
    status: 502,
  };
}

function buildUpstreamErrorMessage(error: unknown, deploymentName: string): string {
  if (!(error instanceof Error)) {
    return "Could not connect to Azure OpenAI.";
  }

  if (error.message.includes("Resource not found")) {
    return `${error.message} Check Azure base URL and deployment name (${deploymentName}).`;
  }
  if (error.message.includes("Unavailable model")) {
    return `${error.message} Check the selected deployment name (${deploymentName}).`;
  }
  if (error.message.includes("Model behavior error")) {
    return `${error.message} Verify your model/deployment supports instruction enhancement.`;
  }

  return error.message;
}

function isAzureCredentialError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return [
    "defaultazurecredential",
    "interactivebrowsercredential",
    "authenticationrequirederror",
    "automatic authentication has been disabled",
    "chainedtokencredential",
    "credentialunavailableerror",
    "managedidentitycredential",
    "azure credential failed",
  ].some((pattern) => message.includes(pattern));
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
