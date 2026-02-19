import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  AZURE_CLI_COMMAND,
  AZURE_LOGOUT_ARGS,
  AZURE_LOGOUT_MAX_BUFFER_BYTES,
  AZURE_LOGOUT_TIMEOUT_MS,
} from "~/lib/constants";
import type { Route } from "./+types/api.azure-logout";

const execFileAsync = promisify(execFile);

export function loader({}: Route.LoaderArgs) {
  return Response.json(
    { error: "Use POST /api/azure-logout for this endpoint." },
    { status: 405 },
  );
}

export async function action({ request }: Route.ActionArgs) {
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

    return Response.json({
      message: "Azure logout completed. Azure connections were refreshed.",
    });
  } catch (error) {
    if (isNoActiveAccountError(error)) {
      return Response.json({
        message: "No active Azure session was found.",
      });
    }

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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
