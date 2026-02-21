import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import type { Route } from "./+types/api.azure-selection";

type AzureSelectionPreferencePayload = {
  projectId: string;
  deploymentName: string;
};

type AzureSelectionPreference = {
  tenantId: string;
  principalId: string;
  projectId: string;
  deploymentName: string;
};

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
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

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
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
      message: "`projectId` and `deploymentName` are required.",
    });

    return Response.json(
      { error: "`projectId` and `deploymentName` are required." },
      { status: 400 },
    );
  }

  try {
    const selection = await saveStoredSelection(identity, preference);
    return Response.json({ selection });
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
        projectId: preference.projectId,
        deploymentName: preference.deploymentName,
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

  const projectId = typeof value.projectId === "string" ? value.projectId.trim() : "";
  const deploymentName = typeof value.deploymentName === "string" ? value.deploymentName.trim() : "";
  if (!projectId || !deploymentName) {
    return null;
  }

  return {
    projectId,
    deploymentName,
  };
}

async function readStoredSelection(
  identity: {
    tenantId: string;
    principalId: string;
  },
): Promise<AzureSelectionPreference | null> {
  await ensurePersistenceDatabaseReady();
  const user = await prisma.user.findUnique({
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
): Promise<AzureSelectionPreference> {
  await ensurePersistenceDatabaseReady();
  const user = await prisma.user.upsert({
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

  const saved = await prisma.azureSelectionPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      projectId: preference.projectId,
      deploymentName: preference.deploymentName,
    },
    update: {
      projectId: preference.projectId,
      deploymentName: preference.deploymentName,
    },
  });

  return mapSelectionRecord(user, saved);
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
  },
): AzureSelectionPreference {
  return {
    tenantId: user.tenantId,
    principalId: user.principalId,
    projectId: selection.projectId,
    deploymentName: selection.deploymentName,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
