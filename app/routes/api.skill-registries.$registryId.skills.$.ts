/**
 * API route module for /api/skill-registries/:registryId/skills/*.
 */
import { methodNotAllowedResponse } from "~/lib/server/http";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/runtime-event-log";
import { discoverSkillCatalog } from "~/lib/server/skills/catalog";
import {
  deleteInstalledSkillFromRegistry,
  discoverSkillRegistries,
  installSkillFromRegistry,
} from "~/lib/server/skills/registry";
import {
  parseSkillRegistryMutationPath,
  readAuthenticatedUser,
  readErrorMessage,
  syncWorkspaceSkillMasters,
} from "./api.skills";
import type { Route } from "./+types/api.skill-registries.$registryId.skills.$";

const SKILL_REGISTRY_SKILL_ALLOWED_METHODS = ["PUT", "DELETE"] as const;

export function loader() {
  installGlobalServerErrorLogging();
  return methodNotAllowedResponse(SKILL_REGISTRY_SKILL_ALLOWED_METHODS);
}

export async function action({ request, params }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "PUT" && request.method !== "DELETE") {
    return methodNotAllowedResponse(SKILL_REGISTRY_SKILL_ALLOWED_METHODS);
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

  const registryId = typeof params.registryId === "string" ? params.registryId : "";
  const skillName = typeof params["*"] === "string" ? params["*"] : "";
  const parsedMutation = parseSkillRegistryMutationPath(registryId, skillName);
  if (!parsedMutation.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/skill-registries/:registryId/skills/*",
      eventName: "invalid_skills_mutation_request",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: parsedMutation.error,
      userId: user.id,
      context: {
        registryId,
        skillName,
      },
    });

    return Response.json({ error: parsedMutation.error }, { status: 400 });
  }

  try {
    let message = "";
    let status = 200;

    if (request.method === "PUT") {
      const installResult = await installSkillFromRegistry({
        registryId: parsedMutation.value.registryId,
        skillName: parsedMutation.value.skillName,
        workspaceUserId: user.id,
      });
      message = installResult.skippedAsDuplicate
        ? `Skill "${installResult.skillName}" is already installed.`
        : `Installed Skill "${installResult.skillName}".`;
      status = installResult.installed ? 201 : 200;
    } else {
      const deleteResult = await deleteInstalledSkillFromRegistry({
        registryId: parsedMutation.value.registryId,
        skillName: parsedMutation.value.skillName,
        workspaceUserId: user.id,
      });
      message = deleteResult.removed
        ? `Removed Skill "${deleteResult.skillName}".`
        : `Skill "${deleteResult.skillName}" was not installed.`;
    }

    const [catalogDiscovery, registryDiscovery] = await Promise.all([
      discoverSkillCatalog({ workspaceUserId: user.id }),
      discoverSkillRegistries({ workspaceUserId: user.id }),
    ]);
    await syncWorkspaceSkillMasters({
      userId: user.id,
      skills: catalogDiscovery.skills,
      registries: registryDiscovery.catalogs,
    });

    return Response.json(
      {
        message,
        skills: catalogDiscovery.skills,
        registries: registryDiscovery.catalogs,
        skillWarnings: catalogDiscovery.warnings,
        registryWarnings: registryDiscovery.warnings,
        warnings: [...catalogDiscovery.warnings, ...registryDiscovery.warnings],
      },
      {
        status,
        headers:
          request.method === "PUT" && status === 201
            ? {
                Location: buildSkillResourcePath(
                  parsedMutation.value.registryId,
                  parsedMutation.value.skillName,
                ),
              }
            : undefined,
      },
    );
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/skill-registries/:registryId/skills/*",
      eventName: "skills_action_failed",
      action: request.method === "PUT" ? "install_registry_skill" : "delete_registry_skill",
      statusCode: 500,
      error,
      userId: user.id,
      context: {
        registryId: parsedMutation.value.registryId,
        skillName: parsedMutation.value.skillName,
      },
    });

    return Response.json(
      {
        error: `Failed to update Skills: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

function buildSkillResourcePath(registryId: string, skillName: string): string {
  const encodedSkillPath = skillName.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `/api/skill-registries/${encodeURIComponent(registryId)}/skills/${encodedSkillPath}`;
}
