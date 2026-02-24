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

export type DatabaseDebugTableReadOptions = {
  limit: number;
  offset: number;
};

export type DatabaseDebugTableReadResult = {
  tableName: string;
  purpose: string;
  accumulatesErrors: boolean;
  fields: DatabaseDebugTableFieldDefinition[];
  pagination: {
    limit: number;
    offset: number;
    rowCount: number;
    totalRows: number;
    hasMore: boolean;
  };
  rows: Array<Record<string, unknown>>;
};

export const databaseDebugDefaultReadLimit = 50;
export const databaseDebugMaxReadLimit = 200;
export const databaseDebugMaxReadOffset = 100_000;

const tableDefinitions: DatabaseDebugTableDefinition[] = [
  {
    tableName: "User",
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
        description: "Foreign key to User.id (one row per user).",
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
    tableName: "McpServerProfile",
    toolName: "debug_read_mcp_server_profile_table",
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
        description: "Foreign key to User.id.",
      },
      {
        name: "sortOrder",
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
    tableName: "Thread",
    toolName: "debug_read_thread_table",
    purpose:
      "Stores thread-level metadata and runtime options (name, timestamps, reasoning mode, web search toggle).",
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
        description: "Foreign key to User.id.",
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
    ],
  },
  {
    tableName: "ThreadSkillSelection",
    toolName: "debug_read_thread_skill_selection_table",
    purpose:
      "Stores ordered skill selections attached to each thread for agent runtime instructions.",
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
        name: "sortOrder",
        type: "INTEGER",
        nullable: false,
        description: "Order of selected skills in the thread.",
      },
      {
        name: "skillName",
        type: "TEXT",
        nullable: false,
        description: "Skill display name.",
      },
      {
        name: "skillPath",
        type: "TEXT",
        nullable: false,
        description: "Skill source path or URI.",
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
        name: "sortOrder",
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
    tableName: "ThreadMcpServer",
    toolName: "debug_read_thread_mcp_server_table",
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
        name: "sortOrder",
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
    tableName: "ThreadMcpRpcLog",
    toolName: "debug_read_thread_mcp_rpc_log_table",
    purpose:
      "Stores MCP RPC request/response logs for each thread and turn, including explicit error flags.",
    accumulatesErrors: true,
    fields: [
      {
        name: "id",
        type: "TEXT",
        nullable: false,
        description: "MCP log row ID.",
      },
      {
        name: "threadId",
        type: "TEXT",
        nullable: false,
        description: "Foreign key to Thread.id.",
      },
      {
        name: "sortOrder",
        type: "INTEGER",
        nullable: false,
        description: "Ordering index for persisted logs.",
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
    tableName: "AppEventLog",
    toolName: "debug_read_app_event_log_table",
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
        description: "User.id when available.",
      },
      {
        name: "stack",
        type: "TEXT",
        nullable: true,
        description: "Stack trace text for error events.",
      },
      {
        name: "context",
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
  ];

  return lines.join("\n");
}

export function normalizeDatabaseDebugReadOptions(options: {
  limit?: number;
  offset?: number;
}): DatabaseDebugTableReadOptions {
  const parsedLimit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.trunc(options.limit)
      : null;
  const parsedOffset =
    typeof options.offset === "number" && Number.isFinite(options.offset)
      ? Math.trunc(options.offset)
      : null;

  const limitCandidate =
    parsedLimit === null ? databaseDebugDefaultReadLimit : parsedLimit;
  const offsetCandidate = parsedOffset === null ? 0 : parsedOffset;

  const limit = Math.min(
    databaseDebugMaxReadLimit,
    Math.max(1, limitCandidate),
  );
  const offset = Math.min(databaseDebugMaxReadOffset, Math.max(0, offsetCandidate));

  return {
    limit,
    offset,
  };
}

export async function readDatabaseDebugTableRows(
  table: DatabaseDebugTableDefinition,
  options: DatabaseDebugTableReadOptions,
): Promise<DatabaseDebugTableReadResult> {
  const totalRows = await readDatabaseDebugTableRowCount(table.tableName);
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "${table.tableName}" ORDER BY rowid DESC LIMIT ? OFFSET ?`,
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

async function readDatabaseDebugTableRowCount(tableName: string): Promise<number> {
  const result = await prisma.$queryRawUnsafe<Array<{ count?: unknown }>>(
    `SELECT COUNT(*) AS count FROM "${tableName}"`,
  );
  const countValue = result[0]?.count;
  return readIntegerFromUnknown(countValue);
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
