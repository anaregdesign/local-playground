/**
 * API route module for /api/runtime/event-logs.
 */
import { readClientRuntimeEventLogPayload } from "~/lib/observability/runtime-event-log";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import {
  installGlobalServerErrorLogging,
  logRuntimeEventWithId,
  logServerRouteEvent,
} from "~/lib/server/observability/runtime-event-log";
import {
  errorResponse,
  invalidJsonResponse,
  methodNotAllowedResponse,
  validationErrorResponse,
} from "~/lib/server/http";

const APP_EVENT_LOGS_ALLOWED_METHODS = ["POST"] as const;

export function loader() {
  installGlobalServerErrorLogging();
  return methodNotAllowedResponse(APP_EVENT_LOGS_ALLOWED_METHODS);
}

export async function action({ request }: { request: Request }) {
  installGlobalServerErrorLogging();

  if (request.method !== "POST") {
    return methodNotAllowedResponse(APP_EVENT_LOGS_ALLOWED_METHODS);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await logServerRouteEvent({
      request,
      route: "/api/runtime/event-logs",
      eventName: "invalid_json_body",
      action: "parse_request_body",
      level: "warning",
      statusCode: 400,
      message: "Invalid JSON body.",
    });
    return invalidJsonResponse();
  }

  const parsed = readClientRuntimeEventLogPayload(payload);
  if (!parsed) {
    await logServerRouteEvent({
      request,
      route: "/api/runtime/event-logs",
      eventName: "invalid_client_event_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 422,
      message: "Client event payload is invalid.",
      context: {
        payloadType: typeof payload,
      },
    });

    return validationErrorResponse("invalid_event_log_payload", "Invalid event log payload.");
  }

  const identity = await readAzureArmUserContext();
  const eventLogId = await logRuntimeEventWithId({
    source: "client",
    level: parsed.level,
    category: parsed.category,
    eventName: parsed.eventName,
    message: parsed.message,
    errorName: parsed.errorName,
    location: parsed.location,
    action: parsed.action,
    statusCode: parsed.statusCode,
    httpMethod: request.method,
    httpPath: new URL(request.url).pathname,
    threadId: parsed.threadId,
    tenantId: identity?.tenantId,
    principalId: identity?.principalId,
    stack: parsed.stack,
    context: {
      ...(isRecord(parsed.context) ? parsed.context : { value: parsed.context ?? null }),
      userAgent: request.headers.get("user-agent") ?? "",
      referer: request.headers.get("referer") ?? "",
    },
  });

  if (!eventLogId) {
    await logServerRouteEvent({
      request,
      route: "/api/runtime/event-logs",
      eventName: "create_client_event_log_failed",
      action: "create_client_event_log",
      statusCode: 500,
      message: "Failed to persist runtime event log.",
    });
    return errorResponse({
      status: 500,
      code: "create_client_event_log_failed",
      error: "Failed to persist runtime event log.",
    });
  }

  return Response.json(
    {
      ok: true,
      eventLogId,
    },
    {
      status: 201,
      headers: {
        Location: `/api/runtime/event-logs/${encodeURIComponent(eventLogId)}`,
      },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
