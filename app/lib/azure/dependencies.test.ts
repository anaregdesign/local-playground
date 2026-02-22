import { describe, expect, it, vi } from "vitest";
import {
  AZURE_COGNITIVE_SERVICES_SCOPE,
  createAzureDependencies,
  normalizeAzureOpenAIBaseURL,
} from "./dependencies";

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

  it("reuses OpenAI clients by normalized base URL and shares scope token cache", async () => {
    const getToken = vi.fn(async (scope: string) => ({
      token: `token-for-${scope}`,
      expiresOnTimestamp: Date.now() + 120_000,
    }));
    const createCredential = vi.fn(() => ({ getToken, authenticate: vi.fn(async () => undefined) }));
    const createOpenAIClient = vi.fn((options: unknown) => ({ options }));

    const dependencies = createAzureDependencies({
      createCredential: createCredential as never,
      createOpenAIClient: createOpenAIClient as never,
    });

    const first = dependencies.getAzureOpenAIClient("https://sample.openai.azure.com/");
    const second = dependencies.getAzureOpenAIClient("https://sample.openai.azure.com/openai/v1");
    const third = dependencies.getAzureOpenAIClient("https://other.openai.azure.com");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(createOpenAIClient).toHaveBeenCalledTimes(2);

    const firstCall = createOpenAIClient.mock.calls[0]?.[0] as
      | { baseURL?: string; apiKey?: unknown }
      | undefined;
    expect(firstCall?.baseURL).toBe("https://sample.openai.azure.com/openai/v1/");
    expect(typeof firstCall?.apiKey).toBe("function");

    const firstProvider = ((first as unknown) as { options: { apiKey: () => Promise<string> } })
      .options.apiKey;
    const secondProvider = ((third as unknown) as { options: { apiKey: () => Promise<string> } })
      .options.apiKey;
    const [firstToken, secondToken] = await Promise.all([firstProvider(), secondProvider()]);

    expect(firstToken).toBe(secondToken);
    expect(firstToken).toBe(`token-for-${AZURE_COGNITIVE_SERVICES_SCOPE}`);
    expect(createCredential).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith(AZURE_COGNITIVE_SERVICES_SCOPE);
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

    expect(() => dependencies.getAzureOpenAIClient("   ")).toThrow("Azure base URL is missing.");
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
});
