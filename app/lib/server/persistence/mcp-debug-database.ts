/**
 * Database debug metadata and read helpers for MCP tools.
 */
import { prisma } from "~/lib/server/persistence/prisma";

export type DatabaseDebugTableFieldDefinition = {
  name: string;
  type: string;
  nullable: boolean;
  description: string;
};

export type DatabaseDebugTableDefinition = {
  tableName: string;
  toolName: string;
  purpose: string;
  accumulatesErrors: boolean;
  fields: DatabaseDebugTableFieldDefinition[];
};

export const databaseDebugFilterOperatorValues = [
  "eq",
  "ne",
  "contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "is_null",
  "is_not_null",
] as const;

export type DatabaseDebugFilterOperator =
  (typeof databaseDebugFilterOperatorValues)[number];
export type DatabaseDebugFilterMode = "all" | "any";
export type DatabaseDebugFilterPrimitive = string | number | boolean | null;
export type DatabaseDebugFilter = {
  field: string;
  operator: DatabaseDebugFilterOperator;
  value?: DatabaseDebugFilterPrimitive | DatabaseDebugFilterPrimitive[];
};

export type DatabaseDebugTableReadOptions = {
  limit: number;
  offset: number;
  filterMode: DatabaseDebugFilterMode;
  filters: DatabaseDebugFilter[];
};

export type DatabaseDebugTableReadResult = {
  tableName: string;
  purpose: string;
  accumulatesErrors: boolean;
  fields: DatabaseDebugTableFieldDefinition[];
  filtering: {
    filterMode: DatabaseDebugFilterMode;
    filterCount: number;
    filters: DatabaseDebugFilter[];
  };
  pagination: {
    limit: number;
    offset: number;
    rowCount: number;
    totalRows: number;
    hasMore: boolean;
  };
  rows: Array<Record<string, unknown>>;
};

export type DatabaseDebugLatestThreadReadOptions = {
  threadId: string | null;
  includeArchived: boolean;
  includeRuntimeEventLogs: boolean;
  includeAllRows: boolean;
  messageLimit: number;
  mcpServerLimit: number;
  mcpRpcLimit: number;
  skillSelectionLimit: number;
  runtimeEventLimit: number;
};

export type DatabaseDebugLatestThreadReadResult = {
  target: {
    mode: "latest" | "by_id";
    threadId: string | null;
    includeArchived: boolean;
  };
  found: boolean;
  snapshot: Record<string, unknown> | null;
  runtimeEventLogs: Array<Record<string, unknown>>;
  counts: {
    messages: number;
    messageSkillActivations: number;
    mcpServers: number;
    mcpRpcLogs: number;
    skillSelections: number;
    runtimeEventLogs: number;
  };
  truncation: {
    messages: boolean;
    messageSkillActivations: boolean;
    mcpServers: boolean;
    mcpRpcLogs: boolean;
    skillSelections: boolean;
    runtimeEventLogs: boolean;
  };
};

export const databaseDebugDefaultReadLimit = 50;
export const databaseDebugMaxReadLimit = 200;
export const databaseDebugMaxReadOffset = 100_000;
export const databaseDebugMaxReadFilters = 12;
export const databaseDebugLatestThreadDefaultMessageLimit = 400;
export const databaseDebugLatestThreadDefaultMcpServerLimit = 64;
export const databaseDebugLatestThreadDefaultMcpRpcLimit = 1_500;
export const databaseDebugLatestThreadDefaultSkillSelectionLimit = 128;
export const databaseDebugLatestThreadDefaultRuntimeEventLimit = 400;
export const databaseDebugLatestThreadMaxMessageLimit = 5_000;
export const databaseDebugLatestThreadMaxMcpServerLimit = 512;
export const databaseDebugLatestThreadMaxMcpRpcLimit = 10_000;
export const databaseDebugLatestThreadMaxSkillSelectionLimit = 1_000;
export const databaseDebugLatestThreadMaxRuntimeEventLimit = 5_000;

const databaseDebugMaxReadInValues = 50;
const databaseDebugMaxTextFilterLength = 2_000;

