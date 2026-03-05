/**
 * API route module for /api/azure/projects.
 */
import {
  getAzureDependencies,
  normalizeAzureOpenAIBaseURL,
} from "~/lib/azure/dependencies";
import {
  AZURE_ARM_SCOPE,
  AZURE_COGNITIVE_API_VERSION,
  AZURE_GRAPH_SCOPE,
  AZURE_MAX_ACCOUNTS_PER_SUBSCRIPTION,
  AZURE_MAX_DEPLOYMENTS_PER_ACCOUNT,
  AZURE_MAX_MODELS_PER_ACCOUNT,
  AZURE_MAX_SUBSCRIPTIONS,
  AZURE_MAX_TENANTS,
  AZURE_OPENAI_DEFAULT_API_VERSION,
  AZURE_SUBSCRIPTIONS_API_VERSION,
  AZURE_TENANTS_API_VERSION,
} from "~/lib/constants";
import {
  readAzureArmUserContext,
  type AzurePrincipalType,
} from "~/lib/server/auth/azure-user";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/runtime-event-log";
import {
  authRequiredResponse,
  errorResponse,
  methodNotAllowedResponse,
} from "~/lib/server/http";
import type { AzureDependencies } from "~/lib/azure/dependencies";
import type { Route } from "./+types/api.azure.projects";

const AZURE_PROJECTS_ALLOWED_METHODS = ["GET"] as const;
const AZURE_SUBSCRIPTION_ACCOUNT_FETCH_CONCURRENCY = 6;
const AZURE_PROJECTS_ROUTE = "/api/azure/projects";

export type AzureProject = {
  id: string;
  projectName: string;
  baseUrl: string;
  apiVersion: string;
};

export type AzureTenant = {
  tenantId: string;
  displayName: string;
  defaultDomain: string;
};

export type AzureProjectRef = {
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

type ArmTenant = {
  id?: string;
  tenantId?: string;
  displayName?: string;
  defaultDomain?: string;
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

export type AzurePrincipalProfile = {
  tenantId: string;
  principalId: string;
  displayName: string;
  principalName: string;
  principalType: AzurePrincipalType;
};

type GraphMeResponse = {
  id?: string;
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
};

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return methodNotAllowedResponse(AZURE_PROJECTS_ALLOWED_METHODS);
  }

  const requestedTenantId = new URL(request.url).searchParams.get("tenantId")?.trim() ?? "";
  const dependencies = getAzureDependencies();
  const tokenResult = await getArmAccessToken(dependencies, requestedTenantId);
  if (!tokenResult.ok) {
    return authRequiredResponse();
  }

  const principal = await resolveAzurePrincipalProfile(tokenResult, dependencies);

  try {
    const [projects, tenants] = await Promise.all([
      loadAzureProjectsWithFallback(request, tokenResult.token),
      loadAzureTenantsWithFallback(request, tokenResult.token, tokenResult.tenantId),
    ]);
    return Response.json({
      projects,
      tenants,
      principal,
      tenantId: tokenResult.tenantId,
      principalId: tokenResult.principalId,
      authRequired: false,
    });
  } catch (error) {
    if (isLikelyAzureAuthError(error)) {
      await logServerRouteEvent({
        request,
        route: AZURE_PROJECTS_ROUTE,
        eventName: "azure_auth_required",
        action: "list_projects",
        level: "warning",
        statusCode: 401,
        error,
      });

      return authRequiredResponse();
    }

    await logServerRouteEvent({
      request,
      route: AZURE_PROJECTS_ROUTE,
      eventName: "load_azure_projects_failed",
      action: "list_projects",
      statusCode: 502,
      error,
    });

    return errorResponse({
      status: 502,
      code: "load_azure_projects_failed",
      error: `Failed to load Azure project data: ${readErrorMessage(error)}`,
    });
  }
}

async function loadAzureProjectsWithFallback(
  request: Request,
  accessToken: string,
): Promise<AzureProject[]> {
  try {
    return await listAzureProjects(accessToken);
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: AZURE_PROJECTS_ROUTE,
      eventName: "load_azure_projects_partial_failed",
      action: "list_projects",
      level: "warning",
      error,
      context: {
        fallbackProjects: true,
      },
    });
    return [];
  }
}

