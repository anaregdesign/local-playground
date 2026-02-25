/**
 * API route module for /api/chat.
 */
import type { Route } from "./+types/api.chat";
import fs from "node:fs";
import nodeOs from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import {
  Agent,
  MCPServerSSE,
  MCPServerStdio,
  MCPServerStreamableHttp,
  assistant,
  run,
  tool,
  user,
  type AgentInputItem,
  type MCPServer,
  type OpenAIResponsesCompactionAwareSession,
} from "@openai/agents";
import {
  OpenAIResponsesCompactionSession,
  OpenAIResponsesModel,
  codeInterpreterTool,
} from "@openai/agents-openai";
import { toFile } from "openai";
import {
  getAzureDependencies,
  normalizeAzureOpenAIBaseURL,
} from "~/lib/azure/dependencies";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import {
  CHAT_ATTACHMENT_ALLOWED_EXTENSIONS,
  CHAT_CLEANUP_TIMEOUT_MS,
  CHAT_CODE_INTERPRETER_UPLOAD_TIMEOUT_MS,
  CODE_INTERPRETER_ATTACHMENT_AVAILABILITY_CACHE_MS,
  CHAT_ATTACHMENT_MAX_FILE_NAME_LENGTH,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_NON_PDF_FILE_SIZE_BYTES,
  CHAT_ATTACHMENT_MAX_PDF_FILE_SIZE_BYTES,
  CHAT_ATTACHMENT_MAX_PDF_TOTAL_SIZE_BYTES,
  CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES,
  CHAT_MAX_AGENT_INSTRUCTION_LENGTH,
  CHAT_MAX_ACTIVE_SKILLS,
  CHAT_MAX_RUN_TURNS,
  CHAT_MAX_MCP_SERVERS,
  CHAT_MODEL_RUN_TIMEOUT_MS,
  DEFAULT_AGENT_INSTRUCTION,
  AGENT_SKILL_PROMPT_RESOURCE_PREVIEW_MAX_FILES,
  AGENT_SKILL_READ_TEXT_DEFAULT_MAX_CHARS,
  AGENT_SKILL_READ_TEXT_MAX_CHARS,
  AGENT_SKILL_SCRIPT_ARG_MAX_LENGTH,
  AGENT_SKILL_SCRIPT_MAX_ARGS,
  AGENT_SKILL_SCRIPT_OUTPUT_MAX_CHARS,
  AGENT_SKILL_SCRIPT_TIMEOUT_MAX_MS,
  AGENT_SKILL_TOOL_RESOURCE_PREVIEW_MAX_FILES,
  AGENT_SKILL_NAME_MAX_LENGTH,
  ENV_KEY_PATTERN,
  HTTP_HEADER_NAME_PATTERN,
  MCP_AZURE_AUTH_SCOPE_MAX_LENGTH,
  MCP_DEFAULT_AZURE_AUTH_SCOPE,
  MCP_DEFAULT_HTTP_HEADERS,
  MCP_DEFAULT_TIMEOUT_SECONDS,
  MCP_HTTP_HEADERS_MAX,
  MCP_SERVER_NAME_MAX_LENGTH,
  MCP_STDIO_ARGS_MAX,
  MCP_STDIO_ENV_VARS_MAX,
  MCP_TIMEOUT_SECONDS_MAX,
  MCP_TIMEOUT_SECONDS_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
} from "~/lib/constants";
import type { AzureDependencies } from "~/lib/azure/dependencies";
import type { SkillCatalogEntry, ThreadSkillSelection } from "~/lib/home/skills/types";
import { discoverSkillCatalog, readSkillMarkdown } from "~/lib/server/skills/catalog";
import {
  inspectSkillResourceManifest,
  readSkillResourceBuffer,
  readSkillResourceText,
  runSkillScript,
  type SkillResourceFileEntry,
  type SkillResourceKind,
} from "~/lib/server/skills/runtime";

type ChatRole = "user" | "assistant";

type ClientAttachment = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
};

