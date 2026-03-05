/**
 * API route module for /api/azure/projects/:projectId/deployments.
 */
import { getAzureDependencies } from "~/lib/azure/dependencies";
import {
  authRequiredResponse,
  errorResponse,
  methodNotAllowedResponse,
  validationErrorResponse,
} from "~/lib/server/http";
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
} from "./api.azure.projects";
import type { Route } from "./+types/api.azure.projects.$projectId.deployments";

const AZURE_PROJECT_DEPLOYMENTS_ALLOWED_METHODS = ["GET"] as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return methodNotAllowedResponse(AZURE_PROJECT_DEPLOYMENTS_ALLOWED_METHODS);
  }

  const dependencies = getAzureDependencies();
  const tokenResult = await getArmAccessToken(dependencies);
  if (!tokenResult.ok) {
    return authRequiredResponse();
  }

  const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
  const projectRef = parseProjectId(projectId);
  if (!projectRef) {
    await logServerRouteEvent({
      request,
      route: "/api/azure/projects/:projectId/deployments",
      eventName: "invalid_project_id",
      action: "parse_project_id",
      level: "warning",
      statusCode: 422,
      message: "Invalid projectId.",
      context: {
        projectId,
      },
    });

    return validationErrorResponse("invalid_project_id", "Invalid projectId.");
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
        route: "/api/azure/projects/:projectId/deployments",
        eventName: "azure_auth_required",
        action: "list_deployments",
        level: "warning",
        statusCode: 401,
        error,
        context: {
          projectId,
        },
      });

      return authRequiredResponse();
    }

    await logServerRouteEvent({
      request,
      route: "/api/azure/projects/:projectId/deployments",
      eventName: "load_azure_deployments_failed",
      action: "list_deployments",
      statusCode: 502,
      error,
      context: {
        projectId,
      },
    });

    return errorResponse({
      status: 502,
      code: "load_azure_deployments_failed",
      error: `Failed to load Azure deployment data: ${readErrorMessage(error)}`,
    });
  }
}
