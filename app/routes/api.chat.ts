import type { Route } from "./+types/api.chat";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import {
  Agent,
  MCPServerSSE,
  MCPServerStdio,
  MCPServerStreamableHttp,
  assistant,
  run,
  user,
  type MCPServer,
} from "@openai/agents";
import { OpenAIChatCompletionsModel } from "@openai/agents-openai";
import OpenAI from "openai";

type ChatRole = "user" | "assistant";

type ClientMessage = {
  role: ChatRole;
  content: string;
};

type ReasoningEffort = "none" | "low" | "medium" | "high";
type McpTransport = "streamable_http" | "sse" | "stdio";
type ClientMcpHttpServerConfig = {
  name: string;
  transport: "streamable_http" | "sse";
  url: string;
};
type ClientMcpStdioServerConfig = {
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
};
type ClientMcpServerConfig = ClientMcpHttpServerConfig | ClientMcpStdioServerConfig;

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DEFAULT_CONTEXT_WINDOW_SIZE = 10;
const MIN_CONTEXT_WINDOW_SIZE = 1;
const MAX_CONTEXT_WINDOW_SIZE = 200;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;
const MAX_MCP_SERVERS = 8;
const MAX_MCP_SERVER_NAME_LENGTH = 80;
const MAX_MCP_STDIO_ARGS = 64;
const MAX_MCP_STDIO_ENV_VARS = 64;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const AZURE_OPENAI_BASE_URL =
  process.env.AZURE_BASE_URL ?? process.env.AZURE_OPENAI_BASE_URL ?? "";
const AZURE_OPENAI_API_VERSION =
  (process.env.AZURE_API_VERSION ?? process.env.AZURE_OPENAI_API_VERSION ?? "v1").trim();
const AZURE_OPENAI_DEPLOYMENT_NAME = (
  process.env.AZURE_DEPLOYMENT_NAME ?? process.env.AZURE_OPENAI_DEPLOYMENT_NAME ?? ""
).trim();
const AZURE_COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
const SYSTEM_PROMPT = "You are a concise assistant for a simple chat app.";
const MAX_AGENT_INSTRUCTION_LENGTH = 4000;
let azureOpenAIClient: OpenAI | null = null;

