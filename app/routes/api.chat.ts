import type { Route } from "./+types/api.chat";
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
import {
  AZURE_COGNITIVE_SERVICES_SCOPE,
  getAzureDependencies,
  normalizeAzureOpenAIBaseURL,
} from "~/lib/azure/dependencies";
import type { AzureDependencies } from "~/lib/azure/dependencies";

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
  headers: Record<string, string>;
  useAzureAuth: boolean;
  azureAuthScope: string;
  timeoutSeconds: number;
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
type ChatExecutionOptions = {
  message: string;
  history: ClientMessage[];
  reasoningEffort: ReasoningEffort;
  temperature: number | null;
  agentInstruction: string;
  azureConfig: ResolvedAzureConfig;
  mcpServers: ClientMcpServerConfig[];
};
type JsonRpcRequestPayload = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: Record<string, unknown>;
};
type JsonRpcResponsePayload =
  | {
      jsonrpc: "2.0";
      id: string;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: string;
      error: {
        message: string;
      };
    };
type McpRpcRecord = {
  id: string;
  sequence: number;
  serverName: string;
  method: string;
  startedAt: string;
  completedAt: string;
  request: JsonRpcRequestPayload;
  response: JsonRpcResponsePayload;
  isError: boolean;
};
type ChatExecutionEvent =
  | {
      type: "progress";
      message: string;
      isMcp?: boolean;
    }
  | {
      type: "mcp_rpc";
      record: McpRpcRecord;
    };
type ChatProgressEvent = {
  message: string;
  isMcp?: boolean;
};
type ChatStreamPayload =
  | {
      type: "progress";
      message: string;
      isMcp?: boolean;
    }
  | {
      type: "mcp_rpc";
      record: McpRpcRecord;
    }
  | {
      type: "final";
      message: string;
    }
  | {
      type: "error";
      error: string;
      errorCode?: "azure_login_required";
    };

const DEFAULT_CONTEXT_WINDOW_SIZE = 10;
const MIN_CONTEXT_WINDOW_SIZE = 1;
const MAX_CONTEXT_WINDOW_SIZE = 200;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;
const MAX_MCP_SERVERS = 8;
const MAX_MCP_SERVER_NAME_LENGTH = 80;
const MAX_MCP_STDIO_ARGS = 64;
const MAX_MCP_STDIO_ENV_VARS = 64;
const MAX_MCP_HTTP_HEADERS = 64;
const MAX_MCP_AZURE_AUTH_SCOPE_LENGTH = 512;
const MIN_MCP_TIMEOUT_SECONDS = 1;
const MAX_MCP_TIMEOUT_SECONDS = 600;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DEFAULT_MCP_HTTP_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

const DEFAULT_MCP_AZURE_AUTH_SCOPE = AZURE_COGNITIVE_SERVICES_SCOPE;
const DEFAULT_MCP_TIMEOUT_SECONDS = 30;
const SYSTEM_PROMPT = "You are a concise assistant for a local playground app.";
const MAX_AGENT_INSTRUCTION_LENGTH = 4000;

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
  const azureConfigResult = readAzureConfig(payload);
  if (!azureConfigResult.ok) {
    return Response.json({ error: azureConfigResult.error }, { status: 400 });
  }
  const azureConfig = azureConfigResult.value;
  const mcpServersResult = readMcpServers(payload);
  if (!mcpServersResult.ok) {
    return Response.json({ error: mcpServersResult.error }, { status: 400 });
  }

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

  const executionOptions: ChatExecutionOptions = {
    message,
    history,
    reasoningEffort,
    temperature: temperatureResult.value,
    agentInstruction,
    azureConfig,
    mcpServers: mcpServersResult.value,
  };

  if (wantsEventStream(request)) {
    return streamChatResponse(executionOptions);
  }

  try {
    const assistantMessage = await executeChat(executionOptions);
    return Response.json({ message: assistantMessage });
  } catch (error) {
    const upstreamError = buildUpstreamErrorPayload(error, azureConfig.deploymentName);
    return Response.json(
      upstreamError.payload,
      { status: upstreamError.status },
    );
  }
}

