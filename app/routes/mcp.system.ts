/**
 * MCP route module for /mcp/system contextual metadata server.
 */
import nodeOs from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  AZURE_OPENAI_DEFAULT_API_VERSION,
  MCP_LOCAL_PLAYGROUND_CLIENT_PLATFORM_HEADER,
  MCP_LOCAL_PLAYGROUND_CLIENT_USER_AGENT_HEADER,
  MCP_LOCAL_PLAYGROUND_THREAD_ID_HEADER,
  MCP_LOCAL_PLAYGROUND_TURN_ID_HEADER,
} from "~/lib/constants";
import { normalizeAzureOpenAIBaseURL } from "~/lib/azure/dependencies";
import {
  readAzureArmUserContext,
  type AzurePrincipalType,
} from "~/lib/server/auth/azure-user";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/runtime-event-log";
import { getOrCreateUserByIdentity } from "~/lib/server/persistence/user";
import { prisma } from "~/lib/server/persistence/prisma";
import {
  listAzureProjects,
  parseProjectId,
} from "./api.azure.projects";

const MCP_SYSTEM_ROUTE_PATH = "/mcp/system";
const MCP_SYSTEM_AUTH_REQUIRED_MESSAGE =
  "Authentication required. Click Azure Login in Settings and try again.";
const SYSTEM_READ_THREAD_CONTEXT_TOOL_DESCRIPTION = [
  "Returns canonical identifiers for the authenticated Local Playground context.",
  "Use this tool when another skill/agent needs user/thread/turn identifiers; do not guess or synthesize IDs.",
  "Returned IDs are intended to be reused directly for follow-up API/tool calls.",
  "",
  "Field guide:",
  "- userContext.userId: Authenticated WorkspaceUser primary key (`WorkspaceUser.id`) scoped to this Local Playground database.",
  "  This is NOT Azure `principalId`/`oid`.",
  "  Synonyms often used in other systems: `workspace user id`, `account id`, `owner user id`, `local user id`.",
  "- threadContext.threadId: Current Thread primary key (`Thread.id`) propagated from chat runtime headers.",
  "  `null` when the current request has no active thread context.",
  "  Synonyms often used in other systems: `conversation id`, `chat id`, `dialog id`, `session thread id`.",
  "- threadContext.turnId: Current chat turn execution identifier (one request/response cycle) from chat runtime headers.",
  "  `null` when the request is outside a tracked turn.",
  "  Synonyms often used in other systems: `interaction id`, `request id`, `message cycle id`, `turn execution id`.",
  "- latestThreadName: Display name of the authenticated user's latest non-archived thread (ordered by `Thread.updatedAt` descending).",
  "  `null` when the user has no non-archived threads.",
  "  Synonyms often used in other systems: `latest conversation title`, `recent chat title`, `most recent thread label`, `latest session title`.",
  "- azureContext.principalDisplayName: Human-readable principal display name from Azure access token.",
  "  Synonyms often used in other systems: `principal`, `display name`, `identity display name`.",
  "- azureContext.principalName: Principal sign-in/login name from Azure access token.",
  "  Synonyms often used in other systems: `UPN`, `login name`, `sign-in name`.",
  "- azureContext.principalType: Principal category from Azure token (`User`, `Service Principal`, `Managed Identity`, `Unknown`).",
  "  Synonyms often used in other systems: `identity type`, `subject type`, `actor type`.",
  "- azureContext.tenantId: Azure Entra tenant identifier from Azure access token.",
  "  Synonyms often used in other systems: `directory id`, `AAD tenant id`, `Entra tenant id`.",
  "- azureContext.principalId: Azure principal object identifier from Azure access token.",
  "  Synonyms often used in other systems: `object id`, `OID`, `subject object id`.",
  "- azureContext.playgroundProject: Selected Playground Azure OpenAI project/account name resolved from stored selection.",
  "  `null` when no Playground project selection is stored for the authenticated user.",
  "  Synonyms often used in other systems: `project resource name`, `account name`, `selected project`.",
  "- azureContext.playgroundDeployment: Selected Playground deployment name resolved from stored selection.",
  "  `null` when no Playground deployment selection is stored for the authenticated user.",
  "  Synonyms often used in other systems: `deployment`, `model deployment`, `deployment name`.",
  "- azureContext.endpoint: Normalized Playground Azure OpenAI endpoint (`.../openai/v1/`) for the selected project.",
  "  `null` when no Playground project is selected.",
  "  Synonyms often used in other systems: `base URL`, `service endpoint`, `OpenAI endpoint`.",
  "- azureContext.apiVersion: API version associated with the selected Playground project.",
  "  `null` when no Playground project is selected.",
  "  Synonyms often used in other systems: `OpenAI API version`, `service API version`, `runtime API version`.",
  "- systemContext.clientOperatingSystem: Client OS details inferred from request headers (`Sec-CH-UA-Platform` then `User-Agent`).",
  "  Includes `name`, `version`, `source`.",
  "  Synonyms often used in other systems: `client platform`, `user device OS`, `caller OS`.",
  "- systemContext.serverOperatingSystem: Local Playground server runtime OS details.",
  "  Includes `name`, `platform`, `release`, `architecture`.",
  "  Synonyms often used in other systems: `host OS`, `runtime OS`, `execution environment OS`.",
].join("\n");