const tableDefinitions: DatabaseDebugTableDefinition[] = [
  {
    tableName: "WorkspaceUser",
    toolName: "debug_read_user_table",
    purpose:
      "Stores Local Playground users identified by Azure tenant and principal; parent row for per-user persisted data.",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "INTEGER",
        nullable: false,
        description: "Internal auto-increment primary key.",
      },
      {
        name: "tenantId",
        type: "TEXT",
        nullable: false,
        description: "Azure tenant ID for the signed-in account.",
      },
      {
        name: "principalId",
        type: "TEXT",
        nullable: false,
        description: "Azure principal/object ID for the signed-in account.",
      },
    ],
  },
  {
    tableName: "AzureSelectionPreference",
    toolName: "debug_read_azure_selection_preference_table",
    purpose:
      "Stores last-used Azure project and deployment preferences per user for both primary and utility model slots.",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "INTEGER",
        nullable: false,
        description: "Internal auto-increment primary key.",
      },
      {
        name: "userId",
        type: "INTEGER",
        nullable: false,
        description: "Foreign key to WorkspaceUser.id (one row per user).",
      },
      {
        name: "projectId",
        type: "TEXT",
        nullable: false,
        description: "Selected Azure project identifier.",
      },
      {
        name: "deploymentName",
        type: "TEXT",
        nullable: false,
        description: "Selected deployment name for chat execution.",
      },
      {
        name: "utilityProjectId",
        type: "TEXT",
        nullable: false,
        description: "Selected utility project identifier.",
      },
      {
        name: "utilityDeploymentName",
        type: "TEXT",
        nullable: false,
        description: "Selected utility deployment name.",
      },
      {
        name: "utilityReasoningEffort",
        type: "TEXT",
        nullable: false,
        description: "Reasoning effort for utility requests (for example high).",
      },
    ],
  },
  {
    tableName: "WorkspaceMcpServerProfile",
    toolName: "debug_read_workspace_mcp_server_profile_table",
    purpose:
      "Stores reusable MCP server profiles saved by each user (HTTP/SSE/stdio transport settings).",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "TEXT",
        nullable: false,
        description: "Stable profile ID.",
      },
      {
        name: "userId",
        type: "INTEGER",
        nullable: false,
        description: "Foreign key to WorkspaceUser.id.",
      },
      {
        name: "profileOrder",
        type: "INTEGER",
        nullable: false,
        description: "Display order in MCP Servers tab.",
      },
      {
        name: "configKey",
        type: "TEXT",
        nullable: false,
        description: "Normalized key used to detect duplicate configurations.",
      },
      {
        name: "name",
        type: "TEXT",
        nullable: false,
        description: "User-facing profile name.",
      },
      {
        name: "transport",
        type: "TEXT",
        nullable: false,
        description: "Transport type: streamable_http, sse, or stdio.",
      },
      {
        name: "url",
        type: "TEXT",
        nullable: true,
        description: "HTTP/SSE endpoint URL when transport is remote.",
      },
      {
        name: "headersJson",
        type: "TEXT",
        nullable: true,
        description: "Serialized custom HTTP headers JSON.",
      },
      {
        name: "useAzureAuth",
        type: "BOOLEAN",
        nullable: false,
        description: "Whether bearer token injection with DefaultAzureCredential is enabled.",
      },
      {
        name: "azureAuthScope",
        type: "TEXT",
        nullable: true,
        description: "Azure token scope used when useAzureAuth is true.",
      },
      {
        name: "timeoutSeconds",
        type: "INTEGER",
        nullable: true,
        description: "Per-server timeout in seconds for remote transports.",
      },
      {
        name: "command",
        type: "TEXT",
        nullable: true,
        description: "Executable command when transport is stdio.",
      },
      {
        name: "argsJson",
        type: "TEXT",
        nullable: true,
        description: "Serialized command arguments JSON for stdio transport.",
      },
      {
        name: "cwd",
        type: "TEXT",
        nullable: true,
        description: "Working directory for stdio transport.",
      },
      {
        name: "envJson",
        type: "TEXT",
        nullable: true,
        description: "Serialized environment variable map JSON for stdio transport.",
      },
    ],
  },
  {
    tableName: "WorkspaceSkillRegistryProfile",
    toolName: "debug_read_workspace_skill_registry_profile_table",
    purpose:
      "Stores per-user Skill registry master rows used to classify and group installed Skills.",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "INTEGER",
        nullable: false,
        description: "Internal auto-increment primary key.",
      },
      {
        name: "userId",
        type: "INTEGER",
        nullable: false,
        description: "Foreign key to WorkspaceUser.id.",
      },
      {
        name: "registryId",
        type: "TEXT",
        nullable: false,
        description: "Stable registry identifier (for example openai_curated).",
      },
      {
        name: "registryLabel",
        type: "TEXT",
        nullable: false,
        description: "Registry display label.",
      },
      {
        name: "registryDescription",
        type: "TEXT",
        nullable: false,
        description: "Registry description text.",
      },
      {
        name: "repository",
        type: "TEXT",
        nullable: false,
        description: "Source repository in owner/name format.",
      },
      {
        name: "repositoryUrl",
        type: "TEXT",
        nullable: false,
        description: "Repository URL.",
      },
      {
        name: "sourcePath",
        type: "TEXT",
        nullable: false,
        description: "Path inside the repository used as registry source root.",
      },
      {
        name: "installDirectoryName",
        type: "TEXT",
        nullable: false,
        description: "Directory name used under app-data skills for this registry.",
      },
    ],
  },
  {
    tableName: "WorkspaceSkillProfile",
    toolName: "debug_read_workspace_skill_profile_table",
    purpose:
      "Stores per-user Skill master rows normalized by Skill location and linked to optional Skill registry masters.",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "INTEGER",
        nullable: false,
        description: "Internal auto-increment primary key.",
      },
      {
        name: "userId",
        type: "INTEGER",
        nullable: false,
        description: "Foreign key to WorkspaceUser.id.",
      },
      {
        name: "registryProfileId",
        type: "INTEGER",
        nullable: true,
        description: "Foreign key to WorkspaceSkillRegistryProfile.id when the Skill came from a registry.",
      },
      {
        name: "name",
        type: "TEXT",
        nullable: false,
        description: "Skill display name.",
      },
      {
        name: "location",
        type: "TEXT",
        nullable: false,
        description: "Skill source path or URI.",
      },
      {
        name: "source",
        type: "TEXT",
        nullable: false,
        description: "Skill source kind (for example codex_home or app_data).",
      },
    ],
  },
  {
    tableName: "Thread",
    toolName: "debug_read_thread_table",
    purpose:
      "Stores thread-level metadata and runtime options (name, timestamps, reasoning mode, web search toggle, thread environment variables).",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "TEXT",
        nullable: false,
        description: "Thread ID.",
      },
      {
        name: "userId",
        type: "INTEGER",
        nullable: false,
        description: "Foreign key to WorkspaceUser.id.",
      },
      {
        name: "name",
        type: "TEXT",
        nullable: false,
        description: "Editable thread title.",
      },
      {
        name: "createdAt",
        type: "TEXT",
        nullable: false,
        description: "Creation timestamp (ISO string).",
      },
      {
        name: "updatedAt",
        type: "TEXT",
        nullable: false,
        description: "Last updated timestamp (ISO string).",
      },
      {
        name: "deletedAt",
        type: "TEXT",
        nullable: true,
        description: "Archive timestamp when thread is soft-deleted.",
      },
      {
        name: "reasoningEffort",
        type: "TEXT",
        nullable: false,
        description: "Reasoning effort option for model execution.",
      },
      {
        name: "webSearchEnabled",
        type: "BOOLEAN",
        nullable: false,
        description: "Whether web-search-preview is enabled for the thread.",
      },
      {
        name: "threadEnvironmentJson",
        type: "TEXT",
        nullable: false,
        description: "Serialized thread-scoped environment variables JSON shared across turns.",
      },
    ],
  },
  {
    tableName: "ThreadSkillActivation",
    toolName: "debug_read_thread_skill_activation_table",
    purpose:
      "Stores ordered thread skill selections by linking each thread position to a workspace skill master row.",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "TEXT",
        nullable: false,
        description: "Skill selection row ID.",
      },
      {
        name: "threadId",
        type: "TEXT",
        nullable: false,
        description: "Foreign key to Thread.id.",
      },
      {
        name: "selectionOrder",
        type: "INTEGER",
        nullable: false,
        description: "Order of selected skills in the thread.",
      },
      {
        name: "skillProfileId",
        type: "INTEGER",
        nullable: false,
        description: "Foreign key to WorkspaceSkillProfile.id.",
      },
    ],
  },
  {
    tableName: "ThreadInstruction",
    toolName: "debug_read_thread_instruction_table",
    purpose: "Stores per-thread system instruction text edited in Threads tab.",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "INTEGER",
        nullable: false,
        description: "Internal auto-increment primary key.",
      },
      {
        name: "threadId",
        type: "TEXT",
        nullable: false,
        description: "Foreign key to Thread.id (unique; one instruction per thread).",
      },
      {
        name: "content",
        type: "TEXT",
        nullable: false,
        description: "Instruction body text.",
      },
    ],
  },
  {
    tableName: "ThreadMessage",
    toolName: "debug_read_thread_message_table",
    purpose:
      "Stores ordered chat messages per thread, including role, content, turn ID, and serialized attachments.",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "TEXT",
        nullable: false,
        description: "Message ID.",
      },
      {
        name: "threadId",
        type: "TEXT",
        nullable: false,
        description: "Foreign key to Thread.id.",
      },
      {
        name: "conversationOrder",
        type: "INTEGER",
        nullable: false,
        description: "Message order within the thread.",
      },
      {
        name: "role",
        type: "TEXT",
        nullable: false,
        description: "Chat role (user or assistant).",
      },
      {
        name: "content",
        type: "TEXT",
        nullable: false,
        description: "Message body text.",
      },
      {
        name: "createdAt",
        type: "TEXT",
        nullable: false,
        description: "Message creation timestamp (ISO string).",
      },
      {
        name: "turnId",
        type: "TEXT",
        nullable: false,
        description: "Turn identifier shared by message and MCP logs.",
      },
      {
        name: "attachmentsJson",
        type: "TEXT",
        nullable: false,
        description: "Serialized attachment list JSON.",
      },
    ],
  },
  {
    tableName: "ThreadMessageSkillActivation",
    toolName: "debug_read_thread_message_skill_activation_table",
    purpose:
      "Stores ordered message skill activation selections by linking each message position to a workspace skill master row.",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "TEXT",
        nullable: false,
        description: "Message skill activation row ID.",
      },
      {
        name: "messageId",
        type: "TEXT",
        nullable: false,
        description: "Foreign key to ThreadMessage.id.",
      },
      {
        name: "selectionOrder",
        type: "INTEGER",
        nullable: false,
        description: "Order of selected message skill activations in the message.",
      },
      {
        name: "skillProfileId",
        type: "INTEGER",
        nullable: false,
        description: "Foreign key to WorkspaceSkillProfile.id.",
      },
    ],
  },
  {
    tableName: "ThreadMcpConnection",
    toolName: "debug_read_thread_mcp_connection_table",
    purpose:
      "Stores MCP server connections that were active for a specific thread snapshot.",
    accumulatesErrors: false,
    fields: [
      {
        name: "id",
        type: "TEXT",
        nullable: false,
        description: "Thread MCP server row ID.",
      },
      {
        name: "threadId",
        type: "TEXT",
        nullable: false,
        description: "Foreign key to Thread.id.",
      },
      {
        name: "selectionOrder",
        type: "INTEGER",
        nullable: false,
        description: "Order of MCP servers attached to the thread.",
      },
      {
        name: "name",
        type: "TEXT",
        nullable: false,
        description: "Server display name at snapshot time.",
      },
      {
        name: "transport",
        type: "TEXT",
        nullable: false,
        description: "Transport type: streamable_http, sse, or stdio.",
      },
      {
        name: "url",
        type: "TEXT",
        nullable: true,
        description: "Remote endpoint URL for HTTP/SSE transports.",
      },
      {
        name: "headersJson",
        type: "TEXT",
        nullable: true,
        description: "Serialized custom HTTP headers JSON.",
      },
      {
        name: "useAzureAuth",
        type: "BOOLEAN",
        nullable: false,
        description: "Whether bearer token injection with DefaultAzureCredential is enabled.",
      },
      {
        name: "azureAuthScope",
        type: "TEXT",
        nullable: true,
        description: "Azure token scope used when useAzureAuth is true.",
      },
      {
        name: "timeoutSeconds",
        type: "INTEGER",
        nullable: true,
        description: "Per-server timeout in seconds for remote transports.",
      },
      {
        name: "command",
        type: "TEXT",
        nullable: true,
        description: "Executable command when transport is stdio.",
      },
      {
        name: "argsJson",
        type: "TEXT",
        nullable: true,
        description: "Serialized stdio command arguments JSON.",
      },
      {
        name: "cwd",
        type: "TEXT",
        nullable: true,
        description: "Working directory for stdio transport.",
      },
      {
        name: "envJson",
        type: "TEXT",
        nullable: true,
        description: "Serialized environment variable map JSON for stdio transport.",
      },
    ],
  },
  {
    tableName: "ThreadOperationLog",
    toolName: "debug_read_thread_operation_log_table",
    purpose:
      "Stores MCP RPC request/response logs for each thread and turn, including explicit error flags.",
    accumulatesErrors: true,
    fields: [
      {
        name: "rowId",
        type: "TEXT",
        nullable: false,
        description: "MCP log row ID.",
      },
      {
        name: "sourceRpcId",
        type: "TEXT",
        nullable: false,
        description: "Original RPC identifier from runtime history.",
      },
      {
        name: "threadId",
        type: "TEXT",
        nullable: false,
        description: "Foreign key to Thread.id.",
      },
      {
        name: "conversationOrder",
        type: "INTEGER",
        nullable: false,
        description: "Persisted ordering index used for thread replay.",
      },
      {
        name: "sequence",
        type: "INTEGER",
        nullable: false,
        description: "RPC sequence number within a run.",
      },
      {
        name: "operationType",
        type: "TEXT",
        nullable: false,
        description: "Operation category (mcp or skill).",
      },
      {
        name: "serverName",
        type: "TEXT",
        nullable: false,
        description: "MCP server name.",
      },
      {
        name: "method",
        type: "TEXT",
        nullable: false,
        description: "JSON-RPC method (for example tools/list or tools/call).",
      },
      {
        name: "startedAt",
        type: "TEXT",
        nullable: false,
        description: "RPC start timestamp (ISO string).",
      },
      {
        name: "completedAt",
        type: "TEXT",
        nullable: false,
        description: "RPC completion timestamp (ISO string).",
      },
      {
        name: "requestJson",
        type: "TEXT",
        nullable: false,
        description: "Serialized JSON-RPC request payload.",
      },
      {
        name: "responseJson",
        type: "TEXT",
        nullable: false,
        description: "Serialized JSON-RPC response payload.",
      },
      {
        name: "isError",
        type: "BOOLEAN",
        nullable: false,
        description: "True when the MCP RPC completed with an error.",
      },
      {
        name: "turnId",
        type: "TEXT",
        nullable: false,
        description: "Conversation turn identifier linked to the log.",
      },
    ],
  },
  {
    tableName: "RuntimeEventLog",
    toolName: "debug_read_runtime_event_log_table",
    purpose:
      "Stores server/client observability events, including errors and warnings used for diagnostics.",
    accumulatesErrors: true,
    fields: [
      {
        name: "id",
        type: "TEXT",
        nullable: false,
        description: "Event row ID.",
      },
      {
        name: "createdAt",
        type: "TEXT",
        nullable: false,
        description: "Event timestamp (ISO string).",
      },
      {
        name: "source",
        type: "TEXT",
        nullable: false,
        description: "Event source (for example server or client).",
      },
      {
        name: "level",
        type: "TEXT",
        nullable: false,
        description: "Log level (info, warning, error).",
      },
      {
        name: "category",
        type: "TEXT",
        nullable: false,
        description: "Log category.",
      },
      {
        name: "eventName",
        type: "TEXT",
        nullable: false,
        description: "Structured event name.",
      },
      {
        name: "message",
        type: "TEXT",
        nullable: false,
        description: "Human-readable log message.",
      },
      {
        name: "errorName",
        type: "TEXT",
        nullable: true,
        description: "Error class/name when available.",
      },
      {
        name: "location",
        type: "TEXT",
        nullable: true,
        description: "Source location (module/function context).",
      },
      {
        name: "action",
        type: "TEXT",
        nullable: true,
        description: "Action label associated with this event.",
      },
      {
        name: "statusCode",
        type: "INTEGER",
        nullable: true,
        description: "HTTP status code when applicable.",
      },
      {
        name: "httpMethod",
        type: "TEXT",
        nullable: true,
        description: "HTTP method for request-scoped logs.",
      },
      {
        name: "httpPath",
        type: "TEXT",
        nullable: true,
        description: "HTTP path for request-scoped logs.",
      },
      {
        name: "threadId",
        type: "TEXT",
        nullable: true,
        description: "Thread ID associated with the event.",
      },
      {
        name: "tenantId",
        type: "TEXT",
        nullable: true,
        description: "Azure tenant ID when available.",
      },
      {
        name: "principalId",
        type: "TEXT",
        nullable: true,
        description: "Azure principal/object ID when available.",
      },
      {
        name: "userId",
        type: "INTEGER",
        nullable: true,
        description: "WorkspaceUser.id when available.",
      },
      {
        name: "stack",
        type: "TEXT",
        nullable: true,
        description: "Stack trace text for error events.",
      },
      {
        name: "contextJson",
        type: "TEXT",
        nullable: false,
        description: "Serialized structured context payload.",
      },
    ],
  },
  {
    tableName: "SkillRegistryCache",
    toolName: "debug_read_skill_registry_cache_table",
    purpose:
      "Stores cached skill-registry payload snapshots and expiration timestamps.",
    accumulatesErrors: false,
    fields: [
      {
        name: "cacheKey",
        type: "TEXT",
        nullable: false,
        description: "Cache key for registry payload lookup.",
      },
      {
        name: "payloadJson",
        type: "TEXT",
        nullable: false,
        description: "Serialized registry payload JSON.",
      },
      {
        name: "updatedAt",
        type: "TEXT",
        nullable: false,
        description: "Cache update timestamp (ISO string).",
      },
      {
        name: "expiresAt",
        type: "TEXT",
        nullable: false,
        description: "Cache expiration timestamp (ISO string).",
      },
    ],
  },
];