async function executeChat(
  options: ChatExecutionOptions,
  onEvent?: (event: ChatExecutionEvent) => void,
): Promise<string> {
  const azureDependencies = getAzureDependencies();
  const connectedMcpServers: MCPServer[] = [];
  const toolNameByCallId = new Map<string, string>();
  let mcpRpcSequence = 0;
  const hasMcpServers = options.mcpServers.length > 0;
  const azureMcpAuthorizationTokenPromiseByScope = new Map<string, Promise<string>>();

  const emitProgress = (event: ChatProgressEvent) => {
    onEvent?.({
      type: "progress",
      message: event.message,
      ...(event.isMcp ? { isMcp: true } : {}),
    });
  };
  const emitMcpRpcRecord = (record: McpRpcRecord) => {
    onEvent?.({
      type: "mcp_rpc",
      record,
    });
  };

  try {
    if (hasMcpServers) {
      emitProgress({
        message: `Preparing MCP server connections (${options.mcpServers.length})...`,
        isMcp: true,
      });
    }

    for (const serverConfig of options.mcpServers) {
      emitProgress({
        message: `Connecting MCP server: ${serverConfig.name}`,
        isMcp: true,
      });

      const connectSequence = (() => {
        mcpRpcSequence += 1;
        return mcpRpcSequence;
      })();
      const connectRequestId = buildMcpRpcRequestId(serverConfig.name, connectSequence);
      const connectStartedAt = new Date().toISOString();
      const connectRequest: JsonRpcRequestPayload = {
        jsonrpc: "2.0",
        id: connectRequestId,
        method: "server/connect",
        params: buildMcpConnectParams(serverConfig),
      };

      let instrumentedServer: MCPServer;
      try {
        const server = await createMcpServer(serverConfig, {
          getAzureAuthorizationToken: (scope) => {
            const normalizedScope = scope.trim();
            const current = azureMcpAuthorizationTokenPromiseByScope.get(normalizedScope);
            if (current) {
              return current;
            }

            const created = getAzureMcpAuthorizationToken(
              normalizedScope,
              azureDependencies,
            );
            azureMcpAuthorizationTokenPromiseByScope.set(normalizedScope, created);
            return created;
          },
        });
        instrumentedServer = instrumentMcpServer(server, {
          nextSequence: () => {
            mcpRpcSequence += 1;
            return mcpRpcSequence;
          },
          onRecord: emitMcpRpcRecord,
        });

        await instrumentedServer.connect();
      } catch (error) {
        const connectResponse: JsonRpcResponsePayload = {
          jsonrpc: "2.0",
          id: connectRequestId,
          error: {
            message: readErrorMessage(error),
          },
        };
        emitMcpRpcRecord({
          id: connectRequestId,
          sequence: connectSequence,
          serverName: serverConfig.name,
          method: "server/connect",
          startedAt: connectStartedAt,
          completedAt: new Date().toISOString(),
          request: connectRequest,
          response: connectResponse,
          isError: true,
        });
        throw new Error(
          `Failed to connect MCP server "${serverConfig.name}" (${describeMcpServer(serverConfig)}): ${readErrorMessage(error)}`,
        );
      }

      connectedMcpServers.push(instrumentedServer);
      const connectResponse: JsonRpcResponsePayload = {
        jsonrpc: "2.0",
        id: connectRequestId,
        result: {
          status: "connected",
        },
      };
      emitMcpRpcRecord({
        id: connectRequestId,
        sequence: connectSequence,
        serverName: serverConfig.name,
        method: "server/connect",
        startedAt: connectStartedAt,
        completedAt: new Date().toISOString(),
        request: connectRequest,
        response: connectResponse,
        isError: false,
      });
      emitProgress({
        message: `Connected MCP server: ${serverConfig.name}`,
        isMcp: true,
      });
    }

    emitProgress({ message: "Initializing model and agent..." });

    const model = new OpenAIChatCompletionsModel(
      getAzureOpenAIClient(options.azureConfig.baseUrl, azureDependencies),
      options.azureConfig.deploymentName,
    );

    const agent = new Agent({
      name: "LocalPlaygroundAgent",
      instructions: options.agentInstruction,
      model,
      modelSettings: {
        ...(options.temperature !== null ? { temperature: options.temperature } : {}),
        reasoning: {
          effort: options.reasoningEffort,
        },
      },
      mcpServers: connectedMcpServers,
    });

    const runInput = [
      ...options.history.map((entry) =>
        entry.role === "user" ? user(entry.content) : assistant(entry.content),
      ),
      user(options.message),
    ];

    emitProgress({ message: "Sending request to Azure OpenAI..." });

    if (onEvent) {
      const streamedResult = await run(agent, runInput, { stream: true });
      for await (const event of streamedResult) {
        const progress = readProgressEventFromRunStreamEvent(
          event,
          hasMcpServers,
          toolNameByCallId,
        );
        if (progress) {
          emitProgress(progress);
        }
      }

      await streamedResult.completed;

      const assistantMessage = extractAgentFinalOutput(streamedResult.finalOutput);
      if (!assistantMessage) {
        throw new Error("Azure OpenAI returned an empty message.");
      }

      emitProgress({ message: "Finalizing response..." });
      return assistantMessage;
    }

    const result = await run(agent, runInput);
    const assistantMessage = extractAgentFinalOutput(result.finalOutput);
    if (!assistantMessage) {
      throw new Error("Azure OpenAI returned an empty message.");
    }

    return assistantMessage;
  } finally {
    await Promise.allSettled(connectedMcpServers.map((server) => server.close()));
  }
}

