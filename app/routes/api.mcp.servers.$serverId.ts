/**
 * API route module for /api/mcp/servers/:serverId.
 */
import {
  authRequiredResponse,
  errorResponse,
  invalidJsonResponse,
  methodNotAllowedResponse,
  validationErrorResponse,
} from "~/lib/server/http";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/runtime-event-log";
import {
  deleteWorkspaceMcpServerProfile,
  mergeDefaultWorkspaceMcpServerProfiles,
  parseIncomingMcpServer,
  readAuthenticatedUser,
  readErrorMessage,
  readWorkspaceMcpServerProfiles,
  upsertWorkspaceMcpServerProfile,
  writeWorkspaceMcpServerProfiles,
} from "./api.mcp.servers";
import type { Route } from "./+types/api.mcp.servers.$serverId";

const MCP_SERVER_ITEM_ALLOWED_METHODS = ["PUT", "DELETE"] as const;

export function loader() {
  installGlobalServerErrorLogging();
  return methodNotAllowedResponse(MCP_SERVER_ITEM_ALLOWED_METHODS);
}

export async function action({ request, params }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "PUT" && request.method !== "DELETE") {
    return methodNotAllowedResponse(MCP_SERVER_ITEM_ALLOWED_METHODS);
  }

  const user = await readAuthenticatedUser();
  if (!user) {
    return authRequiredResponse();
  }

  const serverId = typeof params.serverId === "string" ? params.serverId.trim() : "";
  if (!serverId) {
    return validationErrorResponse("invalid_mcp_server_id", "Invalid MCP server id.");
  }

  if (request.method === "DELETE") {
    try {
      const currentProfiles = await readWorkspaceMcpServerProfiles(user.id);
      const deleteResult = deleteWorkspaceMcpServerProfile(currentProfiles, serverId);
      if (!deleteResult.deleted) {
        return errorResponse({
          status: 404,
          code: "mcp_server_not_found",
          error: "Selected MCP server is not available.",
        });
      }

      await writeWorkspaceMcpServerProfiles(user.id, deleteResult.profiles);
      return Response.json({ profiles: deleteResult.profiles });
    } catch (error) {
      await logServerRouteEvent({
        request,
        route: "/api/mcp/servers/:serverId",
        eventName: "delete_mcp_server_failed",
        action: "delete_saved_profile",
        statusCode: 500,
        error,
        userId: user.id,
        context: {
          serverId,
        },
      });

      return errorResponse({
        status: 500,
        code: "delete_mcp_server_failed",
        error: `Failed to delete MCP server in database: ${readErrorMessage(error)}`,
      });
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return invalidJsonResponse();
  }

  const parsed = parseIncomingMcpServer(payload);
  if (!parsed.ok) {
    return validationErrorResponse("invalid_mcp_server_payload", parsed.error);
  }

  if ("id" in parsed.value && parsed.value.id && parsed.value.id !== serverId) {
    return validationErrorResponse("mcp_server_id_mismatch", "`id` must match path `serverId`.");
  }

  try {
    const currentProfiles = await readWorkspaceMcpServerProfiles(user.id);
    const profilesWithDefaults = mergeDefaultWorkspaceMcpServerProfiles(currentProfiles, user.id);
    const hasTargetProfile = profilesWithDefaults.some((profile) => profile.id === serverId);
    if (!hasTargetProfile) {
      return errorResponse({
        status: 404,
        code: "mcp_server_not_found",
        error: "Selected MCP server is not available.",
      });
    }

    const profilesWithoutTarget = profilesWithDefaults.filter((profile) => profile.id !== serverId);
    const { profile, profiles, warning } = upsertWorkspaceMcpServerProfile(profilesWithoutTarget, {
      ...parsed.value,
      id: serverId,
    });

    await writeWorkspaceMcpServerProfiles(user.id, profiles);
    return Response.json({ profile, profiles, warning });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/mcp/servers/:serverId",
      eventName: "update_mcp_server_failed",
      action: "update_saved_profile",
      statusCode: 500,
      error,
      userId: user.id,
      context: {
        serverId,
      },
    });

    return errorResponse({
      status: 500,
      code: "update_mcp_server_failed",
      error: `Failed to update MCP server in database: ${readErrorMessage(error)}`,
    });
  }
}