type ClientMessage = {
  role: ChatRole;
  content: string;
  attachments: ClientAttachment[];
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
type ClientSkillSelection = ThreadSkillSelection;

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
  attachments: ClientAttachment[];
  history: ClientMessage[];
  reasoningEffort: ReasoningEffort;
  webSearchEnabled: boolean;
  temperature: number | null;
  agentInstruction: string;
  skills: ClientSkillSelection[];
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
  operationType: "mcp" | "skill";
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
type CodeInterpreterAttachmentAvailabilityCache = {
  supported: boolean;
  checkedAt: number;
  reason: string;
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
type ActiveSkillRuntimeEntry = {
  name: string;
  description: string;
  location: string;
  content: string;
  skillRoot: string;
  scripts: SkillResourceFileEntry[];
  references: SkillResourceFileEntry[];
  assets: SkillResourceFileEntry[];
  scriptsTruncated: boolean;
  referencesTruncated: boolean;
  assetsTruncated: boolean;
};
type EnvironmentMap = Record<string, string | undefined>;

const shellPathStartMarker = "__LOCAL_PLAYGROUND_PATH_START__";
const shellPathEndMarker = "__LOCAL_PLAYGROUND_PATH_END__";
let cachedShellExecutablePathEntries: string[] | null = null;
let cachedRuntimeExecutablePathEntries: string[] | null = null;
type SkillRuntimeContext = {
  availableSkills: SkillCatalogEntry[];
  activeSkills: ActiveSkillRuntimeEntry[];
  warnings: string[];
};
type SkillToolCategory = SkillResourceKind;
type SkillToolLogHandlers = {
  nextSequence: () => number;
  onRecord: (record: McpRpcRecord) => void;
};

let codeInterpreterAttachmentAvailabilityCache: CodeInterpreterAttachmentAvailabilityCache | null =
  null;
const WEB_SEARCH_PREVIEW_TOOL_NAME = "web_search_preview";
const WEB_SEARCH_PREVIEW_CONTEXT_SIZE = "medium";

export function loader({}: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  return Response.json(
    { error: "Use POST /api/chat for this endpoint." },
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
      route: "/api/chat",
      eventName: "invalid_json_body",
      action: "parse_request_body",
      level: "warning",
      statusCode: 400,
      message: "Invalid JSON body.",
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = readMessage(payload);
  if (!message) {
    await logServerRouteEvent({
      request,
      route: "/api/chat",
      eventName: "missing_message",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: "`message` is required.",
    });

    return Response.json({ error: "`message` is required." }, { status: 400 });
  }

  const historyResult = readHistory(payload);
  if (!historyResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/chat",
      eventName: "invalid_history_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: historyResult.error,
    });

    return Response.json({ error: historyResult.error }, { status: 400 });
  }
  const history = historyResult.value;
  const attachmentsResult = readAttachments(payload);
  if (!attachmentsResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/chat",
      eventName: "invalid_attachments_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: attachmentsResult.error,
    });

    return Response.json({ error: attachmentsResult.error }, { status: 400 });
  }
  const reasoningEffort = readReasoningEffort(payload);
  const webSearchEnabled = readWebSearchEnabled(payload);
  const temperatureResult = readTemperature(payload);
  if (!temperatureResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/chat",
      eventName: "invalid_temperature_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: temperatureResult.error,
    });

    return Response.json({ error: temperatureResult.error }, { status: 400 });
  }
  const agentInstruction = readAgentInstruction(payload);
  const skillsResult = readSkills(payload);
  if (!skillsResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/chat",
      eventName: "invalid_skills_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: skillsResult.error,
    });

    return Response.json({ error: skillsResult.error }, { status: 400 });
  }
  const azureConfigResult = readAzureConfig(payload);
  if (!azureConfigResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/chat",
      eventName: "invalid_azure_config",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: azureConfigResult.error,
    });

    return Response.json({ error: azureConfigResult.error }, { status: 400 });
  }
  const azureConfig = azureConfigResult.value;
  const mcpServersResult = readMcpServers(payload);
  if (!mcpServersResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/chat",
      eventName: "invalid_mcp_servers_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: mcpServersResult.error,
    });

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
    attachments: attachmentsResult.value,
    history,
    reasoningEffort,
    webSearchEnabled,
    temperature: temperatureResult.value,
    agentInstruction,
    skills: skillsResult.value,
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
    await logServerRouteEvent({
      request,
      route: "/api/chat",
      eventName: "chat_execution_failed",
      action: "execute_chat",
      statusCode: upstreamError.status,
      error,
      context: {
        deploymentName: azureConfig.deploymentName,
        mcpServerCount: executionOptions.mcpServers.length,
        maxRunTurns: CHAT_MAX_RUN_TURNS,
      },
    });

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
  const azureOpenAIClient = getAzureOpenAIClient(options.azureConfig.baseUrl, azureDependencies);
  const connectedMcpServers: MCPServer[] = [];
  let codeInterpreterContainerId = "";
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
          operationType: "mcp",
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
        operationType: "mcp",
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

    const skillRuntime = await buildSkillRuntimeContext(options.skills);
    const skillWarnings = collectSkillRuntimeWarnings(skillRuntime);
    if (skillWarnings.length > 0) {
      emitProgress({
        message: `Skill loading warnings: ${skillWarnings.slice(0, 2).join(" / ")}`,
      });
    }

    emitProgress({ message: "Initializing model and agent..." });

    const model = new OpenAIResponsesModel(
      azureOpenAIClient,
      options.azureConfig.deploymentName,
    );
    const webSearchTools = options.webSearchEnabled ? [buildWebSearchPreviewTool()] : [];
    if (options.webSearchEnabled) {
      emitProgress({ message: "Enabling web-search-preview tool..." });
    }
    const useCodeInterpreter = shouldEnableCodeInterpreter(options);
    let codeInterpreterEnabledForRun = false;
    if (useCodeInterpreter) {
      emitProgress({ message: "Enabling Code Interpreter for non-PDF attachments..." });
      const nonPdfAttachments = collectNonPdfAttachments(options);
      if (nonPdfAttachments.length > 0) {
        const cachedAvailability = readCodeInterpreterAttachmentAvailabilityCache();
        if (cachedAvailability && !cachedAvailability.supported) {
          emitProgress({
            message:
              "Code Interpreter file upload is temporarily unavailable; continuing without non-PDF file access.",
          });
        } else {
          emitProgress({
            message: `Uploading attachments for Code Interpreter (${nonPdfAttachments.length})...`,
          });
          try {
            codeInterpreterContainerId = await createCodeInterpreterContainerWithAttachments(
              nonPdfAttachments,
              azureOpenAIClient,
            );
            codeInterpreterEnabledForRun = true;
            markCodeInterpreterAttachmentAvailabilitySupported();
          } catch (error) {
            const reason = readErrorMessage(error);
            markCodeInterpreterAttachmentAvailabilityUnavailable(reason);
            emitProgress({
              message: `Code Interpreter file upload failed (${truncateProgressMessage(reason)}). Continuing without non-PDF file access.`,
            });
          }
        }
      } else {
        codeInterpreterEnabledForRun = true;
      }
    }

    const enableCodeInterpreterTool =
      codeInterpreterEnabledForRun && codeInterpreterContainerId.length > 0;
    const skillTools = buildSkillTools(skillRuntime.activeSkills, {
      nextSequence: () => {
        mcpRpcSequence += 1;
        return mcpRpcSequence;
      },
      onRecord: emitMcpRpcRecord,
    });

    const agent = new Agent({
      name: "LocalPlaygroundAgent",
      instructions: buildAgentInstructionWithSkills(options.agentInstruction, skillRuntime),
      model,
      modelSettings: {
        ...(options.temperature !== null ? { temperature: options.temperature } : {}),
        reasoning: {
          effort: options.reasoningEffort,
        },
      },
      tools: [
        ...webSearchTools,
        ...(enableCodeInterpreterTool
          ? [
              codeInterpreterTool({
                container: codeInterpreterContainerId,
              }),
            ]
          : []),
        ...skillTools,
      ],
      mcpServers: connectedMcpServers,
    });

    const historyInput = options.history.map((entry) =>
      entry.role === "user"
        ? buildUserMessageInput(entry.content, entry.attachments, {
            useCodeInterpreter: enableCodeInterpreterTool,
          })
        : assistant(entry.content),
    );
    const currentInput = buildUserMessageInput(options.message, options.attachments, {
      useCodeInterpreter: enableCodeInterpreterTool,
    });
    const compactionSession = await initializeCompactionSession({
      client: azureOpenAIClient,
      deploymentName: options.azureConfig.deploymentName,
      historyInput,
      onCompactionUnavailable: () => {
        emitProgress({
          message:
            "Automatic context compaction is unavailable for this deployment; continuing without it.",
        });
      },
    });
    const runInput = compactionSession ? [currentInput] : [...historyInput, currentInput];

    emitProgress({ message: "Sending request to Azure OpenAI..." });
    const runTimeoutSeconds = Math.ceil(CHAT_MODEL_RUN_TIMEOUT_MS / 1000);
    const runTimeoutMessage = useCodeInterpreter
      ? `Azure OpenAI request timed out after ${runTimeoutSeconds} seconds while processing file attachments. The selected deployment may not support Code Interpreter.`
      : `Azure OpenAI request timed out after ${runTimeoutSeconds} seconds.`;

    if (onEvent) {
      const streamedResult = await runAgentWithTimeout(
        (signal) =>
          run(agent, runInput, {
            stream: true,
            signal,
            maxTurns: CHAT_MAX_RUN_TURNS,
            ...(compactionSession ? { session: compactionSession } : {}),
          }),
        CHAT_MODEL_RUN_TIMEOUT_MS,
        runTimeoutMessage,
      );
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

      await awaitWithTimeout(
        streamedResult.completed,
        CHAT_MODEL_RUN_TIMEOUT_MS,
        runTimeoutMessage,
      );

      const assistantMessage = extractAgentFinalOutput(streamedResult.finalOutput);
      if (!assistantMessage) {
        throw new Error("Azure OpenAI returned an empty message.");
      }

      emitProgress({ message: "Finalizing response..." });
      return assistantMessage;
    }

    const result = await runAgentWithTimeout(
      (signal) =>
        run(agent, runInput, {
          signal,
          maxTurns: CHAT_MAX_RUN_TURNS,
          ...(compactionSession ? { session: compactionSession } : {}),
        }),
      CHAT_MODEL_RUN_TIMEOUT_MS,
      runTimeoutMessage,
    );
    const assistantMessage = extractAgentFinalOutput(result.finalOutput);
    if (!assistantMessage) {
      throw new Error("Azure OpenAI returned an empty message.");
    }

    return assistantMessage;
  } finally {
    await Promise.allSettled([
      awaitWithTimeout(
        (async () => {
          if (!codeInterpreterContainerId) {
            return;
          }
          try {
            await azureOpenAIClient.containers.delete(codeInterpreterContainerId);
          } catch {
            // Best-effort cleanup for temporary Code Interpreter containers.
          }
        })(),
        CHAT_CLEANUP_TIMEOUT_MS,
        "Timed out while cleaning up the Code Interpreter container.",
      ),
      awaitWithTimeout(
        Promise.allSettled(connectedMcpServers.map((server) => server.close())).then(
          () => undefined,
        ),
        CHAT_CLEANUP_TIMEOUT_MS,
        "Timed out while closing MCP server connections.",
      ),
    ]);
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
        await logServerRouteEvent({
          route: "/api/chat",
          eventName: "chat_stream_execution_failed",
          action: "stream_chat",
          statusCode: upstreamError.status,
          error,
          context: {
            deploymentName: options.azureConfig.deploymentName,
            mcpServerCount: options.mcpServers.length,
            maxRunTurns: CHAT_MAX_RUN_TURNS,
          },
        });

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

function buildWebSearchPreviewTool() {
  return {
    type: "hosted_tool" as const,
    name: WEB_SEARCH_PREVIEW_TOOL_NAME,
    providerData: {
      type: "web_search_preview",
      name: WEB_SEARCH_PREVIEW_TOOL_NAME,
      search_context_size: WEB_SEARCH_PREVIEW_CONTEXT_SIZE,
    },
  };
}

function shouldEnableCodeInterpreter(options: ChatExecutionOptions): boolean {
  if (hasNonPdfAttachments(options.attachments)) {
    return true;
  }

  return options.history.some(
    (entry) => entry.role === "user" && hasNonPdfAttachments(entry.attachments),
  );
}

function hasNonPdfAttachments(attachments: ClientAttachment[]): boolean {
  return attachments.some((attachment) => readFileExtension(attachment.name) !== "pdf");
}

function collectNonPdfAttachments(options: ChatExecutionOptions): ClientAttachment[] {
  const dedupedByKey = new Map<string, ClientAttachment>();

  const register = (attachment: ClientAttachment) => {
    if (readFileExtension(attachment.name) === "pdf") {
      return;
    }
    dedupedByKey.set(buildAttachmentKey(attachment), attachment);
  };

  for (const attachment of options.attachments) {
    register(attachment);
  }
  for (const historyEntry of options.history) {
    if (historyEntry.role !== "user") {
      continue;
    }
    for (const attachment of historyEntry.attachments) {
      register(attachment);
    }
  }

  return [...dedupedByKey.values()];
}

async function createCodeInterpreterContainerWithAttachments(
  attachments: ClientAttachment[],
  client: ReturnType<AzureDependencies["getAzureOpenAIClient"]>,
): Promise<string> {
  const container = await awaitWithTimeout(
    client.containers.create({
      name: "local-playground-chat",
    }),
    CHAT_CODE_INTERPRETER_UPLOAD_TIMEOUT_MS,
    "Timed out while creating a Code Interpreter container.",
  );
  const containerId = typeof container.id === "string" ? container.id.trim() : "";
  if (!containerId) {
    throw new Error("Failed to initialize a Code Interpreter container.");
  }

  try {
    for (const attachment of attachments) {
      const parsedAttachmentDataUrl = parseAttachmentDataUrl(
        attachment.dataUrl,
        `attachments["${attachment.name}"].dataUrl`,
      );
      if (!parsedAttachmentDataUrl.ok) {
        throw new Error(parsedAttachmentDataUrl.error);
      }

      const base64Payload = readDataUrlBase64Payload(parsedAttachmentDataUrl.value.dataUrl);
      const attachmentBuffer = Buffer.from(base64Payload, "base64");
      const normalizedMimeType =
        attachment.mimeType ||
        parsedAttachmentDataUrl.value.mimeType ||
        "application/octet-stream";
      const file = await toFile(attachmentBuffer, attachment.name, { type: normalizedMimeType });
      try {
        await awaitWithTimeout(
          client.containers.files.create(containerId, { file }),
          CHAT_CODE_INTERPRETER_UPLOAD_TIMEOUT_MS,
          `Timed out while uploading "${attachment.name}" to Code Interpreter.`,
        );
      } catch (error) {
        throw buildCodeInterpreterAttachmentUploadError(attachment.name, error);
      }
    }

    return containerId;
  } catch (error) {
    try {
      await client.containers.delete(containerId);
    } catch {
      // Best-effort cleanup when attachment upload fails.
    }
    throw error;
  }
}

function buildCodeInterpreterAttachmentUploadError(
  fileName: string,
  error: unknown,
): Error {
  const message = readErrorMessage(error);
  if (
    /unsupported extension/i.test(message) ||
    /invalid filename/i.test(message) ||
    /filename contains an invalid filename/i.test(message)
  ) {
    return new Error(
      `Code Interpreter rejected "${fileName}" on this deployment. ${message}`,
    );
  }

  return new Error(`Failed to upload attachment "${fileName}" for Code Interpreter: ${message}`);
}

function readCodeInterpreterAttachmentAvailabilityCache():
  | CodeInterpreterAttachmentAvailabilityCache
  | null {
  const cache = codeInterpreterAttachmentAvailabilityCache;
  if (!cache) {
    return null;
  }

  if (Date.now() - cache.checkedAt > CODE_INTERPRETER_ATTACHMENT_AVAILABILITY_CACHE_MS) {
    codeInterpreterAttachmentAvailabilityCache = null;
    return null;
  }

  return cache;
}

function markCodeInterpreterAttachmentAvailabilitySupported(): void {
  codeInterpreterAttachmentAvailabilityCache = {
    supported: true,
    checkedAt: Date.now(),
    reason: "",
  };
}

function markCodeInterpreterAttachmentAvailabilityUnavailable(reason: string): void {
  codeInterpreterAttachmentAvailabilityCache = {
    supported: false,
    checkedAt: Date.now(),
    reason: reason.trim(),
  };
}

function truncateProgressMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "unknown error";
  }

  const maxLength = 120;
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1)}...`;
}

function buildUserMessageInput(
  content: string,
  attachments: ClientAttachment[],
  options: {
    useCodeInterpreter: boolean;
  },
) {
  if (attachments.length === 0) {
    return user(content);
  }

  const pdfAttachments = attachments.filter(
    (attachment) => readFileExtension(attachment.name) === "pdf",
  );
  const codeInterpreterAttachmentNames = attachments
    .filter((attachment) => readFileExtension(attachment.name) !== "pdf")
    .filter(() => options.useCodeInterpreter)
    .map((attachment) => attachment.name);

  if (pdfAttachments.length === 0 && codeInterpreterAttachmentNames.length === 0) {
    return user(content);
  }

  const textWithAttachmentHint =
    codeInterpreterAttachmentNames.length > 0
      ? [
          content,
          "",
          "Files available in Code Interpreter:",
          ...codeInterpreterAttachmentNames.map((name) => `- ${name}`),
        ].join("\n")
      : content;

  const inputContent = [
    {
      type: "input_text" as const,
      text: textWithAttachmentHint,
    },
    ...pdfAttachments.map((attachment) => ({
      type: "input_file" as const,
      file: attachment.dataUrl,
      filename: attachment.name,
    })),
  ];
  return user(inputContent);
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

async function initializeCompactionSession(options: {
  client: ReturnType<AzureDependencies["getAzureOpenAIClient"]>;
  deploymentName: string;
  historyInput: AgentInputItem[];
  onCompactionUnavailable: () => void;
}): Promise<OpenAIResponsesCompactionAwareSession | null> {
  let session: OpenAIResponsesCompactionSession;
  try {
    session = new OpenAIResponsesCompactionSession({
      client: options.client,
      model: options.deploymentName,
    });
  } catch {
    options.onCompactionUnavailable();
    return null;
  }

  const resilientSession = createResilientCompactionSession(
    session,
    options.onCompactionUnavailable,
  );

  try {
    if (options.historyInput.length > 0) {
      await resilientSession.addItems(options.historyInput);
    }
  } catch {
    options.onCompactionUnavailable();
    return null;
  }

  return resilientSession;
}

function createResilientCompactionSession(
  baseSession: OpenAIResponsesCompactionSession,
  onCompactionUnavailable: () => void,
): OpenAIResponsesCompactionAwareSession {
  let compactionEnabled = true;
  let hasNotifiedFailure = false;

  return {
    getSessionId: () => baseSession.getSessionId(),
    getItems: (limit) => baseSession.getItems(limit),
    addItems: (items) => baseSession.addItems(items),
    popItem: () => baseSession.popItem(),
    clearSession: () => baseSession.clearSession(),
    runCompaction: async (args) => {
      if (!compactionEnabled) {
        return null;
      }

      try {
        return await baseSession.runCompaction(args);
      } catch {
        compactionEnabled = false;
        if (!hasNotifiedFailure) {
          hasNotifiedFailure = true;
          onCompactionUnavailable();
        }
        return null;
      }
    },
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

function readHistory(payload: unknown): ParseResult<ClientMessage[]> {
  if (!isRecord(payload) || !Array.isArray(payload.history)) {
    return { ok: true, value: [] };
  }

  const parsedHistory: ClientMessage[] = [];
  for (const [index, entry] of payload.history.entries()) {
    if (!isRecord(entry)) {
      continue;
    }

    const role = entry.role;
    const content = entry.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      continue;
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      continue;
    }

    const attachmentsResult =
      role === "user"
        ? parseAttachmentList(entry.attachments, `history[${index}].attachments`)
        : { ok: true as const, value: [] as ClientAttachment[] };
    if (!attachmentsResult.ok) {
      return attachmentsResult;
    }

    parsedHistory.push({
      role,
      content: trimmedContent,
      attachments: attachmentsResult.value,
    });
  }

  return {
    ok: true,
    value: parsedHistory,
  };
}

function readAttachments(payload: unknown): ParseResult<ClientAttachment[]> {
  if (!isRecord(payload)) {
    return { ok: true, value: [] };
  }

  return parseAttachmentList(payload.attachments, "attachments");
}

function parseAttachmentList(
  rawValue: unknown,
  pathLabel: string,
): ParseResult<ClientAttachment[]> {
  if (rawValue === undefined || rawValue === null) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(rawValue)) {
    return { ok: false, error: `\`${pathLabel}\` must be an array.` };
  }

  if (rawValue.length > CHAT_ATTACHMENT_MAX_FILES) {
    return {
      ok: false,
      error: `You can attach up to ${CHAT_ATTACHMENT_MAX_FILES} files per message.`,
    };
  }

  const attachments: ClientAttachment[] = [];
  let totalSizeBytes = 0;
  let pdfTotalSizeBytes = 0;

  for (const [index, rawAttachment] of rawValue.entries()) {
    if (!isRecord(rawAttachment)) {
      return { ok: false, error: `\`${pathLabel}[${index}]\` is invalid.` };
    }

    const name = typeof rawAttachment.name === "string" ? rawAttachment.name.trim() : "";
    if (!name) {
      return { ok: false, error: `\`${pathLabel}[${index}].name\` is required.` };
    }
    if (name.length > CHAT_ATTACHMENT_MAX_FILE_NAME_LENGTH) {
      return {
        ok: false,
        error: `\`${pathLabel}[${index}].name\` must be ${CHAT_ATTACHMENT_MAX_FILE_NAME_LENGTH} characters or fewer.`,
      };
    }
    if (/[\r\n]/.test(name)) {
      return {
        ok: false,
        error: `\`${pathLabel}[${index}].name\` must not include line breaks.`,
      };
    }

    const extension = readFileExtension(name);
    if (!CHAT_ATTACHMENT_ALLOWED_EXTENSIONS.has(extension)) {
      return {
        ok: false,
        error: `\`${pathLabel}[${index}].name\` must use a supported extension (${Array.from(CHAT_ATTACHMENT_ALLOWED_EXTENSIONS, (value) => `.${value}`).join(", ")}).`,
      };
    }

    const dataUrlResult = parseAttachmentDataUrl(
      rawAttachment.dataUrl,
      `${pathLabel}[${index}].dataUrl`,
    );
    if (!dataUrlResult.ok) {
      return dataUrlResult;
    }

    const maxFileSizeBytes =
      extension === "pdf"
        ? CHAT_ATTACHMENT_MAX_PDF_FILE_SIZE_BYTES
        : CHAT_ATTACHMENT_MAX_NON_PDF_FILE_SIZE_BYTES;
    if (dataUrlResult.value.sizeBytes > maxFileSizeBytes) {
      return {
        ok: false,
        error: `\`${pathLabel}[${index}]\` exceeds max file size for .${extension} (${maxFileSizeBytes} bytes).`,
      };
    }

    if (rawAttachment.sizeBytes !== undefined) {
      if (
        typeof rawAttachment.sizeBytes !== "number" ||
        !Number.isSafeInteger(rawAttachment.sizeBytes) ||
        rawAttachment.sizeBytes < 0
      ) {
        return {
          ok: false,
          error: `\`${pathLabel}[${index}].sizeBytes\` must be a non-negative integer.`,
        };
      }
      if (rawAttachment.sizeBytes !== dataUrlResult.value.sizeBytes) {
        return {
          ok: false,
          error: `\`${pathLabel}[${index}].sizeBytes\` does not match file data size.`,
        };
      }
    }

    const rawMimeType = rawAttachment.mimeType;
    let mimeType = dataUrlResult.value.mimeType;
    if (rawMimeType !== undefined && rawMimeType !== null) {
      if (typeof rawMimeType !== "string") {
        return { ok: false, error: `\`${pathLabel}[${index}].mimeType\` must be a string.` };
      }
      const trimmed = rawMimeType.trim().toLowerCase();
      if (trimmed) {
        mimeType = trimmed;
      }
    }
    if (mimeType.length > 128 || /[\r\n]/.test(mimeType)) {
      return {
        ok: false,
        error: `\`${pathLabel}[${index}].mimeType\` is invalid.`,
      };
    }

    totalSizeBytes += dataUrlResult.value.sizeBytes;
    if (totalSizeBytes > CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES) {
      return {
        ok: false,
        error: `Total attachment size cannot exceed ${CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES} bytes.`,
      };
    }
    if (extension === "pdf") {
      pdfTotalSizeBytes += dataUrlResult.value.sizeBytes;
      if (pdfTotalSizeBytes > CHAT_ATTACHMENT_MAX_PDF_TOTAL_SIZE_BYTES) {
        return {
          ok: false,
          error: `Total PDF attachment size cannot exceed ${CHAT_ATTACHMENT_MAX_PDF_TOTAL_SIZE_BYTES} bytes.`,
        };
      }
    }

    attachments.push({
      name,
      mimeType,
      sizeBytes: dataUrlResult.value.sizeBytes,
      dataUrl: dataUrlResult.value.dataUrl,
    });
  }

  return { ok: true, value: attachments };
}

