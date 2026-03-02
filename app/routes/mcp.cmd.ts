/**
 * MCP route module for /mcp/cmd shell command server.
 */
import childProcess from "node:child_process";
import fs from "node:fs";
import nodeOs from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as z from "zod/v4";
import {
  MCP_LOCAL_PLAYGROUND_THREAD_ID_HEADER,
  MCP_LOCAL_PLAYGROUND_TURN_ID_HEADER,
} from "~/lib/constants";
import { resolveLegacyFoundryConfigDirectory } from "~/lib/foundry/config";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/runtime-event-log";
import { getOrCreateUserByIdentity } from "~/lib/server/persistence/user";

const MCP_CMD_ROUTE_PATH = "/mcp/cmd";
const MCP_CMD_AUTH_REQUIRED_MESSAGE =
  "Authentication required. Click Azure Login in Settings and try again.";
const MCP_CMD_TOOL_NAME = "shell_execute_command";
const MCP_CMD_TOOL_DESCRIPTION = [
  "Executes an arbitrary shell command on the Local Playground host.",
  "Returns stdout/stderr, exit status, timeout state, execution duration, and resolved shell metadata.",
  "Safety policy: if this is the first command execution in a thread, ask the user for explicit consent in chat first.",
  "Then call again with confirmedByUser=true and confirmationMessage set to yes or no.",
  "Default working directory is ~/.foundry_local_playground/users/<user-id>/threads/<thread-id>/tmp.",
  "When threadContext.threadId is missing, explicit consent is required for every call and workingDirectory must be provided explicitly.",
].join("\n");

const MCP_CMD_DEFAULT_TIMEOUT_SECONDS = 120;
const MCP_CMD_MAX_TIMEOUT_SECONDS = 600;
const MCP_CMD_OUTPUT_MAX_BYTES = 1_000_000;
const MCP_CMD_MAX_COMMAND_LENGTH = 32_000;
const MCP_CMD_MAX_CONFIRMATION_MESSAGE_LENGTH = 4_000;
const THREAD_COMMAND_CONSENT_CACHE_MAX = 512;
const COMMAND_APPROVAL_CHOICES = ["yes", "no"] as const;

const cmdExecuteInputSchema = {
  threadId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional thread identifier supplied by the client. When provided, this value is used for first-run consent scope and default working directory resolution.",
    ),
  command: z
    .string()
    .min(1)
    .max(MCP_CMD_MAX_COMMAND_LENGTH)
    .describe(
      "Shell command to execute in the selected shell environment (for example: `ls -la`, `npm run test`, `git status`).",
    ),
  workingDirectory: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional working directory. Relative paths are resolved from the Local Playground process current directory. When omitted, uses ~/.foundry_local_playground/users/<user-id>/threads/<thread-id>/tmp.",
    ),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(MCP_CMD_MAX_TIMEOUT_SECONDS)
    .optional()
    .describe(
      `Execution timeout in seconds. Defaults to ${MCP_CMD_DEFAULT_TIMEOUT_SECONDS} (max ${MCP_CMD_MAX_TIMEOUT_SECONDS}).`,
    ),
  confirmedByUser: z
    .boolean()
    .optional()
    .describe(
      "Set true only after the user explicitly agreed to terminal command execution for this thread.",
    ),
  confirmationMessage: z
    .string()
    .min(1)
    .max(MCP_CMD_MAX_CONFIRMATION_MESSAGE_LENGTH)
    .optional()
    .describe(
      'User choice for command execution approval. Required when confirmedByUser=true and must be either "yes" or "no".',
    ),
};

type AuthenticatedMcpCmdContext = {
  userId: number;
  tenantId: string;
  principalId: string;
};

type McpCmdRequestContext = AuthenticatedMcpCmdContext & {
  threadId: string | null;
  turnId: string | null;
};