type AuthenticatedMcpSystemContext = {
  userId: number;
  tenantId: string;
  principalId: string;
  principalDisplayName: string;
  principalName: string;
  principalType: AzurePrincipalType;
  armAccessToken: string;
};

type ClientOperatingSystemContext = {
  name: string;
  version: string | null;
  source: "sec-ch-ua-platform" | "user-agent" | "unknown";
};

type ServerOperatingSystemContext = {
  name: string;
  platform: NodeJS.Platform;
  release: string;
  architecture: string;
};

type McpSystemRequestContext = AuthenticatedMcpSystemContext & {
  threadId: string | null;
  turnId: string | null;
  clientOperatingSystem: ClientOperatingSystemContext;
  serverOperatingSystem: ServerOperatingSystemContext;
};

type PlaygroundAzureRuntimeContext = {
  projectName: string | null;
  projectId: string | null;
  deploymentName: string | null;
  endpoint: string | null;
  apiVersion: string | null;
};

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
          message: `Method not allowed. Use POST ${MCP_SYSTEM_ROUTE_PATH}.`,
        },
        id: null,
      },
      { status: 405 },
    );
  }

  const authenticatedContext = await readAuthenticatedMcpSystemContext();
  if (!authenticatedContext) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: MCP_SYSTEM_AUTH_REQUIRED_MESSAGE,
        },
        id: null,
      },
      { status: 401 },
    );
  }

  const requestContext = readMcpSystemRequestContext(request, authenticatedContext);
  const server = createSystemMcpServer(requestContext);
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
      route: MCP_SYSTEM_ROUTE_PATH,
      eventName: "mcp_system_route_failed",
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