function streamChatResponse(options: ChatExecutionOptions): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: ChatStreamPayload) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        send({
          type: "progress",
          message: "Preparing request...",
        });

        const message = await executeChat(options, (event) => {
          if (event.type === "progress") {
            send({
              type: "progress",
              message: event.message,
              ...(event.isMcp ? { isMcp: true } : {}),
            });
            return;
          }

          send({
            type: "mcp_rpc",
            record: event.record,
          });
        });

        send({
          type: "final",
          message,
        });
      } catch (error) {
        const upstreamError = buildUpstreamErrorPayload(
          error,
          options.azureConfig.deploymentName,
        );
        send({
          type: "error",
          error: upstreamError.payload.error,
          ...(upstreamError.payload.errorCode
            ? { errorCode: upstreamError.payload.errorCode }
            : {}),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function wantsEventStream(request: Request): boolean {
  const acceptHeader = request.headers.get("accept");
  return (
    typeof acceptHeader === "string" &&
    acceptHeader.toLowerCase().includes("text/event-stream")
  );
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

function getAzureOpenAIClient(
  baseUrl: string,
  dependencies: AzureDependencies,
) {
  return dependencies.getAzureOpenAIClient(baseUrl);
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

  const baseUrl = typeof value.baseUrl === "string" ? normalizeAzureOpenAIBaseURL(value.baseUrl) : "";
  const apiVersion =
    typeof value.apiVersion === "string" && value.apiVersion.trim()
      ? value.apiVersion.trim()
      : "v1";
  const deploymentName = typeof value.deploymentName === "string" ? value.deploymentName.trim() : "";

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

    const headersResult = parseHttpHeaders(entry.headers, index);
    if (!headersResult.ok) {
      return headersResult;
    }
    const useAzureAuth = entry.useAzureAuth === true;
    const scopeResult = parseAzureAuthScope(entry.azureAuthScope, index, useAzureAuth);
    if (!scopeResult.ok) {
      return scopeResult;
    }
    const timeoutResult = parseTimeoutSeconds(entry.timeoutSeconds, index);
    if (!timeoutResult.ok) {
      return timeoutResult;
    }

    const url = parsedUrl.toString();
    const headersKey = buildHttpHeadersDedupeKey(headersResult.value);
    const authKey = useAzureAuth ? "azure-auth:on" : "azure-auth:off";
    const scopeKey = useAzureAuth ? scopeResult.value.toLowerCase() : "";
    const dedupeKey = `${transport}:${url.toLowerCase()}:${headersKey}:${authKey}:${scopeKey}:${timeoutResult.value}`;
    if (dedupeKeys.has(dedupeKey)) {
      continue;
    }

    dedupeKeys.add(dedupeKey);
    result.push({
      name,
      url,
      transport,
      headers: headersResult.value,
      useAzureAuth,
      azureAuthScope: scopeResult.value,
      timeoutSeconds: timeoutResult.value,
    });
  }

  return { ok: true, value: result };
}

async function createMcpServer(
  config: ClientMcpServerConfig,
  helpers: {
    getAzureAuthorizationToken: (scope: string) => Promise<string>;
  },
): Promise<MCPServer> {
  if (config.transport === "stdio") {
    return new MCPServerStdio({
      name: config.name,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
    });
  }

  const headers = buildMcpHttpRequestHeaders(config.headers);
  if (config.useAzureAuth) {
    const token = await helpers.getAzureAuthorizationToken(config.azureAuthScope);
    headers.Authorization = `Bearer ${token}`;
  }

  if (config.transport === "sse") {
    return new MCPServerSSE({
      name: config.name,
      url: config.url,
      clientSessionTimeoutSeconds: config.timeoutSeconds,
      timeout: config.timeoutSeconds * 1000,
      fetch: fetchWithMcpMetaNormalization,
      requestInit: {
        headers,
      },
    });
  }

  return new MCPServerStreamableHttp({
    name: config.name,
    url: config.url,
    clientSessionTimeoutSeconds: config.timeoutSeconds,
    timeout: config.timeoutSeconds * 1000,
    fetch: fetchWithMcpMetaNormalization,
    requestInit: {
      headers,
    },
  });
}

async function fetchWithMcpMetaNormalization(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return response;
  }

  let parsedBody: unknown;
  try {
    parsedBody = await response.clone().json();
  } catch {
    return response;
  }

  const normalizedMetaBody = normalizeMcpMetaNulls(parsedBody);
  const normalizedInitializeBody = normalizeMcpInitializeNullOptionals(normalizedMetaBody.value);
  const normalizedToolsBody = normalizeMcpListToolsNullOptionals(normalizedInitializeBody.value);
  if (!normalizedMetaBody.changed && !normalizedInitializeBody.changed && !normalizedToolsBody.changed) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(normalizedToolsBody.value), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function normalizeMcpMetaNulls(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (Array.isArray(value)) {
    let changed = false;
    const normalizedArray = value.map((entry) => {
      const normalized = normalizeMcpMetaNulls(entry);
      if (normalized.changed) {
        changed = true;
      }
      return normalized.value;
    });

    return changed ? { value: normalizedArray, changed: true } : { value, changed: false };
  }

  if (!isRecord(value)) {
    return { value, changed: false };
  }

  let changed = false;
  const normalizedObject: Record<string, unknown> = {};
  for (const [key, rawEntryValue] of Object.entries(value)) {
    if (key === "_meta" && rawEntryValue === null) {
      normalizedObject[key] = {};
      changed = true;
      continue;
    }

    const normalizedEntry = normalizeMcpMetaNulls(rawEntryValue);
    normalizedObject[key] = normalizedEntry.value;
    if (normalizedEntry.changed) {
      changed = true;
    }
  }

  return changed ? { value: normalizedObject, changed: true } : { value, changed: false };
}

function normalizeMcpInitializeNullOptionals(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (Array.isArray(value)) {
    let changed = false;
    const normalizedArray = value.map((entry) => {
      const normalized = normalizeMcpInitializeNullOptionals(entry);
      if (normalized.changed) {
        changed = true;
      }
      return normalized.value;
    });

    return changed ? { value: normalizedArray, changed: true } : { value, changed: false };
  }

  if (!isRecord(value)) {
    return { value, changed: false };
  }

  const resultValue = value.result;
  if (!isRecord(resultValue) || !looksLikeInitializeResult(resultValue)) {
    return { value, changed: false };
  }

  const normalizedResult = stripNullFieldsRecursively(resultValue);
  if (!normalizedResult.changed) {
    return { value, changed: false };
  }

  return {
    value: {
      ...value,
      result: normalizedResult.value,
    },
    changed: true,
  };
}

function normalizeMcpListToolsNullOptionals(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (Array.isArray(value)) {
    let changed = false;
    const normalizedArray = value.map((entry) => {
      const normalized = normalizeMcpListToolsNullOptionals(entry);
      if (normalized.changed) {
        changed = true;
      }
      return normalized.value;
    });

    return changed ? { value: normalizedArray, changed: true } : { value, changed: false };
  }

  if (!isRecord(value)) {
    return { value, changed: false };
  }

  const resultValue = value.result;
  if (!isRecord(resultValue) || !Array.isArray(resultValue.tools)) {
    return { value, changed: false };
  }

  let changed = false;
  const normalizedTools = resultValue.tools.map((tool) => {
    if (!isRecord(tool)) {
      return tool;
    }

    const normalizedTool = stripNullFieldsRecursively(tool);
    if (normalizedTool.changed) {
      changed = true;
    }
    return normalizedTool.value;
  });

  if (!changed) {
    return { value, changed: false };
  }

  return {
    value: {
      ...value,
      result: {
        ...resultValue,
        tools: normalizedTools,
      },
    },
    changed: true,
  };
}

function looksLikeInitializeResult(value: Record<string, unknown>): boolean {
  const hasProtocolVersion = typeof value.protocolVersion === "string";
  const hasCapabilities = "capabilities" in value;
  const hasServerInfo = "serverInfo" in value;
  return hasProtocolVersion || (hasCapabilities && hasServerInfo);
}

function stripNullFieldsRecursively(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (Array.isArray(value)) {
    let changed = false;
    const normalizedArray: unknown[] = [];
    for (const entry of value) {
      if (entry === null) {
        changed = true;
        continue;
      }

      const normalizedEntry = stripNullFieldsRecursively(entry);
      if (normalizedEntry.changed) {
        changed = true;
      }
      normalizedArray.push(normalizedEntry.value);
    }

    return changed ? { value: normalizedArray, changed: true } : { value, changed: false };
  }

  if (!isRecord(value)) {
    return { value, changed: false };
  }

  let changed = false;
  const normalizedObject: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue === null) {
      changed = true;
      continue;
    }

    const normalizedEntry = stripNullFieldsRecursively(entryValue);
    if (normalizedEntry.changed) {
      changed = true;
    }
    normalizedObject[key] = normalizedEntry.value;
  }

  return changed ? { value: normalizedObject, changed: true } : { value, changed: false };
}

function instrumentMcpServer(
  server: MCPServer,
  handlers: {
    nextSequence: () => number;
    onRecord: (record: McpRpcRecord) => void;
  },
): MCPServer {
  const originalListTools = server.listTools.bind(server);
  const originalCallTool = server.callTool.bind(server);

  server.listTools = async () => {
    const sequence = handlers.nextSequence();
    const requestId = buildMcpRpcRequestId(server.name, sequence);
    const startedAt = new Date().toISOString();
    const requestPayload: JsonRpcRequestPayload = {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/list",
      params: {},
    };

    try {
      const result = await originalListTools();
      const responsePayload: JsonRpcResponsePayload = {
        jsonrpc: "2.0",
        id: requestId,
        result: {
          tools: toSerializableValue(result),
        },
      };

      handlers.onRecord({
        id: requestId,
        sequence,
        serverName: server.name,
        method: "tools/list",
        startedAt,
        completedAt: new Date().toISOString(),
        request: requestPayload,
        response: responsePayload,
        isError: false,
      });

      return result;
    } catch (error) {
      const responsePayload: JsonRpcResponsePayload = {
        jsonrpc: "2.0",
        id: requestId,
        error: {
          message: readErrorMessage(error),
        },
      };

      handlers.onRecord({
        id: requestId,
        sequence,
        serverName: server.name,
        method: "tools/list",
        startedAt,
        completedAt: new Date().toISOString(),
        request: requestPayload,
        response: responsePayload,
        isError: true,
      });

      throw error;
    }
  };

  server.callTool = async (toolName, args, meta) => {
    const sequence = handlers.nextSequence();
    const requestId = buildMcpRpcRequestId(server.name, sequence);
    const startedAt = new Date().toISOString();
    const requestPayload: JsonRpcRequestPayload = {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: toSerializableValue(args ?? {}),
        ...(meta ? { _meta: toSerializableValue(meta) } : {}),
      },
    };

    try {
      const result = await originalCallTool(toolName, args, meta);
      const responsePayload: JsonRpcResponsePayload = {
        jsonrpc: "2.0",
        id: requestId,
        result: toSerializableValue(result),
      };

      handlers.onRecord({
        id: requestId,
        sequence,
        serverName: server.name,
        method: "tools/call",
        startedAt,
        completedAt: new Date().toISOString(),
        request: requestPayload,
        response: responsePayload,
        isError: false,
      });

      return result;
    } catch (error) {
      const responsePayload: JsonRpcResponsePayload = {
        jsonrpc: "2.0",
        id: requestId,
        error: {
          message: readErrorMessage(error),
        },
      };

      handlers.onRecord({
        id: requestId,
        sequence,
        serverName: server.name,
        method: "tools/call",
        startedAt,
        completedAt: new Date().toISOString(),
        request: requestPayload,
        response: responsePayload,
        isError: true,
      });

      throw error;
    }
  };

  return server;
}

