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
} from "~/lib/server/observability/runtime-event-log";
import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import { getOrCreateUserByIdentity } from "~/lib/server/persistence/user";
import { discoverSkillCatalog } from "~/lib/server/skills/catalog";
import { discoverSkillRegistries } from "~/lib/server/skills/registry";
import type { Route } from "./+types/api.skills";

const SKILLS_COLLECTION_ALLOWED_METHODS = ["GET"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return methodNotAllowedResponse(SKILLS_COLLECTION_ALLOWED_METHODS);
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
  return methodNotAllowedResponse(SKILLS_COLLECTION_ALLOWED_METHODS);
}

export function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

export type SkillRegistryMutationPayload = {
  registryId: SkillRegistryId;
  skillName: string;
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseSkillRegistryMutationPath(
  registryIdInput: string,
  skillNameInput: string,
): ParseResult<SkillRegistryMutationPayload> {
  const registryId = registryIdInput.trim();
  if (!isSkillRegistryId(registryId)) {
    return {
      ok: false,
      error: "`registryId` is invalid.",
    };
  }

  const skillName = skillNameInput.trim();
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

export async function readAuthenticatedUser(): Promise<{ id: number } | null> {
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

export async function syncWorkspaceSkillMasters(options: {
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
  parseSkillRegistryMutationPath,
};
