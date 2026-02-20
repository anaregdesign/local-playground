import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  AZURE_CLI_COMMAND,
  AZURE_LOGOUT_ARGS,
  AZURE_LOGOUT_MAX_BUFFER_BYTES,
  AZURE_LOGOUT_TIMEOUT_MS,
} from "~/lib/constants";
import { resetAzureDependencies } from "~/lib/azure/dependencies";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import type { Route } from "./+types/api.azure-logout";

const execFileAsync = promisify(execFile);

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
    await execFileAsync(AZURE_CLI_COMMAND, [...AZURE_LOGOUT_ARGS], {
      env: process.env,
      windowsHide: true,
      timeout: AZURE_LOGOUT_TIMEOUT_MS,
      maxBuffer: AZURE_LOGOUT_MAX_BUFFER_BYTES,
    });
    resetAzureDependencies();

    return Response.json({
      message: "Azure logout completed. Azure connections were refreshed.",
    });
  } catch (error) {
    if (isNoActiveAccountError(error)) {
      await logServerRouteEvent({
        request,
        route: "/api/azure-logout",
        eventName: "azure_logout_no_active_account",
        action: "run_azure_cli_logout",
        level: "warning",
        statusCode: 200,
        error,
        context: {
          command: AZURE_CLI_COMMAND,
          args: [...AZURE_LOGOUT_ARGS],
        },
      });

      resetAzureDependencies();
      return Response.json({
        message: "No active Azure session was found.",
      });
    }

    await logServerRouteEvent({
      request,
      route: "/api/azure-logout",
      eventName: "azure_logout_failed",
      action: "run_azure_cli_logout",
      statusCode: 500,
      error,
      context: {
        command: AZURE_CLI_COMMAND,
        args: [...AZURE_LOGOUT_ARGS],
      },
    });

    return Response.json(
      {
        error: `Failed to run Azure logout: ${readErrorMessage(error)}. Ensure Azure CLI (az) is installed and available in PATH.`,
      },
      { status: 500 },
    );
  }
}

function isNoActiveAccountError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("no subscriptions found") ||
    message.includes("no active account") ||
    message.includes("please run 'az login'")
  );
}

export const azureLogoutRouteTestUtils = {
  isNoActiveAccountError,
};

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
