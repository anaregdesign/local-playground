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
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import { getOrCreateUserByIdentity } from "~/lib/server/persistence/user";
import { discoverSkillCatalog } from "~/lib/server/skills/catalog";
import { discoverSkillRegistries } from "~/lib/server/skills/registry";
import type { Route } from "./+types/api.skills";

const SKILLS_COLLECTION_ALLOWED_METHODS = ["GET", "POST"] as const;

type SkillsDiscoveryResult = {
  skills: SkillCatalogEntry[];
  registries: SkillRegistryCatalog[];
  skillWarnings: string[];
  registryWarnings: string[];
  warnings: string[];
};

type WorkspaceSkillProfileReconcilePayload = {
  forceRefresh: boolean;
};

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return methodNotAllowedResponse(SKILLS_COLLECTION_ALLOWED_METHODS);
  }

  const user = await readAuthenticatedUser();
  if (!user) {
    return authRequiredResponse();
  }

  try {
    const forceRefresh = readSkillRegistryRefreshQueryFlag(request.url);
    if (forceRefresh) {
      await logServerRouteEvent({
        request,
        route: "/api/skills",
        eventName: "discover_skills_force_refresh_requested",
        action: "discover_skills",
        level: "info",
        message: "Skill registry cache bypass requested.",
        userId: user.id,
        context: {
          forceRefresh,
        },
      });
    }

    const discoveryResult = await discoverWorkspaceSkills({
      userId: user.id,
      forceRefresh,
    });
    return Response.json(discoveryResult);
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

    return errorResponse({
      status: 500,
      code: "discover_skills_failed",
      error: `Failed to discover skills: ${readErrorMessage(error)}`,
    });
  }
}

export async function action({ request }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "POST") {
    return methodNotAllowedResponse(SKILLS_COLLECTION_ALLOWED_METHODS);
  }

  const user = await readAuthenticatedUser();
  if (!user) {
    return authRequiredResponse();
  }

  try {
    const payloadResult = await readWorkspaceSkillProfileReconcilePayload(request);
    if (!payloadResult.ok) {
      await logServerRouteEvent({
        request,
        route: "/api/skills",
        eventName: "invalid_reconcile_workspace_skill_profiles_request",
        action: "validate_payload",
        level: "warning",
        statusCode: 422,
        message: payloadResult.error,
        userId: user.id,
      });

      return validationErrorResponse(
        "invalid_reconcile_workspace_skill_profiles_request",
        payloadResult.error,
      );
    }

    const forceRefresh = payloadResult.value.forceRefresh;
    if (forceRefresh) {
      await logServerRouteEvent({
        request,
        route: "/api/skills",
        eventName: "reconcile_workspace_skill_profiles_force_refresh_requested",
        action: "reconcile_workspace_skill_profiles",
        level: "info",
        message: "Workspace Skill profile reconcile requested with cache bypass.",
        userId: user.id,
        context: {
          forceRefresh,
        },
      });
    }

    const discoveryResult = await discoverWorkspaceSkills({
      userId: user.id,
      forceRefresh,
    });
    const syncResult = await syncWorkspaceSkillMasters({
      userId: user.id,
      skills: discoveryResult.skills,
      registries: discoveryResult.registries,
    });

    await logServerRouteEvent({
      request,
      route: "/api/skills",
      eventName: "reconcile_workspace_skill_profiles_completed",
      action: "reconcile_workspace_skill_profiles",
      level: "info",
      message: "Workspace Skill profiles reconciled from installed Skills.",
      userId: user.id,
      context: {
        forceRefresh,
        discoveredSkillCount: discoveryResult.skills.length,
        discoveredRegistryCount: discoveryResult.registries.length,
        warningCount: discoveryResult.warnings.length,
        workspaceSkillProfileCount: syncResult.workspaceSkillProfileCount,
        workspaceSkillRegistryProfileCount: syncResult.workspaceSkillRegistryProfileCount,
      },
    });

    return Response.json({
      ...discoveryResult,
      message: "Workspace Skill profiles reconciled from installed Skills.",
    });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/skills",
      eventName: "reconcile_workspace_skill_profiles_failed",
      action: "reconcile_workspace_skill_profiles",
      statusCode: 500,
      error,
      userId: user.id,
    });

    return errorResponse({
      status: 500,
      code: "reconcile_workspace_skill_profiles_failed",
      error: `Failed to reconcile Workspace Skill profiles: ${readErrorMessage(error)}`,
    });
  }
}