function createSystemMcpServer(requestContext: McpSystemRequestContext): McpServer {
  const server = new McpServer({
    name: "local-playground-system",
    version: "1.0.0",
  });

  server.registerTool(
    "system_read_thread_context",
    {
      description: SYSTEM_READ_THREAD_CONTEXT_TOOL_DESCRIPTION,
    },
    async () => {
      const latestThreadName = await readLatestThreadName(requestContext.userId);
      const playgroundAzureRuntime = await readPlaygroundAzureRuntimeContext(
        requestContext.userId,
        requestContext.armAccessToken,
      );
      const payload: Record<string, unknown> = {
        userContext: {
          userId: requestContext.userId,
        },
        threadContext: {
          threadId: requestContext.threadId,
          turnId: requestContext.turnId,
        },
        systemContext: {
          clientOperatingSystem: requestContext.clientOperatingSystem,
          serverOperatingSystem: requestContext.serverOperatingSystem,
        },
        latestThreadName,
        azureContext: {
          principalDisplayName: requestContext.principalDisplayName,
          principalName: requestContext.principalName,
          principalType: formatPrincipalType(requestContext.principalType),
          tenantId: requestContext.tenantId,
          principalId: requestContext.principalId,
          playgroundProject: playgroundAzureRuntime.projectName,
          playgroundProjectId: playgroundAzureRuntime.projectId,
          playgroundDeployment: playgroundAzureRuntime.deploymentName,
          endpoint: playgroundAzureRuntime.endpoint,
          apiVersion: playgroundAzureRuntime.apiVersion,
        },
        descriptions: {
          userId: {
            fieldPath: "userContext.userId",
            identifies:
              "Authenticated WorkspaceUser primary key (`WorkspaceUser.id`) in Local Playground; not Azure principalId/oid.",
            synonyms: ["workspace user id", "account id", "owner user id", "local user id"],
            nullWhen: "Never null for successful authenticated requests.",
          },
          threadId: {
            fieldPath: "threadContext.threadId",
            identifies:
              "Current Thread primary key (`Thread.id`) passed from the chat runtime context.",
            synonyms: ["conversation id", "chat id", "dialog id", "session thread id"],
            nullWhen: "No active thread context is attached to the current request.",
          },
          turnId: {
            fieldPath: "threadContext.turnId",
            identifies:
              "Current chat turn execution identifier for this request/response cycle.",
            synonyms: ["interaction id", "request id", "message cycle id", "turn execution id"],
            nullWhen: "Request is outside a tracked chat turn.",
          },
          latestThreadName: {
            fieldPath: "latestThreadName",
            identifies:
              "Display name of the authenticated user's most recently updated non-archived thread.",
            synonyms: ["latest conversation title", "recent chat title", "most recent thread label", "latest session title"],
            nullWhen: "Authenticated user has no non-archived threads.",
          },
          principalDisplayName: {
            fieldPath: "azureContext.principalDisplayName",
            identifies: "Human-readable Azure principal display name for the authenticated identity.",
            synonyms: ["principal", "display name", "identity display name"],
            nullWhen: "Azure token does not contain display-name claims.",
          },
          principalName: {
            fieldPath: "azureContext.principalName",
            identifies: "Azure principal login/sign-in identifier for the authenticated identity.",
            synonyms: ["UPN", "login name", "sign-in name"],
            nullWhen: "Azure token does not contain sign-in-name claims.",
          },
          principalType: {
            fieldPath: "azureContext.principalType",
            identifies: "Azure principal category for the authenticated identity.",
            synonyms: ["identity type", "subject type", "actor type"],
            nullWhen: "Never null for successful authenticated requests.",
          },
          tenantId: {
            fieldPath: "azureContext.tenantId",
            identifies: "Azure Entra tenant identifier for the authenticated identity.",
            synonyms: ["directory id", "AAD tenant id", "Entra tenant id"],
            nullWhen: "Never null for successful authenticated requests.",
          },
          principalId: {
            fieldPath: "azureContext.principalId",
            identifies: "Azure principal object identifier (`oid`) for the authenticated identity.",
            synonyms: ["object id", "OID", "subject object id"],
            nullWhen: "Never null for successful authenticated requests.",
          },
          playgroundProject: {
            fieldPath: "azureContext.playgroundProject",
            identifies: "Selected Playground Azure OpenAI project/account name.",
            synonyms: ["project resource name", "account name", "selected project"],
            nullWhen: "No Playground project selection is stored for the authenticated user.",
          },
          playgroundDeployment: {
            fieldPath: "azureContext.playgroundDeployment",
            identifies: "Selected Playground deployment name.",
            synonyms: ["deployment", "model deployment", "deployment name"],
            nullWhen: "No Playground deployment selection is stored for the authenticated user.",
          },
          endpoint: {
            fieldPath: "azureContext.endpoint",
            identifies: "Normalized Azure OpenAI endpoint (`.../openai/v1/`) for the selected Playground project.",
            synonyms: ["base URL", "service endpoint", "OpenAI endpoint"],
            nullWhen: "No Playground project selection is stored for the authenticated user.",
          },
          apiVersion: {
            fieldPath: "azureContext.apiVersion",
            identifies: "API version associated with the selected Playground project.",
            synonyms: ["OpenAI API version", "service API version", "runtime API version"],
            nullWhen: "No Playground project selection is stored for the authenticated user.",
          },
          clientOperatingSystem: {
            fieldPath: "systemContext.clientOperatingSystem",
            identifies:
              "Client OS details inferred from request headers (`Sec-CH-UA-Platform` then `User-Agent`).",
            synonyms: ["client platform", "user device OS", "caller OS"],
            nullWhen: "Never null; falls back to `{ name: \"Unknown\", version: null, source: \"unknown\" }` when unavailable.",
          },
          serverOperatingSystem: {
            fieldPath: "systemContext.serverOperatingSystem",
            identifies: "Server runtime OS details for the Local Playground process handling this request.",
            synonyms: ["host OS", "runtime OS", "execution environment OS"],
            nullWhen: "Never null for successful authenticated requests.",
          },
        },
      };

      return buildToolResponse(payload);
    },
  );

  return server;
}

