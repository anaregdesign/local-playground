import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import type { Route } from "./+types/api.azure-selection";

type AzureSelectionPreference = {
  tenantId: string;
  projectId: string;
  deploymentName: string;
  updatedAt: string;
};

export async function loader({ request }: Route.LoaderArgs) {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const tenantId = readTenantIdFromUrl(request.url);
  if (!tenantId) {
    return Response.json({ error: "`tenantId` query parameter is required." }, { status: 400 });
  }

  try {
    const selection = await readStoredSelection(tenantId);
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
      { error: "`tenantId`, `projectId`, and `deploymentName` are required." },
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

function readTenantIdFromUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const tenantId = url.searchParams.get("tenantId");
  return typeof tenantId === "string" ? tenantId.trim() : "";
}

export function parseAzureSelectionPreference(value: unknown): AzureSelectionPreference | null {
  if (!isRecord(value)) {
    return null;
  }

  const tenantId = typeof value.tenantId === "string" ? value.tenantId.trim() : "";
  const projectId = typeof value.projectId === "string" ? value.projectId.trim() : "";
  const deploymentName = typeof value.deploymentName === "string" ? value.deploymentName.trim() : "";
  if (!tenantId || !projectId || !deploymentName) {
    return null;
  }

  return {
    tenantId,
    projectId,
    deploymentName,
    updatedAt: new Date().toISOString(),
  };
}

async function readStoredSelection(tenantId: string): Promise<AzureSelectionPreference | null> {
  await ensurePersistenceDatabaseReady();
  const record = await prisma.azureSelectionPreference.findUnique({
    where: { tenantId },
  });
  return record ? mapSelectionRecord(record) : null;
}

async function saveStoredSelection(
  preference: AzureSelectionPreference,
): Promise<AzureSelectionPreference> {
  await ensurePersistenceDatabaseReady();
  const saved = await prisma.azureSelectionPreference.upsert({
    where: { tenantId: preference.tenantId },
    create: {
      tenantId: preference.tenantId,
      projectId: preference.projectId,
      deploymentName: preference.deploymentName,
      updatedAt: new Date(preference.updatedAt),
    },
    update: {
      projectId: preference.projectId,
      deploymentName: preference.deploymentName,
      updatedAt: new Date(preference.updatedAt),
    },
  });

  return mapSelectionRecord(saved);
}

function mapSelectionRecord(record: {
  tenantId: string;
  projectId: string;
  deploymentName: string;
  updatedAt: Date;
}): AzureSelectionPreference {
  return {
    tenantId: record.tenantId,
    projectId: record.projectId,
    deploymentName: record.deploymentName,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
