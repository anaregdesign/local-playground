import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import type { Route } from "./+types/api.azure-selection";

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

  const query = readTenantAndPrincipalFromUrl(request.url);
  if (!query) {
    return Response.json(
      { error: "`tenantId` and `principalId` query parameters are required." },
      { status: 400 },
    );
  }

  try {
    const selection = await readStoredSelection(query.tenantId, query.principalId);
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const preference = parseAzureSelectionPreference(payload);
  if (!preference) {
    return Response.json(
      { error: "`tenantId`, `principalId`, `projectId`, and `deploymentName` are required." },
      { status: 400 },
    );
  }

  try {
    const selection = await saveStoredSelection(preference);
    return Response.json({ selection });
  } catch (error) {
    return Response.json(
      { error: `Failed to save Azure selection to database: ${readErrorMessage(error)}` },
      { status: 500 },
    );
  }
}

function readTenantAndPrincipalFromUrl(rawUrl: string):
  | { tenantId: string; principalId: string }
  | null {
  const url = new URL(rawUrl);
  const tenantId = (url.searchParams.get("tenantId") ?? "").trim();
  const principalId = (url.searchParams.get("principalId") ?? "").trim();

  if (!tenantId || !principalId) {
    return null;
  }

  return { tenantId, principalId };
}

export function parseAzureSelectionPreference(value: unknown): AzureSelectionPreference | null {
  if (!isRecord(value)) {
    return null;
  }

  const tenantId = typeof value.tenantId === "string" ? value.tenantId.trim() : "";
  const principalId = typeof value.principalId === "string" ? value.principalId.trim() : "";
  const projectId = typeof value.projectId === "string" ? value.projectId.trim() : "";
  const deploymentName = typeof value.deploymentName === "string" ? value.deploymentName.trim() : "";
  if (!tenantId || !principalId || !projectId || !deploymentName) {
    return null;
  }

  return {
    tenantId,
    principalId,
    projectId,
    deploymentName,
  };
}

async function readStoredSelection(
  tenantId: string,
  principalId: string,
): Promise<AzureSelectionPreference | null> {
  await ensurePersistenceDatabaseReady();
  const user = await prisma.user.findUnique({
    where: {
      tenantId_principalId: {
        tenantId,
        principalId,
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
  preference: AzureSelectionPreference,
): Promise<AzureSelectionPreference> {
  await ensurePersistenceDatabaseReady();
  const user = await prisma.user.upsert({
    where: {
      tenantId_principalId: {
        tenantId: preference.tenantId,
        principalId: preference.principalId,
      },
    },
    create: {
      tenantId: preference.tenantId,
      principalId: preference.principalId,
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
