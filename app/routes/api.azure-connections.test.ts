import { describe, expect, it } from "vitest";
import {
  readPrincipalIdFromAccessToken,
  readTenantIdFromAccessToken,
} from "~/lib/server/auth/azure-user";
import { isLikelyAzureAuthError } from "./api.azure-connections";

function createAccessToken(payload: unknown): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encodedPayload}.signature`;
}

describe("readTenantIdFromAccessToken", () => {
  it("returns tid when present", () => {
    const token = createAccessToken({ tid: " tenant-a " });
    expect(readTenantIdFromAccessToken(token)).toBe("tenant-a");
  });

  it("returns empty string when tid is not present", () => {
    const token = createAccessToken({ tenantId: "tenant-b" });
    expect(readTenantIdFromAccessToken(token)).toBe("");
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

describe("readPrincipalIdFromAccessToken", () => {
  it("returns oid when present", () => {
    const token = createAccessToken({ oid: " principal-oid " });
    expect(readPrincipalIdFromAccessToken(token)).toBe("principal-oid");
  });

  it("returns empty string when oid is not present", () => {
    const withSub = createAccessToken({ sub: "principal-sub" });
    expect(readPrincipalIdFromAccessToken(withSub)).toBe("");

    const withAppId = createAccessToken({ appid: "principal-app" });
    expect(readPrincipalIdFromAccessToken(withAppId)).toBe("");
  });

  it("returns empty string for invalid token format", () => {
    expect(readPrincipalIdFromAccessToken("invalid-token")).toBe("");
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