type ParsedCmdToolArguments = {
  threadId: string | null;
  command: string;
  workingDirectory: string | null;
  timeoutSeconds: number;
  confirmedByUser: boolean;
  confirmationMessage: string | null;
  confirmationChoice: "yes" | "no" | null;
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type CommandConsentResult =
  | {
      ok: true;
      scope: "thread" | "request";
      grantedInThisCall: boolean;
    }
  | {
      ok: false;
      scope: "thread" | "request";
      reason: string;
      nextCallArguments: {
        confirmedByUser: true;
        confirmationMessage: string;
      };
    };

type ShellFamily = "posix" | "powershell" | "cmd";

type ShellExecutionContext = {
  executable: string;
  argsPrefix: string[];
  probeArgs: string[];
  family: ShellFamily;
  source: string;
};

type OutputCollector = {
  chunks: Buffer[];
  size: number;
  truncated: boolean;
};

type CommandExecutionResult = {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
};

const threadCommandConsentMap = new Map<string, { grantedAt: string }>();

export async function loader({ request }: { request: Request }) {
  installGlobalServerErrorLogging();
  return handleMcpRequest(request);
}

export async function action({ request }: { request: Request }) {
  installGlobalServerErrorLogging();
  return handleMcpRequest(request);
}

async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: `Method not allowed. Use POST ${MCP_CMD_ROUTE_PATH}.`,
        },
        id: null,
      },
      { status: 405 },
    );
  }

  const authenticatedContext = await readAuthenticatedMcpCmdContext();
  if (!authenticatedContext) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: MCP_CMD_AUTH_REQUIRED_MESSAGE,
        },
        id: null,
      },
      { status: 401 },
    );
  }

  const requestContext = readMcpCmdRequestContext(request, authenticatedContext);
  const server = createCmdMcpServer(requestContext);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: MCP_CMD_ROUTE_PATH,
      eventName: "mcp_cmd_route_failed",
      action: "handle_mcp_request",
      statusCode: 500,
      error,
      userId: requestContext.userId,
      threadId: requestContext.threadId,
      context: {
        tenantId: requestContext.tenantId,
        principalId: requestContext.principalId,
        turnId: requestContext.turnId,
      },
    });

    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error.",
        },
        id: null,
      },
      { status: 500 },
    );
  } finally {
    await Promise.allSettled([
      transport.close(),
      server.close(),
    ]);
  }
}

