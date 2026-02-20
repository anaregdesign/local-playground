import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
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
    return Response.json(
      { error: `Failed to read Azure selection from database: ${readErrorMessage(error)}` },
      { status: 500 },
    );
  }
}

export async function action({ request }: Route.ActionArgs) {
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
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const preference = parseAzureSelectionPreference(payload);
  if (!preference) {
    return Response.json(
      { error: "`projectId` and `deploymentName` are required." },
      { status: 400 },
    );
  }

  try {
    const selection = await saveStoredSelection(identity, preference);
    return Response.json({ selection });
  } catch (error) {
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
