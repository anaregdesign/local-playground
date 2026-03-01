/**
 * API route module for /api/skills.
 */
import {
  isSkillRegistryId,
  parseSkillRegistrySkillName,
  readSkillRegistrySkillNameValidationMessage,
  SKILL_REGISTRY_OPTIONS,
  type SkillRegistryId,
} from "~/lib/home/skills/registry";
import type { SkillCatalogEntry, SkillRegistryCatalog } from "~/lib/home/skills/types";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import { methodNotAllowedResponse } from "~/lib/server/http";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import { getOrCreateUserByIdentity } from "~/lib/server/persistence/user";
import { discoverSkillCatalog } from "~/lib/server/skills/catalog";
import {
  deleteInstalledSkillFromRegistry,
  discoverSkillRegistries,
  installSkillFromRegistry,
} from "~/lib/server/skills/registry";
import type { Route } from "./+types/api.skills";

const SKILLS_ALLOWED_METHODS = ["GET", "PUT", "DELETE"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return methodNotAllowedResponse(SKILLS_ALLOWED_METHODS);
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

  try {
    const [catalogDiscovery, registryDiscovery] = await Promise.all([
      discoverSkillCatalog({ workspaceUserId: user.id }),
      discoverSkillRegistries({ workspaceUserId: user.id }),
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
      userId: user.id,
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

  if (request.method !== "PUT" && request.method !== "DELETE") {
    return methodNotAllowedResponse(SKILLS_ALLOWED_METHODS);
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

  const parsedMutation = parseSkillRegistryMutationRequest(request.url);
  if (!parsedMutation.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/skills",
      eventName: "invalid_skills_mutation_request",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: parsedMutation.error,
      userId: user.id,
    });

    return Response.json({ error: parsedMutation.error }, { status: 400 });
  }

  try {
    let message = "";
    if (request.method === "PUT") {
      const installResult = await installSkillFromRegistry({
        registryId: parsedMutation.value.registryId,
        skillName: parsedMutation.value.skillName,
        workspaceUserId: user.id,
      });
      message = installResult.skippedAsDuplicate
        ? `Skill "${installResult.skillName}" is already installed.`
        : `Installed Skill "${installResult.skillName}".`;
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

type SkillRegistryMutationPayload = {
  registryId: SkillRegistryId;
  skillName: string;
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseSkillRegistryMutationRequest(url: string): ParseResult<SkillRegistryMutationPayload> {
  const parsedUrl = new URL(url);
  const registryId = parsedUrl.searchParams.get("registryId")?.trim() ?? "";
  if (!isSkillRegistryId(registryId)) {
    return {
      ok: false,
      error: "`registryId` is invalid.",
    };
  }

  const skillName = parsedUrl.searchParams.get("skillName")?.trim() ?? "";
  const parsedSkillName = parseSkillRegistrySkillName(registryId, skillName);
  if (!parsedSkillName) {
    return {
      ok: false,
      error: readSkillRegistrySkillNameValidationMessage(registryId),
    };
  }

  return {
    ok: true,
    value: {
      registryId,
      skillName: parsedSkillName.normalizedSkillName,
    },
  };
}

async function readAuthenticatedUser(): Promise<{ id: number } | null> {
  const userContext = await readAzureArmUserContext();
  if (!userContext) {
    return null;
  }

  const user = await getOrCreateUserByIdentity({
    tenantId: userContext.tenantId,
    principalId: userContext.principalId,
  });

  return {
    id: user.id,
  };
}

async function syncWorkspaceSkillMasters(options: {
  userId: number;
  skills: SkillCatalogEntry[];
  registries: SkillRegistryCatalog[];
}): Promise<void> {
  await ensurePersistenceDatabaseReady();

  await prisma.$transaction(async (transaction) => {
    const registryProfileIdByInstallDirectory = new Map<string, number>();

    for (const registry of options.registries) {
      const registryOption = SKILL_REGISTRY_OPTIONS.find(
        (option) => option.id === registry.registryId,
      );
      const installDirectoryName = registryOption?.installDirectoryName ?? "";
      if (!installDirectoryName) {
        continue;
      }

      const registryProfile = await transaction.workspaceSkillRegistryProfile.upsert({
        where: {
          userId_registryId: {
            userId: options.userId,
            registryId: registry.registryId,
          },
        },
        create: {
          userId: options.userId,
          registryId: registry.registryId,
          registryLabel: registry.registryLabel,
          registryDescription: registry.registryDescription,
          repository: registry.repository,
          repositoryUrl: registry.repositoryUrl,
          sourcePath: registry.sourcePath,
          installDirectoryName,
        },
        update: {
          registryLabel: registry.registryLabel,
          registryDescription: registry.registryDescription,
          repository: registry.repository,
          repositoryUrl: registry.repositoryUrl,
          sourcePath: registry.sourcePath,
          installDirectoryName,
        },
        select: {
          id: true,
        },
      });

      registryProfileIdByInstallDirectory.set(installDirectoryName, registryProfile.id);
    }

    for (const skill of options.skills) {
      const installDirectoryName = readRegistryInstallDirectoryNameFromSkillLocation(skill.location);
      const registryProfileId = installDirectoryName
        ? registryProfileIdByInstallDirectory.get(installDirectoryName) ?? null
        : null;

      await transaction.workspaceSkillProfile.upsert({
        where: {
          userId_location: {
            userId: options.userId,
            location: skill.location,
          },
        },
        create: {
          userId: options.userId,
          registryProfileId,
          name: skill.name,
          location: skill.location,
          source: skill.source,
        },
        update: {
          registryProfileId,
          name: skill.name,
          source: skill.source,
        },
      });
    }
  });
}

function readRegistryInstallDirectoryNameFromSkillLocation(location: string): string | null {
  const segments = location
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== "skills") {
      continue;
    }

    const firstCandidate = segments[index + 1] ?? "";
    const secondCandidate = segments[index + 2] ?? "";
    const candidates = [firstCandidate];
    if (isPositiveIntegerString(firstCandidate)) {
      candidates.push(secondCandidate);
    }

    for (const candidate of candidates) {
      if (
        SKILL_REGISTRY_OPTIONS.some(
          (option) => option.installDirectoryName === candidate,
        )
      ) {
        return candidate;
      }
    }
  }

  return null;
}

function isPositiveIntegerString(value: string): boolean {
  return /^[1-9]\d*$/.test(value.trim());
}

export const skillsRouteTestUtils = {
  parseSkillRegistryMutationRequest,
};
