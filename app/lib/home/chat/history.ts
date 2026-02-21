import type { McpRpcHistoryEntry } from "~/lib/home/chat/stream";

export function buildMcpHistoryByTurnId(
  entries: McpRpcHistoryEntry[],
): Map<string, McpRpcHistoryEntry[]> {
  const byTurnId = new Map<string, McpRpcHistoryEntry[]>();
  for (const entry of entries) {
    if (!entry.turnId) {
      continue;
    }

    const current = byTurnId.get(entry.turnId) ?? [];
    current.push(entry);
    byTurnId.set(entry.turnId, current);
  }
  return byTurnId;
}

export function buildMcpEntryCopyPayload(entry: McpRpcHistoryEntry): Record<string, unknown> {
  return {
    operationType: readOperationLogType(entry),
    id: entry.id,
    sequence: entry.sequence,
    serverName: entry.serverName,
    method: entry.method,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt,
    request: entry.request ?? null,
    response: entry.response ?? null,
    isError: entry.isError,
    turnId: entry.turnId,
  };
}

export function readOperationLogType(
  entry: Pick<McpRpcHistoryEntry, "method"> &
    Partial<Pick<McpRpcHistoryEntry, "operationType">>,
): "mcp" | "skill" {
  if (entry.operationType === "skill") {
    return "skill";
  }
  if (entry.operationType === "mcp") {
    return "mcp";
  }

  return entry.method.startsWith("skill_") ? "skill" : "mcp";
}
