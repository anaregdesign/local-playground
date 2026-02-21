import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import { discoverSkillCatalog } from "~/lib/server/skills/catalog";
import type { Route } from "./+types/api.skills";

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  try {
    const discovery = await discoverSkillCatalog();
    return Response.json({
      skills: discovery.skills,
      warnings: discovery.warnings,
    });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/skills",
      eventName: "discover_skills_failed",
      action: "discover_skills",
      statusCode: 500,
      error,
    });

    return Response.json(
      {
        error: `Failed to discover skills: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

export function action({}: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