function buildMcpRpcRequestId(serverName: string, sequence: number): string {
  const normalizedName = serverName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "mcp";
  return `${normalizedName}-${Date.now()}-${sequence}`;
}

function buildMcpConnectParams(serverConfig: ClientMcpServerConfig): Record<string, unknown> {
  if (serverConfig.transport === "stdio") {
    return {
      transport: "stdio",
      command: serverConfig.command,
      args: serverConfig.args,
      cwd: serverConfig.cwd ?? "",
      envKeys: Object.keys(serverConfig.env).sort((left, right) => left.localeCompare(right)),
    };
  }

  return {
    transport: serverConfig.transport,
    url: serverConfig.url,
    headerKeys: Object.keys(serverConfig.headers).sort((left, right) => left.localeCompare(right)),
    useAzureAuth: serverConfig.useAzureAuth,
    azureAuthScope: serverConfig.azureAuthScope,
    timeoutSeconds: serverConfig.timeoutSeconds,
  };
}

function toSerializableValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
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

function parseHttpHeaders(
  headersValue: unknown,
  index: number,
): ParseResult<Record<string, string>> {
  if (headersValue === undefined || headersValue === null) {
    return { ok: true, value: {} };
  }

  if (!isRecord(headersValue)) {
    return { ok: false, error: `mcpServers[${index}].headers must be an object.` };
  }

  const entries = Object.entries(headersValue);
  if (entries.length > MAX_MCP_HTTP_HEADERS) {
    return {
      ok: false,
      error: `mcpServers[${index}].headers can include up to ${MAX_MCP_HTTP_HEADERS} entries.`,
    };
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!HTTP_HEADER_NAME_PATTERN.test(key)) {
      return { ok: false, error: `mcpServers[${index}].headers key "${key}" is invalid.` };
    }

    if (key.toLowerCase() === "content-type") {
      return {
        ok: false,
        error: `mcpServers[${index}].headers cannot include "Content-Type". It is fixed to "application/json".`,
      };
    }

    if (typeof value !== "string") {
      return { ok: false, error: `mcpServers[${index}].headers["${key}"] must be a string.` };
    }

    headers[key] = value;
  }

  return { ok: true, value: headers };
}