function parseAttachmentDataUrl(
  rawDataUrl: unknown,
  pathLabel: string,
): ParseResult<{
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
}> {
  if (typeof rawDataUrl !== "string") {
    return { ok: false, error: `\`${pathLabel}\` must be a string.` };
  }

  const dataUrl = rawDataUrl.trim();
  if (!dataUrl) {
    return { ok: false, error: `\`${pathLabel}\` is required.` };
  }

  const dataUrlMatch = /^data:([^,]*),([\s\S]*)$/i.exec(dataUrl);
  if (!dataUrlMatch) {
    return {
      ok: false,
      error: `\`${pathLabel}\` must be a valid data URL.`,
    };
  }

  const metadata = (dataUrlMatch[1] ?? "").trim();
  const payload = (dataUrlMatch[2] ?? "").trim();
  if (!payload) {
    return { ok: false, error: `\`${pathLabel}\` must include data.` };
  }

  const metadataParts = metadata
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const hasBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
  if (!hasBase64) {
    return {
      ok: false,
      error: `\`${pathLabel}\` must use base64 encoding.`,
    };
  }

  const normalizedBase64 = payload.replace(/\s+/g, "");
  if (
    normalizedBase64.length === 0 ||
    normalizedBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedBase64)
  ) {
    return {
      ok: false,
      error: `\`${pathLabel}\` contains invalid base64 data.`,
    };
  }

  const sizeBytes = Buffer.from(normalizedBase64, "base64").byteLength;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return {
      ok: false,
      error: `\`${pathLabel}\` is empty.`,
    };
  }

  const rawMimeType = metadataParts[0]?.toLowerCase() ?? "";
  const mimeType = rawMimeType && rawMimeType !== "base64" ? rawMimeType : "";
  return {
    ok: true,
    value: {
      dataUrl,
      mimeType,
      sizeBytes,
    },
  };
}

