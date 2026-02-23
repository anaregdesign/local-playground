/**
 * API route module for /api/skills.
 */
import { AGENT_SKILL_NAME_PATTERN } from "~/lib/constants";
import { isSkillRegistryId, type SkillRegistryId } from "~/lib/home/skills/registry";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import { discoverSkillCatalog } from "~/lib/server/skills/catalog";
import {
  deleteInstalledSkillFromRegistry,
  discoverSkillRegistries,
  installSkillFromRegistry,
} from "~/lib/server/skills/registry";
import type { Route } from "./+types/api.skills";

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  try {
    const [catalogDiscovery, registryDiscovery] = await Promise.all([
      discoverSkillCatalog(),
      discoverSkillRegistries(),
    ]);
    return Response.json({
      skills: catalogDiscovery.skills,
      registries: registryDiscovery.catalogs,
      skillWarnings: catalogDiscovery.warnings,
      registryWarnings: registryDiscovery.warnings,
      warnings: [...catalogDiscovery.warnings, ...registryDiscovery.warnings],
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

export async function action({ request }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await logServerRouteEvent({
      request,
      route: "/api/skills",
      eventName: "invalid_json_body",
      action: "parse_request_body",
      level: "warning",
      statusCode: 400,
      message: "Invalid JSON body.",
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsedAction = parseSkillRegistryActionPayload(payload);
  if (!parsedAction.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/skills",
      eventName: "invalid_skills_action_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: parsedAction.error,
    });

    return Response.json({ error: parsedAction.error }, { status: 400 });
  }

  try {
    let message = "";
    if (parsedAction.value.action === "install_registry_skill") {
      const installResult = await installSkillFromRegistry({
        registryId: parsedAction.value.registryId,
        skillName: parsedAction.value.skillName,
      });
      message = installResult.skippedAsDuplicate
        ? `Skill "${installResult.skillName}" is already installed.`
        : `Installed Skill "${installResult.skillName}".`;
    } else {
      const deleteResult = await deleteInstalledSkillFromRegistry({
        registryId: parsedAction.value.registryId,
        skillName: parsedAction.value.skillName,
      });
      message = deleteResult.removed
        ? `Removed Skill "${deleteResult.skillName}".`
        : `Skill "${deleteResult.skillName}" was not installed.`;
    }

    const [catalogDiscovery, registryDiscovery] = await Promise.all([
      discoverSkillCatalog(),
      discoverSkillRegistries(),
    ]);
    return Response.json({
      message,
      skills: catalogDiscovery.skills,
      registries: registryDiscovery.catalogs,
      skillWarnings: catalogDiscovery.warnings,
      registryWarnings: registryDiscovery.warnings,
      warnings: [...catalogDiscovery.warnings, ...registryDiscovery.warnings],
    });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/skills",
      eventName: "skills_action_failed",
      action: parsedAction.value.action,
      statusCode: 500,
      error,
      context: {
        registryId: parsedAction.value.registryId,
        skillName: parsedAction.value.skillName,
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

type SkillRegistryActionPayload =
  | {
      action: "install_registry_skill";
      registryId: SkillRegistryId;
      skillName: string;
    }
  | {
      action: "delete_registry_skill";
      registryId: SkillRegistryId;
      skillName: string;
    };

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseSkillRegistryActionPayload(payload: unknown): ParseResult<SkillRegistryActionPayload> {
  if (!isRecord(payload)) {
    return { ok: false, error: "Invalid request payload." };
  }

  const action = readTrimmedString(payload.action);
  if (action !== "install_registry_skill" && action !== "delete_registry_skill") {
    return {
      ok: false,
      error: "`action` must be \"install_registry_skill\" or \"delete_registry_skill\".",
    };
  }

  const registryId = readTrimmedString(payload.registryId);
  if (!isSkillRegistryId(registryId)) {
    return {
      ok: false,
      error: "`registryId` is invalid.",
    };
  }

  const skillName = readTrimmedString(payload.skillName);
  if (!skillName || !AGENT_SKILL_NAME_PATTERN.test(skillName)) {
    return {
      ok: false,
      error: "`skillName` must be lower-case kebab-case.",
    };
  }

  return {
    ok: true,
    value: {
      action,
      registryId,
      skillName,
    },
  };
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export const skillsRouteTestUtils = {
  parseSkillRegistryActionPayload,
};
