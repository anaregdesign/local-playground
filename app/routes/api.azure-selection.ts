/**
 * API route module for /api/azure-selection.
 */
import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import { methodNotAllowedResponse } from "~/lib/server/http";
import { HOME_REASONING_EFFORT_OPTIONS } from "~/lib/constants";
import type { ReasoningEffort } from "~/lib/home/shared/view-types";
import type { Route } from "./+types/api.azure-selection";

const AZURE_SELECTION_ALLOWED_METHODS = ["GET", "PUT"] as const;

type AzureSelectionPreferencePayload = {
  target: AzureSelectionTarget;
  projectId: string;
  deploymentName: string;
  reasoningEffort: ReasoningEffort | null;
};

type AzureSelectionTarget = "playground" | "utility";

type AzureSelectionTargetPreference = {
  projectId: string;
  deploymentName: string;
};

type AzureUtilitySelectionTargetPreference = AzureSelectionTargetPreference & {
  reasoningEffort: ReasoningEffort;
};

type AzureSelectionPreference = {
  tenantId: string;
  principalId: string;
  playground: AzureSelectionTargetPreference | null;
  utility: AzureUtilitySelectionTargetPreference | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return methodNotAllowedResponse(AZURE_SELECTION_ALLOWED_METHODS);
  }

  const identity = await readAuthenticatedIdentity();
  if (!identity) {
    return Response.json(
      {
        authRequired: true,
        error: "Azure login is required. Click Azure Login to continue.",
      },
      { status: 401 },
    );
  }

  try {
    const selection = await readStoredSelection(identity);
    return Response.json({ selection });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/azure-selection",
      eventName: "read_azure_selection_failed",
      action: "read_selection",
      statusCode: 500,
      error,
      context: {
        tenantId: identity.tenantId,
        principalId: identity.principalId,
      },
    });

    return Response.json(
      { error: `Failed to read Azure selection from database: ${readErrorMessage(error)}` },
      { status: 500 },
    );
  }
}

export async function action({ request }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "PUT") {
    return methodNotAllowedResponse(AZURE_SELECTION_ALLOWED_METHODS);
  }

  const identity = await readAuthenticatedIdentity();
  if (!identity) {
    return Response.json(
      {
        authRequired: true,
        error: "Azure login is required. Click Azure Login to continue.",
      },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await logServerRouteEvent({
      request,
      route: "/api/azure-selection",
      eventName: "invalid_json_body",
      action: "parse_request_body",
      level: "warning",
      statusCode: 400,
      message: "Invalid JSON body.",
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const preference = parseAzureSelectionPreference(payload);
  if (!preference) {
    await logServerRouteEvent({
      request,
      route: "/api/azure-selection",
      eventName: "invalid_selection_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message:
        "`target`, `projectId`, and `deploymentName` are required. `reasoningEffort` is required for `utility` target.",
    });

    return Response.json(
      {
        error:
          "`target`, `projectId`, and `deploymentName` are required. `reasoningEffort` is required for `utility` target.",
      },
      { status: 400 },
    );
  }

  try {
    const saved = await saveStoredSelection(identity, preference);
    return Response.json(
      { selection: saved.selection },
      {
        status: saved.created ? 201 : 200,
      },
    );
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/azure-selection",
      eventName: "save_azure_selection_failed",
      action: "save_selection",
      statusCode: 500,
      error,
      context: {
        tenantId: identity.tenantId,
        principalId: identity.principalId,
        target: preference.target,
        projectId: preference.projectId,
        deploymentName: preference.deploymentName,
        reasoningEffort: preference.reasoningEffort,
      },
    });

    return Response.json(
      { error: `Failed to save Azure selection to database: ${readErrorMessage(error)}` },
      { status: 500 },
    );
  }
}

export function parseAzureSelectionPreference(value: unknown): AzureSelectionPreferencePayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const target = value.target;
  const projectId = typeof value.projectId === "string" ? value.projectId.trim() : "";
  const deploymentName = typeof value.deploymentName === "string" ? value.deploymentName.trim() : "";
  const reasoningEffort =
    typeof value.reasoningEffort === "string"
      ? readReasoningEffortFromUnknown(value.reasoningEffort)
      : null;
  if (
    (target !== "playground" && target !== "utility") ||
    !projectId ||
    !deploymentName ||
    (target === "utility" && !reasoningEffort)
  ) {
    return null;
  }

  return {
    target,
    projectId,
    deploymentName,
    reasoningEffort,
  };
}