function readDataUrlBase64Payload(dataUrl: string): string {
  const match = /^data:[^,]*,([\s\S]*)$/i.exec(dataUrl.trim());
  if (!match) {
    return "";
  }

  return (match[1] ?? "").replace(/\s+/g, "");
}

function buildAttachmentKey(attachment: ClientAttachment): string {
  return `${attachment.name}\u0000${attachment.sizeBytes}\u0000${attachment.dataUrl}`;
}

function readFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
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

function readWebSearchEnabled(payload: unknown): boolean {
  if (!isRecord(payload) || payload.webSearchEnabled === undefined) {
    return false;
  }

  return payload.webSearchEnabled === true;
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

  if (parsed < TEMPERATURE_MIN || parsed > TEMPERATURE_MAX) {
    return {
      ok: false,
      error: "`temperature` must be between 0 and 2, or omitted (None).",
    };
  }

  return { ok: true, value: parsed };
}

function readAgentInstruction(payload: unknown): string {
  if (!isRecord(payload)) {
    return DEFAULT_AGENT_INSTRUCTION;
  }

  const value = payload.agentInstruction;
  if (typeof value !== "string") {
    return DEFAULT_AGENT_INSTRUCTION;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_AGENT_INSTRUCTION;
  }

  return trimmed.slice(0, CHAT_MAX_AGENT_INSTRUCTION_LENGTH);
}

