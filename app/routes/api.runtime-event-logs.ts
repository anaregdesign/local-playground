/**
 * API route module for /api/app-event-logs.
 */
import { readClientAppEventLogPayload } from "~/lib/observability/app-event-log";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import {
  installGlobalServerErrorLogging,
  logAppEvent,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import { methodNotAllowedResponse } from "~/lib/server/http";

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
      route: "/api/app-event-logs",
      eventName: "invalid_json_body",
      action: "parse_request_body",
      level: "warning",
      statusCode: 400,
      message: "Invalid JSON body.",
    });
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = readClientAppEventLogPayload(payload);
  if (!parsed) {
    await logServerRouteEvent({
      request,
      route: "/api/app-event-logs",
      eventName: "invalid_client_event_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: "Client event payload is invalid.",
      context: {
        payloadType: typeof payload,
      },
    });

    return Response.json({ error: "Invalid event log payload." }, { status: 400 });
  }

  const identity = await readAzureArmUserContext();
  await logAppEvent({
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

  return Response.json({ ok: true }, { status: 201 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
