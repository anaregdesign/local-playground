/**
 * Azure integration helper module.
 */
import { InteractiveBrowserCredential } from "@azure/identity";
import OpenAI from "openai";
import {
  AZURE_ACCESS_TOKEN_REFRESH_BUFFER_MS,
  AZURE_ARM_SCOPE,
  AZURE_COGNITIVE_SERVICES_SCOPE,
} from "~/lib/constants";

type AzureCredential = {
  getToken: InteractiveBrowserCredential["getToken"];
  authenticate: InteractiveBrowserCredential["authenticate"];
};

type AzureAccessToken = NonNullable<Awaited<ReturnType<AzureCredential["getToken"]>>>;
type CachedAzureAccessToken = {
  token: string;
  expiresOnTimestamp: number;
  refreshAfterTimestamp?: number;
};

export type AzureDependencies = {
  getCredential: () => AzureCredential;
  authenticateAzure: (scope: string, tenantId?: string) => Promise<void>;
  getAzureBearerToken: (scope: string, tenantId?: string) => Promise<string>;
  getAzureOpenAIClient: (baseUrl: string) => OpenAI;
};

type CreateAzureDependenciesOptions = {
  createCredential?: () => AzureCredential;
  createOpenAIClient?: (options: ConstructorParameters<typeof OpenAI>[0]) => OpenAI;
};

export { AZURE_COGNITIVE_SERVICES_SCOPE };

export function createAzureDependencies(
  options: CreateAzureDependenciesOptions = {},
): AzureDependencies {
  const createCredential =
    options.createCredential ??
    (() =>
      new InteractiveBrowserCredential({
        disableAutomaticAuthentication: true,
        additionallyAllowedTenants: ["*"],
      }));
  const createOpenAIClient =
    options.createOpenAIClient ?? ((openAIOptions) => new OpenAI(openAIOptions));
  let credential: AzureCredential | null = null;
  const clientsByBaseURL = new Map<string, OpenAI>();
  const accessTokenByScope = new Map<string, CachedAzureAccessToken>();
  const accessTokenRequestByScope = new Map<string, Promise<string>>();
  let activeTenantId = "";

  const getCredential = (): AzureCredential => {
    if (!credential) {
      credential = createCredential();
    }
    return credential;
  };

  const clearAzureAccessTokenCache = (): void => {
    accessTokenByScope.clear();
    accessTokenRequestByScope.clear();
  };

  const authenticateAzure = async (scope: string, tenantId?: string): Promise<void> => {
    const normalizedScope = normalizeAzureScope(scope);
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (!normalizedScope) {
      throw new Error("Azure token scope is missing.");
    }

    const credentialRef = getCredential();
    await authenticateAzureCredential(credentialRef, normalizedScope, normalizedTenantId);
    clearAzureAccessTokenCache();
    activeTenantId = normalizedTenantId;

    const accessToken = await requestAzureAccessToken(
      credentialRef,
      normalizedScope,
      normalizedTenantId,
    );
    if (!accessToken?.token) {
      throw new Error(
        `Azure credential failed to acquire Azure token (scope: ${normalizedScope}).`,
      );
    }
    if (shouldValidateAzureAccessTokenTenant(normalizedScope)) {
      assertAzureAccessTokenTenant(accessToken.token, normalizedTenantId, normalizedScope);
    }
    accessTokenByScope.set(
      createAccessTokenCacheKey(normalizedScope, normalizedTenantId),
      mapCachedAzureAccessToken(accessToken),
    );
  };

  const getAzureBearerToken = async (scope: string, tenantId?: string): Promise<string> => {
    const normalizedScope = normalizeAzureScope(scope);
    const resolvedTenantId = normalizeTenantId(tenantId) || activeTenantId;
    if (!normalizedScope) {
      throw new Error("Azure token scope is missing.");
    }
    const cacheKey = createAccessTokenCacheKey(normalizedScope, resolvedTenantId);

    const cachedToken = accessTokenByScope.get(cacheKey);
    if (cachedToken && isAzureAccessTokenReusable(cachedToken)) {
      if (!resolvedTenantId) {
        return cachedToken.token;
      }
      const cachedTenantId = readAzureAccessTokenTenantId(cachedToken.token);
      if (cachedTenantId && cachedTenantId.toLowerCase() === resolvedTenantId.toLowerCase()) {
        return cachedToken.token;
      }
      accessTokenByScope.delete(cacheKey);
    }

    const existingRequest = accessTokenRequestByScope.get(cacheKey);
    if (existingRequest) {
      return existingRequest;
    }

    const createdRequest = requestAzureAccessToken(
      getCredential(),
      normalizedScope,
      resolvedTenantId,
    )
      .then((token) => {
        if (!token?.token) {
          throw new Error(
            `Azure credential failed to acquire Azure token (scope: ${normalizedScope}).`,
          );
        }
        if (shouldValidateAzureAccessTokenTenant(normalizedScope)) {
          assertAzureAccessTokenTenant(token.token, resolvedTenantId, normalizedScope);
        }
        accessTokenByScope.set(cacheKey, mapCachedAzureAccessToken(token));
        return token.token;
      })
      .finally(() => {
        accessTokenRequestByScope.delete(cacheKey);
      });

    accessTokenRequestByScope.set(cacheKey, createdRequest);
    return createdRequest;
  };

  const getAzureOpenAIClient = (baseUrl: string): OpenAI => {
    const normalizedBaseURL = normalizeAzureOpenAIBaseURL(baseUrl);
    if (!normalizedBaseURL) {
      throw new Error("Azure base URL is missing.");
    }

    const existingClient = clientsByBaseURL.get(normalizedBaseURL);
    if (existingClient) {
      return existingClient;
    }

    const client = createOpenAIClient({
      baseURL: normalizedBaseURL,
      apiKey: () => getAzureBearerToken(AZURE_COGNITIVE_SERVICES_SCOPE),
    });
    clientsByBaseURL.set(normalizedBaseURL, client);
    return client;
  };

  return {
    getCredential,
    authenticateAzure,
    getAzureBearerToken,
    getAzureOpenAIClient,
  };
}

