/**
 * Test module verifying MCP database debug metadata helpers.
 */
import { describe, expect, it } from "vitest";
import {
  buildDatabaseDebugTableToolDescription,
  databaseDebugDefaultReadLimit,
  databaseDebugMaxReadLimit,
  databaseDebugMaxReadOffset,
  listDatabaseDebugTables,
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
    });

    expect(
      normalizeDatabaseDebugReadOptions({
        limit: 0,
        offset: -9,
      }),
    ).toEqual({
      limit: 1,
      offset: 0,
    });

    expect(
      normalizeDatabaseDebugReadOptions({
        limit: databaseDebugMaxReadLimit + 999,
        offset: databaseDebugMaxReadOffset + 999,
      }),
    ).toEqual({
      limit: databaseDebugMaxReadLimit,
      offset: databaseDebugMaxReadOffset,
    });
  });
});