function readMcpSystemRequestContext(
  request: Request,
  authenticatedContext: AuthenticatedMcpSystemContext,
): McpSystemRequestContext {
  return {
    ...authenticatedContext,
    threadId: readOptionalHeaderValue(request, MCP_LOCAL_PLAYGROUND_THREAD_ID_HEADER),
    turnId: readOptionalHeaderValue(request, MCP_LOCAL_PLAYGROUND_TURN_ID_HEADER),
    clientOperatingSystem: readClientOperatingSystemContext(request),
    serverOperatingSystem: readServerOperatingSystemContext(),
  };
}

async function readAuthenticatedMcpSystemContext(): Promise<AuthenticatedMcpSystemContext | null> {
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
    principalDisplayName: normalizeOptionalLabel(azureContext.displayName) ?? "",
    principalName: normalizeOptionalLabel(azureContext.principalName) ?? "",
    principalType: azureContext.principalType,
    armAccessToken: azureContext.token,
  };
}

function readOptionalHeaderValue(request: Request, name: string): string | null {
  const rawValue = request.headers.get(name);
  if (typeof rawValue !== "string") {
    return null;
  }

  const normalized = rawValue.trim();
  return normalized.length > 0 ? normalized : null;
}

function readClientOperatingSystemContext(request: Request): ClientOperatingSystemContext {
  const clientHintPlatform = normalizeOptionalLabel(
    request.headers.get(MCP_LOCAL_PLAYGROUND_CLIENT_PLATFORM_HEADER)
    ?? request.headers.get("sec-ch-ua-platform"),
  );
  if (clientHintPlatform) {
    return {
      name: normalizeClientHintPlatform(clientHintPlatform),
      version: null,
      source: "sec-ch-ua-platform",
    };
  }

  const userAgent = normalizeOptionalLabel(
    request.headers.get(MCP_LOCAL_PLAYGROUND_CLIENT_USER_AGENT_HEADER)
    ?? request.headers.get("user-agent"),
  );
  if (!userAgent) {
    return {
      name: "Unknown",
      version: null,
      source: "unknown",
    };
  }

  const parsedFromUserAgent = parseOperatingSystemFromUserAgent(userAgent);
  if (!parsedFromUserAgent) {
    return {
      name: "Unknown",
      version: null,
      source: "unknown",
    };
  }

  return {
    ...parsedFromUserAgent,
    source: "user-agent",
  };
}

function parseOperatingSystemFromUserAgent(
  userAgent: string,
): Omit<ClientOperatingSystemContext, "source"> | null {
  const lowerUserAgent = userAgent.toLowerCase();

  if (lowerUserAgent.includes("windows nt")) {
    return {
      name: "Windows",
      version: normalizeOperatingSystemVersion(extractUserAgentVersion(userAgent, /Windows NT ([0-9.]+)/i)),
    };
  }

  if (/iphone|ipad|ipod/i.test(userAgent)) {
    return {
      name: "iOS",
      version: normalizeOperatingSystemVersion(extractUserAgentVersion(userAgent, /OS ([0-9_]+)/i)),
    };
  }

  if (lowerUserAgent.includes("android")) {
    return {
      name: "Android",
      version: normalizeOperatingSystemVersion(extractUserAgentVersion(userAgent, /Android ([0-9.]+)/i)),
    };
  }

  if (lowerUserAgent.includes("mac os x") || lowerUserAgent.includes("macintosh")) {
    return {
      name: "macOS",
      version: normalizeOperatingSystemVersion(extractUserAgentVersion(userAgent, /Mac OS X ([0-9_]+)/i)),
    };
  }

  if (lowerUserAgent.includes("linux")) {
    return {
      name: "Linux",
      version: null,
    };
  }

  return null;
}