export function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

export type SkillRegistryMutationPayload = {
  registryId: SkillRegistryId;
  skillName: string;
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function readSkillRegistryRefreshQueryFlag(requestUrl: string): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    return false;
  }

  const refreshFlag = parsedUrl.searchParams.get("refresh")?.trim().toLowerCase() ?? "";
  return refreshFlag === "1" || refreshFlag === "true" || refreshFlag === "yes";
}

async function readWorkspaceSkillProfileReconcilePayload(
  request: Request,
): Promise<ParseResult<WorkspaceSkillProfileReconcilePayload>> {
  const contentType = request.headers.get("content-type")?.trim().toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    const content = (await request.text().catch(() => "")).trim();
    if (!content) {
      return {
        ok: true,
        value: {
          forceRefresh: false,
        },
      };
    }

    return {
      ok: false,
      error: "Request body must be JSON.",
    };
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return {
      ok: false,
      error: "Request body must be valid JSON.",
    };
  }

  return readWorkspaceSkillProfileReconcilePayloadFromUnknown(payload);
}

export function readWorkspaceSkillProfileReconcilePayloadFromUnknown(
  payload: unknown,
): ParseResult<WorkspaceSkillProfileReconcilePayload> {
  if (!isRecord(payload)) {
    return {
      ok: false,
      error: "Request body must be a JSON object.",
    };
  }

  const forceRefreshValue = payload.forceRefresh;
  if (forceRefreshValue === undefined) {
    return {
      ok: true,
      value: {
        forceRefresh: false,
      },
    };
  }
  if (typeof forceRefreshValue !== "boolean") {
    return {
      ok: false,
      error: "`forceRefresh` must be a boolean.",
    };
  }

  return {
    ok: true,
    value: {
      forceRefresh: forceRefreshValue,
    },
  };
}

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
}): Promise<{
  workspaceSkillProfileCount: number;
  workspaceSkillRegistryProfileCount: number;
}> {
  await ensurePersistenceDatabaseReady();

  return await prisma.$transaction(async (transaction) => {
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

    const [workspaceSkillProfileCount, workspaceSkillRegistryProfileCount] = await Promise.all([
      transaction.workspaceSkillProfile.count({
        where: {
          userId: options.userId,
        },
      }),
      transaction.workspaceSkillRegistryProfile.count({
        where: {
          userId: options.userId,
        },
      }),
    ]);

    return {
      workspaceSkillProfileCount,
      workspaceSkillRegistryProfileCount,
    };
  });
}

async function discoverWorkspaceSkills(options: {
  userId: number;
  forceRefresh: boolean;
}): Promise<SkillsDiscoveryResult> {
  const [catalogDiscovery, registryDiscovery] = await Promise.all([
    discoverSkillCatalog({ workspaceUserId: options.userId }),
    discoverSkillRegistries({
      workspaceUserId: options.userId,
      forceRefresh: options.forceRefresh,
    }),
  ]);

  return {
    skills: catalogDiscovery.skills,
    registries: registryDiscovery.catalogs,
    skillWarnings: catalogDiscovery.warnings,
    registryWarnings: registryDiscovery.warnings,
    warnings: [...catalogDiscovery.warnings, ...registryDiscovery.warnings],
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export const skillsRouteTestUtils = {
  parseSkillRegistryMutationPath,
  readSkillRegistryRefreshQueryFlag,
  readWorkspaceSkillProfileReconcilePayloadFromUnknown,
};