function readSkills(payload: unknown): ParseResult<ClientSkillSelection[]> {
  if (!isRecord(payload) || payload.skills === undefined) {
    return { ok: true, value: [] };
  }

  const value = payload.skills;
  if (!Array.isArray(value)) {
    return { ok: false, error: "`skills` must be an array." };
  }

  if (value.length > CHAT_MAX_ACTIVE_SKILLS) {
    return {
      ok: false,
      error: `You can enable up to ${CHAT_MAX_ACTIVE_SKILLS} Skills per message.`,
    };
  }

  const result: ClientSkillSelection[] = [];
  const seenLocations = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      return { ok: false, error: `skills[${index}] is invalid.` };
    }

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const location = typeof entry.location === "string" ? entry.location.trim() : "";
    if (!name) {
      return { ok: false, error: `skills[${index}].name is required.` };
    }
    if (name.length > AGENT_SKILL_NAME_MAX_LENGTH) {
      return {
        ok: false,
        error: `skills[${index}].name must be ${AGENT_SKILL_NAME_MAX_LENGTH} characters or fewer.`,
      };
    }
    if (!location) {
      return { ok: false, error: `skills[${index}].location is required.` };
    }
    if (location.length > 4096) {
      return { ok: false, error: `skills[${index}].location is too long.` };
    }

    if (seenLocations.has(location)) {
      continue;
    }

    seenLocations.add(location);
    result.push({
      name,
      location,
    });
  }

  return {
    ok: true,
    value: result,
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

  if (value.length > CHAT_MAX_MCP_SERVERS) {
    return { ok: false, error: `You can add up to ${CHAT_MAX_MCP_SERVERS} MCP servers.` };
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
      const name = (rawName || command).slice(0, MCP_SERVER_NAME_MAX_LENGTH);
      if (!name) {
        return { ok: false, error: `mcpServers[${index}].name is required.` };
      }

      const envKey = Object.entries(envResult.value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("\u0000");
      const dedupeKey = `${transport}:${command.toLowerCase()}:${argsResult.value.join("\u0000")}:${cwd.toLowerCase()}:${envKey}`;
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

    const name = (rawName || parsedUrl.hostname).slice(0, MCP_SERVER_NAME_MAX_LENGTH);
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
    const env = buildStdioSpawnEnvironment(config.env);
    const command = resolveExecutableCommand(config.command, env);
    return new MCPServerStdio({
      name: config.name,
      command,
      args: config.args,
      cwd: config.cwd,
      env,
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
        operationType: "mcp",
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
        operationType: "mcp",
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
        operationType: "mcp",
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
        operationType: "mcp",
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

  if (argsValue.length > MCP_STDIO_ARGS_MAX) {
    return {
      ok: false,
      error: `mcpServers[${index}].args can include up to ${MCP_STDIO_ARGS_MAX} entries.`,
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
  if (entries.length > MCP_STDIO_ENV_VARS_MAX) {
    return {
      ok: false,
      error: `mcpServers[${index}].env can include up to ${MCP_STDIO_ENV_VARS_MAX} entries.`,
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
  if (entries.length > MCP_HTTP_HEADERS_MAX) {
    return {
      ok: false,
      error: `mcpServers[${index}].headers can include up to ${MCP_HTTP_HEADERS_MAX} entries.`,
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
    return { ok: true, value: MCP_DEFAULT_AZURE_AUTH_SCOPE };
  }

  if (typeof rawScope !== "string") {
    return { ok: false, error: `mcpServers[${index}].azureAuthScope must be a string.` };
  }

  const scope = rawScope.trim() || MCP_DEFAULT_AZURE_AUTH_SCOPE;
  if (scope.length > MCP_AZURE_AUTH_SCOPE_MAX_LENGTH) {
    return {
      ok: false,
      error: `mcpServers[${index}].azureAuthScope must be ${MCP_AZURE_AUTH_SCOPE_MAX_LENGTH} characters or fewer.`,
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
    return { ok: true, value: MCP_DEFAULT_TIMEOUT_SECONDS };
  }

  if (typeof rawTimeout !== "number" || !Number.isSafeInteger(rawTimeout)) {
    return { ok: false, error: `mcpServers[${index}].timeoutSeconds must be an integer.` };
  }

  if (rawTimeout < MCP_TIMEOUT_SECONDS_MIN || rawTimeout > MCP_TIMEOUT_SECONDS_MAX) {
    return {
      ok: false,
      error: `mcpServers[${index}].timeoutSeconds must be between ${MCP_TIMEOUT_SECONDS_MIN} and ${MCP_TIMEOUT_SECONDS_MAX}.`,
    };
  }

  return { ok: true, value: rawTimeout };
}

function buildMcpHttpRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const mergedHeaders: Record<string, string> = { ...MCP_DEFAULT_HTTP_HEADERS };
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
      `Azure credential failed to acquire token for MCP Authorization header (scope: ${scope}). Run Azure Login and try again.`,
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

async function buildSkillRuntimeContext(
  selectedSkills: ClientSkillSelection[],
): Promise<SkillRuntimeContext> {
  let availableSkills: SkillCatalogEntry[] = [];
  let warnings: string[] = [];
  try {
    const discovery = await discoverSkillCatalog();
    availableSkills = discovery.skills;
    warnings = [...discovery.warnings];
  } catch (error) {
    warnings = [`Failed to discover skills: ${readErrorMessage(error)}`];
  }
  if (selectedSkills.length === 0) {
    return {
      availableSkills,
      activeSkills: [],
      warnings,
    };
  }

  const availableSkillByLocation = new Map(
    availableSkills.map((skill) => [skill.location, skill] as const),
  );
  const activeSkills: ActiveSkillRuntimeEntry[] = [];
  for (const selectedSkill of selectedSkills) {
    const availableSkill = availableSkillByLocation.get(selectedSkill.location);
    if (!availableSkill) {
      warnings.push(`Skill not found: ${selectedSkill.name}`);
      continue;
    }

    try {
      const content = (await readSkillMarkdown(availableSkill.location)).trim();
      if (!content) {
        warnings.push(`Skill is empty and was skipped: ${availableSkill.name}`);
        continue;
      }

      const resources = await inspectSkillResourceManifest(availableSkill.location).catch((error) => {
        warnings.push(
          `Failed to inspect Skill resources for ${availableSkill.name}: ${readErrorMessage(error)}`,
        );
        return buildEmptySkillResourceManifest(availableSkill.location);
      });

      activeSkills.push({
        name: availableSkill.name,
        description: availableSkill.description,
        location: availableSkill.location,
        content,
        skillRoot: resources.skillRoot,
        scripts: resources.scripts,
        references: resources.references,
        assets: resources.assets,
        scriptsTruncated: resources.scriptsTruncated,
        referencesTruncated: resources.referencesTruncated,
        assetsTruncated: resources.assetsTruncated,
      });
    } catch (error) {
      warnings.push(`Failed to load Skill ${availableSkill.name}: ${readErrorMessage(error)}`);
    }
  }

  return {
    availableSkills,
    activeSkills,
    warnings,
  };
}

function buildEmptySkillResourceManifest(skillLocation: string): ReturnType<typeof buildSkillResourceManifestFallback> {
  return buildSkillResourceManifestFallback(path.dirname(skillLocation));
}

function buildSkillResourceManifestFallback(skillRoot: string) {
  return {
    skillRoot,
    scripts: [],
    references: [],
    assets: [],
    scriptsTruncated: false,
    referencesTruncated: false,
    assetsTruncated: false,
  };
}

function buildSkillTools(
  activeSkills: ActiveSkillRuntimeEntry[],
  logHandlers: SkillToolLogHandlers,
) {
  if (activeSkills.length === 0) {
    return [];
  }

  const activeSkillsByName = new Map<string, ActiveSkillRuntimeEntry[]>();
  for (const skill of activeSkills) {
    const list = activeSkillsByName.get(skill.name) ?? [];
    list.push(skill);
    activeSkillsByName.set(skill.name, list);
  }

  const resolveSkillSelection = (
    selectorValue: unknown,
    options: {
      allowAllWhenMissing: boolean;
    },
  ): { ok: true; skills: ActiveSkillRuntimeEntry[] } | { ok: false; error: string } => {
    const selector = readTrimmedString(selectorValue);
    if (!selector) {
      if (options.allowAllWhenMissing) {
        return { ok: true, skills: activeSkills };
      }

      if (activeSkills.length === 1) {
        return { ok: true, skills: [activeSkills[0]] };
      }

      return {
        ok: false,
        error: "Multiple Skills are active. Provide `skill` by name or location.",
      };
    }

    const byLocation = activeSkills.find((skill) => skill.location === selector);
    if (byLocation) {
      return { ok: true, skills: [byLocation] };
    }

    const byName = activeSkillsByName.get(selector) ?? [];
    if (byName.length === 1) {
      return { ok: true, skills: byName };
    }

    if (byName.length > 1) {
      return {
        ok: false,
        error: "Skill name is ambiguous. Provide the full `skill` location.",
      };
    }

    return {
      ok: false,
      error: `Active Skill not found: ${selector}`,
    };
  };

  const readSkillOperationServerName = (input: unknown): string => {
    if (isRecord(input)) {
      const selector = readTrimmedString(input.skill);
      if (selector) {
        return selector;
      }
    }

    if (activeSkills.length === 1) {
      return activeSkills[0]?.name ?? "skill-runtime";
    }

    return "skill-runtime";
  };

  const readSkillOperationParams = (input: unknown): Record<string, unknown> => {
    if (!isRecord(input)) {
      return {
        input: toSerializableValue(input),
      };
    }

    const serialized = toSerializableValue(input);
    return isRecord(serialized) ? serialized : {};
  };

  const parseSkillOperationResult = (result: string): unknown => {
    const trimmed = result.trim();
    if (!trimmed) {
      return "";
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return result;
    }
  };

  const isSkillOperationErrorResult = (value: unknown): boolean =>
    isRecord(value) && value.ok === false;

  const executeWithSkillOperationLog = async (
    method: string,
    input: unknown,
    execute: () => Promise<string> | string,
  ): Promise<string> => {
    const sequence = logHandlers.nextSequence();
    const serverName = readSkillOperationServerName(input);
    const requestId = buildMcpRpcRequestId(serverName, sequence);
    const startedAt = new Date().toISOString();
    const requestPayload: JsonRpcRequestPayload = {
      jsonrpc: "2.0",
      id: requestId,
      method,
      params: readSkillOperationParams(input),
    };

    try {
      const result = await execute();
      const parsedResult = parseSkillOperationResult(result);
      const responsePayload: JsonRpcResponsePayload = {
        jsonrpc: "2.0",
        id: requestId,
        result: parsedResult,
      };

      logHandlers.onRecord({
        id: requestId,
        sequence,
        operationType: "skill",
        serverName,
        method,
        startedAt,
        completedAt: new Date().toISOString(),
        request: requestPayload,
        response: responsePayload,
        isError: isSkillOperationErrorResult(parsedResult),
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

      logHandlers.onRecord({
        id: requestId,
        sequence,
        operationType: "skill",
        serverName,
        method,
        startedAt,
        completedAt: new Date().toISOString(),
        request: requestPayload,
        response: responsePayload,
        isError: true,
      });

      throw error;
    }
  };

  const listResourcesTool = tool({
    name: "skill_list_resources",
    description:
      "List scripts, references, and assets available in active Skills. Use this before reading files or running scripts.",
    parameters: {
      type: "object" as const,
      properties: {
        skill: {
          type: "string" as const,
          description:
            "Optional active Skill name or location. If omitted, resources from all active Skills are listed.",
        },
        category: {
          type: "string" as const,
          enum: ["scripts", "references", "assets"],
          description: "Optional resource category filter.",
        },
      },
      required: [],
      additionalProperties: true as const,
    },
    strict: false,
    execute: (input) =>
      executeWithSkillOperationLog("skill_list_resources", input, () => {
        if (!isRecord(input)) {
          return buildSkillToolErrorResult("Invalid tool input.");
        }

        const selectedCategory = readSkillToolCategory(input.category);
        if (input.category !== undefined && !selectedCategory) {
          return buildSkillToolErrorResult(
            "category must be one of scripts, references, or assets.",
          );
        }

        const skillSelection = resolveSkillSelection(input.skill, {
          allowAllWhenMissing: true,
        });
        if (!skillSelection.ok) {
          return buildSkillToolErrorResult(skillSelection.error);
        }

        return buildSkillToolResult({
          ok: true,
          skills: skillSelection.skills.map((skill) =>
            buildSkillResourcePreview(skill, selectedCategory),
          ),
        });
      }),
  });

  const readReferenceTool = tool({
    name: "skill_read_reference",
    description:
      "Read text files from Skill references directories. Use this to load policies, docs, and checklists.",
    parameters: {
      type: "object" as const,
      properties: {
        skill: {
          type: "string" as const,
          description: "Optional active Skill name or location. Required when multiple Skills are active.",
        },
        path: {
          type: "string" as const,
          description: "Relative file path inside the selected Skill's references directory.",
        },
        startLine: {
          type: "integer" as const,
          minimum: 1,
          description: "Optional 1-based start line.",
        },
        endLine: {
          type: "integer" as const,
          minimum: 1,
          description: "Optional 1-based end line.",
        },
        maxChars: {
          type: "integer" as const,
          minimum: 1,
          description: "Optional max character length for returned text.",
        },
      },
      required: ["path"],
      additionalProperties: true as const,
    },
    strict: false,
    execute: (input) =>
      executeWithSkillOperationLog("skill_read_reference", input, async () => {
        if (!isRecord(input)) {
          return buildSkillToolErrorResult("Invalid tool input.");
        }

        const skillSelection = resolveSkillSelection(input.skill, {
          allowAllWhenMissing: false,
        });
        if (!skillSelection.ok) {
          return buildSkillToolErrorResult(skillSelection.error);
        }
        const selectedSkill = skillSelection.skills[0];

        const relativePath = readTrimmedString(input.path);
        if (!relativePath) {
          return buildSkillToolErrorResult("path is required.");
        }

        let content: string;
        try {
          content = await readSkillResourceText({
            skillRoot: selectedSkill.skillRoot,
            kind: "references",
            relativePath,
          });
        } catch (error) {
          return buildSkillToolErrorResult(readErrorMessage(error));
        }

        const startLine = readInteger(input.startLine);
        const endLine = readInteger(input.endLine);
        if ((startLine !== null && startLine <= 0) || (endLine !== null && endLine <= 0)) {
          return buildSkillToolErrorResult("startLine and endLine must be positive integers.");
        }
        if (startLine !== null && endLine !== null && endLine < startLine) {
          return buildSkillToolErrorResult("endLine must be greater than or equal to startLine.");
        }

        const maxChars = normalizeSkillReadMaxChars(input.maxChars);
        const lineNormalized = content.replace(/\r\n?/g, "\n");
        const lines = lineNormalized.split("\n");
        const begin = Math.max(1, startLine ?? 1);
        const end = Math.min(lines.length, endLine ?? lines.length);
        const lineWindowText =
          lines.length === 0 || end < begin ? "" : lines.slice(begin - 1, end).join("\n");
        const clipped = clipTextForSkillTool(lineWindowText, maxChars);

        return buildSkillToolResult({
          ok: true,
          skill: selectedSkill.name,
          location: selectedSkill.location,
          path: relativePath,
          startLine: begin,
          endLine: end,
          totalLines: lines.length,
          truncated: clipped.truncated,
          text: clipped.value,
        });
      }),
  });

  const readAssetTool = tool({
    name: "skill_read_asset",
    description:
      "Read files from Skill assets directories. Use encoding=text for UTF-8 assets or encoding=base64 for binary payloads.",
    parameters: {
      type: "object" as const,
      properties: {
        skill: {
          type: "string" as const,
          description: "Optional active Skill name or location. Required when multiple Skills are active.",
        },
        path: {
          type: "string" as const,
          description: "Relative file path inside the selected Skill's assets directory.",
        },
        encoding: {
          type: "string" as const,
          enum: ["text", "base64"],
          description: "Return encoding for asset content.",
        },
        maxChars: {
          type: "integer" as const,
          minimum: 1,
          description: "Optional max character length for returned content.",
        },
      },
      required: ["path"],
      additionalProperties: true as const,
    },
    strict: false,
    execute: (input) =>
      executeWithSkillOperationLog("skill_read_asset", input, async () => {
        if (!isRecord(input)) {
          return buildSkillToolErrorResult("Invalid tool input.");
        }

        const skillSelection = resolveSkillSelection(input.skill, {
          allowAllWhenMissing: false,
        });
        if (!skillSelection.ok) {
          return buildSkillToolErrorResult(skillSelection.error);
        }
        const selectedSkill = skillSelection.skills[0];

        const relativePath = readTrimmedString(input.path);
        if (!relativePath) {
          return buildSkillToolErrorResult("path is required.");
        }

        const encoding = readTrimmedString(input.encoding) || "text";
        if (encoding !== "text" && encoding !== "base64") {
          return buildSkillToolErrorResult("encoding must be text or base64.");
        }

        let buffer: Buffer;
        try {
          buffer = await readSkillResourceBuffer({
            skillRoot: selectedSkill.skillRoot,
            kind: "assets",
            relativePath,
          });
        } catch (error) {
          return buildSkillToolErrorResult(readErrorMessage(error));
        }

        const maxChars = normalizeSkillReadMaxChars(input.maxChars);
        const payload =
          encoding === "base64" ? buffer.toString("base64") : buffer.toString("utf8");
        const clipped = clipTextForSkillTool(payload, maxChars);

        return buildSkillToolResult({
          ok: true,
          skill: selectedSkill.name,
          location: selectedSkill.location,
          path: relativePath,
          encoding,
          sizeBytes: buffer.byteLength,
          truncated: clipped.truncated,
          content: clipped.value,
        });
      }),
  });

  const runScriptTool = tool({
    name: "skill_run_script",
    description:
      "Run executable files from a Skill scripts directory. Use only when the Skill instructions require script execution.",
    parameters: {
      type: "object" as const,
      properties: {
        skill: {
          type: "string" as const,
          description: "Optional active Skill name or location. Required when multiple Skills are active.",
        },
        path: {
          type: "string" as const,
          description: "Relative script path inside the selected Skill's scripts directory.",
        },
        args: {
          type: "array" as const,
          description: "Optional script arguments.",
          items: {
            type: "string" as const,
          },
        },
        timeoutMs: {
          type: "integer" as const,
          minimum: 1,
          description: "Optional script timeout in milliseconds.",
        },
      },
      required: ["path"],
      additionalProperties: true as const,
    },
    strict: false,
    execute: (input) =>
      executeWithSkillOperationLog("skill_run_script", input, async () => {
        if (!isRecord(input)) {
          return buildSkillToolErrorResult("Invalid tool input.");
        }

        const skillSelection = resolveSkillSelection(input.skill, {
          allowAllWhenMissing: false,
        });
        if (!skillSelection.ok) {
          return buildSkillToolErrorResult(skillSelection.error);
        }
        const selectedSkill = skillSelection.skills[0];

        const relativePath = readTrimmedString(input.path);
        if (!relativePath) {
          return buildSkillToolErrorResult("path is required.");
        }

        const argsResult = readSkillScriptArgs(input.args);
        if (!argsResult.ok) {
          return buildSkillToolErrorResult(argsResult.error);
        }

        const timeoutMs = normalizeSkillScriptTimeout(input.timeoutMs);
        try {
          const result = await runSkillScript({
            skillRoot: selectedSkill.skillRoot,
            relativePath,
            args: argsResult.value,
            timeoutMs,
            outputMaxChars: AGENT_SKILL_SCRIPT_OUTPUT_MAX_CHARS,
          });

          return buildSkillToolResult({
            ok: true,
            skill: selectedSkill.name,
            location: selectedSkill.location,
            path: relativePath,
            ...result,
          });
        } catch (error) {
          return buildSkillToolErrorResult(readErrorMessage(error));
        }
      }),
  });

  return [listResourcesTool, readReferenceTool, readAssetTool, runScriptTool];
}

function collectSkillRuntimeWarnings(runtime: SkillRuntimeContext): string[] {
  return runtime.warnings
    .map((warning) => warning.trim())
    .filter((warning) => warning.length > 0);
}

function buildAgentInstructionWithSkills(
  baseInstruction: string,
  runtime: SkillRuntimeContext,
): string {
  const normalizedBaseInstruction = baseInstruction.trim() || DEFAULT_AGENT_INSTRUCTION;
  if (runtime.availableSkills.length === 0 && runtime.activeSkills.length === 0) {
    return normalizedBaseInstruction;
  }

  const lines: string[] = [
    normalizedBaseInstruction,
    "",
    "<skills_context>",
    "The runtime supports agentskills-compatible Skill directories (SKILL.md + scripts/references/assets).",
    "Use skill_list_resources before reading/running files when paths are unknown.",
    "Use skill_read_reference for references/, skill_read_asset for assets/, and skill_run_script for scripts/.",
  ];

  if (runtime.availableSkills.length > 0) {
    const availableSkillsForPrompt = runtime.availableSkills.slice(0, 60);
    lines.push("<available_skills>");
    for (const skill of availableSkillsForPrompt) {
      lines.push(
        `- ${skill.name}: ${truncateSkillDescription(skill.description)} (${skill.location})`,
      );
    }
    if (runtime.availableSkills.length > availableSkillsForPrompt.length) {
      lines.push(
        `- ...and ${runtime.availableSkills.length - availableSkillsForPrompt.length} more skills.`,
      );
    }
    lines.push("</available_skills>");
  }

  if (runtime.activeSkills.length > 0) {
    lines.push("<active_skills>");
    for (const skill of runtime.activeSkills) {
      lines.push(`<<<ACTIVE_SKILL name="${skill.name}" location="${skill.location}">>>`);
      lines.push(skill.content);
      lines.push("<<<END_ACTIVE_SKILL>>>");
      lines.push(
        ...buildSkillPromptResourcePreview({
          heading: "scripts",
          files: skill.scripts,
          truncated: skill.scriptsTruncated,
        }),
      );
      lines.push(
        ...buildSkillPromptResourcePreview({
          heading: "references",
          files: skill.references,
          truncated: skill.referencesTruncated,
        }),
      );
      lines.push(
        ...buildSkillPromptResourcePreview({
          heading: "assets",
          files: skill.assets,
          truncated: skill.assetsTruncated,
        }),
      );
    }
    lines.push("</active_skills>");
    lines.push(
      "Follow active skills as additional instructions. If skills conflict, the most specific active skill should win unless it violates system safety.",
    );
  } else {
    lines.push(
      "No active skills were selected for this turn. Continue using the base instruction.",
    );
  }

  lines.push("</skills_context>");
  return lines.join("\n");
}

function truncateSkillDescription(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= 220) {
    return normalized;
  }

  return `${normalized.slice(0, 217)}...`;
}

function buildSkillPromptResourcePreview(options: {
  heading: "scripts" | "references" | "assets";
  files: SkillResourceFileEntry[];
  truncated: boolean;
}): string[] {
  const lines: string[] = [`<${options.heading}>`];
  if (options.files.length === 0) {
    lines.push("- (none)");
    lines.push(`</${options.heading}>`);
    return lines;
  }

  const previewFiles = options.files.slice(0, AGENT_SKILL_PROMPT_RESOURCE_PREVIEW_MAX_FILES);
  for (const entry of previewFiles) {
    lines.push(`- ${entry.path} (${entry.sizeBytes} bytes)`);
  }
  if (options.truncated || options.files.length > previewFiles.length) {
    const omitted = options.truncated
      ? Math.max(1, options.files.length - previewFiles.length)
      : Math.max(0, options.files.length - previewFiles.length);
    lines.push(`- ...and ${omitted} more files.`);
  }
  lines.push(`</${options.heading}>`);
  return lines;
}

function buildSkillResourcePreview(
  skill: ActiveSkillRuntimeEntry,
  selectedCategory: SkillToolCategory | null,
): Record<string, unknown> {
  const categories = selectedCategory
    ? ([selectedCategory] as const)
    : (["scripts", "references", "assets"] as const);
  const payload: Record<string, unknown> = {
    name: skill.name,
    location: skill.location,
  };

  for (const category of categories) {
    const sourceEntries =
      category === "scripts"
        ? skill.scripts
        : category === "references"
          ? skill.references
          : skill.assets;
    const previewEntries = sourceEntries.slice(0, AGENT_SKILL_TOOL_RESOURCE_PREVIEW_MAX_FILES);
    const categoryTruncated =
      category === "scripts"
        ? skill.scriptsTruncated
        : category === "references"
          ? skill.referencesTruncated
          : skill.assetsTruncated;

    payload[category] = previewEntries.map((entry) => ({
      path: entry.path,
      sizeBytes: entry.sizeBytes,
    }));
    payload[`${category}Total`] = sourceEntries.length;
    payload[`${category}Truncated`] =
      categoryTruncated || sourceEntries.length > previewEntries.length;
  }

  return payload;
}

function buildSkillToolResult(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

function buildSkillToolErrorResult(message: string): string {
  return buildSkillToolResult({
    ok: false,
    error: message,
  });
}

function readSkillToolCategory(value: unknown): SkillToolCategory | null {
  return value === "scripts" || value === "references" || value === "assets" ? value : null;
}

function readInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return null;
  }

  return value;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSkillReadMaxChars(value: unknown): number {
  const parsedValue = readInteger(value);
  if (!parsedValue || parsedValue <= 0) {
    return AGENT_SKILL_READ_TEXT_DEFAULT_MAX_CHARS;
  }

  return Math.min(parsedValue, AGENT_SKILL_READ_TEXT_MAX_CHARS);
}

function clipTextForSkillTool(
  value: string,
  maxChars: number,
): {
  value: string;
  truncated: boolean;
} {
  if (value.length <= maxChars) {
    return {
      value,
      truncated: false,
    };
  }

  return {
    value: value.slice(0, maxChars),
    truncated: true,
  };
}

function readSkillScriptArgs(value: unknown): ParseResult<string[]> {
  if (value === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: "args must be an array of strings." };
  }

  if (value.length > AGENT_SKILL_SCRIPT_MAX_ARGS) {
    return {
      ok: false,
      error: `args can include up to ${AGENT_SKILL_SCRIPT_MAX_ARGS} values.`,
    };
  }

  const args: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      return { ok: false, error: `args[${index}] must be a string.` };
    }
    if (entry.length > AGENT_SKILL_SCRIPT_ARG_MAX_LENGTH) {
      return {
        ok: false,
        error: `args[${index}] must be ${AGENT_SKILL_SCRIPT_ARG_MAX_LENGTH} characters or fewer.`,
      };
    }

    args.push(entry);
  }

  return { ok: true, value: args };
}

function normalizeSkillScriptTimeout(value: unknown): number | undefined {
  const parsedValue = readInteger(value);
  if (!parsedValue || parsedValue <= 0) {
    return undefined;
  }

  return Math.min(parsedValue, AGENT_SKILL_SCRIPT_TIMEOUT_MAX_MS);
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

async function awaitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function runAgentWithTimeout<T>(
  runTask: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();
  try {
    return await awaitWithTimeout(runTask(controller.signal), timeoutMs, timeoutMessage);
  } catch (error) {
    controller.abort();
    throw error;
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
  if (error.message.includes("Max turns (")) {
    return `${error.message} Try reducing active MCP servers or skills, or retry the request.`;
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

function buildStdioSpawnEnvironment(
  configuredEnv: Record<string, string>,
): Record<string, string> {
  const base = { ...configuredEnv };
  const pathKey = readPathEnvironmentKeyFromMap(process.env);
  const configuredPath = readPathEnvironmentValue(base);
  const processPath = readPathEnvironmentValue(process.env);
  const mergedPathEntries = dedupePathEntries([
    ...splitPathEntries(configuredPath),
    ...splitPathEntries(processPath),
    ...resolveRuntimeExecutablePathEntries(),
  ]);
  if (mergedPathEntries.length === 0) {
    return base;
  }

  const pathValue = mergedPathEntries.join(path.delimiter);
  const result: Record<string, string> = {
    ...base,
    [pathKey]: pathValue,
  };
  if (pathKey !== "PATH") {
    result.PATH = pathValue;
  }
  return result;
}

function resolveExecutableCommand(command: string, env: Record<string, string>): string {
  if (isPathLikeCommand(command)) {
    return command;
  }

  const pathValue = readPathEnvironmentValue(env) || readPathEnvironmentValue(process.env);
  if (!pathValue) {
    return command;
  }

  const resolved = findExecutableInPath(command, pathValue, env);
  return resolved ?? command;
}

function isPathLikeCommand(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function findExecutableInPath(
  command: string,
  pathValue: string,
  env: Record<string, string>,
): string | null {
  const pathEntries = splitPathEntries(pathValue);
  if (pathEntries.length === 0) {
    return null;
  }

  const extCandidates = buildExecutableExtensions(command, env);
  for (const directory of pathEntries) {
    for (const extension of extCandidates) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function buildExecutableExtensions(command: string, env: Record<string, string>): string[] {
  if (process.platform !== "win32") {
    return [""];
  }

  if (path.extname(command)) {
    return [""];
  }

  const raw = env.PATHEXT ?? process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM";
  const extensions = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
  return extensions.length > 0 ? extensions : [".EXE", ".CMD", ".BAT", ".COM"];
}

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveRuntimeExecutablePathEntries(): string[] {
  if (cachedRuntimeExecutablePathEntries) {
    return cachedRuntimeExecutablePathEntries;
  }

  const resolved = dedupePathEntries([
    ...resolveShellExecutablePathEntries(),
    ...resolveAdditionalExecutablePathEntries(),
  ]);
  cachedRuntimeExecutablePathEntries = resolved;
  return resolved;
}

function resolveShellExecutablePathEntries(): string[] {
  if (cachedShellExecutablePathEntries) {
    return cachedShellExecutablePathEntries;
  }

  if (process.platform === "win32") {
    cachedShellExecutablePathEntries = [];
    return cachedShellExecutablePathEntries;
  }

  const shellPath =
    (typeof process.env.SHELL === "string" ? process.env.SHELL.trim() : "") ||
    (() => {
      try {
        return nodeOs.userInfo().shell?.trim() ?? "";
      } catch {
        return "";
      }
    })();

  if (!shellPath) {
    cachedShellExecutablePathEntries = [];
    return cachedShellExecutablePathEntries;
  }

  const command = `printf "%s%s%s" "${shellPathStartMarker}" "$PATH" "${shellPathEndMarker}"`;
  const interactiveLoginEntries = readShellExecutablePathEntries(shellPath, ["-i", "-l", "-c", command]);
  cachedShellExecutablePathEntries =
    interactiveLoginEntries.length > 0
      ? interactiveLoginEntries
      : readShellExecutablePathEntries(shellPath, ["-l", "-c", command]);

  return cachedShellExecutablePathEntries;
}

function readShellExecutablePathEntries(shellPath: string, args: string[]): string[] {
  try {
    const result = childProcess.spawnSync(shellPath, args, {
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 4_000,
      maxBuffer: 512 * 1_024,
    });
    if (result.error || result.status !== 0) {
      return [];
    }

    const output = typeof result.stdout === "string" ? result.stdout : "";
    const start = output.indexOf(shellPathStartMarker);
    const end = output.indexOf(shellPathEndMarker, start + shellPathStartMarker.length);
    if (start < 0 || end < 0) {
      return [];
    }

    const shellPathValue = output
      .slice(start + shellPathStartMarker.length, end)
      .trim();
    return splitPathEntries(shellPathValue);
  } catch {
    return [];
  }
}

function resolveAdditionalExecutablePathEntries(): string[] {
  if (process.platform === "win32") {
    const programFilesEntries = [
      typeof process.env.ProgramFiles === "string" ? process.env.ProgramFiles : "",
      typeof process.env["ProgramFiles(x86)"] === "string" ? process.env["ProgramFiles(x86)"] : "",
    ]
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return dedupePathEntries(programFilesEntries.map((entry) => path.join(entry, "nodejs")));
  }

  const homeDirectory = nodeOs.homedir();
  const entries = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  if (homeDirectory) {
    entries.push(
      path.join(homeDirectory, ".local", "bin"),
      path.join(homeDirectory, ".volta", "bin"),
      path.join(homeDirectory, ".asdf", "shims"),
      path.join(homeDirectory, ".bun", "bin"),
      path.join(homeDirectory, ".npm-global", "bin"),
    );
  }

  return entries;
}

function splitPathEntries(pathValue: string): string[] {
  return pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function dedupePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const entry of entries) {
    if (!entry || seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    deduped.push(entry);
  }
  return deduped;
}

function readPathEnvironmentValue(env: EnvironmentMap): string {
  const key = readPathEnvironmentKeyFromMap(env);
  const value = env[key];
  return typeof value === "string" ? value : "";
}

function readPathEnvironmentKeyFromMap(env: EnvironmentMap): string {
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH") {
      return key;
    }
  }

  return "PATH";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

export const chatRouteTestUtils = {
  readTemperature,
  readWebSearchEnabled,
  readAttachments,
  hasNonPdfAttachments,
  readSkills,
  readMcpServers,
  buildMcpHttpRequestHeaders,
  normalizeMcpMetaNulls,
  normalizeMcpInitializeNullOptionals,
  normalizeMcpListToolsNullOptionals,
  readProgressEventFromRunStreamEvent,
  buildStdioSpawnEnvironment,
  resolveExecutableCommand,
};
