/**
 * API route module for /api/azure/session.
 */
import { getAzureDependencies, resetAzureDependencies } from "~/lib/azure/dependencies";
import { AZURE_ARM_SCOPE } from "~/lib/constants";
import { methodNotAllowedResponse } from "~/lib/server/http";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/runtime-event-log";
import {
  getOrCreateUserByIdentity,
  readMostRecentWorkspaceUserTenantId,
} from "~/lib/server/persistence/user";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import { ensureDefaultMcpServersForUser } from "./api.mcp.servers";
import type { Route } from "./+types/api.azure.session";

const AZURE_SESSION_ALLOWED_METHODS = ["PUT", "DELETE"] as const;
const AZURE_SESSION_INVALID_BODY_ERROR = "Invalid request body.";

export function loader() {
  installGlobalServerErrorLogging();
  return methodNotAllowedResponse(AZURE_SESSION_ALLOWED_METHODS);
}

export async function action({ request }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "PUT" && request.method !== "DELETE") {
    return methodNotAllowedResponse(AZURE_SESSION_ALLOWED_METHODS);
  }

  if (request.method === "PUT") {
    const tenantIdResult = await readAzureSessionPutTenantId(request);
    if (!tenantIdResult.ok) {
      return Response.json({ error: tenantIdResult.error }, { status: 400 });
    }

    const tenantId = tenantIdResult.tenantId;
    let resolvedTenantId = "";

    try {
      const persistedTenantId = tenantId || (await readMostRecentWorkspaceUserTenantId());
      resolvedTenantId = persistedTenantId.trim();
      resetAzureDependencies();
      const dependencies = getAzureDependencies();
      if (resolvedTenantId) {
        await dependencies.authenticateAzure(AZURE_ARM_SCOPE, resolvedTenantId);
      } else {
        await dependencies.authenticateAzure(AZURE_ARM_SCOPE);
      }
      const identity = await readAzureArmUserContext(dependencies, resolvedTenantId);
      if (!identity) {
        throw new Error("Azure token does not include tenant or principal claims.");
      }
      if (
        resolvedTenantId &&
        identity.tenantId.toLowerCase() !== resolvedTenantId.toLowerCase()
      ) {
        throw new Error(
          `Azure tenant switch did not complete. Requested tenant: ${resolvedTenantId}, resolved tenant: ${identity.tenantId}.`,
        );
      }
      const user = await getOrCreateUserByIdentity({
        tenantId: identity.tenantId,
        principalId: identity.principalId,
      });
      await ensureDefaultMcpServersForUser(user.id);

      return Response.json({
        message: "Azure login completed. Azure projects were refreshed.",
      });
    } catch (error) {
      await logServerRouteEvent({
        request,
        route: "/api/azure/session",
        eventName: "azure_login_start_failed",
        action: "authenticate_interactive_browser_credential",
        statusCode: 500,
        error,
        context: {
          scope: AZURE_ARM_SCOPE,
          tenantId: tenantId || null,
          persistedTenantId: tenantId ? null : resolvedTenantId || null,
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
      route: "/api/azure/session",
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

async function readAzureSessionPutTenantId(
  request: Request,
): Promise<{ ok: true; tenantId: string } | { ok: false; error: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: true, tenantId: "" };
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, error: AZURE_SESSION_INVALID_BODY_ERROR };
  }

  if (!isRecord(payload)) {
    return { ok: false, error: AZURE_SESSION_INVALID_BODY_ERROR };
  }

  const tenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
  return { ok: true, tenantId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
