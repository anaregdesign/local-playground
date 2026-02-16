import { mkdir, writeFile } from "node:fs/promises";
import { getFoundryConfigFilePaths, readFoundryConfigTextFile } from "~/lib/foundry-config";
import type { Route } from "./+types/api.azure-selection";

type AzureSelectionPreference = {
  tenantId: string;
  projectId: string;
  deploymentName: string;
  updatedAt: string;
};

type StoredAzureSelectionFile = {
  tenants: Record<string, AzureSelectionPreference>;
};

const AZURE_SELECTION_FILE_PATHS = getFoundryConfigFilePaths("azure-selection.json");

export async function loader({ request }: Route.LoaderArgs) {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const tenantId = readTenantIdFromUrl(request.url);
  if (!tenantId) {
    return Response.json({ error: "`tenantId` query parameter is required." }, { status: 400 });
  }

  try {
    const file = await readStoredSelectionFile();
    return Response.json({ selection: file.tenants[tenantId] ?? null });
  } catch (error) {
    return Response.json(
      { error: `Failed to read Azure selection file: ${readErrorMessage(error)}` },
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
    const file = await readStoredSelectionFile();
    file.tenants[preference.tenantId] = preference;
    await writeStoredSelectionFile(file);
    return Response.json({ selection: preference });
  } catch (error) {
    return Response.json(
      { error: `Failed to save Azure selection file: ${readErrorMessage(error)}` },
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

async function readStoredSelectionFile(): Promise<StoredAzureSelectionFile> {
  const content = await readFoundryConfigTextFile(AZURE_SELECTION_FILE_PATHS);
  if (content === null) {
    return { tenants: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { tenants: {} };
  }

  if (!isRecord(parsed) || !isRecord(parsed.tenants)) {
    return { tenants: {} };
  }

  const tenants: Record<string, AzureSelectionPreference> = {};
  for (const [tenantId, entry] of Object.entries(parsed.tenants)) {
    if (typeof tenantId !== "string" || !tenantId.trim()) {
      continue;
    }

    const normalized = parseAzureSelectionPreference(entry);
    if (!normalized) {
      continue;
    }

    tenants[tenantId.trim()] = normalized;
  }

  return { tenants };
}

async function writeStoredSelectionFile(file: StoredAzureSelectionFile): Promise<void> {
  await mkdir(AZURE_SELECTION_FILE_PATHS.primaryDirectoryPath, { recursive: true });
  await writeFile(
    AZURE_SELECTION_FILE_PATHS.primaryFilePath,
    JSON.stringify(file, null, 2) + "\n",
    "utf8",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
