/**
 * API route module for /api/mcp-servers/:serverId.
 */
import { methodNotAllowedResponse } from "~/lib/server/http";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import {
  deleteSavedMcpServer,
  mergeDefaultMcpServers,
  parseIncomingMcpServer,
  readAuthenticatedUser,
  readErrorMessage,
  readSavedMcpServers,
  upsertSavedMcpServer,
  writeSavedMcpServers,
} from "./api.mcp-servers";
import type { Route } from "./+types/api.mcp-servers.$serverId";

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
    return Response.json(
      {
        authRequired: true,
        error: "Azure login is required. Click Azure Login to continue.",
      },
      { status: 401 },
    );
  }

  const serverId = typeof params.serverId === "string" ? params.serverId.trim() : "";
  if (!serverId) {
    return Response.json({ error: "Invalid MCP server id." }, { status: 400 });
  }

  if (request.method === "DELETE") {
    try {
      const currentProfiles = await readSavedMcpServers(user.id);
      const deleteResult = deleteSavedMcpServer(currentProfiles, serverId);
      if (!deleteResult.deleted) {
        return Response.json({ error: "Selected MCP server is not available." }, { status: 404 });
      }

      await writeSavedMcpServers(user.id, deleteResult.profiles);
      return Response.json({ profiles: deleteResult.profiles });
    } catch (error) {
      await logServerRouteEvent({
        request,
        route: "/api/mcp-servers/:serverId",
        eventName: "delete_mcp_server_failed",
        action: "delete_saved_profile",
        statusCode: 500,
        error,
        userId: user.id,
        context: {
          serverId,
        },
      });

      return Response.json(
        {
          error: `Failed to delete MCP server in database: ${readErrorMessage(error)}`,
        },
        { status: 500 },
      );
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseIncomingMcpServer(payload);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  if ("id" in parsed.value && parsed.value.id && parsed.value.id !== serverId) {
    return Response.json({ error: "`id` must match path `serverId`." }, { status: 400 });
  }

  try {
    const currentProfiles = await readSavedMcpServers(user.id);
    const profilesWithDefaults = mergeDefaultMcpServers(currentProfiles);
    const hasTargetProfile = profilesWithDefaults.some((profile) => profile.id === serverId);
    if (!hasTargetProfile) {
      return Response.json({ error: "Selected MCP server is not available." }, { status: 404 });
    }

    const profilesWithoutTarget = profilesWithDefaults.filter((profile) => profile.id !== serverId);
    const { profile, profiles, warning } = upsertSavedMcpServer(profilesWithoutTarget, {
      ...parsed.value,
      id: serverId,
    });

    await writeSavedMcpServers(user.id, profiles);
    return Response.json({ profile, profiles, warning });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/mcp-servers/:serverId",
      eventName: "update_mcp_server_failed",
      action: "update_saved_profile",
      statusCode: 500,
      error,
      userId: user.id,
      context: {
        serverId,
      },
    });

    return Response.json(
      {
        error: `Failed to update MCP server in database: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}
