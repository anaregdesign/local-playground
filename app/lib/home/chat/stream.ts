/**
 * Home runtime support module.
 */
import { readThreadEnvironmentFromUnknown } from "~/lib/home/thread/environment";

export type ChatApiResponse = {
  message?: string;
  threadEnvironment?: Record<string, string>;
  error?: string;
  errorCode?: "azure_login_required";
};

export type McpRpcHistoryEntry = {
  id: string;
  sequence: number;
  operationType: "mcp" | "skill";
  serverName: string;
  method: string;
  startedAt: string;
  completedAt: string;
  request: unknown;
  response: unknown;
  isError: boolean;
  turnId: string;
};

type ChatStreamProgressEvent = {
  type: "progress";
  message?: unknown;
  isMcp?: unknown;
};

type ChatStreamFinalEvent = {
  type: "final";
  message?: unknown;
  threadEnvironment?: unknown;
};

type ChatStreamErrorEvent = {
  type: "error";
  error?: unknown;
  errorCode?: unknown;
};

type ChatStreamMcpRpcEvent = {
  type: "mcp_rpc";
  record?: unknown;
};

type ChatStreamEvent =
  | ChatStreamProgressEvent
  | ChatStreamFinalEvent
  | ChatStreamErrorEvent
  | ChatStreamMcpRpcEvent;

export async function readChatEventStreamPayload(
  response: Response,
  handlers: {
    onProgress: (message: string) => void;
    onMcpRpcRecord: (entry: McpRpcHistoryEntry) => void;
  },
): Promise<ChatApiResponse> {
  if (!response.body) {
    return {
      error: "The server returned an empty stream.",
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: ChatApiResponse = {};

  const readChunk = (chunk: string) => {
    buffer += chunk;
    buffer = buffer.replace(/\r\n/g, "\n");

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const data = parseSseDataBlock(block);
      if (data) {
        const event = readChatStreamEvent(data);
        if (event) {
          if (event.type === "progress") {
            handlers.onProgress(event.message);
          } else if (event.type === "mcp_rpc") {
            handlers.onMcpRpcRecord(event.record);
          } else if (event.type === "final") {
            finalPayload = {
              message: event.message,
              threadEnvironment: event.threadEnvironment,
            };
          } else if (event.type === "error") {
            finalPayload = {
              error: event.error,
              ...(event.errorCode ? { errorCode: event.errorCode } : {}),
            };
          }
        }
      }

      separatorIndex = buffer.indexOf("\n\n");
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    readChunk(decoder.decode(value, { stream: true }));
  }

  const tail = decoder.decode();
  if (tail) {
    readChunk(tail);
  }

  return finalPayload.message || finalPayload.error
    ? finalPayload
    : { error: "The server returned an empty stream response." };
}

export function parseSseDataBlock(block: string): string | null {
  const lines = block.split("\n");
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join("\n").trim();
}

export function readChatStreamEvent(data: string): (
  | { type: "progress"; message: string }
  | { type: "final"; message: string; threadEnvironment: Record<string, string> }
  | { type: "error"; error: string; errorCode?: "azure_login_required" }
  | { type: "mcp_rpc"; record: McpRpcHistoryEntry }
) | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return null;
  }

  if (parsed.type === "progress") {
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    if (!message) {
      return null;
    }
    return {
      type: "progress",
      message,
    };
  }

  if (parsed.type === "final") {
    const message = typeof parsed.message === "string" ? parsed.message : "";
    if (!message) {
      return null;
    }
    return {
      type: "final",
      message,
      threadEnvironment: readThreadEnvironmentFromUnknown(parsed.threadEnvironment),
    };
  }

  if (parsed.type === "error") {
    const error = typeof parsed.error === "string" ? parsed.error : "Failed to send message.";
    return {
      type: "error",
      error,
      ...(parsed.errorCode === "azure_login_required"
        ? { errorCode: parsed.errorCode }
        : {}),
    };
  }

  if (parsed.type === "mcp_rpc") {
    const record = readMcpRpcHistoryEntryFromUnknown(parsed.record);
    if (!record) {
      return null;
    }

    return {
      type: "mcp_rpc",
      record,
    };
  }

  return null;
}

export function readMcpRpcHistoryEntryFromUnknown(value: unknown): McpRpcHistoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const sequence = typeof value.sequence === "number" ? value.sequence : Number.NaN;
  const serverName = typeof value.serverName === "string" ? value.serverName.trim() : "";
  const method = typeof value.method === "string" ? value.method.trim() : "";
  const operationType = value.operationType === "skill" ? "skill" : "mcp";
  const startedAt = typeof value.startedAt === "string" ? value.startedAt.trim() : "";
  const completedAt = typeof value.completedAt === "string" ? value.completedAt.trim() : "";
  const isError = value.isError === true;

  if (
    !id ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !serverName ||
    !method ||
    !startedAt ||
    !completedAt
  ) {
    return null;
  }

  return {
    id,
    sequence,
    operationType,
    serverName,
    method,
    startedAt,
    completedAt,
    request: "request" in value ? value.request : null,
    response: "response" in value ? value.response : null,
    isError,
    turnId: "",
  };
}

export function upsertMcpRpcHistoryEntry(
  current: McpRpcHistoryEntry[],
  entry: McpRpcHistoryEntry,
): McpRpcHistoryEntry[] {
  const existingIndex = current.findIndex((existing) => existing.id === entry.id);
  if (existingIndex < 0) {
    const insertIndex = findMcpRpcInsertIndex(current, entry);
    if (insertIndex === current.length) {
      return [...current, entry];
    }
    return [...current.slice(0, insertIndex), entry, ...current.slice(insertIndex)];
  }

  const existing = current[existingIndex];
  if (compareMcpRpcHistoryOrder(existing, entry) === 0) {
    const next = [...current];
    next[existingIndex] = entry;
    return next;
  }

  const withoutExisting = [
    ...current.slice(0, existingIndex),
    ...current.slice(existingIndex + 1),
  ];
  const insertIndex = findMcpRpcInsertIndex(withoutExisting, entry);
  if (insertIndex === withoutExisting.length) {
    return [...withoutExisting, entry];
  }
  return [
    ...withoutExisting.slice(0, insertIndex),
    entry,
    ...withoutExisting.slice(insertIndex),
  ];
}

export function appendProgressMessage(
  message: string,
  setMessages: (updater: (current: string[]) => string[]) => void,
): void {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }

  setMessages((current) => {
    if (current[current.length - 1] === trimmed) {
      return current;
    }

    const next = [...current, trimmed];
    return next.slice(-8);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function compareMcpRpcHistoryOrder(
  left: Pick<McpRpcHistoryEntry, "startedAt" | "sequence">,
  right: Pick<McpRpcHistoryEntry, "startedAt" | "sequence">,
): number {
  const timeOrder = left.startedAt.localeCompare(right.startedAt);
  if (timeOrder !== 0) {
    return timeOrder;
  }
  return left.sequence - right.sequence;
}

function findMcpRpcInsertIndex(
  entries: McpRpcHistoryEntry[],
  entry: McpRpcHistoryEntry,
): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareMcpRpcHistoryOrder(entries[middle], entry) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
