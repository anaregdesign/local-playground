import type { Route } from "./+types/api.thread-title";
import { Agent, run, user } from "@openai/agents";
import { OpenAIResponsesModel } from "@openai/agents-openai";
import {
  getAzureDependencies,
  normalizeAzureOpenAIBaseURL,
} from "~/lib/azure/dependencies";
import {
  CHAT_MAX_AGENT_INSTRUCTION_LENGTH,
  HOME_REASONING_EFFORT_OPTIONS,
  THREAD_AUTO_TITLE_SYSTEM_PROMPT,
} from "~/lib/constants";
import {
  buildThreadAutoTitleRequestMessage,
  normalizeThreadAutoTitle,
} from "~/lib/home/thread/title";
import type { ReasoningEffort } from "~/lib/home/shared/view-types";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";

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

type ThreadTitleOptions = {
  playgroundContent: string;
  instruction: string;
  azureConfig: ResolvedAzureConfig;
  reasoningEffort: ReasoningEffort;
};

const threadTitleMaxPlaygroundContentLength = 12_000;

export function loader({}: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  return Response.json(
    {
      error:
        "Use POST /api/thread-title with { playgroundContent, instruction, azureConfig, ... }.",
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
      route: "/api/thread-title",
      eventName: "invalid_json_body",
      action: "parse_request_body",
      level: "warning",
      statusCode: 400,
      message: "Invalid JSON body.",
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const playgroundContentResult = readPlaygroundContent(payload);
  if (!playgroundContentResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/thread-title",
      eventName: "invalid_playground_content",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: playgroundContentResult.error,
    });

    return Response.json({ error: playgroundContentResult.error }, { status: 400 });
  }
  const playgroundContent = playgroundContentResult.value;

  const instruction = readInstruction(payload);
  const reasoningEffortResult = parseThreadTitleReasoningEffort(payload);
  if (!reasoningEffortResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/thread-title",
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
      route: "/api/thread-title",
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
    return Response.json(
      {
        error: "Azure OpenAI base URL is missing.",
      },
      { status: 400 },
    );
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
    const title = await generateThreadTitle({
      playgroundContent,
      instruction,
      azureConfig,
      reasoningEffort,
    });
    return Response.json({ title });
  } catch (error) {
    const upstreamError = buildUpstreamErrorPayload(error, azureConfig.deploymentName);
    await logServerRouteEvent({
      request,
      route: "/api/thread-title",
      eventName: "generate_thread_title_failed",
      action: "generate_thread_title",
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

async function generateThreadTitle(options: ThreadTitleOptions): Promise<string> {
  const azureDependencies = getAzureDependencies();
  const model = new OpenAIResponsesModel(
    azureDependencies.getAzureOpenAIClient(options.azureConfig.baseUrl),
    options.azureConfig.deploymentName,
  );

  const agent = new Agent({
    name: "LocalPlaygroundThreadTitleAgent",
    instructions: THREAD_AUTO_TITLE_SYSTEM_PROMPT,
    model,
    modelSettings: {
      reasoning: {
        effort: options.reasoningEffort,
      },
    },
  });

  const prompt = buildThreadAutoTitleRequestMessage({
    playgroundContent: options.playgroundContent,
    instruction: options.instruction,
  });

  const result = await run(agent, [user(prompt)]);
  return extractThreadAutoTitle(result.finalOutput);
}

export function extractThreadAutoTitle(finalOutput: unknown): string {
  if (isRecord(finalOutput) && typeof finalOutput.title === "string") {
    const normalized = normalizeThreadAutoTitle(finalOutput.title);
    if (normalized) {
      return normalized;
    }
    throw new Error("Thread title response is empty.");
  }

  if (typeof finalOutput === "string") {
    const trimmed = finalOutput.trim();
    if (!trimmed) {
      throw new Error("Thread title response is empty.");
    }

    const parsed = parseJson(trimmed);
    if (isRecord(parsed) && typeof parsed.title === "string") {
      const normalizedFromJson = normalizeThreadAutoTitle(parsed.title);
      if (normalizedFromJson) {
        return normalizedFromJson;
      }
    }

    const normalized = normalizeThreadAutoTitle(trimmed);
    if (normalized) {
      return normalized;
    }
    throw new Error("Thread title response is empty.");
  }

  throw new Error("Thread title response is not valid.");
}

function readPlaygroundContent(payload: unknown): ParseResult<string> {
  if (!isRecord(payload)) {
    return { ok: false, error: "`playgroundContent` is required." };
  }

  const value = payload.playgroundContent;
  if (typeof value !== "string") {
    return { ok: false, error: "`playgroundContent` must be a string." };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: "`playgroundContent` is required." };
  }

  if (Array.from(trimmed).length > threadTitleMaxPlaygroundContentLength) {
    return {
      ok: false,
      error: `\`playgroundContent\` must be ${threadTitleMaxPlaygroundContentLength} characters or fewer.`,
    };
  }

  return { ok: true, value: trimmed };
}

function readInstruction(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.instruction !== "string") {
    return "";
  }

  return payload.instruction.trim().slice(0, CHAT_MAX_AGENT_INSTRUCTION_LENGTH);
}

export function parseThreadTitleReasoningEffort(payload: unknown): ParseResult<ReasoningEffort> {
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

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildUpstreamErrorPayload(error: unknown, deploymentName: string): {
  payload: UpstreamErrorPayload;
  status: number;
} {
  if (isAzureCredentialError(error)) {
    return {
      payload: {
        error:
          'Azure authentication failed. Click "Azure Login", complete sign-in, and try again.',
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
    return `${error.message} Verify your model/deployment supports utility workflows.`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