export function loader({}: Route.LoaderArgs) {
  return Response.json(
    { error: "Use POST /api/chat for this endpoint." },
    { status: 405 },
  );
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

  const message = readMessage(payload);
  if (!message) {
    return Response.json({ error: "`message` is required." }, { status: 400 });
  }

  const contextWindowSize = readContextWindowSize(payload);
  const history = readHistory(payload, contextWindowSize);
  const reasoningEffort = readReasoningEffort(payload);
  const temperatureResult = readTemperature(payload);
  if (!temperatureResult.ok) {
    return Response.json({ error: temperatureResult.error }, { status: 400 });
  }
  const agentInstruction = readAgentInstruction(payload);
  const mcpServersResult = readMcpServers(payload);
  if (!mcpServersResult.ok) {
    return Response.json({ error: mcpServersResult.error }, { status: 400 });
  }

  if (!AZURE_OPENAI_BASE_URL) {
    return Response.json({
      message:
        "Azure OpenAI is not configured. Set AZURE_BASE_URL/AZURE_OPENAI_BASE_URL, then restart the server.",
      placeholder: true,
    });
  }
  if (!AZURE_OPENAI_DEPLOYMENT_NAME) {
    return Response.json(
      {
        error:
          "Azure deployment is not configured. Set AZURE_DEPLOYMENT_NAME (or AZURE_OPENAI_DEPLOYMENT_NAME).",
      },
      { status: 400 },
    );
  }
  if (AZURE_OPENAI_API_VERSION && AZURE_OPENAI_API_VERSION !== "v1") {
    return Response.json(
      {
        error:
          "For Azure OpenAI v1 endpoint, set AZURE_API_VERSION (or AZURE_OPENAI_API_VERSION) to `v1`.",
      },
      { status: 400 },
    );
  }

  const connectedMcpServers: MCPServer[] = [];

  try {
    for (const serverConfig of mcpServersResult.value) {
      const server = createMcpServer(serverConfig);

      try {
        await server.connect();
      } catch (error) {
        throw new Error(
          `Failed to connect MCP server "${serverConfig.name}" (${describeMcpServer(serverConfig)}): ${readErrorMessage(error)}`,
        );
      }

      connectedMcpServers.push(server);
    }

    const model = new OpenAIChatCompletionsModel(
      getAzureOpenAIClient(),
      AZURE_OPENAI_DEPLOYMENT_NAME,
    );

    const agent = new Agent({
      name: "SimpleChatAgent",
      instructions: agentInstruction,
      model,
      modelSettings: {
        ...(temperatureResult.value !== null
          ? { temperature: temperatureResult.value }
          : {}),
        reasoning: {
          effort: reasoningEffort,
        },
      },
      mcpServers: connectedMcpServers,
    });

    const result = await run(agent, [
      ...history.map((entry) =>
        entry.role === "user" ? user(entry.content) : assistant(entry.content),
      ),
      user(message),
    ]);

    const assistantMessage = extractAgentFinalOutput(result.finalOutput);
    if (!assistantMessage) {
      return Response.json(
        { error: "Azure OpenAI returned an empty message." },
        { status: 502 },
      );
    }

    return Response.json({ message: assistantMessage });
  } catch (error) {
    return Response.json(
      {
        error: buildUpstreamErrorMessage(error),
      },
      { status: 502 },
    );
  } finally {
    await Promise.allSettled(connectedMcpServers.map((server) => server.close()));
  }
}

function extractAgentFinalOutput(finalOutput: unknown): string {
  if (typeof finalOutput === "string") {
    return finalOutput.trim();
  }
  if (typeof finalOutput === "number" || typeof finalOutput === "boolean") {
    return String(finalOutput);
  }
  if (finalOutput && typeof finalOutput === "object") {
    try {
      return JSON.stringify(finalOutput);
    } catch {
      return "";
    }
  }
  return "";
}

function getAzureOpenAIClient(): OpenAI {
  if (azureOpenAIClient) {
    return azureOpenAIClient;
  }

  const credential = new DefaultAzureCredential();
  const azureADTokenProvider = getBearerTokenProvider(
    credential,
    AZURE_COGNITIVE_SERVICES_SCOPE,
  );

  azureOpenAIClient = new OpenAI({
    baseURL: normalizeAzureOpenAIBaseURL(AZURE_OPENAI_BASE_URL),
    apiKey: azureADTokenProvider,
  });

  return azureOpenAIClient;
}

function normalizeAzureOpenAIBaseURL(rawValue: string): string {
  const trimmed = rawValue.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  if (/\/openai\/v1$/i.test(trimmed)) {
    return `${trimmed}/`;
  }

  return `${trimmed}/openai/v1/`;
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

function readHistory(payload: unknown, contextWindowSize: number): ClientMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.history)) {
    return [];
  }

  return payload.history
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const role = entry.role;
      const content = entry.content;
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
        return null;
      }

      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return null;
      }

      return { role, content: trimmedContent };
    })
    .filter((entry): entry is ClientMessage => entry !== null)
    .slice(-contextWindowSize);
}

function readContextWindowSize(payload: unknown): number {
  if (!isRecord(payload)) {
    return DEFAULT_CONTEXT_WINDOW_SIZE;
  }

  const value = payload.contextWindowSize;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return DEFAULT_CONTEXT_WINDOW_SIZE;
  }

  return clamp(value, MIN_CONTEXT_WINDOW_SIZE, MAX_CONTEXT_WINDOW_SIZE);
}

