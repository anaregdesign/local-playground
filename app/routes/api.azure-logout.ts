import { resetAzureDependencies } from "~/lib/azure/dependencies";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import type { Route } from "./+types/api.azure-logout";

export function loader({}: Route.LoaderArgs) {
  return Response.json(
    { error: "Use POST /api/azure-logout for this endpoint." },
    { status: 405 },
  );
}

export async function action({ request }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  try {
    resetAzureDependencies();

    return Response.json({
      message: "Azure logout completed. Sign in again when needed.",
    });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/azure-logout",
      eventName: "azure_logout_failed",
      action: "reset_azure_dependencies",
      statusCode: 500,
      error,
    });

    return Response.json(
      {
        error: `Failed to reset Azure authentication state: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