const tableDefinitionByToolName = new Map(
  tableDefinitions.map((table) => [table.toolName, table]),
);

export function listDatabaseDebugTables(): readonly DatabaseDebugTableDefinition[] {
  return tableDefinitions;
}

export function readDatabaseDebugTableByToolName(
  toolName: string,
): DatabaseDebugTableDefinition | null {
  return tableDefinitionByToolName.get(toolName) ?? null;
}

export function buildDatabaseDebugTableToolDescription(
  table: DatabaseDebugTableDefinition,
): string {
  const lines = [
    `Debug read tool for Prisma table "${table.tableName}".`,
    `Role: ${table.purpose}`,
    table.accumulatesErrors
      ? "Error accumulation note: This table stores error records and may grow continuously during runtime."
      : "Error accumulation note: This table is not dedicated to error accumulation.",
    "Fields:",
    ...table.fields.map(
      (field) =>
        `- ${field.name} (${field.type}, ${field.nullable ? "nullable" : "required"}): ${field.description}`,
    ),
    "Query options:",
    '- `limit` / `offset` for pagination.',
    '- `filters` for conditional rows (field + operator + value).',
    `- Supported operators: ${databaseDebugFilterOperatorValues.join(", ")}.`,
    "- `filterMode`: `all` (AND) or `any` (OR).",
  ];

  return lines.join("\n");
}

