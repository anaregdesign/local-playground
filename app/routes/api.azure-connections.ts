import { DefaultAzureCredential } from "@azure/identity";
import type { Route } from "./+types/api.azure-connections";

type AzureProject = {
  id: string;
  projectName: string;
  baseUrl: string;
  apiVersion: string;
};

type AzureProjectRef = {
  subscriptionId: string;
  resourceGroup: string;
  accountName: string;
};

type ArmPagedResponse<T> = {
  value?: T[];
  nextLink?: string;
};

type ArmSubscription = {
  subscriptionId?: string;
  state?: string;
};

type ArmCognitiveAccount = {
  id?: string;
  name?: string;
  kind?: string;
  properties?: {
    endpoint?: string;
  };
};

type ArmModelInfo = {
  name?: string;
  version?: string;
  format?: string;
  capabilities?: Record<string, unknown>;
};

type ArmCognitiveDeployment = {
  name?: string;
  properties?: {
    provisioningState?: string;
    model?: ArmModelInfo;
  };
};

type ArmAccountModel = {
  model?: ArmModelInfo;
};

const ARM_SCOPE = "https://management.azure.com/.default";
const SUBSCRIPTIONS_API_VERSION = "2022-12-01";
const COGNITIVE_API_VERSION = "2024-10-01";
const DEFAULT_AZURE_API_VERSION = "v1";
const MAX_SUBSCRIPTIONS = 64;
const MAX_ACCOUNTS_PER_SUBSCRIPTION = 256;
const MAX_DEPLOYMENTS_PER_ACCOUNT = 256;
const MAX_MODELS_PER_ACCOUNT = 512;