function readReasoningEffort(payload: unknown): ReasoningEffort {
  if (!isRecord(payload)) {
    return "none";
  }

  const value = payload.reasoningEffort;
  if (value === "none" || value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "none";
}

function readTemperature(payload: unknown): ParseResult<number | null> {
  if (!isRecord(payload) || payload.temperature === undefined || payload.temperature === null) {
    return { ok: true, value: null };
  }

  const value = payload.temperature;
  if (typeof value === "string" && value.trim() === "") {
    return { ok: true, value: null };
  }

  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return {
      ok: false,
      error: "`temperature` must be a number between 0 and 2, or omitted (None).",
    };
  }

  if (parsed < MIN_TEMPERATURE || parsed > MAX_TEMPERATURE) {
    return {
      ok: false,
      error: "`temperature` must be between 0 and 2, or omitted (None).",
    };
  }

  return { ok: true, value: parsed };
}

function readAgentInstruction(payload: unknown): string {
  if (!isRecord(payload)) {
    return SYSTEM_PROMPT;
  }

  const value = payload.agentInstruction;
  if (typeof value !== "string") {
    return SYSTEM_PROMPT;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return SYSTEM_PROMPT;
  }

  return trimmed.slice(0, MAX_AGENT_INSTRUCTION_LENGTH);
}

function readMcpServers(payload: unknown): ParseResult<ClientMcpServerConfig[]> {
  if (!isRecord(payload)) {
    return { ok: true, value: [] };
  }

  const value = payload.mcpServers;
  if (value === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: "`mcpServers` must be an array." };
  }

  if (value.length > MAX_MCP_SERVERS) {
    return { ok: false, error: `You can add up to ${MAX_MCP_SERVERS} MCP servers.` };
  }

  const result: ClientMcpServerConfig[] = [];
  const dedupeKeys = new Set<string>();

  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      return { ok: false, error: `mcpServers[${index}] is invalid.` };
    }

    const rawName = typeof entry.name === "string" ? entry.name.trim() : "";

    const rawTransport = entry.transport;
    let transport: McpTransport;
    if (rawTransport === "sse") {
      transport = "sse";
    } else if (rawTransport === "stdio") {
      transport = "stdio";
    } else if (rawTransport === "streamable_http" || rawTransport === undefined || rawTransport === null) {
      transport = "streamable_http";
    } else {
      return {
        ok: false,
        error: `mcpServers[${index}].transport must be "streamable_http", "sse", or "stdio".`,
      };
    }

    if (transport === "stdio") {
      const command = typeof entry.command === "string" ? entry.command.trim() : "";
      if (!command) {
        return { ok: false, error: `mcpServers[${index}].command is required for stdio.` };
      }

      if (/\s/.test(command)) {
        return { ok: false, error: `mcpServers[${index}].command must not include spaces.` };
      }

      const argsResult = parseStdioArgs(entry.args, index);
      if (!argsResult.ok) {
        return argsResult;
      }

      const envResult = parseStdioEnv(entry.env, index);
      if (!envResult.ok) {
        return envResult;
      }

      const cwd = typeof entry.cwd === "string" ? entry.cwd.trim() : "";
      const name = (rawName || command).slice(0, MAX_MCP_SERVER_NAME_LENGTH);
      if (!name) {
        return { ok: false, error: `mcpServers[${index}].name is required.` };
      }

      const dedupeKey = `${transport}:${command.toLowerCase()}:${argsResult.value.join("\u0000")}:${cwd.toLowerCase()}`;
      if (dedupeKeys.has(dedupeKey)) {
        continue;
      }

      dedupeKeys.add(dedupeKey);
      result.push({
        name,
        transport,
        command,
        args: argsResult.value,
        cwd: cwd || undefined,
        env: envResult.value,
      });
      continue;
    }

    const rawUrl = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!rawUrl) {
      return { ok: false, error: `mcpServers[${index}].url is required.` };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return { ok: false, error: `mcpServers[${index}].url is invalid.` };
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return {
        ok: false,
        error: `mcpServers[${index}].url must start with http:// or https://.`,
      };
    }

    const name = (rawName || parsedUrl.hostname).slice(0, MAX_MCP_SERVER_NAME_LENGTH);
    if (!name) {
      return { ok: false, error: `mcpServers[${index}].name is required.` };
    }

    const url = parsedUrl.toString();
    const dedupeKey = `${transport}:${url.toLowerCase()}`;
    if (dedupeKeys.has(dedupeKey)) {
      continue;
    }

    dedupeKeys.add(dedupeKey);
    result.push({ name, url, transport });
  }

  return { ok: true, value: result };
}

