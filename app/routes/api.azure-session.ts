/**
 * API route module for /api/azure-session.
 */
import { getAzureDependencies, resetAzureDependencies } from "~/lib/azure/dependencies";
import { AZURE_ARM_SCOPE } from "~/lib/constants";
import { methodNotAllowedResponse } from "~/lib/server/http";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import type { Route } from "./+types/api.azure-session";

const AZURE_SESSION_ALLOWED_METHODS = ["POST", "DELETE"] as const;

export function loader() {
  installGlobalServerErrorLogging();
  return methodNotAllowedResponse(AZURE_SESSION_ALLOWED_METHODS);
}

export async function action({ request }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "POST" && request.method !== "DELETE") {
    return methodNotAllowedResponse(AZURE_SESSION_ALLOWED_METHODS);
  }

  if (request.method === "POST") {
    try {
      const dependencies = getAzureDependencies();
      await dependencies.authenticateAzure(AZURE_ARM_SCOPE);

      return Response.json({
        message: "Azure login completed. Azure connections were refreshed.",
      });
    } catch (error) {
      await logServerRouteEvent({
        request,
        route: "/api/azure-session",
        eventName: "azure_login_start_failed",
        action: "authenticate_interactive_browser_credential",
        statusCode: 500,
        error,
        context: {
          scope: AZURE_ARM_SCOPE,
        },
      });

      return Response.json(
        {
          error: `Failed to run Azure login: ${readErrorMessage(error)}. Retry and complete sign-in in the browser.`,
        },
        { status: 500 },
      );
    }
  }

  try {
    resetAzureDependencies();

    return Response.json({
      message: "Azure logout completed. Sign in again when needed.",
    });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/azure-session",
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
