/**
 * Home runtime support module.
 */
import {
  THREAD_OPERATION_LOG_ROW_ID_PATTERN,
  THREAD_MCP_SERVER_ROW_ID_PATTERN,
} from "~/lib/constants";

export function normalizeThreadMcpServerSourceId(sourceId: string, index: number): string {
  let normalized = sourceId.trim();

  // Unwrap persisted row-id prefixes to keep source ids stable across load/save cycles.
  while (normalized.length > 0) {
    const match = normalized.match(THREAD_MCP_SERVER_ROW_ID_PATTERN);
    if (!match?.[1]) {
      break;
    }
    normalized = match[1].trim();
  }

  if (!normalized) {
    return `server-${index + 1}`;
  }

  return normalized;
}

export function buildThreadMcpServerRowId(threadId: string, sourceId: string, index: number): string {
  const normalizedThreadId = threadId.trim();
  const normalizedSourceId = normalizeThreadMcpServerSourceId(sourceId, index);
  return `thread:${normalizedThreadId}:mcp:${index}:${normalizedSourceId}`;
}

export function normalizeThreadOperationLogSourceRpcId(sourceId: string, index: number): string {
  let normalized = sourceId.trim();

  // Unwrap persisted row-id prefixes to keep source ids stable across load/save cycles.
  while (normalized.length > 0) {
    const match = normalized.match(THREAD_OPERATION_LOG_ROW_ID_PATTERN);
    if (!match?.[1]) {
      break;
    }
    normalized = match[1].trim();
  }

  if (!normalized) {
    return `rpc-${index + 1}`;
  }

  return normalized;
}

export function buildThreadOperationLogRowId(threadId: string, sourceId: string, index: number): string {
  const normalizedThreadId = threadId.trim();
  const normalizedSourceId = normalizeThreadOperationLogSourceRpcId(sourceId, index);
  return `thread:${normalizedThreadId}:rpc:${index}:${normalizedSourceId}`;
}

export function buildThreadSkillActivationRowId(threadId: string, index: number): string {
  const normalizedThreadId = threadId.trim();
  return `thread:${normalizedThreadId}:skill:${index}`;
}

export function buildThreadMessageSkillActivationRowId(
  messageId: string,
  index: number,
): string {
  const normalizedMessageId = messageId.trim();
  return `message:${normalizedMessageId}:skill:${index}`;
}