function createCmdMcpServer(requestContext: McpCmdRequestContext): McpServer {
  const server = new McpServer({
    name: "local-playground-cmd",
    version: "1.0.0",
  });

  server.registerTool(
    MCP_CMD_TOOL_NAME,
    {
      description: MCP_CMD_TOOL_DESCRIPTION,
      inputSchema: cmdExecuteInputSchema,
    },
    async (args) => {
      const parsedArguments = parseCmdExecuteArguments(args);
      if (!parsedArguments.ok) {
        return buildToolResponse({
          executed: false,
          approvalRequired: false,
          error: parsedArguments.error,
          threadContext: {
            threadId: requestContext.threadId,
            turnId: requestContext.turnId,
          },
        }, { isError: true });
      }

      const commandArgs = parsedArguments.value;
      const effectiveThreadId = commandArgs.threadId ?? requestContext.threadId;
      const effectiveRequestContext: McpCmdRequestContext = {
        ...requestContext,
        threadId: effectiveThreadId,
      };
      if (commandArgs.confirmedByUser && commandArgs.confirmationChoice === "no") {
        return buildToolResponse({
          executed: false,
          approvalRequired: false,
          approvalDenied: true,
          reason: "User selected no. Command execution was canceled.",
          command: commandArgs.command,
          threadContext: {
            threadId: effectiveThreadId,
            turnId: requestContext.turnId,
          },
        });
      }
      const commandConsent = evaluateCommandExecutionConsent(
        effectiveRequestContext,
        commandArgs,
      );
      if (!commandConsent.ok) {
        const confirmationPromptMarkdown = buildCommandApprovalPromptMarkdown(commandArgs.command);
        return buildToolResponse({
          executed: false,
          approvalRequired: true,
          requiresUserConfirmation: true,
          reason: commandConsent.reason,
          confirmationPromptMarkdown,
          confirmationChoices: COMMAND_APPROVAL_CHOICES,
          consentScope: commandConsent.scope,
          threadContext: {
            threadId: effectiveThreadId,
            turnId: requestContext.turnId,
          },
          nextCallArguments: {
            ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
            command: commandArgs.command,
            workingDirectory: commandArgs.workingDirectory,
            timeoutSeconds: commandArgs.timeoutSeconds,
            ...commandConsent.nextCallArguments,
          },
        }, {
          isError: true,
          text: confirmationPromptMarkdown,
        });
      }

      const workingDirectoryResult = resolveWorkingDirectory(
        requestContext.userId,
        effectiveThreadId,
        commandArgs.workingDirectory,
      );
      if (!workingDirectoryResult.ok) {
        return buildToolResponse({
          executed: false,
          approvalRequired: false,
          error: workingDirectoryResult.error,
          threadContext: {
            threadId: effectiveThreadId,
            turnId: requestContext.turnId,
          },
        }, { isError: true });
      }

      const shellExecutionContext = resolveShellExecutionContext();
      if (!shellExecutionContext) {
        return buildToolResponse({
          executed: false,
          approvalRequired: false,
          error:
            "No available shell environment was found for this operating system. Configure SHELL/ComSpec and retry.",
          threadContext: {
            threadId: effectiveThreadId,
            turnId: requestContext.turnId,
          },
        }, { isError: true });
      }

      try {
        const executionResult = await runShellCommand({
          shellExecutionContext,
          command: commandArgs.command,
          workingDirectory: workingDirectoryResult.value,
          timeoutSeconds: commandArgs.timeoutSeconds,
        });

        return buildToolResponse({
          executed: true,
          approvalRequired: false,
          command: commandArgs.command,
          workingDirectory: workingDirectoryResult.value,
          timeoutSeconds: commandArgs.timeoutSeconds,
          threadContext: {
            threadId: effectiveThreadId,
            turnId: requestContext.turnId,
          },
          consentScope: commandConsent.scope,
          consentGrantedInThisCall: commandConsent.grantedInThisCall,
          stdout: executionResult.stdout,
          stderr: executionResult.stderr,
          stdoutTruncated: executionResult.stdoutTruncated,
          stderrTruncated: executionResult.stderrTruncated,
          exitCode: executionResult.exitCode,
          signal: executionResult.signal,
          timedOut: executionResult.timedOut,
          durationMs: executionResult.durationMs,
          shell: {
            executable: shellExecutionContext.executable,
            argsPrefix: shellExecutionContext.argsPrefix,
            family: shellExecutionContext.family,
            source: shellExecutionContext.source,
            platform: process.platform,
          },
        });
      } catch (error) {
        return buildToolResponse({
          executed: false,
          approvalRequired: false,
          command: commandArgs.command,
          workingDirectory: workingDirectoryResult.value,
          timeoutSeconds: commandArgs.timeoutSeconds,
          threadContext: {
            threadId: effectiveThreadId,
            turnId: requestContext.turnId,
          },
          shell: {
            executable: shellExecutionContext.executable,
            argsPrefix: shellExecutionContext.argsPrefix,
            family: shellExecutionContext.family,
            source: shellExecutionContext.source,
            platform: process.platform,
          },
          error: `Failed to execute command: ${readErrorMessage(error)}`,
        }, { isError: true });
      }
    },
  );

  return server;
}