export async function loader({ request }: Route.LoaderArgs) {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const tokenResult = await getArmAccessToken();
  if (!tokenResult.ok) {
    return Response.json(
      {
        authRequired: true,
        error: "Azure login is required. Click Azure Login to continue.",
      },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";

  try {
    if (!projectId) {
      const projects = await listAzureProjects(tokenResult.token);
      return Response.json({ projects, tenantId: tokenResult.tenantId, authRequired: false });
    }

    const projectRef = parseProjectId(projectId);
    if (!projectRef) {
      return Response.json({ error: "Invalid projectId." }, { status: 400 });
    }

    const deployments = await listProjectDeployments(tokenResult.token, projectRef);
    return Response.json({ deployments, tenantId: tokenResult.tenantId, authRequired: false });
  } catch (error) {
    return Response.json(
      {
        error: `Failed to load Azure connection data: ${readErrorMessage(error)}`,
      },
      { status: 502 },
    );
  }
}

async function listAzureProjects(accessToken: string): Promise<AzureProject[]> {
  const subscriptions = await fetchArmPaged<ArmSubscription>(
    `https://management.azure.com/subscriptions?api-version=${SUBSCRIPTIONS_API_VERSION}`,
    accessToken,
    MAX_SUBSCRIPTIONS,
  );

  const discovered: Array<AzureProject & { resourceGroup: string }> = [];
  const dedupeById = new Set<string>();

  for (const subscription of subscriptions) {
    const subscriptionId =
      typeof subscription.subscriptionId === "string" ? subscription.subscriptionId.trim() : "";
    const subscriptionState =
      typeof subscription.state === "string" ? subscription.state.toLowerCase() : "";
    if (!subscriptionId || (subscriptionState && subscriptionState !== "enabled")) {
      continue;
    }

    let accounts: ArmCognitiveAccount[];
    try {
      accounts = await fetchArmPaged<ArmCognitiveAccount>(
        `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.CognitiveServices/accounts?api-version=${COGNITIVE_API_VERSION}`,
        accessToken,
        MAX_ACCOUNTS_PER_SUBSCRIPTION,
      );
    } catch {
      continue;
    }

    for (const account of accounts) {
      if (!isAzureOpenAIProject(account)) {
        continue;
      }

      const accountName = typeof account.name === "string" ? account.name.trim() : "";
      const accountId = typeof account.id === "string" ? account.id.trim() : "";
      if (!accountName || !accountId) {
        continue;
      }

      const resourceGroup = parseResourceGroupFromResourceId(accountId);
      if (!resourceGroup) {
        continue;
      }

      const endpoint =
        typeof account.properties?.endpoint === "string" && account.properties.endpoint.trim()
          ? account.properties.endpoint
          : `https://${accountName}.openai.azure.com/`;
      const baseUrl = normalizeAzureOpenAIBaseURL(endpoint);
      if (!baseUrl) {
        continue;
      }

      const id = createProjectId({
        subscriptionId,
        resourceGroup,
        accountName,
      });

      if (dedupeById.has(id)) {
        continue;
      }
      dedupeById.add(id);

      discovered.push({
        id,
        projectName: accountName,
        baseUrl,
        apiVersion: DEFAULT_AZURE_API_VERSION,
        resourceGroup,
      });
    }
  }

  const nameCounts = new Map<string, number>();
  for (const project of discovered) {
    const key = project.projectName.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const projects = discovered
    .map(({ resourceGroup, ...project }) => {
      const nameKey = project.projectName.toLowerCase();
      const duplicateCount = nameCounts.get(nameKey) ?? 0;
      return duplicateCount > 1
        ? { ...project, projectName: `${project.projectName} (${resourceGroup})` }
        : project;
    })
    .sort((left, right) => left.projectName.localeCompare(right.projectName));

  return projects;
}

async function listProjectDeployments(
  accessToken: string,
  projectRef: AzureProjectRef,
): Promise<string[]> {
  const { subscriptionId, resourceGroup, accountName } = projectRef;
  const deployments = await fetchArmPaged<ArmCognitiveDeployment>(
    `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.CognitiveServices/accounts/${encodeURIComponent(accountName)}/deployments?api-version=${COGNITIVE_API_VERSION}`,
    accessToken,
    MAX_DEPLOYMENTS_PER_ACCOUNT,
  );

  const accountModels = await listAccountModels(accessToken, projectRef);
  const modelCapabilities = buildModelCapabilitiesMap(accountModels);

  const names: string[] = [];
  const seen = new Set<string>();

  for (const deployment of deployments) {
    const name = typeof deployment.name === "string" ? deployment.name.trim() : "";
    if (!name) {
      continue;
    }

    if (!isDeploymentSucceeded(deployment)) {
      continue;
    }

    if (!isAgentsSdkCompatibleDeployment(deployment, modelCapabilities)) {
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    names.push(name);
  }

  return names.sort((left, right) => left.localeCompare(right));
}

async function listAccountModels(
  accessToken: string,
  projectRef: AzureProjectRef,
): Promise<ArmAccountModel[]> {
  const { subscriptionId, resourceGroup, accountName } = projectRef;
  try {
    return await fetchArmPaged<ArmAccountModel>(
      `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.CognitiveServices/accounts/${encodeURIComponent(accountName)}/models?api-version=${COGNITIVE_API_VERSION}`,
      accessToken,
      MAX_MODELS_PER_ACCOUNT,
    );
  } catch {
    return [];
  }
}

function buildModelCapabilitiesMap(
  models: ArmAccountModel[],
): Map<string, Record<string, boolean>> {
  const map = new Map<string, Record<string, boolean>>();

  for (const entry of models) {
    const model = entry.model;
    if (!model) {
      continue;
    }

    const name = typeof model.name === "string" ? model.name.trim().toLowerCase() : "";
    const version = typeof model.version === "string" ? model.version.trim().toLowerCase() : "";
    if (!name) {
      continue;
    }

    const capabilities = normalizeCapabilities(model.capabilities);
    map.set(createModelKey(name, version), capabilities);
    if (version) {
      map.set(createModelKey(name, ""), capabilities);
    }
  }

  return map;
}

function normalizeCapabilities(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, boolean> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase();
    if (!key) {
      continue;
    }
    normalized[key] = parseCapabilityBoolean(rawValue);
  }

  return normalized;
}

function parseCapabilityBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "enabled";
}

function isAgentsSdkCompatibleDeployment(
  deployment: ArmCognitiveDeployment,
  modelCapabilities: Map<string, Record<string, boolean>>,
): boolean {
  const model = deployment.properties?.model;
  if (!model) {
    return false;
  }

  const modelName = typeof model.name === "string" ? model.name.trim().toLowerCase() : "";
  const modelVersion = typeof model.version === "string" ? model.version.trim().toLowerCase() : "";
  const format = typeof model.format === "string" ? model.format.trim().toLowerCase() : "";

  if (!modelName || isUnsupportedModelName(modelName)) {
    return false;
  }

  if (format && !format.includes("openai")) {
    return false;
  }

  const capabilities =
    modelCapabilities.get(createModelKey(modelName, modelVersion)) ??
    modelCapabilities.get(createModelKey(modelName, ""));

  if (capabilities) {
    if (supportsChatCompletion(capabilities)) {
      return true;
    }

    if (supportsNonChatOnly(capabilities)) {
      return false;
    }
  }

  return looksLikeChatModelName(modelName);
}

function supportsChatCompletion(capabilities: Record<string, boolean>): boolean {
  return (
    capabilities.chatcompletion === true ||
    capabilities.chatcompletions === true ||
    capabilities.completion === true ||
    capabilities.completions === true
  );
}

function supportsNonChatOnly(capabilities: Record<string, boolean>): boolean {
  const chat = supportsChatCompletion(capabilities);
  if (chat) {
    return false;
  }

  return (
    capabilities.embedding === true ||
    capabilities.embeddings === true ||
    capabilities.audio === true ||
    capabilities.audiotranscription === true ||
    capabilities.audiotranslation === true ||
    capabilities.imagegeneration === true ||
    capabilities.images === true
  );
}

function isUnsupportedModelName(modelName: string): boolean {
  return (
    modelName.startsWith("text-embedding") ||
    modelName.includes("embedding") ||
    modelName.startsWith("whisper") ||
    modelName.startsWith("tts") ||
    modelName.startsWith("dall-e") ||
    modelName.startsWith("gpt-image") ||
    modelName.includes("moderation")
  );
}

function looksLikeChatModelName(modelName: string): boolean {
  return /^gpt/.test(modelName) || /^o[1-9]/.test(modelName);
}

function isDeploymentSucceeded(deployment: ArmCognitiveDeployment): boolean {
  const state = deployment.properties?.provisioningState;
  if (typeof state !== "string") {
    return true;
  }

  return state.trim().toLowerCase() === "succeeded";
}

function createModelKey(modelName: string, modelVersion: string): string {
  return `${modelName}::${modelVersion}`;
}

function createProjectId(projectRef: AzureProjectRef): string {
  const raw = JSON.stringify(projectRef);
  return Buffer.from(raw, "utf8").toString("base64url");
}

function parseProjectId(projectId: string): AzureProjectRef | null {
  try {
    const decoded = Buffer.from(projectId, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const subscriptionId =
      typeof parsed.subscriptionId === "string" ? parsed.subscriptionId.trim() : "";
    const resourceGroup =
      typeof parsed.resourceGroup === "string" ? parsed.resourceGroup.trim() : "";
    const accountName = typeof parsed.accountName === "string" ? parsed.accountName.trim() : "";
    if (!subscriptionId || !resourceGroup || !accountName) {
      return null;
    }

    return { subscriptionId, resourceGroup, accountName };
  } catch {
    return null;
  }
}

function isAzureOpenAIProject(account: ArmCognitiveAccount): boolean {
  const kind = typeof account.kind === "string" ? account.kind.toLowerCase() : "";
  const endpoint =
    typeof account.properties?.endpoint === "string" ? account.properties.endpoint.toLowerCase() : "";

  return (
    kind === "openai" ||
    kind === "aiservices" ||
    endpoint.includes(".openai.azure.com") ||
    endpoint.includes(".services.ai.azure.com")
  );
}

function parseResourceGroupFromResourceId(resourceId: string): string {
  const match = resourceId.match(/\/resourceGroups\/([^/]+)/i);
  return match?.[1] ?? "";
}

async function getArmAccessToken(): Promise<{ ok: true; token: string; tenantId: string } | { ok: false }> {
  try {
    const credential = new DefaultAzureCredential();
    const token = await credential.getToken(ARM_SCOPE);
    if (!token?.token) {
      return { ok: false };
    }

    return {
      ok: true,
      token: token.token,
      tenantId: readTenantIdFromAccessToken(token.token),
    };
  } catch {
    return { ok: false };
  }
}

function readTenantIdFromAccessToken(accessToken: string): string {
  const parts = accessToken.split(".");
  if (parts.length < 2) {
    return "";
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (!isRecord(payload)) {
      return "";
    }

    const tid = typeof payload.tid === "string" ? payload.tid.trim() : "";
    const tenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
    return tid || tenantId;
  } catch {
    return "";
  }
}

async function fetchArmPaged<T>(
  url: string,
  accessToken: string,
  maxItems: number,
): Promise<T[]> {
  const items: T[] = [];
  let nextUrl = url;

  while (nextUrl && items.length < maxItems) {
    const response = await fetch(nextUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const payload = (await response.json().catch(() => null)) as ArmPagedResponse<T> | null;
    if (!response.ok) {
      throw new Error(readArmErrorMessage(payload) || response.statusText || "Azure ARM request failed.");
    }

    const pageItems = Array.isArray(payload?.value) ? payload.value : [];
    const remaining = maxItems - items.length;
    items.push(...pageItems.slice(0, remaining));

    nextUrl = typeof payload?.nextLink === "string" ? payload.nextLink : "";
  }

  return items;
}

function normalizeAzureOpenAIBaseURL(rawValue: string): string {
  const trimmed = rawValue.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  if (/\/openai\/v1$/i.test(trimmed)) {
    return `${trimmed}/`;
  }

  return `${trimmed}/openai/v1/`;
}

function readArmErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  const errorValue = payload.error;
  if (!isRecord(errorValue)) {
    return "";
  }

  const message = errorValue.message;
  return typeof message === "string" ? message : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
