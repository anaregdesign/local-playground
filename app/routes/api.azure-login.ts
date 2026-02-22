import {
  AZURE_ARM_SCOPE,
  AZURE_COGNITIVE_SERVICES_SCOPE,
  AZURE_GRAPH_SCOPE,
} from "~/lib/constants";
import { getAzureDependencies } from "~/lib/azure/dependencies";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import type { Route } from "./+types/api.azure-login";

export function loader({}: Route.LoaderArgs) {
  return Response.json(
    { error: "Use POST /api/azure-login for this endpoint." },
    { status: 405 },
  );
}

export async function action({ request }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  try {
    const dependencies = getAzureDependencies();
    await dependencies.authenticateAzure([
      AZURE_ARM_SCOPE,
      AZURE_COGNITIVE_SERVICES_SCOPE,
      AZURE_GRAPH_SCOPE,
    ]);

    return Response.json({
      message: "Azure login completed. Azure connections were refreshed.",
    });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/azure-login",
      eventName: "azure_login_start_failed",
      action: "authenticate_interactive_browser_credential",
      statusCode: 500,
      error,
      context: {
        scopes: [AZURE_ARM_SCOPE, AZURE_COGNITIVE_SERVICES_SCOPE, AZURE_GRAPH_SCOPE],
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
