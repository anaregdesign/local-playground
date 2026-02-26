/**
 * Home runtime support module.
 */
import type { McpRpcHistoryEntry } from "~/lib/home/chat/stream";
import type { ThreadSkillSelection } from "~/lib/home/skills/types";

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

export function collectSuccessfulSkillGuideLocations(
  entries: McpRpcHistoryEntry[],
  selectedSkills: Pick<ThreadSkillSelection, "location">[],
): string[] {
  if (entries.length === 0 || selectedSkills.length === 0) {
    return [];
  }

  const selectedLocations: string[] = [];
  const selectedLocationSet = new Set<string>();
  for (const skill of selectedSkills) {
    const location = skill.location.trim();
    if (!location || selectedLocationSet.has(location)) {
      continue;
    }

    selectedLocations.push(location);
    selectedLocationSet.add(location);
  }
  if (selectedLocations.length === 0) {
    return [];
  }

  const successfulLocationSet = new Set<string>();
  for (const entry of entries) {
    if (readOperationLogType(entry) !== "skill") {
      continue;
    }
    if (entry.method !== "skill_read_guide" || entry.isError) {
      continue;
    }

    const responseResult = readJsonRpcResponseResult(entry.response);
    if (!responseResult || responseResult.ok !== true) {
      continue;
    }

    const location =
      typeof responseResult.location === "string" ? responseResult.location.trim() : "";
    if (!location || !selectedLocationSet.has(location)) {
      continue;
    }

    successfulLocationSet.add(location);
    if (successfulLocationSet.size === selectedLocationSet.size) {
      break;
    }
  }

  return selectedLocations.filter((location) => successfulLocationSet.has(location));
}

function readJsonRpcResponseResult(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const result = value.result;
  if (!isRecord(result)) {
    return null;
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
