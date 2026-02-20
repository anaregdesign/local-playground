export type AppEventLogSource = "server" | "client";
export type AppEventLogLevel = "error" | "warning" | "info";

export type AppEventLogInput = {
  id?: string;
  createdAt?: string;
  source: AppEventLogSource;
  level: AppEventLogLevel;
  category: string;
  eventName: string;
  message: string;
  errorName?: string | null;
  location?: string | null;
  action?: string | null;
  statusCode?: number | null;
  httpMethod?: string | null;
  httpPath?: string | null;
  threadId?: string | null;
  tenantId?: string | null;
  principalId?: string | null;
  userId?: number | null;
  stack?: string | null;
  context?: unknown;
};

export type ClientAppEventLogPayload = {
  level: AppEventLogLevel;
  category: string;
  eventName: string;
  message: string;
  errorName?: string;
  location?: string;
  action?: string;
  statusCode?: number;
  threadId?: string;
  stack?: string;
  context?: unknown;
};

const MAX_CATEGORY_LENGTH = 80;
const MAX_EVENT_NAME_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TEXT_LENGTH = 8_000;
const MAX_PATH_LENGTH = 1_024;
const MAX_CONTEXT_DEPTH = 6;
const MAX_CONTEXT_KEYS = 200;
const MAX_CONTEXT_ARRAY_ITEMS = 200;

export function normalizeAppEventLogLevel(value: unknown): AppEventLogLevel {
  return value === "error" || value === "warning" || value === "info" ? value : "error";
}

export function normalizeAppEventLogSource(value: unknown): AppEventLogSource {
  return value === "client" || value === "server" ? value : "server";
}

export function readClientAppEventLogPayload(value: unknown): ClientAppEventLogPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const category = normalizeRequiredText(value.category, MAX_CATEGORY_LENGTH);
  const eventName = normalizeRequiredText(value.eventName, MAX_EVENT_NAME_LENGTH);
  const message = normalizeRequiredText(value.message, MAX_MESSAGE_LENGTH);
  if (!category || !eventName || !message) {
    return null;
  }

  const level = normalizeAppEventLogLevel(value.level);
  const errorName = normalizeOptionalText(value.errorName, MAX_EVENT_NAME_LENGTH);
  const location = normalizeOptionalText(value.location, MAX_PATH_LENGTH);
  const action = normalizeOptionalText(value.action, MAX_EVENT_NAME_LENGTH);
  const statusCode = normalizeOptionalSafeInteger(value.statusCode);
  const threadId = normalizeOptionalText(value.threadId, MAX_EVENT_NAME_LENGTH);
  const stack = normalizeOptionalText(value.stack, MAX_TEXT_LENGTH);
  const context = value.context;

  return {
    level,
    category,
    eventName,
    message,
    ...(errorName ? { errorName } : {}),
    ...(location ? { location } : {}),
    ...(action ? { action } : {}),
    ...(statusCode !== null ? { statusCode } : {}),
    ...(threadId ? { threadId } : {}),
    ...(stack ? { stack } : {}),
    ...(context !== undefined ? { context } : {}),
  };
}

export function readErrorDetails(error: unknown): {
  name: string;
  message: string;
  stack: string | null;
} {
  if (error instanceof Error) {
    const name = normalizeRequiredText(error.name, MAX_EVENT_NAME_LENGTH) || "Error";
    const message = normalizeRequiredText(error.message, MAX_MESSAGE_LENGTH) || "Unknown error.";
    const stack = normalizeOptionalText(error.stack, MAX_TEXT_LENGTH);
    return {
      name,
      message,
      stack,
    };
  }

  const message =
    typeof error === "string"
      ? normalizeRequiredText(error, MAX_MESSAGE_LENGTH)
      : normalizeRequiredText(safeStringify(error), MAX_MESSAGE_LENGTH);
  return {
    name: "UnknownError",
    message: message || "Unknown error.",
    stack: null,
  };
}

export function normalizeCreatedAt(value: unknown): string {
  const normalized = normalizeOptionalText(value, 64);
  if (!normalized) {
    return new Date().toISOString();
  }

  const parsedMs = Date.parse(normalized);
  return Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : new Date().toISOString();
}

export function normalizeCategory(value: unknown): string {
  return normalizeRequiredText(value, MAX_CATEGORY_LENGTH) || "general";
}

export function normalizeEventName(value: unknown): string {
  return normalizeRequiredText(value, MAX_EVENT_NAME_LENGTH) || "unknown_event";
}

export function normalizeMessage(value: unknown): string {
  return normalizeRequiredText(value, MAX_MESSAGE_LENGTH) || "Unknown error.";
}

export function normalizeOptionalStatusCode(value: unknown): number | null {
  return normalizeOptionalSafeInteger(value);
}

export function normalizeOptionalPath(value: unknown): string | null {
  return normalizeOptionalText(value, MAX_PATH_LENGTH);
}

export function normalizeOptionalLabel(value: unknown): string | null {
  return normalizeOptionalText(value, MAX_EVENT_NAME_LENGTH);
}

export function normalizeOptionalTextValue(value: unknown): string | null {
  return normalizeOptionalText(value, MAX_TEXT_LENGTH);
}

export function normalizeOptionalUserId(value: unknown): number | null {
  return normalizeOptionalSafeInteger(value);
}

export function serializeAppEventContext(context: unknown): string {
  try {
    const safeContext = sanitizeJsonValue(context, 0);
    return JSON.stringify(safeContext ?? {});
  } catch {
    return JSON.stringify({
      serializationError: "Failed to serialize event context.",
    });
  }
}

export function createEventLogId(): string {
  const maybeCrypto = globalThis.crypto;
  if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeOptionalSafeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return null;
  }

  return value;
}

function normalizeRequiredText(value: unknown, maxLength: number): string {
  const normalized = normalizeOptionalText(value, maxLength);
  return normalized ?? "";
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function sanitizeJsonValue(value: unknown, depth: number): unknown {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.slice(0, MAX_TEXT_LENGTH);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (depth >= MAX_CONTEXT_DEPTH) {
    return "[truncated]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_CONTEXT_ARRAY_ITEMS)
      .map((entry) => sanitizeJsonValue(entry, depth + 1));
  }

  if (!isRecord(value)) {
    return safeStringify(value);
  }

  const entries = Object.entries(value).slice(0, MAX_CONTEXT_KEYS);
  const sanitized: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim().slice(0, MAX_EVENT_NAME_LENGTH);
    if (!key) {
      continue;
    }
    sanitized[key] = sanitizeJsonValue(rawValue, depth + 1);
  }

  return sanitized;
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === "string") {
      return value;
    }

    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