function extractUserAgentVersion(userAgent: string, pattern: RegExp): string | null {
  const matched = userAgent.match(pattern);
  const version = matched?.[1];
  if (typeof version !== "string") {
    return null;
  }

  const normalized = version.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOperatingSystemVersion(version: string | null): string | null {
  if (!version) {
    return null;
  }
  return version.replaceAll("_", ".");
}

function normalizeClientHintPlatform(value: string): string {
  const unquoted = value.trim().replace(/^"(.*)"$/, "$1").trim();
  return unquoted.length > 0 ? unquoted : "Unknown";
}

function readServerOperatingSystemContext(): ServerOperatingSystemContext {
  const platform = process.platform;
  return {
    name: mapNodePlatformToOperatingSystemName(platform),
    platform,
    release: nodeOs.release(),
    architecture: nodeOs.arch(),
  };
}

function mapNodePlatformToOperatingSystemName(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return "macOS";
  }
  if (platform === "win32") {
    return "Windows";
  }
  if (platform === "linux") {
    return "Linux";
  }
  return platform;
}

async function readLatestThreadName(userId: number): Promise<string | null> {
  const latestThread = await prisma.thread.findFirst({
    where: {
      userId,
      deletedAt: null,
    },
    orderBy: [
      { updatedAt: "desc" },
    ],
    select: {
      name: true,
    },
  });

  return typeof latestThread?.name === "string" ? latestThread.name : null;
}

async function readPlaygroundAzureRuntimeContext(
  userId: number,
  armAccessToken: string,
): Promise<PlaygroundAzureRuntimeContext> {
  const selection = await prisma.azureSelectionPreference.findUnique({
    where: {
      userId,
    },
    select: {
      projectId: true,
      deploymentName: true,
    },
  });

  const selectedProjectId = normalizeOptionalLabel(selection?.projectId);
  const selectedDeploymentName = normalizeOptionalLabel(selection?.deploymentName);
  if (!selectedProjectId || !selectedDeploymentName) {
    return {
      projectName: null,
      projectId: selectedProjectId,
      deploymentName: selectedDeploymentName,
      endpoint: null,
      apiVersion: null,
    };
  }

  let matchedProject:
    | {
        projectName: string;
        baseUrl: string;
        apiVersion: string;
      }
    | undefined;
  try {
    const projects = await listAzureProjects(armAccessToken);
    matchedProject = projects.find((project) => project.id === selectedProjectId);
  } catch {
    // Best-effort enrichment: still return selection data even when ARM listing fails.
  }

  const fallbackProjectRef = parseProjectId(selectedProjectId);
  const fallbackProjectName = normalizeOptionalLabel(fallbackProjectRef?.accountName);
  const fallbackEndpoint = fallbackProjectName
    ? normalizeAzureOpenAIBaseURL(`https://${fallbackProjectName}.cognitiveservices.azure.com/`)
    : "";

  const resolvedProjectName =
    normalizeOptionalLabel(matchedProject?.projectName) ?? fallbackProjectName;
  const resolvedEndpoint =
    normalizeOptionalLabel(matchedProject?.baseUrl) ??
    (fallbackEndpoint ? fallbackEndpoint : null);
  const resolvedApiVersion =
    normalizeOptionalLabel(matchedProject?.apiVersion) ??
    (resolvedProjectName ? AZURE_OPENAI_DEFAULT_API_VERSION : null);

  return {
    projectName: resolvedProjectName,
    projectId: selectedProjectId,
    deploymentName: selectedDeploymentName,
    endpoint: resolvedEndpoint,
    apiVersion: resolvedApiVersion,
  };
}

function normalizeOptionalLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function formatPrincipalType(principalType: AzurePrincipalType): string {
  if (principalType === "user") {
    return "User";
  }
  if (principalType === "servicePrincipal") {
    return "Service Principal";
  }
  if (principalType === "managedIdentity") {
    return "Managed Identity";
  }
  return "Unknown";
}

function buildToolResponse(payload: Record<string, unknown>) {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    structuredContent: payload,
  };
}
