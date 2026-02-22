import { InteractiveBrowserCredential } from "@azure/identity";
import OpenAI from "openai";
import {
  AZURE_ACCESS_TOKEN_REFRESH_BUFFER_MS,
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
  authenticateAzure: (scopes: string | ReadonlyArray<string>) => Promise<void>;
  getAzureBearerToken: (scope: string) => Promise<string>;
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
      }));
  const createOpenAIClient =
    options.createOpenAIClient ?? ((openAIOptions) => new OpenAI(openAIOptions));
  let credential: AzureCredential | null = null;
  const clientsByBaseURL = new Map<string, OpenAI>();
  const accessTokenByScope = new Map<string, CachedAzureAccessToken>();
  const accessTokenRequestByScope = new Map<string, Promise<string>>();

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

  const authenticateAzure = async (scopes: string | ReadonlyArray<string>): Promise<void> => {
    const normalizedScopes = normalizeAzureScopes(scopes);
    if (normalizedScopes.length === 0) {
      throw new Error("Azure token scope is missing.");
    }

    await getCredential().authenticate(normalizedScopes);
    clearAzureAccessTokenCache();
  };

  const getAzureBearerToken = async (scope: string): Promise<string> => {
    const normalizedScope = normalizeAzureScope(scope);
    if (!normalizedScope) {
      throw new Error("Azure token scope is missing.");
    }

    const cachedToken = accessTokenByScope.get(normalizedScope);
    if (cachedToken && isAzureAccessTokenReusable(cachedToken)) {
      return cachedToken.token;
    }

    const existingRequest = accessTokenRequestByScope.get(normalizedScope);
    if (existingRequest) {
      return existingRequest;
    }

    const createdRequest = getCredential()
      .getToken(normalizedScope)
      .then((token) => {
        if (!token?.token) {
          throw new Error(
            `Azure credential failed to acquire Azure token (scope: ${normalizedScope}).`,
          );
        }
        accessTokenByScope.set(normalizedScope, mapCachedAzureAccessToken(token));
        return token.token;
      })
      .finally(() => {
        accessTokenRequestByScope.delete(normalizedScope);
      });

    accessTokenRequestByScope.set(normalizedScope, createdRequest);
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

function normalizeAzureScopes(rawValue: string | ReadonlyArray<string>): string[] {
  const rawScopes = Array.isArray(rawValue) ? rawValue : [rawValue];
  const normalized = rawScopes
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  return [...new Set(normalized)];
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
