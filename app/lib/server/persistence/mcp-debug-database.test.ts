/**
 * Test module verifying MCP database debug metadata helpers.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDatabaseDebugLatestThreadToolDescription,
  buildDatabaseDebugTableToolDescription,
  databaseDebugDefaultReadLimit,
  databaseDebugLatestThreadDefaultAppEventLimit,
  databaseDebugLatestThreadDefaultMcpRpcLimit,
  databaseDebugLatestThreadDefaultMcpServerLimit,
  databaseDebugLatestThreadDefaultMessageLimit,
  databaseDebugLatestThreadDefaultSkillSelectionLimit,
  databaseDebugLatestThreadMaxAppEventLimit,
  databaseDebugLatestThreadMaxMcpRpcLimit,
  databaseDebugLatestThreadMaxMcpServerLimit,
  databaseDebugLatestThreadMaxMessageLimit,
  databaseDebugLatestThreadMaxSkillSelectionLimit,
  databaseDebugMaxReadLimit,
  databaseDebugMaxReadOffset,
  databaseDebugMaxReadFilters,
  listDatabaseDebugTables,
  normalizeDatabaseDebugLatestThreadReadOptions,
  normalizeDatabaseDebugReadOptions,
  readDatabaseDebugTableByToolName,
} from "./mcp-debug-database";

describe("mcp-debug-database metadata", () => {
  it("publishes table catalog with role and field definitions", () => {
    const tables = listDatabaseDebugTables();
    expect(tables).toHaveLength(11);

    const appEventLog = tables.find((table) => table.tableName === "AppEventLog");
    expect(appEventLog).toBeTruthy();
    expect(appEventLog?.accumulatesErrors).toBe(true);
    expect(appEventLog?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "eventName",
          type: "TEXT",
        }),
      ]),
    );
  });

  it("keeps debug table catalog aligned with prisma schema models", () => {
    const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
    const schemaSource = readFileSync(schemaPath, "utf8");
    const modelNames = Array.from(
      schemaSource.matchAll(/^model\s+([A-Za-z0-9_]+)\s+\{/gm),
      (match) => match[1],
    );
    const modelNameSet = new Set(modelNames);

    for (const table of listDatabaseDebugTables()) {
      expect(modelNameSet.has(table.tableName)).toBe(true);
    }
  });

  it("marks error accumulation tables in tool descriptions", () => {
    const table = readDatabaseDebugTableByToolName("debug_read_thread_mcp_rpc_log_table");
    expect(table).toBeTruthy();
    expect(table?.accumulatesErrors).toBe(true);

    const description = buildDatabaseDebugTableToolDescription(table!);
    expect(description).toContain("Role:");
    expect(description).toContain("Error accumulation note: This table stores error records");
    expect(description).toContain("- isError (BOOLEAN, required):");
  });

  it("normalizes pagination options to safe bounds", () => {
    expect(normalizeDatabaseDebugReadOptions({})).toEqual({
      limit: databaseDebugDefaultReadLimit,
      offset: 0,
      filterMode: "all",
      filters: [],
    });

    expect(
      normalizeDatabaseDebugReadOptions({
        limit: 0,
        offset: -9,
      }),
    ).toEqual({
      limit: 1,
      offset: 0,
      filterMode: "all",
      filters: [],
    });

    expect(
      normalizeDatabaseDebugReadOptions({
        limit: databaseDebugMaxReadLimit + 999,
        offset: databaseDebugMaxReadOffset + 999,
      }),
    ).toEqual({
      limit: databaseDebugMaxReadLimit,
      offset: databaseDebugMaxReadOffset,
      filterMode: "all",
      filters: [],
    });
  });

  it("normalizes table-scoped filters and ignores invalid entries", () => {
    const table = readDatabaseDebugTableByToolName("debug_read_app_event_log_table");
    expect(table).toBeTruthy();

    const result = normalizeDatabaseDebugReadOptions(
      {
        filterMode: "any",
        filters: [
          {
            field: "level",
            operator: "eq",
            value: "error",
          },
          {
            field: "statusCode",
            operator: "gt",
            value: 499,
          },
          {
            field: "missing",
            operator: "eq",
            value: "ignored",
          },
          {
            field: "eventName",
            operator: "in",
            value: ["send_message_failed", "chat_stream_execution_failed"],
          },
          {
            field: "eventName",
            operator: "in",
            value: new Array(databaseDebugMaxReadFilters + 20).fill("x"),
          },
        ],
      },
      table!,
    );

    expect(result.filterMode).toBe("any");
    expect(result.filters).toEqual(
      expect.arrayContaining([
        {
          field: "level",
          operator: "eq",
          value: "error",
        },
        {
          field: "statusCode",
          operator: "gt",
          value: 499,
        },
        {
          field: "eventName",
          operator: "in",
          value: ["send_message_failed", "chat_stream_execution_failed"],
        },
      ]),
    );
    expect(result.filters).toHaveLength(4);
    expect(result.filters[3]).toEqual({
      field: "eventName",
      operator: "in",
      value: new Array(databaseDebugMaxReadFilters + 20).fill("x"),
    });
  });

  it("publishes latest-thread debug tool description with schema and field semantics", () => {
    const description = buildDatabaseDebugLatestThreadToolDescription();
    expect(description).toContain("Schema source: prisma/schema.prisma");
    expect(description).toContain("Input options:");
    expect(description).toContain("Output fields:");
    expect(description).toContain("snapshot.messages[]");
    expect(description).toContain("appEventLogs[]");
  });

  it("normalizes latest-thread read options with safe defaults and bounds", () => {
    expect(normalizeDatabaseDebugLatestThreadReadOptions()).toEqual({
      threadId: null,
      includeArchived: true,
      includeAppEventLogs: true,
      includeAllRows: true,
      messageLimit: databaseDebugLatestThreadDefaultMessageLimit,
      mcpServerLimit: databaseDebugLatestThreadDefaultMcpServerLimit,
      mcpRpcLimit: databaseDebugLatestThreadDefaultMcpRpcLimit,
      skillSelectionLimit: databaseDebugLatestThreadDefaultSkillSelectionLimit,
      appEventLimit: databaseDebugLatestThreadDefaultAppEventLimit,
    });

    expect(
      normalizeDatabaseDebugLatestThreadReadOptions({
        threadId: "  thread-001  ",
        includeArchived: false,
        includeAppEventLogs: false,
        includeAllRows: false,
        messageLimit: databaseDebugLatestThreadMaxMessageLimit + 1000,
        mcpServerLimit: databaseDebugLatestThreadMaxMcpServerLimit + 1000,
        mcpRpcLimit: databaseDebugLatestThreadMaxMcpRpcLimit + 1000,
        skillSelectionLimit: databaseDebugLatestThreadMaxSkillSelectionLimit + 1000,
        appEventLimit: databaseDebugLatestThreadMaxAppEventLimit + 1000,
      }),
    ).toEqual({
      threadId: "thread-001",
      includeArchived: false,
      includeAppEventLogs: false,
      includeAllRows: false,
      messageLimit: databaseDebugLatestThreadMaxMessageLimit,
      mcpServerLimit: databaseDebugLatestThreadMaxMcpServerLimit,
      mcpRpcLimit: databaseDebugLatestThreadMaxMcpRpcLimit,
      skillSelectionLimit: databaseDebugLatestThreadMaxSkillSelectionLimit,
      appEventLimit: databaseDebugLatestThreadMaxAppEventLimit,
    });
  });
});
