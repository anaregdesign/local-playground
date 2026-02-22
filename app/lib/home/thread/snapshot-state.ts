import type { McpServerConfig } from "~/lib/home/mcp/profile";
import type { ChatMessage } from "~/lib/home/chat/messages";
import type { McpRpcHistoryEntry } from "~/lib/home/chat/stream";
import type { ThreadSkillSelection } from "~/lib/home/skills/types";
import type { ThreadSnapshot } from "~/lib/home/thread/types";

export function cloneMessages(value: ChatMessage[]): ChatMessage[] {
  return value.map((message) => ({
    ...message,
    attachments: message.attachments.map((attachment) => ({ ...attachment })),
  }));
}

export function cloneMcpServers(value: McpServerConfig[]): McpServerConfig[] {
  return value.map((server) =>
    server.transport === "stdio"
      ? {
          ...server,
          args: [...server.args],
          env: { ...server.env },
        }
      : {
          ...server,
          headers: { ...server.headers },
        },
  );
}

export function cloneMcpRpcHistory(value: McpRpcHistoryEntry[]): McpRpcHistoryEntry[] {
  return value.map((entry) => ({
    ...entry,
  }));
}

export function cloneThreadSkillSelections(value: ThreadSkillSelection[]): ThreadSkillSelection[] {
  return value.map((entry) => ({
    ...entry,
  }));
}

export function buildThreadSaveSignature(snapshot: ThreadSnapshot): string {
  return JSON.stringify({
    name: snapshot.name,
    deletedAt: snapshot.deletedAt,
    agentInstruction: snapshot.agentInstruction,
    messages: snapshot.messages,
    mcpServers: snapshot.mcpServers,
    mcpRpcHistory: snapshot.mcpRpcHistory,
    skillSelections: snapshot.skillSelections,
  });
}

export function hasThreadInteraction(
  snapshot: Pick<ThreadSnapshot, "messages"> &
    Partial<Pick<ThreadSnapshot, "skillSelections">>,
): boolean {
  if (snapshot.messages.length > 0) {
    return true;
  }

  return (snapshot.skillSelections?.length ?? 0) > 0;
}

export function isThreadSnapshotArchived(
  snapshot: Pick<ThreadSnapshot, "deletedAt"> | null | undefined,
): boolean {
  return snapshot !== null && snapshot !== undefined && snapshot.deletedAt !== null;
}

export function isThreadArchivedById(
  snapshots: Array<Pick<ThreadSnapshot, "id" | "deletedAt">>,
  threadIdRaw: string,
): boolean {
  const threadId = threadIdRaw.trim();
  if (!threadId) {
    return false;
  }

  const snapshot = snapshots.find((entry) => entry.id === threadId);
  return isThreadSnapshotArchived(snapshot);
}

export function upsertThreadSnapshot(
  current: ThreadSnapshot[],
  next: ThreadSnapshot,
): ThreadSnapshot[] {
  const existingIndex = current.findIndex((thread) => thread.id === next.id);
  if (existingIndex < 0) {
    return [next, ...current].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  const updated = current.map((thread, index) => (index === existingIndex ? next : thread));
  return updated.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
