/**
 * Home runtime support module.
 */
import { CLIENT_EVENT_LOG_DEDUPE_WINDOW_MS } from "~/lib/constants";
import {
  readErrorDetails,
  type ClientAppEventLogPayload,
} from "~/lib/observability/app-event-log";

type ClientRuntimeContextProvider = () => Record<string, unknown>;
type GlobalClientLoggerState = {
  refCount: number;
  uninstall: (() => void) | null;
};

const globalForClientEventLog = globalThis as typeof globalThis & {
  __localPlaygroundClientErrorLoggerState?: GlobalClientLoggerState;
};

const lastSentAtBySignature = new Map<string, number>();
const dedupeSignatureCacheLimit = 512;
const dedupeSignatureMaxAgeMs = CLIENT_EVENT_LOG_DEDUPE_WINDOW_MS * 6;

export function reportClientEvent(payload: ClientAppEventLogPayload): void {
  const now = Date.now();
  pruneSignatureCache(now);

  const signature = [
    payload.level,
    payload.category,
    payload.eventName,
    payload.message,
  ].join("::");
  const lastSentAt = lastSentAtBySignature.get(signature);
  if (lastSentAt !== undefined && now - lastSentAt < CLIENT_EVENT_LOG_DEDUPE_WINDOW_MS) {
    return;
  }

  if (lastSentAt !== undefined) {
    lastSentAtBySignature.delete(signature);
  }
  lastSentAtBySignature.set(signature, now);
  trimSignatureCache();

  void sendClientEvent(payload);
}

export function reportClientError(
  eventName: string,
  error: unknown,
  options: {
    category?: string;
    location?: string;
    action?: string;
    statusCode?: number;
    threadId?: string;
    context?: Record<string, unknown>;
  } = {},
): void {
  const details = readErrorDetails(error);
  reportClientEvent({
    level: "error",
    category: options.category ?? "frontend",
    eventName,
    message: details.message,
    errorName: details.name,
    stack: details.stack ?? undefined,
    ...(options.location ? { location: options.location } : {}),
    ...(options.action ? { action: options.action } : {}),
    ...(options.statusCode !== undefined ? { statusCode: options.statusCode } : {}),
    ...(options.threadId ? { threadId: options.threadId } : {}),
    ...(options.context ? { context: options.context } : {}),
  });
}

export function reportClientWarning(
  eventName: string,
  message: string,
  options: {
    category?: string;
    location?: string;
    action?: string;
    threadId?: string;
    context?: Record<string, unknown>;
  } = {},
): void {
  reportClientEvent({
    level: "warning",
    category: options.category ?? "frontend",
    eventName,
    message,
    ...(options.location ? { location: options.location } : {}),
    ...(options.action ? { action: options.action } : {}),
    ...(options.threadId ? { threadId: options.threadId } : {}),
    ...(options.context ? { context: options.context } : {}),
  });
}

export function installGlobalClientErrorLogging(
  contextProvider: ClientRuntimeContextProvider = () => ({}),
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const currentState = globalForClientEventLog.__localPlaygroundClientErrorLoggerState;
  if (currentState && currentState.uninstall) {
    currentState.refCount += 1;
    return () => {
      releaseGlobalClientLogger();
    };
  }

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  const onUnhandledError = (event: ErrorEvent) => {
    reportClientError("window_error", event.error ?? event.message, {
      category: "frontend",
      location: "window.error",
      action: "uncaught_exception",
      context: {
        ...contextProvider(),
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportClientError("window_unhandled_rejection", event.reason, {
      category: "frontend",
      location: "window.unhandledrejection",
      action: "unhandled_rejection",
      context: {
        ...contextProvider(),
        reasonType: typeof event.reason,
      },
    });
  };

  const patchedWarn = (...args: unknown[]) => {
    originalWarn(...args);
    reportClientWarning(
      "console_warning",
      summarizeConsoleArgs(args),
      {
        location: "console.warn",
        action: "warning",
        context: {
          ...contextProvider(),
          args: args.map((entry) => summarizeConsoleValue(entry)),
        },
      },
    );
  };

  const patchedError = (...args: unknown[]) => {
    originalError(...args);
    reportClientEvent({
      level: "error",
      category: "frontend",
      eventName: "console_error",
      message: summarizeConsoleArgs(args),
      location: "console.error",
      action: "error",
      context: {
        ...contextProvider(),
        args: args.map((entry) => summarizeConsoleValue(entry)),
      },
    });
  };

  console.warn = patchedWarn;
  console.error = patchedError;
  window.addEventListener("error", onUnhandledError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  globalForClientEventLog.__localPlaygroundClientErrorLoggerState = {
    refCount: 1,
    uninstall: () => {
      if (console.warn === patchedWarn) {
        console.warn = originalWarn;
      }
      if (console.error === patchedError) {
        console.error = originalError;
      }
      window.removeEventListener("error", onUnhandledError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    },
  };

  return () => {
    releaseGlobalClientLogger();
  };
}

function releaseGlobalClientLogger(): void {
  const state = globalForClientEventLog.__localPlaygroundClientErrorLoggerState;
  if (!state || !state.uninstall) {
    return;
  }

  state.refCount -= 1;
  if (state.refCount > 0) {
    return;
  }

  state.uninstall();
  globalForClientEventLog.__localPlaygroundClientErrorLoggerState = undefined;
}

function pruneSignatureCache(now: number): void {
  for (const [signature, lastSentAt] of lastSentAtBySignature) {
    if (now - lastSentAt <= dedupeSignatureMaxAgeMs) {
      continue;
    }
    lastSentAtBySignature.delete(signature);
  }
}

function trimSignatureCache(): void {
  while (lastSentAtBySignature.size > dedupeSignatureCacheLimit) {
    const oldest = lastSentAtBySignature.keys().next();
    if (oldest.done) {
      return;
    }
    lastSentAtBySignature.delete(oldest.value);
  }
}

async function sendClientEvent(payload: ClientAppEventLogPayload): Promise<void> {
  try {
    await fetch("/api/app-event-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Do not throw from client telemetry.
  }
}

function summarizeConsoleArgs(args: unknown[]): string {
  const firstString = args.find((entry) => typeof entry === "string");
  if (typeof firstString === "string") {
    return firstString;
  }

  if (args.length === 0) {
    return "Console message";
  }

  return summarizeConsoleValue(args[0]);
}

function summarizeConsoleValue(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
