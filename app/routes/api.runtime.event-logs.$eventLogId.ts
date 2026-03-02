/**
 * API route module for /api/runtime/event-logs/:eventLogId.
 */
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import { methodNotAllowedResponse } from "~/lib/server/http";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
  readRuntimeEventLogByIdForUser,
} from "~/lib/server/observability/runtime-event-log";
import { getOrCreateUserByIdentity } from "~/lib/server/persistence/user";
import type { Route } from "./+types/api.runtime.event-logs.$eventLogId";

const RUNTIME_EVENT_LOG_ITEM_ALLOWED_METHODS = ["GET"] as const;

export function action() {
  installGlobalServerErrorLogging();
  return methodNotAllowedResponse(RUNTIME_EVENT_LOG_ITEM_ALLOWED_METHODS);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return methodNotAllowedResponse(RUNTIME_EVENT_LOG_ITEM_ALLOWED_METHODS);
  }

  const eventLogId = typeof params.eventLogId === "string" ? params.eventLogId.trim() : "";
  if (!eventLogId) {
    await logServerRouteEvent({
      request,
      route: "/api/runtime/event-logs/:eventLogId",
      eventName: "invalid_event_log_id",
      action: "read_event_log_id",
      level: "warning",
      statusCode: 400,
      message: "Invalid event log id.",
    });

    return Response.json({ error: "Invalid event log id." }, { status: 400 });
  }

  const identity = await readAzureArmUserContext();
  if (!identity) {
    return Response.json(
      {
        authRequired: true,
        error: "Azure login is required. Click Azure Login to continue.",
      },
      { status: 401 },
    );
  }

  try {
    const user = await getOrCreateUserByIdentity({
      tenantId: identity.tenantId,
      principalId: identity.principalId,
    });

    const eventLog = await readRuntimeEventLogByIdForUser({
      eventLogId,
      tenantId: identity.tenantId,
      principalId: identity.principalId,
      userId: user.id,
    });
    if (!eventLog) {
      return Response.json({ error: "Runtime event log is not available." }, { status: 404 });
    }

    return Response.json({ eventLog });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/runtime/event-logs/:eventLogId",
      eventName: "read_runtime_event_log_failed",
      action: "read_runtime_event_log",
      statusCode: 500,
      error,
      context: {
        eventLogId,
        tenantId: identity.tenantId,
        principalId: identity.principalId,
      },
    });

    return Response.json(
      {
        error:
          error instanceof Error
            ? `Failed to read runtime event log: ${error.message}`
            : "Failed to read runtime event log: Unknown error.",
      },
      { status: 500 },
    );
  }
}