async function loadAzureTenantsWithFallback(
  request: Request,
  accessToken: string,
  activeTenantId: string,
): Promise<AzureTenant[]> {
  try {
    return await listAzureTenants(accessToken, activeTenantId);
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: AZURE_PROJECTS_ROUTE,
      eventName: "load_azure_tenants_failed",
      action: "list_tenants",
      level: "warning",
      error,
      context: {
        tenantId: activeTenantId || null,
      },
    });

    return activeTenantId
      ? [
          {
            tenantId: activeTenantId,
            displayName: activeTenantId,
            defaultDomain: "",
          },
        ]
      : [];
  }
}

export async function listAzureProjects(accessToken: string): Promise<AzureProject[]> {
  const subscriptions = await fetchArmPaged<ArmSubscription>(
    `https://management.azure.com/subscriptions?api-version=${AZURE_SUBSCRIPTIONS_API_VERSION}`,
    accessToken,
    AZURE_MAX_SUBSCRIPTIONS,
  );

  const enabledSubscriptionIds = subscriptions
    .map((subscription) => {
      const subscriptionId =
        typeof subscription.subscriptionId === "string" ? subscription.subscriptionId.trim() : "";
      const subscriptionState =
        typeof subscription.state === "string" ? subscription.state.toLowerCase() : "";
      if (!subscriptionId || (subscriptionState && subscriptionState !== "enabled")) {
        return "";
      }

      return subscriptionId;
    })
    .filter(Boolean);

  const discovered = (
    await mapWithConcurrency(
      enabledSubscriptionIds,
      AZURE_SUBSCRIPTION_ACCOUNT_FETCH_CONCURRENCY,
      async (subscriptionId): Promise<Array<AzureProject & { resourceGroup: string }>> => {
        let accounts: ArmCognitiveAccount[];
        try {
          accounts = await fetchArmPaged<ArmCognitiveAccount>(
            `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.CognitiveServices/accounts?api-version=${AZURE_COGNITIVE_API_VERSION}`,
            accessToken,
            AZURE_MAX_ACCOUNTS_PER_SUBSCRIPTION,
          );
        } catch (error) {
          await logServerRouteEvent({
            route: AZURE_PROJECTS_ROUTE,
            eventName: "list_accounts_failed",
            action: "list_subscription_accounts",
            level: "warning",
            error,
            context: {
              subscriptionId,
            },
          });
          return [];
        }

        const projects: Array<AzureProject & { resourceGroup: string }> = [];
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

          projects.push({
            id: createProjectId({
              subscriptionId,
              resourceGroup,
              accountName,
            }),
            projectName: accountName,
            baseUrl,
            apiVersion: AZURE_OPENAI_DEFAULT_API_VERSION,
            resourceGroup,
          });
        }

        return projects;
      },
    )
  ).flat();

  const dedupeById = new Set<string>();
  const dedupedDiscovered: Array<AzureProject & { resourceGroup: string }> = [];
  for (const project of discovered) {
    if (dedupeById.has(project.id)) {
      continue;
    }

    dedupeById.add(project.id);
    dedupedDiscovered.push(project);
  }

  const nameCounts = new Map<string, number>();
  for (const project of dedupedDiscovered) {
    const key = project.projectName.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const projects = dedupedDiscovered
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

export async function listAzureTenants(
  accessToken: string,
  activeTenantId: string,
  abortSignal?: AbortSignal,
): Promise<AzureTenant[]> {
  const discovered = await fetchArmPaged<ArmTenant>(
    `https://management.azure.com/tenants?api-version=${AZURE_TENANTS_API_VERSION}`,
    accessToken,
    AZURE_MAX_TENANTS,
    abortSignal,
  );

  const tenantsById = new Map<string, AzureTenant>();
  for (const tenant of discovered) {
    const tenantId = readArmTenantId(tenant);
    if (!tenantId) {
      continue;
    }
    const tenantKey = tenantId.toLowerCase();

    const defaultDomain =
      typeof tenant.defaultDomain === "string" ? tenant.defaultDomain.trim() : "";
    const displayNameRaw =
      typeof tenant.displayName === "string" ? tenant.displayName.trim() : "";
    const displayName = displayNameRaw || defaultDomain || tenantId;
    const existing = tenantsById.get(tenantKey);
    if (existing && existing.defaultDomain && existing.displayName) {
      continue;
    }

    tenantsById.set(tenantKey, {
      tenantId,
      displayName,
      defaultDomain,
    });
  }

  const normalizedActiveTenantId = activeTenantId.trim();
  const normalizedActiveTenantKey = normalizedActiveTenantId.toLowerCase();
  if (normalizedActiveTenantId && !tenantsById.has(normalizedActiveTenantKey)) {
    tenantsById.set(normalizedActiveTenantKey, {
      tenantId: normalizedActiveTenantId,
      displayName: normalizedActiveTenantId,
      defaultDomain: "",
    });
  }

  return Array.from(tenantsById.values()).sort((left, right) => {
    if (
      normalizedActiveTenantKey &&
      left.tenantId.toLowerCase() === normalizedActiveTenantKey
    ) {
      return -1;
    }
    if (
      normalizedActiveTenantKey &&
      right.tenantId.toLowerCase() === normalizedActiveTenantKey
    ) {
      return 1;
    }
    return left.displayName.localeCompare(right.displayName);
  });
}

export async function listProjectDeployments(
  accessToken: string,
  projectRef: AzureProjectRef,
): Promise<string[]> {
  const { subscriptionId, resourceGroup, accountName } = projectRef;
  const deployments = await fetchArmPaged<ArmCognitiveDeployment>(
    `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.CognitiveServices/accounts/${encodeURIComponent(accountName)}/deployments?api-version=${AZURE_COGNITIVE_API_VERSION}`,
    accessToken,
    AZURE_MAX_DEPLOYMENTS_PER_ACCOUNT,
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
      `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.CognitiveServices/accounts/${encodeURIComponent(accountName)}/models?api-version=${AZURE_COGNITIVE_API_VERSION}`,
      accessToken,
      AZURE_MAX_MODELS_PER_ACCOUNT,
    );
  } catch (error) {
    await logServerRouteEvent({
      route: AZURE_PROJECTS_ROUTE,
      eventName: "list_account_models_failed",
      action: "list_account_models",
      level: "warning",
      error,
      context: {
        subscriptionId,
        resourceGroup,
        accountName,
      },
    });
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

export function parseProjectId(projectId: string): AzureProjectRef | null {
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

function readArmTenantId(tenant: ArmTenant): string {
  const tenantId =
    typeof tenant.tenantId === "string" ? tenant.tenantId.trim() : "";
  if (tenantId) {
    return tenantId;
  }

  const resourceId = typeof tenant.id === "string" ? tenant.id.trim() : "";
  const match = resourceId.match(/\/tenants\/([^/]+)/i);
  return match?.[1]?.trim() ?? "";
}

export type ArmAccessTokenResult =
  | {
      ok: true;
      token: string;
      tenantId: string;
      principalId: string;
      displayName: string;
      principalName: string;
      principalType: AzurePrincipalType;
    }
  | { ok: false };

export async function getArmAccessToken(
  dependencies: AzureDependencies = getAzureDependencies(),
  preferredTenantId = "",
): Promise<ArmAccessTokenResult> {
  const normalizedPreferredTenantId = preferredTenantId.trim();
  let userContext = await readAzureArmUserContext(dependencies, normalizedPreferredTenantId);
  if (!userContext) {
    return { ok: false };
  }

  if (
    normalizedPreferredTenantId &&
    userContext.tenantId.toLowerCase() !== normalizedPreferredTenantId.toLowerCase()
  ) {
    try {
      await dependencies.authenticateAzure(AZURE_ARM_SCOPE, normalizedPreferredTenantId);
    } catch {
      return { ok: false };
    }

    userContext = await readAzureArmUserContext(dependencies, normalizedPreferredTenantId);
    if (
      !userContext ||
      userContext.tenantId.toLowerCase() !== normalizedPreferredTenantId.toLowerCase()
    ) {
      return { ok: false };
    }
  }

  return {
    ok: true,
    token: userContext.token,
    tenantId: userContext.tenantId,
    principalId: userContext.principalId,
    displayName: userContext.displayName,
    principalName: userContext.principalName,
    principalType: userContext.principalType,
  };
}

export async function resolveAzurePrincipalProfile(
  accessContext: Extract<ArmAccessTokenResult, { ok: true }>,
  dependencies: AzureDependencies,
): Promise<AzurePrincipalProfile> {
  const fallbackProfile: AzurePrincipalProfile = {
    tenantId: accessContext.tenantId,
    principalId: accessContext.principalId,
    displayName: accessContext.displayName,
    principalName: accessContext.principalName,
    principalType: accessContext.principalType,
  };

  if (
    accessContext.principalType === "servicePrincipal" ||
    accessContext.principalType === "managedIdentity"
  ) {
    return normalizeAzurePrincipalProfile(fallbackProfile);
  }

  let graphToken = "";
  try {
    graphToken = await dependencies.getAzureBearerToken(AZURE_GRAPH_SCOPE);
  } catch {
    return normalizeAzurePrincipalProfile(fallbackProfile);
  }

  if (!graphToken) {
    return normalizeAzurePrincipalProfile(fallbackProfile);
  }

  try {
    const graphRequestStartedAtMs = Date.now();
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${graphToken}`,
        },
      },
    );
    const graphRequestDurationMs = Date.now() - graphRequestStartedAtMs;
    const payload = (await response.json().catch(() => null)) as GraphMeResponse | null;
    if (!response.ok) {
      await logServerRouteEvent({
        route: AZURE_PROJECTS_ROUTE,
        eventName: "azure_graph_api_call_failed",
        action: "load_graph_profile",
        level: "warning",
        statusCode: response.status,
        message: "Microsoft Graph API call failed.",
        context: {
          requestUrl: summarizeUrlForLog(
            "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail",
          ),
          durationMs: graphRequestDurationMs,
          statusText: response.statusText || null,
        },
      });
      return normalizeAzurePrincipalProfile(fallbackProfile);
    }

    await logServerRouteEvent({
      route: AZURE_PROJECTS_ROUTE,
      eventName: "azure_graph_api_call_succeeded",
      action: "load_graph_profile",
      level: "info",
      statusCode: response.status,
      message: "Microsoft Graph API call succeeded.",
      context: {
        requestUrl: summarizeUrlForLog(
          "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail",
        ),
        durationMs: graphRequestDurationMs,
      },
    });

    const graphPrincipalId = typeof payload?.id === "string" ? payload.id.trim() : "";
    const graphDisplayName = typeof payload?.displayName === "string" ? payload.displayName.trim() : "";
    const graphPrincipalName =
      typeof payload?.userPrincipalName === "string"
        ? payload.userPrincipalName.trim()
        : typeof payload?.mail === "string"
          ? payload.mail.trim()
          : "";

    return normalizeAzurePrincipalProfile({
      tenantId: fallbackProfile.tenantId,
      principalId: graphPrincipalId || fallbackProfile.principalId,
      displayName: graphDisplayName || fallbackProfile.displayName,
      principalName: graphPrincipalName || fallbackProfile.principalName,
      principalType:
        fallbackProfile.principalType === "unknown" ? "user" : fallbackProfile.principalType,
    });
  } catch (error) {
    await logServerRouteEvent({
      route: AZURE_PROJECTS_ROUTE,
      eventName: "azure_graph_api_call_failed",
      action: "load_graph_profile",
      level: "warning",
      message: "Microsoft Graph API call failed.",
      error,
      context: {
        requestUrl: summarizeUrlForLog(
          "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail",
        ),
      },
    });
    return normalizeAzurePrincipalProfile(fallbackProfile);
  }
}

function normalizeAzurePrincipalProfile(profile: AzurePrincipalProfile): AzurePrincipalProfile {
  const tenantId = profile.tenantId.trim();
  const principalId = profile.principalId.trim();
  const principalName = profile.principalName.trim();
  const displayName = profile.displayName.trim() || principalName || principalId;

  return {
    tenantId,
    principalId,
    displayName,
    principalName,
    principalType: profile.principalType,
  };
}

async function fetchArmPaged<T>(
  url: string,
  accessToken: string,
  maxItems: number,
  abortSignal?: AbortSignal,
): Promise<T[]> {
  const items: T[] = [];
  let nextUrl = url;
  let pageNumber = 0;

  while (nextUrl && items.length < maxItems) {
    pageNumber += 1;
    const requestStartedAtMs = Date.now();

    let response: Response;
    try {
      response = await fetch(nextUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: abortSignal,
      });
    } catch (error) {
      await logServerRouteEvent({
        route: AZURE_PROJECTS_ROUTE,
        eventName: "azure_arm_api_call_failed",
        action: "fetch_arm_page",
        level: "warning",
        message: "Azure ARM API call failed before response.",
        error,
        context: {
          requestUrl: summarizeUrlForLog(nextUrl),
          durationMs: Date.now() - requestStartedAtMs,
          pageNumber,
        },
      });
      throw error;
    }

    const payload = (await response.json().catch(() => null)) as ArmPagedResponse<T> | null;
    const requestDurationMs = Date.now() - requestStartedAtMs;
    if (!response.ok) {
      await logServerRouteEvent({
        route: AZURE_PROJECTS_ROUTE,
        eventName: "azure_arm_api_call_failed",
        action: "fetch_arm_page",
        level: "warning",
        statusCode: response.status,
        message: "Azure ARM API call failed.",
        context: {
          requestUrl: summarizeUrlForLog(nextUrl),
          durationMs: requestDurationMs,
          pageNumber,
          statusText: response.statusText || null,
          armErrorMessage: readArmErrorMessage(payload) || null,
        },
      });
      throw new Error(readArmErrorMessage(payload) || response.statusText || "Azure ARM request failed.");
    }

    const pageItems = Array.isArray(payload?.value) ? payload.value : [];
    const hasNextLink = typeof payload?.nextLink === "string" && payload.nextLink.length > 0;

    await logServerRouteEvent({
      route: AZURE_PROJECTS_ROUTE,
      eventName: "azure_arm_api_call_succeeded",
      action: "fetch_arm_page",
      level: "info",
      statusCode: response.status,
      message: "Azure ARM API call succeeded.",
      context: {
        requestUrl: summarizeUrlForLog(nextUrl),
        durationMs: requestDurationMs,
        pageNumber,
        pageItemCount: pageItems.length,
        hasNextLink,
      },
    });

    const remaining = maxItems - items.length;
    items.push(...pageItems.slice(0, remaining));

    nextUrl = typeof payload?.nextLink === "string" ? payload.nextLink : "";
  }

  return items;
}

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const normalizedConcurrency = Math.max(1, Math.min(items.length, concurrency));
  const results = new Array<TResult>(items.length);
  let currentIndex = 0;

  await Promise.all(
    Array.from({ length: normalizedConcurrency }, async () => {
      while (currentIndex < items.length) {
        const targetIndex = currentIndex;
        currentIndex += 1;
        results[targetIndex] = await mapper(items[targetIndex], targetIndex);
      }
    }),
  );

  return results;
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

function summarizeUrlForLog(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const apiVersion = parsed.searchParams.get("api-version");
    return apiVersion
      ? `${parsed.origin}${parsed.pathname}?api-version=${apiVersion}`
      : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl.slice(0, 512);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

export function isLikelyAzureAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return [
    "defaultazurecredential",
    "interactivebrowsercredential",
    "authenticationrequirederror",
    "automatic authentication has been disabled",
    "chainedtokencredential",
    "credentialunavailableerror",
    "managedidentitycredential",
    "azure credential failed",
    "authentication",
    "authorization",
    "unauthorized",
    "forbidden",
    "access token",
    "aadsts",
  ].some((pattern) => message.includes(pattern));
}