let singletonAzureDependencies: AzureDependencies | null = null;

export function getAzureDependencies(): AzureDependencies {
  if (!singletonAzureDependencies) {
    singletonAzureDependencies = createAzureDependencies();
  }
  return singletonAzureDependencies;
}

export function resetAzureDependencies(): void {
  singletonAzureDependencies = null;
}

export function normalizeAzureOpenAIBaseURL(rawValue: string): string {
  const trimmed = rawValue.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  if (/\/openai\/v1$/i.test(trimmed)) {
    return `${trimmed}/`;
  }

  return `${trimmed}/openai/v1/`;
}

function normalizeAzureScope(rawValue: string): string {
  return rawValue.trim();
}

function normalizeTenantId(rawValue: string | undefined): string {
  return typeof rawValue === "string" ? rawValue.trim() : "";
}

function createAccessTokenCacheKey(scope: string, tenantId: string): string {
  return `${tenantId || "default"}::${scope}`;
}

function requestAzureAccessToken(
  credential: AzureCredential,
  scope: string,
  tenantId: string,
): ReturnType<AzureCredential["getToken"]> {
  if (tenantId) {
    return credential.getToken(scope, { tenantId });
  }

  return credential.getToken(scope);
}

async function authenticateAzureCredential(
  credential: AzureCredential,
  scope: string,
  tenantId: string,
): Promise<void> {
  if (tenantId) {
    await credential.authenticate(scope, { tenantId });
    return;
  }

  await credential.authenticate(scope);
}

function mapCachedAzureAccessToken(token: AzureAccessToken): CachedAzureAccessToken {
  const refreshAfterTimestamp =
    typeof token.refreshAfterTimestamp === "number" ? token.refreshAfterTimestamp : undefined;

  return {
    token: token.token,
    expiresOnTimestamp: token.expiresOnTimestamp,
    ...(refreshAfterTimestamp ? { refreshAfterTimestamp } : {}),
  };
}

function isAzureAccessTokenReusable(token: CachedAzureAccessToken): boolean {
  const now = Date.now();
  if (token.refreshAfterTimestamp && token.refreshAfterTimestamp <= now) {
    return false;
  }
  return token.expiresOnTimestamp - AZURE_ACCESS_TOKEN_REFRESH_BUFFER_MS > now;
}

function shouldValidateAzureAccessTokenTenant(scope: string): boolean {
  return scope.trim().toLowerCase() === AZURE_ARM_SCOPE.toLowerCase();
}

function assertAzureAccessTokenTenant(
  accessToken: string,
  requestedTenantId: string,
  scope: string,
): void {
  const normalizedRequestedTenantId = requestedTenantId.trim();
  if (!normalizedRequestedTenantId) {
    return;
  }

  const tokenTenantId = readAzureAccessTokenTenantId(accessToken);
  if (!tokenTenantId) {
    throw new Error(
      `Azure credential returned a token without tid claim for requested tenant ${normalizedRequestedTenantId} (scope: ${scope}).`,
    );
  }

  if (tokenTenantId.toLowerCase() !== normalizedRequestedTenantId.toLowerCase()) {
    throw new Error(
      `Azure credential returned tenant ${tokenTenantId} while tenant ${normalizedRequestedTenantId} was requested (scope: ${scope}).`,
    );
  }
}

function readAzureAccessTokenTenantId(accessToken: string): string {
  const parts = accessToken.split(".");
  if (parts.length < 2) {
    return "";
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return "";
    }
    const tenantId = (payload as Record<string, unknown>).tid;
    return typeof tenantId === "string" ? tenantId.trim() : "";
  } catch {
    return "";
  }
}