export function buildDatabaseDebugLatestThreadToolDescription(): string {
  const lines = [
    "Debug read tool for retrieving a full thread snapshot in one call.",
    "Role: Reads the most-recent thread (or an explicit threadId) together with instruction, messages, message skill activations, MCP servers, MCP RPC logs, thread skill selections, and related app event logs.",
    "Schema source: prisma/schema.prisma (Thread, ThreadInstruction, ThreadMessage, ThreadMessageSkillActivation, ThreadMcpConnection, ThreadOperationLog, ThreadSkillActivation, WorkspaceSkillProfile, WorkspaceSkillRegistryProfile, RuntimeEventLog).",
    "Input options:",
    "- `threadId` (TEXT, optional): Specific thread ID to read. When omitted, the latest thread is selected by updatedAt.",
    "- `includeArchived` (BOOLEAN, optional): Include archived threads when selecting the latest thread. Defaults to true.",
    "- `includeRuntimeEventLogs` (BOOLEAN, optional): Include thread-linked RuntimeEventLog rows. Defaults to true.",
    "- `includeAllRows` (BOOLEAN, optional): Return all related thread rows (messages/MCP/skills) without per-section take limits. Defaults to true.",
    `- \`messageLimit\` (INTEGER, optional): Applied when includeAllRows=false. Defaults to ${databaseDebugLatestThreadDefaultMessageLimit} (max ${databaseDebugLatestThreadMaxMessageLimit}).`,
    `- \`mcpServerLimit\` (INTEGER, optional): Applied when includeAllRows=false. Defaults to ${databaseDebugLatestThreadDefaultMcpServerLimit} (max ${databaseDebugLatestThreadMaxMcpServerLimit}).`,
    `- \`mcpRpcLimit\` (INTEGER, optional): Applied when includeAllRows=false. Defaults to ${databaseDebugLatestThreadDefaultMcpRpcLimit} (max ${databaseDebugLatestThreadMaxMcpRpcLimit}).`,
    `- \`skillSelectionLimit\` (INTEGER, optional): Applied when includeAllRows=false. Defaults to ${databaseDebugLatestThreadDefaultSkillSelectionLimit} (max ${databaseDebugLatestThreadMaxSkillSelectionLimit}).`,
    `- \`runtimeEventLimit\` (INTEGER, optional): Maximum RuntimeEventLog rows when includeRuntimeEventLogs=true. Defaults to ${databaseDebugLatestThreadDefaultRuntimeEventLimit} (max ${databaseDebugLatestThreadMaxRuntimeEventLimit}).`,
    "Output fields:",
    "- `target`: Which thread-selection mode was used (`latest` or `by_id`), and the effective threadId/includeArchived flags.",
    "- `found`: Whether a matching thread exists.",
    "- `snapshot.thread`: Thread core metadata. Includes parsed `threadEnvironment` alongside raw `threadEnvironmentJson`.",
    "- `snapshot.instruction`: Per-thread instruction row (or null when absent).",
    "- `snapshot.messages[]`: Ordered thread messages. Includes parsed `attachments` plus linked `skillActivations` and normalized `normalizedSkillActivations`.",
    "- `snapshot.mcpServers[]`: Ordered MCP server snapshot rows. Includes parsed `headers`/`args`/`env` plus raw JSON fields.",
    "- `snapshot.mcpRpcLogs[]`: Ordered MCP RPC rows. Includes parsed `request`/`response` plus raw JSON fields.",
    "- `snapshot.skillSelections[]`: Ordered thread skill activations including linked `skillProfile` and optional `skillProfile.registryProfile`.",
    "- `runtimeEventLogs[]`: Related RuntimeEventLog rows for the thread. Includes parsed `context` plus raw `contextJson`.",
    "- `counts`: Total row counts per section in storage.",
    "- `truncation`: True when returned rows are truncated by limits.",
  ];

  return lines.join("\n");
}

