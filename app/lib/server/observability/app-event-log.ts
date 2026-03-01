/**
 * Server runtime module.
 */
import {
  createEventLogId,
  normalizeAppEventLogLevel,
  normalizeAppEventLogSource,
  normalizeCategory,
  normalizeCreatedAt,
  normalizeEventName,
  normalizeMessage,
  normalizeOptionalLabel,
  normalizeOptionalPath,
  normalizeOptionalStatusCode,
  normalizeOptionalTextValue,
  normalizeOptionalUserId,
  readErrorDetails,
  serializeAppEventContext,
  type AppEventLogInput,
  type AppEventLogLevel,
} from "~/lib/observability/app-event-log";
import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";

type ProcessWithUncaughtMonitor = NodeJS.Process & {
  on(event: "uncaughtExceptionMonitor", listener: (error: Error, origin: string) => void): NodeJS.Process;
};

type ServerRouteEventInput = {
  request?: Request;
  route: string;
  eventName: string;
  action?: string;
  category?: string;
  level?: AppEventLogLevel;
  message?: string;
  error?: unknown;
  statusCode?: number;
  threadId?: string | null;
  tenantId?: string | null;
  principalId?: string | null;
  userId?: number | null;
  context?: unknown;
};

const globalForServerEventLog = globalThis as typeof globalThis & {
  __localPlaygroundServerErrorHooksInstalled?: boolean;
};

export function installGlobalServerErrorLogging(): void {
  if (globalForServerEventLog.__localPlaygroundServerErrorHooksInstalled) {
    return;
  }

  const monitoredProcess = process as ProcessWithUncaughtMonitor;

  monitoredProcess.on("uncaughtExceptionMonitor", (error, origin) => {
    const details = readErrorDetails(error);
    void logAppEvent({
      source: "server",
      level: "error",
      category: "runtime",
      eventName: "uncaught_exception",
      message: details.message,
      errorName: details.name,
      stack: details.stack,
      location: "process",
      action: origin,
      context: {
        origin,
      },
    });
  });

  process.on("unhandledRejection", (reason) => {
    const details = readErrorDetails(reason);
    void logAppEvent({
      source: "server",
      level: "error",
      category: "runtime",
      eventName: "unhandled_rejection",
      message: details.message,
      errorName: details.name,
      stack: details.stack,
      location: "process",
      action: "unhandledRejection",
      context: {
        reasonType: typeof reason,
      },
    });
  });

  process.on("warning", (warning) => {
    const details = readErrorDetails(warning);
    void logAppEvent({
      source: "server",
      level: "warning",
      category: "runtime",
      eventName: "process_warning",
      message: details.message,
      errorName: details.name,
      stack: details.stack,
      location: "process",
      action: "warning",
      context: {
        warningCode:
          warning && typeof warning === "object" && "code" in warning
            ? (warning as { code?: unknown }).code
            : null,
      },
    });
  });

  globalForServerEventLog.__localPlaygroundServerErrorHooksInstalled = true;
}

export async function logServerRouteEvent(input: ServerRouteEventInput): Promise<void> {
  const details = input.error !== undefined ? readErrorDetails(input.error) : null;
  const requestPath = input.request ? new URL(input.request.url).pathname : null;
  const message =
    typeof input.message === "string" && input.message.trim()
      ? input.message
      : details?.message ?? "Unknown error.";

  await logAppEvent({
    source: "server",
    level: input.level ?? "error",
    category: input.category ?? "api",
    eventName: input.eventName,
    message,
    errorName: details?.name ?? null,
    stack: details?.stack ?? null,
    location: input.route,
    action: input.action ?? null,
    statusCode: input.statusCode ?? null,
    httpMethod: input.request?.method ?? null,
    httpPath: requestPath,
    threadId: input.threadId ?? null,
    tenantId: input.tenantId ?? null,
    principalId: input.principalId ?? null,
    userId: input.userId ?? null,
    context: input.context ?? {},
  });
}

export async function logAppEvent(input: AppEventLogInput): Promise<void> {
  try {
    await ensurePersistenceDatabaseReady();
    await prisma.runtimeEventLog.create({
      data: {
        id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : createEventLogId(),
        createdAt: normalizeCreatedAt(input.createdAt),
        source: normalizeAppEventLogSource(input.source),
        level: normalizeAppEventLogLevel(input.level),
        category: normalizeCategory(input.category),
        eventName: normalizeEventName(input.eventName),
        message: normalizeMessage(input.message),
        errorName: normalizeOptionalLabel(input.errorName),
        location: normalizeOptionalPath(input.location),
        action: normalizeOptionalLabel(input.action),
        statusCode: normalizeOptionalStatusCode(input.statusCode),
        httpMethod: normalizeOptionalLabel(input.httpMethod),
        httpPath: normalizeOptionalPath(input.httpPath),
        threadId: normalizeOptionalLabel(input.threadId),
        tenantId: normalizeOptionalLabel(input.tenantId),
        principalId: normalizeOptionalLabel(input.principalId),
        userId: normalizeOptionalUserId(input.userId),
        stack: normalizeOptionalTextValue(input.stack),
        contextJson: serializeAppEventContext(input.context),
      },
    });
  } catch {
    // Logging must not throw into business logic.
  }
}