function parseCmdExecuteArguments(value: unknown): ParseResult<ParsedCmdToolArguments> {
  if (!isRecord(value)) {
    return { ok: false, error: "Tool arguments must be a JSON object." };
  }

  const rawCommand = value.command;
  if (typeof rawCommand !== "string") {
    return { ok: false, error: "`command` must be a string." };
  }
  const command = rawCommand.trim();
  if (!command) {
    return { ok: false, error: "`command` must not be empty." };
  }
  if (command.length > MCP_CMD_MAX_COMMAND_LENGTH) {
    return {
      ok: false,
      error: `\`command\` must be ${MCP_CMD_MAX_COMMAND_LENGTH} characters or fewer.`,
    };
  }

  const rawWorkingDirectory = value.workingDirectory;
  let workingDirectory: string | null = null;
  if (rawWorkingDirectory !== undefined && rawWorkingDirectory !== null) {
    if (typeof rawWorkingDirectory !== "string") {
      return { ok: false, error: "`workingDirectory` must be a string when provided." };
    }

    const normalizedWorkingDirectory = rawWorkingDirectory.trim();
    if (normalizedWorkingDirectory.length > 0) {
      workingDirectory = normalizedWorkingDirectory;
    }
  }

  const timeoutSecondsResult = parseTimeoutSeconds(value.timeoutSeconds);
  if (!timeoutSecondsResult.ok) {
    return timeoutSecondsResult;
  }

  const confirmationResult = parseConfirmationInput(value);
  if (!confirmationResult.ok) {
    return confirmationResult;
  }

  const threadIdResult = parseThreadId(value.threadId);
  if (!threadIdResult.ok) {
    return threadIdResult;
  }

  return {
    ok: true,
    value: {
      threadId: threadIdResult.value,
      command,
      workingDirectory,
      timeoutSeconds: timeoutSecondsResult.value,
      confirmedByUser: confirmationResult.value.confirmedByUser,
      confirmationMessage: confirmationResult.value.confirmationMessage,
      confirmationChoice: confirmationResult.value.confirmationChoice,
    },
  };
}

function parseThreadId(rawThreadId: unknown): ParseResult<string | null> {
  if (rawThreadId === undefined || rawThreadId === null) {
    return { ok: true, value: null };
  }

  if (typeof rawThreadId !== "string") {
    return { ok: false, error: "`threadId` must be a string when provided." };
  }

  const threadId = rawThreadId.trim();
  if (!threadId) {
    return { ok: false, error: "`threadId` must not be empty when provided." };
  }

  return { ok: true, value: threadId };
}

function parseTimeoutSeconds(rawTimeoutSeconds: unknown): ParseResult<number> {
  if (rawTimeoutSeconds === undefined || rawTimeoutSeconds === null) {
    return { ok: true, value: MCP_CMD_DEFAULT_TIMEOUT_SECONDS };
  }

  if (typeof rawTimeoutSeconds !== "number" || !Number.isSafeInteger(rawTimeoutSeconds)) {
    return { ok: false, error: "`timeoutSeconds` must be an integer." };
  }

  if (rawTimeoutSeconds < 1 || rawTimeoutSeconds > MCP_CMD_MAX_TIMEOUT_SECONDS) {
    return {
      ok: false,
      error: `\`timeoutSeconds\` must be between 1 and ${MCP_CMD_MAX_TIMEOUT_SECONDS}.`,
    };
  }

  return { ok: true, value: rawTimeoutSeconds };
}

function parseConfirmationInput(
  value: Record<string, unknown>,
): ParseResult<Pick<ParsedCmdToolArguments, "confirmedByUser" | "confirmationMessage" | "confirmationChoice">> {
  const rawConfirmedByUser = value.confirmedByUser;
  const confirmedByUser = rawConfirmedByUser === true;
  if (rawConfirmedByUser !== undefined && typeof rawConfirmedByUser !== "boolean") {
    return { ok: false, error: "`confirmedByUser` must be a boolean when provided." };
  }

  const rawConfirmationMessage = value.confirmationMessage;
  let confirmationMessage: string | null = null;
  if (rawConfirmationMessage !== undefined && rawConfirmationMessage !== null) {
    if (typeof rawConfirmationMessage !== "string") {
      return {
        ok: false,
        error: "`confirmationMessage` must be a string when provided.",
      };
    }

    const normalizedConfirmationMessage = rawConfirmationMessage.trim();
    if (normalizedConfirmationMessage.length > MCP_CMD_MAX_CONFIRMATION_MESSAGE_LENGTH) {
      return {
        ok: false,
        error:
          `\`confirmationMessage\` must be ${MCP_CMD_MAX_CONFIRMATION_MESSAGE_LENGTH} characters or fewer.`,
      };
    }

    confirmationMessage = normalizedConfirmationMessage.length > 0
      ? normalizedConfirmationMessage
      : null;
  }

  if (confirmedByUser && !confirmationMessage) {
    return {
      ok: false,
      error: "`confirmationMessage` is required when `confirmedByUser` is true.",
    };
  }

  const confirmationChoice =
    confirmedByUser && confirmationMessage
      ? normalizeConfirmationChoice(confirmationMessage)
      : null;
  if (confirmedByUser && !confirmationChoice) {
    return {
      ok: false,
      error: '`confirmationMessage` must be either "yes" or "no" when `confirmedByUser` is true.',
    };
  }

  return {
    ok: true,
    value: {
      confirmedByUser,
      confirmationMessage,
      confirmationChoice,
    },
  };
}