function createMcpServer(config: ClientMcpServerConfig): MCPServer {
  if (config.transport === "stdio") {
    return new MCPServerStdio({
      name: config.name,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
    });
  }

  if (config.transport === "sse") {
    return new MCPServerSSE({
      name: config.name,
      url: config.url,
    });
  }

  return new MCPServerStreamableHttp({
    name: config.name,
    url: config.url,
  });
}

function parseStdioArgs(argsValue: unknown, index: number): ParseResult<string[]> {
  if (argsValue === undefined || argsValue === null) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(argsValue)) {
    return { ok: false, error: `mcpServers[${index}].args must be an array of strings.` };
  }

  if (argsValue.length > MAX_MCP_STDIO_ARGS) {
    return {
      ok: false,
      error: `mcpServers[${index}].args can include up to ${MAX_MCP_STDIO_ARGS} entries.`,
    };
  }

  const args: string[] = [];
  for (const [argIndex, arg] of argsValue.entries()) {
    if (typeof arg !== "string") {
      return { ok: false, error: `mcpServers[${index}].args[${argIndex}] must be a string.` };
    }

    const trimmed = arg.trim();
    if (!trimmed) {
      return { ok: false, error: `mcpServers[${index}].args[${argIndex}] must not be empty.` };
    }

    args.push(trimmed);
  }

  return { ok: true, value: args };
}

function parseStdioEnv(
  envValue: unknown,
  index: number,
): ParseResult<Record<string, string>> {
  if (envValue === undefined || envValue === null) {
    return { ok: true, value: {} };
  }

  if (!isRecord(envValue)) {
    return { ok: false, error: `mcpServers[${index}].env must be an object.` };
  }

  const entries = Object.entries(envValue);
  if (entries.length > MAX_MCP_STDIO_ENV_VARS) {
    return {
      ok: false,
      error: `mcpServers[${index}].env can include up to ${MAX_MCP_STDIO_ENV_VARS} entries.`,
    };
  }

  const env: Record<string, string> = {};

  for (const [key, value] of entries) {
    if (!ENV_KEY_PATTERN.test(key)) {
      return { ok: false, error: `mcpServers[${index}].env key "${key}" is invalid.` };
    }

    if (typeof value !== "string") {
      return { ok: false, error: `mcpServers[${index}].env["${key}"] must be a string.` };
    }

    env[key] = value;
  }

  return { ok: true, value: env };
}

function describeMcpServer(config: ClientMcpServerConfig): string {
  if (config.transport === "stdio") {
    const argsPart = config.args.length > 0 ? ` ${config.args.join(" ")}` : "";
    return `stdio:${config.command}${argsPart}`;
  }

  return config.url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function buildUpstreamErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Could not connect to Azure OpenAI.";
  }

  if (error.message.includes("Resource not found")) {
    return `${error.message} Check AZURE_BASE_URL and deployment name (${AZURE_OPENAI_DEPLOYMENT_NAME}).`;
  }
  if (error.message.includes("Unavailable model")) {
    return `${error.message} Check AZURE_DEPLOYMENT_NAME (or AZURE_OPENAI_DEPLOYMENT_NAME).`;
  }
  if (error.message.includes("Model behavior error")) {
    return `${error.message} Verify your model/deployment supports the selected reasoning effort.`;
  }

  return error.message;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
