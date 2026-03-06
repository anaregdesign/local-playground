/**
 * Test module verifying dependencies behavior.
 */
import { describe, expect, it, vi } from "vitest";
import { AZURE_ARM_SCOPE } from "~/lib/constants";
import {
  AZURE_COGNITIVE_SERVICES_SCOPE,
  createAzureDependencies,
  normalizeAzureOpenAIBaseURL,
} from "./dependencies";

function createAzureAccessToken(payload: Record<string, unknown>): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encodedPayload}.signature`;
}

describe("normalizeAzureOpenAIBaseURL", () => {
  it("appends /openai/v1/ when endpoint does not include it", () => {
    expect(normalizeAzureOpenAIBaseURL(" https://sample.openai.azure.com/ ")).toBe(
      "https://sample.openai.azure.com/openai/v1/",
    );
  });

  it("normalizes existing /openai/v1 suffix", () => {
    expect(normalizeAzureOpenAIBaseURL("https://sample.openai.azure.com/openai/v1")).toBe(
      "https://sample.openai.azure.com/openai/v1/",
    );
  });

  it("returns empty string for blank input", () => {
    expect(normalizeAzureOpenAIBaseURL("   ")).toBe("");
  });
});

describe("createAzureDependencies", () => {
  it("creates InteractiveBrowserCredential lazily once and reuses it", () => {
    const credential = {
      getToken: vi.fn(async () => null),
      authenticate: vi.fn(async () => undefined),
    };
    const createCredential = vi.fn(() => credential);
    const dependencies = createAzureDependencies({
      createCredential: createCredential as never,
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    expect(dependencies.getCredential()).toBe(credential);
    expect(dependencies.getCredential()).toBe(credential);
    expect(createCredential).toHaveBeenCalledTimes(1);
  });

  it("reuses OpenAI clients by normalized base URL and tenant and shares scope token cache", async () => {
    const getToken = vi.fn(async (scope: string, options?: { tenantId?: string }) => ({
      token: createAzureAccessToken({
        tid: options?.tenantId ?? "default",
        oid: "principal-a",
        scope,
      }),
      expiresOnTimestamp: Date.now() + 120_000,
    }));
    const createCredential = vi.fn(() => ({ getToken, authenticate: vi.fn(async () => undefined) }));
    const createOpenAIClient = vi.fn((options: unknown) => ({ options }));

    const dependencies = createAzureDependencies({
      createCredential: createCredential as never,
      createOpenAIClient: createOpenAIClient as never,
    });

    const first = dependencies.getAzureOpenAIClient("https://sample.openai.azure.com/", "tenant-a");
    const second = dependencies.getAzureOpenAIClient(
      "https://sample.openai.azure.com/openai/v1",
      "tenant-a",
    );
    const third = dependencies.getAzureOpenAIClient("https://other.openai.azure.com", "tenant-a");
    const fourth = dependencies.getAzureOpenAIClient("https://sample.openai.azure.com", "tenant-b");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(first).not.toBe(fourth);
    expect(createOpenAIClient).toHaveBeenCalledTimes(3);

    const firstCall = createOpenAIClient.mock.calls[0]?.[0] as
      | { baseURL?: string; apiKey?: unknown }
      | undefined;
    expect(firstCall?.baseURL).toBe("https://sample.openai.azure.com/openai/v1/");
    expect(typeof firstCall?.apiKey).toBe("function");

    const firstProvider = ((first as unknown) as { options: { apiKey: () => Promise<string> } })
      .options.apiKey;
    const secondProvider = ((third as unknown) as { options: { apiKey: () => Promise<string> } })
      .options.apiKey;
    const thirdProvider = ((fourth as unknown) as { options: { apiKey: () => Promise<string> } })
      .options.apiKey;
    const firstToken = await firstProvider();
    const secondToken = await secondProvider();
    const thirdToken = await thirdProvider();

    expect(firstToken).toBe(secondToken);
    expect(firstToken).not.toBe(thirdToken);
    expect(createCredential).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken.mock.calls[0]).toEqual([
      AZURE_COGNITIVE_SERVICES_SCOPE,
      { tenantId: "tenant-a" },
    ]);
    expect(getToken.mock.calls[1]).toEqual([
      AZURE_COGNITIVE_SERVICES_SCOPE,
      { tenantId: "tenant-b" },
    ]);
  });

  it("throws when base URL is empty", () => {
    const dependencies = createAzureDependencies({
      createCredential: vi.fn(
        () =>
          ({
            getToken: vi.fn(async () => null),
            authenticate: vi.fn(async () => undefined),
          }) as never,
      ),
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    expect(() => dependencies.getAzureOpenAIClient("   ", "tenant-a")).toThrow(
      "Azure base URL is missing.",
    );
  });

  it("throws when tenant ID is empty for Azure OpenAI client creation", () => {
    const dependencies = createAzureDependencies({
      createCredential: vi.fn(
        () =>
          ({
            getToken: vi.fn(async () => null),
            authenticate: vi.fn(async () => undefined),
          }) as never,
      ),
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    expect(() => dependencies.getAzureOpenAIClient("https://sample.openai.azure.com", "   ")).toThrow(
      "Azure tenant ID is missing.",
    );
  });

  it("reuses bearer token for the same normalized scope", async () => {
    let sequence = 0;
    const getToken = vi.fn(async (scope: string) => {
      sequence += 1;
      return {
        token: `${scope}-token-${sequence}`,
        expiresOnTimestamp: Date.now() + 120_000,
      };
    });
    const authenticate = vi.fn(async () => undefined);
    const dependencies = createAzureDependencies({
      createCredential: vi.fn(() => ({ getToken, authenticate })) as never,
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    const first = await dependencies.getAzureBearerToken(" scope-a ");
    const second = await dependencies.getAzureBearerToken("scope-a");
    const third = await dependencies.getAzureBearerToken("scope-b");

    expect(first).toBe(second);
    expect(third).not.toBe(first);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken.mock.calls[0]?.[0]).toBe("scope-a");
    expect(getToken.mock.calls[1]?.[0]).toBe("scope-b");
  });

  it("deduplicates in-flight token requests per scope", async () => {
    let resolveToken: (value: { token: string; expiresOnTimestamp: number }) => void = () => {
      throw new Error("resolveToken is not set");
    };
    const getToken = vi.fn(
      () =>
        new Promise<{ token: string; expiresOnTimestamp: number }>((resolve) => {
          resolveToken = resolve as (value: { token: string; expiresOnTimestamp: number }) => void;
        }),
    );
    const authenticate = vi.fn(async () => undefined);

    const dependencies = createAzureDependencies({
      createCredential: vi.fn(() => ({ getToken, authenticate })) as never,
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    const firstPromise = dependencies.getAzureBearerToken("scope-a");
    const secondPromise = dependencies.getAzureBearerToken("scope-a");

    expect(getToken).toHaveBeenCalledTimes(1);
    resolveToken({
      token: "scope-a-token",
      expiresOnTimestamp: Date.now() + 120_000,
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toBe("scope-a-token");
    expect(second).toBe("scope-a-token");
  });

  it("refreshes token when cached token is too close to expiry", async () => {
    let sequence = 0;
    const getToken = vi.fn(async () => {
      sequence += 1;
      return {
        token: `token-${sequence}`,
        expiresOnTimestamp: Date.now() + (sequence === 1 ? 5_000 : 120_000),
      };
    });
    const authenticate = vi.fn(async () => undefined);

    const dependencies = createAzureDependencies({
      createCredential: vi.fn(() => ({ getToken, authenticate })) as never,
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    const first = await dependencies.getAzureBearerToken("scope-a");
    const second = await dependencies.getAzureBearerToken("scope-a");

    expect(first).toBe("token-1");
    expect(second).toBe("token-2");
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("throws when scope is empty", async () => {
    const dependencies = createAzureDependencies({
      createCredential: vi.fn(
        () =>
          ({
            getToken: vi.fn(async () => ({
              token: "unused",
              expiresOnTimestamp: Date.now() + 120_000,
            })),
            authenticate: vi.fn(async () => undefined),
          }) as never,
      ),
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    await expect(dependencies.getAzureBearerToken("   ")).rejects.toThrow(
      "Azure token scope is missing.",
    );
  });

  it("runs interactive authentication and clears cached tokens", async () => {
    const getToken = vi
      .fn()
      .mockResolvedValueOnce({
        token: "scope-a-token-1",
        expiresOnTimestamp: Date.now() + 120_000,
      })
      .mockResolvedValueOnce({
        token: "scope-a-token-2",
        expiresOnTimestamp: Date.now() + 120_000,
      });
    const authenticate = vi.fn(async () => undefined);

    const dependencies = createAzureDependencies({
      createCredential: vi.fn(() => ({ getToken, authenticate })) as never,
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    await dependencies.getAzureBearerToken("scope-a");
    await dependencies.authenticateAzure(" scope-a ");
    const nextToken = await dependencies.getAzureBearerToken("scope-a");

    expect(nextToken).toBe("scope-a-token-2");
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledWith("scope-a");
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("reuses selected tenantId for subsequent token requests", async () => {
    const scopeATenantToken = createAzureAccessToken({
      tid: "tenant-b",
      oid: "principal-b",
      tokenUse: "scope-a",
    });
    const scopeBTenantToken = createAzureAccessToken({
      tid: "tenant-b",
      oid: "principal-b",
      tokenUse: "scope-b",
    });
    const getToken = vi
      .fn()
      .mockResolvedValueOnce({
        token: scopeATenantToken,
        expiresOnTimestamp: Date.now() + 120_000,
      })
      .mockResolvedValueOnce({
        token: scopeBTenantToken,
        expiresOnTimestamp: Date.now() + 120_000,
      });
    const authenticate = vi.fn(async () => undefined);

    const dependencies = createAzureDependencies({
      createCredential: vi.fn(() => ({ getToken, authenticate })) as never,
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    await dependencies.authenticateAzure("scope-a", " tenant-b ");
    const scopeAToken = await dependencies.getAzureBearerToken("scope-a");
    const scopeBToken = await dependencies.getAzureBearerToken("scope-b");

    expect(scopeAToken).toBe(scopeATenantToken);
    expect(scopeBToken).toBe(scopeBTenantToken);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledWith("scope-a", { tenantId: "tenant-b" });
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken.mock.calls[0]).toEqual(["scope-a", { tenantId: "tenant-b" }]);
    expect(getToken.mock.calls[1]).toEqual(["scope-b", { tenantId: "tenant-b" }]);
  });

  it("rejects ARM token when requested tenant and tid do not match", async () => {
    const getToken = vi.fn(async () => ({
      token: createAzureAccessToken({
        tid: "tenant-a",
        oid: "principal-a",
      }),
      expiresOnTimestamp: Date.now() + 120_000,
    }));
    const authenticate = vi.fn(async () => undefined);

    const dependencies = createAzureDependencies({
      createCredential: vi.fn(() => ({ getToken, authenticate })) as never,
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    await expect(dependencies.getAzureBearerToken(AZURE_ARM_SCOPE, "tenant-b")).rejects.toThrow(
      "Azure credential returned tenant tenant-a while tenant tenant-b was requested",
    );
  });

  it("accepts tenant mismatch for non-ARM scope tokens", async () => {
    const token = createAzureAccessToken({
      tid: "tenant-a",
      oid: "principal-a",
    });
    const getToken = vi.fn(async () => ({
      token,
      expiresOnTimestamp: Date.now() + 120_000,
    }));
    const authenticate = vi.fn(async () => undefined);

    const dependencies = createAzureDependencies({
      createCredential: vi.fn(() => ({ getToken, authenticate })) as never,
      createOpenAIClient: vi.fn(() => ({}) as never),
    });

    await expect(
      dependencies.getAzureBearerToken(AZURE_COGNITIVE_SERVICES_SCOPE, "tenant-b"),
    ).resolves.toBe(token);
    expect(getToken).toHaveBeenCalledWith(AZURE_COGNITIVE_SERVICES_SCOPE, {
      tenantId: "tenant-b",
    });
  });
});
