/**
 * API route module for /api/azure-projects/:projectId/deployments.
 */
import { getAzureDependencies } from "~/lib/azure/dependencies";
import { methodNotAllowedResponse } from "~/lib/server/http";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/runtime-event-log";
import {
  getArmAccessToken,
  isLikelyAzureAuthError,
  listProjectDeployments,
  parseProjectId,
  readErrorMessage,
  resolveAzurePrincipalProfile,
} from "./api.azure-connections";
import type { Route } from "./+types/api.azure-project-deployments";

const AZURE_PROJECT_DEPLOYMENTS_ALLOWED_METHODS = ["GET"] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return methodNotAllowedResponse(AZURE_PROJECT_DEPLOYMENTS_ALLOWED_METHODS);
  }

  const dependencies = getAzureDependencies();
  const tokenResult = await getArmAccessToken(dependencies);
  if (!tokenResult.ok) {
    return Response.json(
      {
        authRequired: true,
        error: "Azure login is required. Click Azure Login to continue.",
      },
      { status: 401 },
    );
  }

  const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
  const projectRef = parseProjectId(projectId);
  if (!projectRef) {
    await logServerRouteEvent({
      request,
      route: "/api/azure-projects/:projectId/deployments",
      eventName: "invalid_project_id",
      action: "parse_project_id",
      level: "warning",
      statusCode: 400,
      message: "Invalid projectId.",
      context: {
        projectId,
      },
    });

    return Response.json({ error: "Invalid projectId." }, { status: 400 });
  }

  const principal = await resolveAzurePrincipalProfile(tokenResult, dependencies);

  try {
    const deployments = await listProjectDeployments(tokenResult.token, projectRef);
    return Response.json({
      deployments,
      principal,
      tenantId: tokenResult.tenantId,
      principalId: tokenResult.principalId,
      authRequired: false,
    });
  } catch (error) {
    if (isLikelyAzureAuthError(error)) {
      await logServerRouteEvent({
        request,
        route: "/api/azure-projects/:projectId/deployments",
        eventName: "azure_auth_required",
        action: "list_deployments",
        level: "warning",
        statusCode: 401,
        error,
        context: {
          projectId,
        },
      });

      return Response.json(
        {
          authRequired: true,
          error: "Azure login is required. Click Azure Login to continue.",
        },
        { status: 401 },
      );
    }

    await logServerRouteEvent({
      request,
      route: "/api/azure-projects/:projectId/deployments",
      eventName: "load_azure_deployments_failed",
      action: "list_deployments",
      statusCode: 502,
      error,
      context: {
        projectId,
      },
    });

    return Response.json(
      {
        error: `Failed to load Azure deployment data: ${readErrorMessage(error)}`,
      },
      { status: 502 },
    );
  }
}
