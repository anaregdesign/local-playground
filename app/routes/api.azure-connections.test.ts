import { describe, expect, it } from "vitest";
import { isLikelyAzureAuthError, readTenantIdFromAccessToken } from "./api.azure-connections";

function createAccessToken(payload: unknown): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encodedPayload}.signature`;
}

describe("readTenantIdFromAccessToken", () => {
  it("returns tid when present", () => {
    const token = createAccessToken({ tid: " tenant-a " });
    expect(readTenantIdFromAccessToken(token)).toBe("tenant-a");
  });

  it("falls back to tenantId when tid is not present", () => {
    const token = createAccessToken({ tenantId: "tenant-b" });
    expect(readTenantIdFromAccessToken(token)).toBe("tenant-b");
  });

  it("prefers tid over tenantId when both are present", () => {
    const token = createAccessToken({ tid: "tenant-priority", tenantId: "tenant-fallback" });
    expect(readTenantIdFromAccessToken(token)).toBe("tenant-priority");
  });

  it("returns empty string for invalid token format", () => {
    expect(readTenantIdFromAccessToken("invalid-token")).toBe("");
  });

  it("returns empty string for invalid payload JSON", () => {
    const encodedPayload = Buffer.from("not-json").toString("base64url");
    const token = `header.${encodedPayload}.signature`;
    expect(readTenantIdFromAccessToken(token)).toBe("");
  });
});

describe("isLikelyAzureAuthError", () => {
  it("returns true for Azure login/authentication failures", () => {
    expect(
      isLikelyAzureAuthError(
        new Error("DefaultAzureCredential failed. Please run 'az login' to setup account."),
      ),
    ).toBe(true);
    expect(
      isLikelyAzureAuthError(new Error("Request failed with status code 401 Unauthorized.")),
    ).toBe(true);
  });

  it("returns false for non-auth errors", () => {
    expect(
      isLikelyAzureAuthError(new Error("Failed to load Azure connection data: Bad gateway.")),
    ).toBe(false);
    expect(isLikelyAzureAuthError(new Error("Network timeout"))).toBe(false);
    expect(isLikelyAzureAuthError("invalid")).toBe(false);
  });
});