function normalizeConfirmationChoice(value: string): "yes" | "no" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes") {
    return "yes";
  }
  if (normalized === "no") {
    return "no";
  }
  return null;
}

function evaluateCommandExecutionConsent(
  requestContext: McpCmdRequestContext,
  args: ParsedCmdToolArguments,
): CommandConsentResult {
  if (!requestContext.threadId) {
    if (!args.confirmedByUser) {
      return {
        ok: false,
        scope: "request",
        reason:
          "threadContext.threadId is missing. Explicit user confirmation is required for this command execution.",
        nextCallArguments: {
          confirmedByUser: true,
          confirmationMessage: "yes",
        },
      };
    }

    return {
      ok: true,
      scope: "request",
      grantedInThisCall: true,
    };
  }

  const threadConsentKey = buildThreadConsentKey(
    requestContext.userId,
    requestContext.threadId,
  );
  if (threadCommandConsentMap.has(threadConsentKey)) {
    return {
      ok: true,
      scope: "thread",
      grantedInThisCall: false,
    };
  }

  if (!args.confirmedByUser) {
    return {
      ok: false,
      scope: "thread",
      reason:
        "First command execution in this thread requires explicit user confirmation before running terminal commands.",
      nextCallArguments: {
        confirmedByUser: true,
        confirmationMessage: "yes",
      },
    };
  }

  rememberThreadConsent(threadConsentKey);
  return {
    ok: true,
    scope: "thread",
    grantedInThisCall: true,
  };
}

function buildThreadConsentKey(userId: number, threadId: string): string {
  return `${userId}:${threadId}`;
}

function buildCommandApprovalPromptMarkdown(command: string): string {
  const codeFence = createMarkdownCodeFence(command);
  return [
    "Terminal command execution requires your approval.",
    "",
    `${codeFence}sh`,
    command,
    codeFence,
    "",
    "Approve this command?",
    "- yes",
    "- no",
  ].join("\n");
}

function createMarkdownCodeFence(content: string): string {
  const backtickRuns = content.match(/`+/g);
  if (!backtickRuns || backtickRuns.length === 0) {
    return "```";
  }

  let maxBacktickRunLength = 0;
  for (const run of backtickRuns) {
    if (run.length > maxBacktickRunLength) {
      maxBacktickRunLength = run.length;
    }
  }

  const fenceLength = Math.max(3, maxBacktickRunLength + 1);
  return "`".repeat(fenceLength);
}

function rememberThreadConsent(key: string): void {
  if (threadCommandConsentMap.has(key)) {
    threadCommandConsentMap.delete(key);
  }

  threadCommandConsentMap.set(key, {
    grantedAt: new Date().toISOString(),
  });

  while (threadCommandConsentMap.size > THREAD_COMMAND_CONSENT_CACHE_MAX) {
    const oldestKey = threadCommandConsentMap.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    threadCommandConsentMap.delete(oldestKey);
  }
}

function resolveWorkingDirectory(
  userId: number,
  threadId: string | null,
  workingDirectory: string | null,
): ParseResult<string> {
  if (!workingDirectory) {
    return ensureThreadTmpWorkingDirectory(userId, threadId);
  }

  const resolved = path.resolve(workingDirectory);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    return {
      ok: false,
      error: `workingDirectory does not exist: ${resolved}`,
    };
  }

  if (!stats.isDirectory()) {
    return {
      ok: false,
      error: `workingDirectory must be a directory: ${resolved}`,
    };
  }

  return { ok: true, value: resolved };
}

