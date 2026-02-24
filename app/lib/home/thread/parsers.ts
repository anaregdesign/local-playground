/**
 * Home runtime support module.
 */
import type { ChatAttachment } from "~/lib/home/chat/attachments";
import type { ChatMessage } from "~/lib/home/chat/messages";
import type { McpRpcHistoryEntry } from "~/lib/home/chat/stream";
import { readMcpRpcHistoryEntryFromUnknown } from "~/lib/home/chat/stream";
import { readMcpServerFromUnknown } from "~/lib/home/mcp/profile";
import type { ReasoningEffort } from "~/lib/home/shared/view-types";
import { readThreadSkillSelectionList } from "~/lib/home/skills/parsers";
import type { ThreadSnapshot, ThreadSummary } from "~/lib/home/thread/types";

type ReadThreadSnapshotOptions = {
  fallbackInstruction?: string;
};

export function readThreadSnapshotList(
  value: unknown,
  options: ReadThreadSnapshotOptions = {},
): ThreadSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: ThreadSnapshot[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    const parsed = readThreadSnapshotFromUnknown(entry, options);
    if (!parsed || seenIds.has(parsed.id)) {
      continue;
    }

    seenIds.add(parsed.id);
    result.push(parsed);
  }

  return result;
}

export function readThreadSnapshotFromUnknown(
  value: unknown,
  options: ReadThreadSnapshotOptions = {},
): ThreadSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readTrimmedString(value.id);
  const name = readTrimmedString(value.name);
  const createdAt = readTrimmedString(value.createdAt);
  const updatedAt = readTrimmedString(value.updatedAt);
  const deletedAt = readNullableTrimmedString(value.deletedAt);
  const reasoningEffort = readReasoningEffortFromUnknown(value.reasoningEffort);
  const webSearchEnabled = readBooleanFromUnknown(value.webSearchEnabled);
  if (
    !id ||
    !name ||
    !createdAt ||
    !updatedAt ||
    deletedAt === undefined ||
    !reasoningEffort ||
    webSearchEnabled === null
  ) {
    return null;
  }

  const agentInstructionValue = value.agentInstruction;
  const fallbackInstruction = options.fallbackInstruction ?? "";
  const agentInstruction =
    typeof agentInstructionValue === "string" ? agentInstructionValue : fallbackInstruction;

  const messages = readThreadMessageList(value.messages);
  const mcpServers = readThreadMcpServerList(value.mcpServers);
  const mcpRpcHistory = readThreadMcpRpcHistoryList(value.mcpRpcHistory);
  const skillSelections = readThreadSkillSelectionList(value.skillSelections);

  return {
    id,
    name,
    createdAt,
    updatedAt,
    deletedAt,
    reasoningEffort,
    webSearchEnabled,
    agentInstruction,
    messages,
    mcpServers,
    mcpRpcHistory,
    skillSelections,
  };
}

export function buildThreadSummary(snapshot: ThreadSnapshot): ThreadSummary {
  return {
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    deletedAt: snapshot.deletedAt,
    messageCount: snapshot.messages.length,
    mcpServerCount: snapshot.mcpServers.length,
  };
}

function readThreadMessageList(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const messages: ChatMessage[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    const message = readThreadMessageFromUnknown(entry);
    if (!message || seenIds.has(message.id)) {
      continue;
    }

    seenIds.add(message.id);
    messages.push(message);
  }

  return messages;
}

function readThreadMessageFromUnknown(value: unknown): ChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readTrimmedString(value.id);
  const role = value.role;
  const content = typeof value.content === "string" ? value.content : "";
  const turnId = readTrimmedString(value.turnId);
  if (!id || (role !== "user" && role !== "assistant") || !turnId) {
    return null;
  }

  const attachments = readChatAttachmentList(value.attachments);

  return {
    id,
    role,
    content,
    turnId,
    attachments,
  };
}

function readChatAttachmentList(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const attachments: ChatAttachment[] = [];
  for (const entry of value) {
    const attachment = readChatAttachmentFromUnknown(entry);
    if (!attachment) {
      continue;
    }

    attachments.push(attachment);
  }

  return attachments;
}

function readChatAttachmentFromUnknown(value: unknown): ChatAttachment | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readTrimmedString(value.name);
  const mimeType = readTrimmedString(value.mimeType);
  const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl.trim() : "";
  const sizeBytes = readSafeInteger(value.sizeBytes);

  if (!name || !mimeType || !dataUrl || sizeBytes === null || sizeBytes < 0) {
    return null;
  }

  return {
    name,
    mimeType,
    sizeBytes,
    dataUrl,
  };
}

function readThreadMcpServerList(value: unknown): ThreadSnapshot["mcpServers"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const servers: ThreadSnapshot["mcpServers"] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    const server = readMcpServerFromUnknown(entry);
    if (!server || seenIds.has(server.id)) {
      continue;
    }

    seenIds.add(server.id);
    servers.push(server);
  }

  return servers;
}

function readThreadMcpRpcHistoryList(value: unknown): McpRpcHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: McpRpcHistoryEntry[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    const parsed = readThreadMcpRpcHistoryEntryFromUnknown(entry);
    if (!parsed || seenIds.has(parsed.id)) {
      continue;
    }

    seenIds.add(parsed.id);
    entries.push(parsed);
  }

  return entries;
}

function readThreadMcpRpcHistoryEntryFromUnknown(value: unknown): McpRpcHistoryEntry | null {
  const parsed = readMcpRpcHistoryEntryFromUnknown(value);
  if (!parsed || !isRecord(value)) {
    return null;
  }

  const turnId = readTrimmedString(value.turnId);
  if (!turnId) {
    return null;
  }

  return {
    ...parsed,
    turnId,
  };
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableTrimmedString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readSafeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return null;
  }

  return value;
}

function readReasoningEffortFromUnknown(value: unknown): ReasoningEffort | null {
  if (value === "none" || value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return null;
}

function readBooleanFromUnknown(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