export function normalizeDatabaseDebugLatestThreadReadOptions(
  options: {
    threadId?: unknown;
    includeArchived?: unknown;
    includeRuntimeEventLogs?: unknown;
    includeAllRows?: unknown;
    messageLimit?: unknown;
    mcpServerLimit?: unknown;
    mcpRpcLimit?: unknown;
    skillSelectionLimit?: unknown;
    runtimeEventLimit?: unknown;
  } = {},
): DatabaseDebugLatestThreadReadOptions {
  return {
    threadId: readOptionalTextOption(options.threadId, 256),
    includeArchived: readBooleanOption(options.includeArchived, true),
    includeRuntimeEventLogs: readBooleanOption(options.includeRuntimeEventLogs, true),
    includeAllRows: readBooleanOption(options.includeAllRows, true),
    messageLimit: readBoundedIntegerOption(
      options.messageLimit,
      databaseDebugLatestThreadDefaultMessageLimit,
      1,
      databaseDebugLatestThreadMaxMessageLimit,
    ),
    mcpServerLimit: readBoundedIntegerOption(
      options.mcpServerLimit,
      databaseDebugLatestThreadDefaultMcpServerLimit,
      1,
      databaseDebugLatestThreadMaxMcpServerLimit,
    ),
    mcpRpcLimit: readBoundedIntegerOption(
      options.mcpRpcLimit,
      databaseDebugLatestThreadDefaultMcpRpcLimit,
      1,
      databaseDebugLatestThreadMaxMcpRpcLimit,
    ),
    skillSelectionLimit: readBoundedIntegerOption(
      options.skillSelectionLimit,
      databaseDebugLatestThreadDefaultSkillSelectionLimit,
      1,
      databaseDebugLatestThreadMaxSkillSelectionLimit,
    ),
    runtimeEventLimit: readBoundedIntegerOption(
      options.runtimeEventLimit,
      databaseDebugLatestThreadDefaultRuntimeEventLimit,
      1,
      databaseDebugLatestThreadMaxRuntimeEventLimit,
    ),
  };
}