function ensureThreadTmpWorkingDirectory(
  userId: number,
  threadId: string | null,
): ParseResult<string> {
  if (!threadId) {
    return {
      ok: false,
      error:
        "threadContext.threadId is required when workingDirectory is omitted. Provide `workingDirectory` explicitly for threadless requests.",
    };
  }

  const rootDirectory = resolveLegacyFoundryConfigDirectory();
  const resolved = path.join(
    rootDirectory,
    "users",
    String(userId),
    "threads",
    threadId,
    "tmp",
  );
  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      error: `Failed to prepare default workingDirectory (${resolved}): ${readErrorMessage(error)}`,
    };
  }

  return { ok: true, value: resolved };
}

function resolveShellExecutionContext(): ShellExecutionContext | null {
  const candidates = buildShellCandidates();
  for (const candidate of candidates) {
    if (isShellCandidateAvailable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildShellCandidates(): ShellExecutionContext[] {
  const candidates: ShellExecutionContext[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidate: ShellExecutionContext) => {
    const executable = candidate.executable.trim();
    if (!executable) {
      return;
    }

    const key = `${candidate.family}:${executable}`.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push({
      ...candidate,
      executable,
    });
  };

  const processShell = normalizeOptionalString(process.env.SHELL);
  const userInfoShell = readUserInfoShell();

  if (process.platform === "win32") {
    if (processShell) {
      addCandidate(createPosixShellExecutionContext(processShell, "process.env.SHELL"));
    }

    if (userInfoShell) {
      addCandidate(createPosixShellExecutionContext(userInfoShell, "nodeOs.userInfo().shell"));
    }

    addCandidate(createPowerShellExecutionContext("pwsh.exe", "pwsh"));
    addCandidate(createPowerShellExecutionContext("powershell.exe", "powershell"));

    const comspec = normalizeOptionalString(process.env.ComSpec);
    if (comspec) {
      addCandidate(createCmdShellExecutionContext(comspec, "process.env.ComSpec"));
    }
    addCandidate(createCmdShellExecutionContext("cmd.exe", "default"));

    return candidates;
  }

  if (processShell) {
    addCandidate(createPosixShellExecutionContext(processShell, "process.env.SHELL"));
  }

  if (userInfoShell) {
    addCandidate(createPosixShellExecutionContext(userInfoShell, "nodeOs.userInfo().shell"));
  }

  addCandidate(createPosixShellExecutionContext("/bin/bash", "fallback"));
  addCandidate(createPosixShellExecutionContext("/bin/zsh", "fallback"));
  addCandidate(createPosixShellExecutionContext("/bin/sh", "fallback"));
  addCandidate(createPosixShellExecutionContext("bash", "PATH"));
  addCandidate(createPosixShellExecutionContext("zsh", "PATH"));
  addCandidate(createPosixShellExecutionContext("sh", "PATH"));

  return candidates;
}

function createPosixShellExecutionContext(
  executable: string,
  source: string,
): ShellExecutionContext {
  return {
    executable,
    argsPrefix: ["-lc"],
    probeArgs: ["-lc", "exit 0"],
    family: "posix",
    source,
  };
}

function createPowerShellExecutionContext(
  executable: string,
  source: string,
): ShellExecutionContext {
  return {
    executable,
    argsPrefix: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"],
    probeArgs: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 0"],
    family: "powershell",
    source,
  };
}

function createCmdShellExecutionContext(
  executable: string,
  source: string,
): ShellExecutionContext {
  return {
    executable,
    argsPrefix: ["/d", "/s", "/c"],
    probeArgs: ["/d", "/s", "/c", "exit 0"],
    family: "cmd",
    source,
  };
}

function isShellCandidateAvailable(shellExecutionContext: ShellExecutionContext): boolean {
  try {
    const probeResult = childProcess.spawnSync(
      shellExecutionContext.executable,
      shellExecutionContext.probeArgs,
      {
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
        timeout: 1_500,
      },
    );
    if (probeResult.error) {
      return false;
    }

    return probeResult.status === 0;
  } catch {
    return false;
  }
}

async function runShellCommand(options: {
  shellExecutionContext: ShellExecutionContext;
  command: string;
  workingDirectory: string;
  timeoutSeconds: number;
}): Promise<CommandExecutionResult> {
  const {
    shellExecutionContext,
    command,
    workingDirectory,
    timeoutSeconds,
  } = options;

  return await new Promise((resolve, reject) => {
    const stdoutCollector = createOutputCollector();
    const stderrCollector = createOutputCollector();
    let timedOut = false;

    const startedAt = Date.now();
    const child = childProcess.spawn(
      shellExecutionContext.executable,
      [...shellExecutionContext.argsPrefix, command],
      {
        cwd: workingDirectory,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    child.stdout.on("data", (chunk: Buffer) => {
      appendOutputChunk(stdoutCollector, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      appendOutputChunk(stderrCollector, chunk);
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();

      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1_000);
    }, timeoutSeconds * 1_000);

    child.once("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.once("close", (exitCode, signal) => {
      clearTimeout(timeoutHandle);
      resolve({
        stdout: readOutputCollectorText(stdoutCollector),
        stderr: readOutputCollectorText(stderrCollector),
        stdoutTruncated: stdoutCollector.truncated,
        stderrTruncated: stderrCollector.truncated,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function createOutputCollector(): OutputCollector {
  return {
    chunks: [],
    size: 0,
    truncated: false,
  };
}

function appendOutputChunk(collector: OutputCollector, chunk: Buffer | string): void {
  const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (collector.size >= MCP_CMD_OUTPUT_MAX_BYTES) {
    collector.truncated = true;
    return;
  }

  const remaining = MCP_CMD_OUTPUT_MAX_BYTES - collector.size;
  if (bufferChunk.length <= remaining) {
    collector.chunks.push(bufferChunk);
    collector.size += bufferChunk.length;
    return;
  }

  collector.chunks.push(bufferChunk.subarray(0, remaining));
  collector.size = MCP_CMD_OUTPUT_MAX_BYTES;
  collector.truncated = true;
}

function readOutputCollectorText(collector: OutputCollector): string {
  if (collector.chunks.length === 0) {
    return "";
  }

  return Buffer.concat(collector.chunks).toString("utf8");
}

function readMcpCmdRequestContext(
  request: Request,
  authenticatedContext: AuthenticatedMcpCmdContext,
): McpCmdRequestContext {
  return {
    ...authenticatedContext,
    threadId: readOptionalHeaderValue(request, MCP_LOCAL_PLAYGROUND_THREAD_ID_HEADER),
    turnId: readOptionalHeaderValue(request, MCP_LOCAL_PLAYGROUND_TURN_ID_HEADER),
  };
}

async function readAuthenticatedMcpCmdContext(): Promise<AuthenticatedMcpCmdContext | null> {
  const azureContext = await readAzureArmUserContext();
  if (!azureContext) {
    return null;
  }

  const user = await getOrCreateUserByIdentity({
    tenantId: azureContext.tenantId,
    principalId: azureContext.principalId,
  });

  return {
    userId: user.id,
    tenantId: azureContext.tenantId,
    principalId: azureContext.principalId,
  };
}

function readOptionalHeaderValue(request: Request, headerName: string): string | null {
  const raw = request.headers.get(headerName);
  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function readUserInfoShell(): string | null {
  try {
    return normalizeOptionalString(nodeOs.userInfo().shell);
  } catch {
    return null;
  }
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function buildToolResponse(
  payload: Record<string, unknown>,
  options: {
    isError?: boolean;
    text?: string;
  } = {},
) {
  const text = typeof options.text === "string"
    ? options.text
    : JSON.stringify(payload, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    structuredContent: payload,
    ...(options.isError ? { isError: true } : {}),
  };
}

export const mcpCmdRouteTestUtils = {
  parseCmdExecuteArguments,
  evaluateCommandExecutionConsent,
  resolveWorkingDirectory,
  resolveShellExecutionContext,
  clearThreadCommandConsent: () => {
    threadCommandConsentMap.clear();
  },
};
