import { spawn } from "node:child_process";
import { AZURE_CLI_COMMAND, AZURE_LOGIN_ARGS } from "~/lib/constants";
import type { Route } from "./+types/api.azure-login";

export function loader({}: Route.LoaderArgs) {
  return Response.json(
    { error: "Use POST /api/azure-login for this endpoint." },
    { status: 405 },
  );
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  try {
    const loginProcess = spawn(AZURE_CLI_COMMAND, [...AZURE_LOGIN_ARGS], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env,
    });
    loginProcess.unref();

    return Response.json({
      message: "Azure login started. Complete sign-in in the browser, then retry.",
    });
  } catch (error) {
    return Response.json(
      {
        error: `Failed to start Azure login: ${readErrorMessage(error)}. Ensure Azure CLI (az) is installed and available in PATH.`,
      },
      { status: 500 },
    );
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