export async function readDatabaseDebugLatestThreadSnapshot(
  options: DatabaseDebugLatestThreadReadOptions,
): Promise<DatabaseDebugLatestThreadReadResult> {
  const includeAllRows = options.includeAllRows;
  const selectedById = Boolean(options.threadId);
  const thread = selectedById
    ? await prisma.thread.findFirst({
        where: {
          id: options.threadId!,
        },
        include: {
          instruction: true,
          messages: {
            orderBy: { conversationOrder: "asc" },
            ...(includeAllRows ? {} : { take: options.messageLimit }),
            include: {
              skillActivations: {
                orderBy: { selectionOrder: "asc" },
                include: {
                  skillProfile: {
                    include: {
                      registryProfile: true,
                    },
                  },
                },
              },
            },
          },
          mcpServers: {
            orderBy: { selectionOrder: "asc" },
            ...(includeAllRows ? {} : { take: options.mcpServerLimit }),
          },
          mcpRpcLogs: {
            orderBy: { conversationOrder: "asc" },
            ...(includeAllRows ? {} : { take: options.mcpRpcLimit }),
          },
          skillSelections: {
            orderBy: { selectionOrder: "asc" },
            ...(includeAllRows ? {} : { take: options.skillSelectionLimit }),
            include: {
              skillProfile: {
                include: {
                  registryProfile: true,
                },
              },
            },
          },
          _count: {
            select: {
              messages: true,
              mcpServers: true,
              mcpRpcLogs: true,
              skillSelections: true,
            },
          },
        },
      })
    : await prisma.thread.findFirst({
        where: options.includeArchived ? undefined : { deletedAt: null },
        orderBy: [
          { updatedAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        include: {
          instruction: true,
          messages: {
            orderBy: { conversationOrder: "asc" },
            ...(includeAllRows ? {} : { take: options.messageLimit }),
            include: {
              skillActivations: {
                orderBy: { selectionOrder: "asc" },
                include: {
                  skillProfile: {
                    include: {
                      registryProfile: true,
                    },
                  },
                },
              },
            },
          },
          mcpServers: {
            orderBy: { selectionOrder: "asc" },
            ...(includeAllRows ? {} : { take: options.mcpServerLimit }),
          },
          mcpRpcLogs: {
            orderBy: { conversationOrder: "asc" },
            ...(includeAllRows ? {} : { take: options.mcpRpcLimit }),
          },
          skillSelections: {
            orderBy: { selectionOrder: "asc" },
            ...(includeAllRows ? {} : { take: options.skillSelectionLimit }),
            include: {
              skillProfile: {
                include: {
                  registryProfile: true,
                },
              },
            },
          },
          _count: {
            select: {
              messages: true,
              mcpServers: true,
              mcpRpcLogs: true,
              skillSelections: true,
            },
          },
        },
      });

  if (!thread) {
    return {
      target: {
        mode: selectedById ? "by_id" : "latest",
        threadId: options.threadId,
        includeArchived: options.includeArchived,
      },
      found: false,
      snapshot: null,
      runtimeEventLogs: [],
      counts: {
        messages: 0,
        messageSkillActivations: 0,
        mcpServers: 0,
        mcpRpcLogs: 0,
        skillSelections: 0,
        runtimeEventLogs: 0,
      },
      truncation: {
        messages: false,
        messageSkillActivations: false,
        mcpServers: false,
        mcpRpcLogs: false,
        skillSelections: false,
        runtimeEventLogs: false,
      },
    };
  }

  const [runtimeEventLogs, runtimeEventLogCount, messageSkillActivationCount] = options.includeRuntimeEventLogs
    ? await Promise.all([
        prisma.runtimeEventLog.findMany({
          where: {
            threadId: thread.id,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: options.runtimeEventLimit,
        }),
        prisma.runtimeEventLog.count({
          where: {
            threadId: thread.id,
          },
        }),
        prisma.threadMessageSkillActivation.count({
          where: {
            message: {
              threadId: thread.id,
            },
          },
        }),
      ])
    : await Promise.all([
        Promise.resolve([]),
        Promise.resolve(0),
        prisma.threadMessageSkillActivation.count({
          where: {
            message: {
              threadId: thread.id,
            },
          },
        }),
      ]);

  const messages = thread.messages.map((message) => ({
    ...message,
    attachments: normalizeUnknownForJson(readJsonValue(message.attachmentsJson, [])),
    skillActivations: message.skillActivations.map((activation) => ({
      ...activation,
      skillProfile: {
        ...activation.skillProfile,
        registryProfile: activation.skillProfile.registryProfile
          ? { ...activation.skillProfile.registryProfile }
          : null,
      },
    })),
    normalizedSkillActivations: message.skillActivations.map((activation) => ({
      name: activation.skillProfile.name,
      location: activation.skillProfile.location,
    })),
  }));
  const messageSkillActivationRows = messages.flatMap((message) => message.skillActivations);
  const mcpServers = thread.mcpServers.map((server) => ({
    ...server,
    headers: normalizeUnknownForJson(readJsonValue(server.headersJson, {})),
    args: normalizeUnknownForJson(readJsonValue(server.argsJson, [])),
    env: normalizeUnknownForJson(readJsonValue(server.envJson, {})),
  }));
  const mcpRpcLogs = thread.mcpRpcLogs.map((entry) => ({
    ...entry,
    request: normalizeUnknownForJson(readJsonValue(entry.requestJson, null)),
    response: normalizeUnknownForJson(readJsonValue(entry.responseJson, null)),
  }));
  const skillSelections = thread.skillSelections.map((selection) => ({
    ...selection,
    skillProfile: {
      ...selection.skillProfile,
      registryProfile: selection.skillProfile.registryProfile
        ? { ...selection.skillProfile.registryProfile }
        : null,
    },
  }));
  const threadRecord = {
    id: thread.id,
    userId: thread.userId,
    name: thread.name,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    deletedAt: thread.deletedAt,
    reasoningEffort: thread.reasoningEffort,
    webSearchEnabled: thread.webSearchEnabled,
    threadEnvironmentJson: thread.threadEnvironmentJson,
    threadEnvironment: normalizeUnknownForJson(readJsonValue(thread.threadEnvironmentJson, {})),
  };
  const instruction = thread.instruction ? { ...thread.instruction } : null;
  const normalizedRuntimeEventLogs = runtimeEventLogs.map((event) => ({
    ...event,
    context: normalizeUnknownForJson(readJsonValue(event.contextJson, {})),
  }));

  return {
    target: {
      mode: selectedById ? "by_id" : "latest",
      threadId: thread.id,
      includeArchived: options.includeArchived,
    },
    found: true,
    snapshot: {
      thread: threadRecord,
      instruction,
      messages,
      mcpServers,
      mcpRpcLogs,
      skillSelections,
    },
    runtimeEventLogs: normalizedRuntimeEventLogs.map((row) => normalizeRecordForJson(row)),
    counts: {
      messages: thread._count.messages,
      messageSkillActivations: messageSkillActivationCount,
      mcpServers: thread._count.mcpServers,
      mcpRpcLogs: thread._count.mcpRpcLogs,
      skillSelections: thread._count.skillSelections,
      runtimeEventLogs: runtimeEventLogCount,
    },
    truncation: {
      messages: messages.length < thread._count.messages,
      messageSkillActivations: messageSkillActivationRows.length < messageSkillActivationCount,
      mcpServers: mcpServers.length < thread._count.mcpServers,
      mcpRpcLogs: mcpRpcLogs.length < thread._count.mcpRpcLogs,
      skillSelections: skillSelections.length < thread._count.skillSelections,
      runtimeEventLogs: normalizedRuntimeEventLogs.length < runtimeEventLogCount,
    },
  };
}

export function normalizeDatabaseDebugReadOptions(
  options: {
    limit?: unknown;
    offset?: unknown;
    filterMode?: unknown;
    filters?: unknown;
  } = {},
  table?: DatabaseDebugTableDefinition,
): DatabaseDebugTableReadOptions {
  const parsedLimit = readIntegerOption(options.limit);
  const parsedOffset = readIntegerOption(options.offset);
  const limitCandidate =
    parsedLimit === null ? databaseDebugDefaultReadLimit : parsedLimit;
  const offsetCandidate = parsedOffset === null ? 0 : parsedOffset;

  const limit = Math.min(databaseDebugMaxReadLimit, Math.max(1, limitCandidate));
  const offset = Math.min(databaseDebugMaxReadOffset, Math.max(0, offsetCandidate));

  return {
    limit,
    offset,
    filterMode: readFilterMode(options.filterMode),
    filters: readFilters(options.filters, table),
  };
}

export async function readDatabaseDebugTableRows(
  table: DatabaseDebugTableDefinition,
  options: DatabaseDebugTableReadOptions,
): Promise<DatabaseDebugTableReadResult> {
  const whereClause = buildWhereClause(table, options);
  const totalRows = await readDatabaseDebugTableRowCount(table.tableName, whereClause);
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "${table.tableName}"${whereClause.sql} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
    ...whereClause.params,
    options.limit,
    options.offset,
  );

  const normalizedRows = rows.map((row) => normalizeRecordForJson(row));
  const rowCount = normalizedRows.length;
  const hasMore = options.offset + rowCount < totalRows;

  return {
    tableName: table.tableName,
    purpose: table.purpose,
    accumulatesErrors: table.accumulatesErrors,
    fields: table.fields,
    filtering: {
      filterMode: options.filterMode,
      filterCount: options.filters.length,
      filters: options.filters,
    },
    pagination: {
      limit: options.limit,
      offset: options.offset,
      rowCount,
      totalRows,
      hasMore,
    },
    rows: normalizedRows,
  };
}

type SqlClause = {
  sql: string;
  params: unknown[];
};

async function readDatabaseDebugTableRowCount(
  tableName: string,
  whereClause: SqlClause,
): Promise<number> {
  const result = await prisma.$queryRawUnsafe<Array<{ count?: unknown }>>(
    `SELECT COUNT(*) AS count FROM "${tableName}"${whereClause.sql}`,
    ...whereClause.params,
  );
  const countValue = result[0]?.count;
  return readIntegerFromUnknown(countValue);
}

function buildWhereClause(
  table: DatabaseDebugTableDefinition,
  options: DatabaseDebugTableReadOptions,
): SqlClause {
  if (options.filters.length === 0) {
    return { sql: "", params: [] };
  }

  const fieldNameSet = new Set(table.fields.map((field) => field.name));
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const filter of options.filters) {
    if (!fieldNameSet.has(filter.field)) {
      continue;
    }

    const column = quoteSqlIdentifier(filter.field);
    if (filter.operator === "is_null") {
      clauses.push(`${column} IS NULL`);
      continue;
    }
    if (filter.operator === "is_not_null") {
      clauses.push(`${column} IS NOT NULL`);
      continue;
    }

    if (filter.operator === "in") {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        continue;
      }

      const nonNullValues = filter.value.filter(
        (value): value is string | number | boolean => value !== null,
      );
      const includesNull = filter.value.some((value) => value === null);
      const parts: string[] = [];
      if (nonNullValues.length > 0) {
        const placeholders = nonNullValues.map(() => "?").join(", ");
        parts.push(`${column} IN (${placeholders})`);
        for (const value of nonNullValues) {
          params.push(normalizeSqlParameterValue(value));
        }
      }
      if (includesNull) {
        parts.push(`${column} IS NULL`);
      }
      if (parts.length === 1) {
        clauses.push(parts[0]);
      } else if (parts.length > 1) {
        clauses.push(`(${parts.join(" OR ")})`);
      }
      continue;
    }

    if (filter.value === undefined || Array.isArray(filter.value)) {
      continue;
    }

    if (filter.operator === "eq") {
      if (filter.value === null) {
        clauses.push(`${column} IS NULL`);
      } else {
        clauses.push(`${column} = ?`);
        params.push(normalizeSqlParameterValue(filter.value));
      }
      continue;
    }

    if (filter.operator === "ne") {
      if (filter.value === null) {
        clauses.push(`${column} IS NOT NULL`);
      } else {
        clauses.push(`${column} <> ?`);
        params.push(normalizeSqlParameterValue(filter.value));
      }
      continue;
    }

    if (
      filter.operator === "gt" ||
      filter.operator === "gte" ||
      filter.operator === "lt" ||
      filter.operator === "lte"
    ) {
      if (typeof filter.value !== "number") {
        continue;
      }

      const operator =
        filter.operator === "gt"
          ? ">"
          : filter.operator === "gte"
            ? ">="
            : filter.operator === "lt"
              ? "<"
              : "<=";
      clauses.push(`${column} ${operator} ?`);
      params.push(filter.value);
      continue;
    }

    const escapedText = escapeSqlLikePattern(String(filter.value));
    const pattern =
      filter.operator === "contains"
        ? `%${escapedText}%`
        : filter.operator === "starts_with"
          ? `${escapedText}%`
          : `%${escapedText}`;
    clauses.push(`LOWER(CAST(${column} AS TEXT)) LIKE LOWER(?) ESCAPE '\\'`);
    params.push(pattern);
  }

  if (clauses.length === 0) {
    return { sql: "", params: [] };
  }

  return {
    sql: ` WHERE ${clauses.join(options.filterMode === "any" ? " OR " : " AND ")}`,
    params,
  };
}

