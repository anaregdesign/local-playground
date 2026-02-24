/**
 * MCP route module for /mcp database debug server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as z from "zod/v4";
import {
  buildDatabaseDebugTableToolDescription,
  databaseDebugDefaultReadLimit,
  databaseDebugMaxReadLimit,
  databaseDebugMaxReadOffset,
  listDatabaseDebugTables,
  normalizeDatabaseDebugReadOptions,
  readDatabaseDebugTableRows,
} from "~/lib/server/persistence/mcp-debug-database";
import { ensurePersistenceDatabaseReady } from "~/lib/server/persistence/prisma";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";

const tableReadInputSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(databaseDebugMaxReadLimit)
    .optional()
    .describe(
      `Maximum rows to return. Defaults to ${databaseDebugDefaultReadLimit} (max ${databaseDebugMaxReadLimit}).`,
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .max(databaseDebugMaxReadOffset)
    .optional()
    .describe(
      `Pagination offset. Defaults to 0 (max ${databaseDebugMaxReadOffset}).`,
    ),
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
          message: "Method not allowed. Use POST /mcp.",
        },
        id: null,
      },
      { status: 405 },
    );
  }

  const server = createDatabaseDebugMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await ensurePersistenceDatabaseReady();
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/mcp",
      eventName: "mcp_debug_route_failed",
      action: "handle_mcp_request",
      statusCode: 500,
      error,
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

function createDatabaseDebugMcpServer(): McpServer {
  const server = new McpServer({
    name: "local-playground-database-debug",
    version: "1.0.0",
  });

  const tables = listDatabaseDebugTables();
  const errorAccumulationTables = tables
    .filter((table) => table.accumulatesErrors)
    .map((table) => table.tableName);

  server.registerTool(
    "debug_describe_database_tables",
    {
      description:
        "Returns the Local Playground Prisma table catalog with role, field definitions, and error-accumulation notes.",
    },
    async () => {
      const payload = {
        tables: tables.map((table) => ({
          tableName: table.tableName,
          toolName: table.toolName,
          purpose: table.purpose,
          accumulatesErrors: table.accumulatesErrors,
          fields: table.fields,
        })),
        errorAccumulationTables,
      };

      return buildToolResponse(payload);
    },
  );

  for (const table of tables) {
    server.registerTool(
      table.toolName,
      {
        description: buildDatabaseDebugTableToolDescription(table),
        inputSchema: tableReadInputSchema,
      },
      async (args) => {
        const options = normalizeDatabaseDebugReadOptions(args);
        const result = await readDatabaseDebugTableRows(table, options);
        return buildToolResponse(result);
      },
    );
  }

  return server;
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