function parseAzureAuthScope(
  rawScope: unknown,
  index: number,
  useAzureAuth: boolean,
): ParseResult<string> {
  if (rawScope === undefined || rawScope === null) {
    return { ok: true, value: DEFAULT_MCP_AZURE_AUTH_SCOPE };
  }

  if (typeof rawScope !== "string") {
    return { ok: false, error: `mcpServers[${index}].azureAuthScope must be a string.` };
  }

  const scope = rawScope.trim() || DEFAULT_MCP_AZURE_AUTH_SCOPE;
  if (scope.length > MAX_MCP_AZURE_AUTH_SCOPE_LENGTH) {
    return {
      ok: false,
      error: `mcpServers[${index}].azureAuthScope must be ${MAX_MCP_AZURE_AUTH_SCOPE_LENGTH} characters or fewer.`,
    };
  }

  if (/\s/.test(scope)) {
    return { ok: false, error: `mcpServers[${index}].azureAuthScope must not include spaces.` };
  }

  if (useAzureAuth && !scope) {
    return {
      ok: false,
      error: `mcpServers[${index}].azureAuthScope is required when useAzureAuth is true.`,
    };
  }

  return { ok: true, value: scope };
}

function parseTimeoutSeconds(
  rawTimeout: unknown,
  index: number,
): ParseResult<number> {
  if (rawTimeout === undefined || rawTimeout === null) {
    return { ok: true, value: DEFAULT_MCP_TIMEOUT_SECONDS };
  }

  if (typeof rawTimeout !== "number" || !Number.isSafeInteger(rawTimeout)) {
    return { ok: false, error: `mcpServers[${index}].timeoutSeconds must be an integer.` };
  }

  if (rawTimeout < MIN_MCP_TIMEOUT_SECONDS || rawTimeout > MAX_MCP_TIMEOUT_SECONDS) {
    return {
      ok: false,
      error: `mcpServers[${index}].timeoutSeconds must be between ${MIN_MCP_TIMEOUT_SECONDS} and ${MAX_MCP_TIMEOUT_SECONDS}.`,
    };
  }

  return { ok: true, value: rawTimeout };
}

function buildMcpHttpRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const mergedHeaders: Record<string, string> = { ...DEFAULT_MCP_HTTP_HEADERS };
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "content-type") {
      continue;
    }
    mergedHeaders[key] = value;
  }

  return mergedHeaders;
}

async function getAzureMcpAuthorizationToken(
  scope: string,
  dependencies: AzureDependencies,
): Promise<string> {
  try {
    return await dependencies.getAzureBearerToken(scope);
  } catch {
    throw new Error(
      `DefaultAzureCredential failed to acquire Azure token for MCP Authorization header (scope: ${scope}). Run Azure Login and try again.`,
    );
  }
}

function buildHttpHeadersDedupeKey(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000");
}

function describeMcpServer(config: ClientMcpServerConfig): string {
  if (config.transport === "stdio") {
    const argsPart = config.args.length > 0 ? ` ${config.args.join(" ")}` : "";
    return `stdio:${config.command}${argsPart}`;
  }

  return config.useAzureAuth
    ? `${config.url} (azure auth: ${config.azureAuthScope}, timeout: ${config.timeoutSeconds}s)`
    : `${config.url} (timeout: ${config.timeoutSeconds}s)`;
}

function readProgressEventFromRunStreamEvent(
  event: unknown,
  hasMcpServers: boolean,
  toolNameByCallId: Map<string, string>,
): ChatProgressEvent | null {
  if (!isRecord(event) || event.type !== "run_item_stream_event") {
    return null;
  }

  const eventName = event.name;
  if (typeof eventName !== "string") {
    return null;
  }

  const item = event.item;

  if (eventName === "tool_called") {
    const toolName = readToolNameFromRunItem(item);
    const callId = readToolCallIdFromRunItem(item);
    if (callId && toolName) {
      toolNameByCallId.set(callId, toolName);
    }

    const toolLabel = toolName || shortenToolCallId(callId);
    return {
      message: hasMcpServers
        ? `Running MCP command: ${toolLabel}`
        : `Running tool: ${toolLabel}`,
      isMcp: hasMcpServers,
    };
  }

  if (eventName === "tool_output") {
    const callId = readToolCallIdFromRunItem(item);
    const knownToolName = callId ? toolNameByCallId.get(callId) : "";
    if (callId) {
      toolNameByCallId.delete(callId);
    }

    const toolName = knownToolName || readToolNameFromRunItem(item) || shortenToolCallId(callId);
    return {
      message: hasMcpServers
        ? `MCP command finished: ${toolName}`
        : `Tool finished: ${toolName}`,
      isMcp: hasMcpServers,
    };
  }

  if (eventName === "reasoning_item_created") {
    return {
      message: "Reasoning on your request...",
    };
  }

  if (eventName === "message_output_created") {
    return {
      message: "Generating response...",
    };
  }

  return null;
}

function readToolNameFromRunItem(item: unknown): string {
  if (!isRecord(item)) {
    return "";
  }

  if (typeof item.toolName === "string" && item.toolName.trim()) {
    return item.toolName.trim();
  }

  if (!isRecord(item.rawItem)) {
    return "";
  }

  const rawToolName = item.rawItem.name;
  return typeof rawToolName === "string" ? rawToolName.trim() : "";
}

function readToolCallIdFromRunItem(item: unknown): string {
  if (!isRecord(item) || !isRecord(item.rawItem)) {
    return "";
  }

  const rawCallId = item.rawItem.callId;
  return typeof rawCallId === "string" ? rawCallId.trim() : "";
}

function shortenToolCallId(callId: string): string {
  const trimmed = callId.trim();
  if (!trimmed) {
    return "unknown";
  }

  return trimmed.length <= 12 ? trimmed : `${trimmed.slice(0, 12)}...`;
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
    return `${error.message} Verify your model/deployment supports the selected reasoning effort.`;
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
    "chainedtokencredential",
    "credentialunavailableerror",
    "managedidentitycredential",
    "azureclicredential",
    "please run 'az login'",
    "run az login",
    "az login",
  ].some((pattern) => message.includes(pattern));
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