async function readStoredSelection(
  identity: {
    tenantId: string;
    principalId: string;
  },
): Promise<AzureSelectionPreference | null> {
  await ensurePersistenceDatabaseReady();
  const user = await prisma.workspaceUser.findUnique({
    where: {
      tenantId_principalId: {
        tenantId: identity.tenantId,
        principalId: identity.principalId,
      },
    },
    include: {
      azureSelection: true,
    },
  });

  if (!user || !user.azureSelection) {
    return null;
  }

  return mapSelectionRecord(user, user.azureSelection);
}

async function saveStoredSelection(
  identity: {
    tenantId: string;
    principalId: string;
  },
  preference: AzureSelectionPreferencePayload,
): Promise<{ selection: AzureSelectionPreference; created: boolean }> {
  await ensurePersistenceDatabaseReady();
  const user = await prisma.workspaceUser.upsert({
    where: {
      tenantId_principalId: {
        tenantId: identity.tenantId,
        principalId: identity.principalId,
      },
    },
    create: {
      tenantId: identity.tenantId,
      principalId: identity.principalId,
    },
    update: {},
  });

  const existing = await prisma.azureSelectionPreference.findUnique({
    where: { userId: user.id },
    select: { userId: true },
  });

  const saved = await prisma.azureSelectionPreference.upsert({
    where: { userId: user.id },
    create:
      preference.target === "playground"
        ? {
            userId: user.id,
            projectId: preference.projectId,
            deploymentName: preference.deploymentName,
            utilityProjectId: "",
            utilityDeploymentName: "",
            utilityReasoningEffort: "high",
          }
        : {
            userId: user.id,
            projectId: "",
            deploymentName: "",
            utilityProjectId: preference.projectId,
            utilityDeploymentName: preference.deploymentName,
            utilityReasoningEffort: preference.reasoningEffort ?? "high",
          },
    update:
      preference.target === "playground"
        ? {
            projectId: preference.projectId,
            deploymentName: preference.deploymentName,
          }
        : {
            utilityProjectId: preference.projectId,
            utilityDeploymentName: preference.deploymentName,
            utilityReasoningEffort: preference.reasoningEffort ?? "high",
          },
  });

  return {
    selection: mapSelectionRecord(user, saved),
    created: !existing,
  };
}

async function readAuthenticatedIdentity(): Promise<{ tenantId: string; principalId: string } | null> {
  const context = await readAzureArmUserContext();
  if (!context) {
    return null;
  }

  return {
    tenantId: context.tenantId,
    principalId: context.principalId,
  };
}

function mapSelectionRecord(
  user: {
    tenantId: string;
    principalId: string;
  },
  selection: {
    projectId: string;
    deploymentName: string;
    utilityProjectId: string;
    utilityDeploymentName: string;
    utilityReasoningEffort: string;
  },
): AzureSelectionPreference {
  return {
    tenantId: user.tenantId,
    principalId: user.principalId,
    playground: mapSelectionTarget(selection.projectId, selection.deploymentName),
    utility: mapUtilitySelectionTarget(
      selection.utilityProjectId,
      selection.utilityDeploymentName,
      selection.utilityReasoningEffort,
    ),
  };
}

function mapSelectionTarget(
  projectId: string,
  deploymentName: string,
): AzureSelectionTargetPreference | null {
  const normalizedProjectId = projectId.trim();
  const normalizedDeploymentName = deploymentName.trim();
  if (!normalizedProjectId || !normalizedDeploymentName) {
    return null;
  }

  return {
    projectId: normalizedProjectId,
    deploymentName: normalizedDeploymentName,
  };
}

function mapUtilitySelectionTarget(
  projectId: string,
  deploymentName: string,
  reasoningEffort: string,
): AzureUtilitySelectionTargetPreference | null {
  const base = mapSelectionTarget(projectId, deploymentName);
  if (!base) {
    return null;
  }

  const normalizedReasoningEffort = readReasoningEffortFromUnknown(reasoningEffort) ?? "high";
  return {
    ...base,
    reasoningEffort: normalizedReasoningEffort,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function readReasoningEffortFromUnknown(value: unknown): ReasoningEffort | null {
  if (typeof value !== "string") {
    return null;
  }
  if (HOME_REASONING_EFFORT_OPTIONS.includes(value as ReasoningEffort)) {
    return value as ReasoningEffort;
  }

  return null;
}
