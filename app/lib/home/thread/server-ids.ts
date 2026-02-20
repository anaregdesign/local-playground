const THREAD_MCP_SERVER_ROW_ID_PATTERN = /^thread:[^:]+:mcp:\d+:(.+)$/;

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