function readIntegerOption(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function readBoundedIntegerOption(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = readIntegerOption(value);
  const candidate = parsed === null ? fallback : parsed;
  return Math.min(max, Math.max(min, candidate));
}

function readBooleanOption(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readOptionalTextOption(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function readFilterMode(value: unknown): DatabaseDebugFilterMode {
  return value === "any" ? "any" : "all";
}

function readFilters(
  value: unknown,
  table?: DatabaseDebugTableDefinition,
): DatabaseDebugFilter[] {
  if (!table || !Array.isArray(value)) {
    return [];
  }

  const fieldNames = new Set(table.fields.map((field) => field.name));
  const filters: DatabaseDebugFilter[] = [];

  for (const entry of value) {
    if (filters.length >= databaseDebugMaxReadFilters) {
      break;
    }
    if (!isRecord(entry)) {
      continue;
    }

    const field = typeof entry.field === "string" ? entry.field.trim() : "";
    if (!field || !fieldNames.has(field)) {
      continue;
    }

    const operator = readFilterOperator(entry.operator);
    if (!operator) {
      continue;
    }

    const normalized = readFilterValue(operator, entry.value);
    if (!normalized.ok) {
      continue;
    }

    filters.push({
      field,
      operator,
      ...(normalized.value !== undefined ? { value: normalized.value } : {}),
    });
  }

  return filters;
}

function readFilterOperator(value: unknown): DatabaseDebugFilterOperator | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim() as DatabaseDebugFilterOperator;
  return databaseDebugFilterOperatorValues.includes(normalized)
    ? normalized
    : null;
}

function readFilterValue(
  operator: DatabaseDebugFilterOperator,
  value: unknown,
):
  | { ok: true; value?: DatabaseDebugFilterPrimitive | DatabaseDebugFilterPrimitive[] }
  | { ok: false } {
  if (operator === "is_null" || operator === "is_not_null") {
    return { ok: true };
  }

  if (operator === "in") {
    if (!Array.isArray(value)) {
      return { ok: false };
    }

    const values = value
      .map((entry) => readFilterPrimitive(entry))
      .filter((entry): entry is DatabaseDebugFilterPrimitive => entry !== undefined)
      .slice(0, databaseDebugMaxReadInValues);

    return values.length > 0 ? { ok: true, value: values } : { ok: false };
  }

  const primitive = readFilterPrimitive(value);
  if (primitive === undefined) {
    return { ok: false };
  }

  if (operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte") {
    return typeof primitive === "number"
      ? { ok: true, value: primitive }
      : { ok: false };
  }

  if (operator === "contains" || operator === "starts_with" || operator === "ends_with") {
    const textValue = String(primitive);
    return { ok: true, value: textValue.slice(0, databaseDebugMaxTextFilterLength) };
  }

  if (typeof primitive === "string") {
    return { ok: true, value: primitive.slice(0, databaseDebugMaxTextFilterLength) };
  }

  return { ok: true, value: primitive };
}

function readFilterPrimitive(value: unknown): DatabaseDebugFilterPrimitive | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeSqlParameterValue(value: string | number | boolean): string | number {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return value;
}

function escapeSqlLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readIntegerFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "bigint") {
    if (value < 0n) {
      return 0;
    }

    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? Math.trunc(asNumber) : Number.MAX_SAFE_INTEGER;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }

  return 0;
}

function normalizeRecordForJson(input: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    normalized[key] = normalizeUnknownForJson(value);
  }
  return normalized;
}

function normalizeUnknownForJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeUnknownForJson(entry));
  }

  if (value && typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = normalizeUnknownForJson(entry);
    }
    return normalized;
  }

  return value;
}

function readJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }

  try {
    return JSON.parse(normalized) as T;
  } catch {
    return fallback;
  }
}
