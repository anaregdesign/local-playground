/**
 * Test module verifying api.azure-connections behavior.
 */
import { describe, expect, it } from "vitest";
import {
  readPrincipalDisplayNameFromAccessToken,
  readPrincipalIdFromAccessToken,
  readPrincipalNameFromAccessToken,
  readPrincipalTypeFromAccessToken,
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

describe("readPrincipalNameFromAccessToken", () => {
  it("prefers preferred_username", () => {
    const token = createAccessToken({
      preferred_username: " user@contoso.com ",
      upn: "ignored@contoso.com",
    });
    expect(readPrincipalNameFromAccessToken(token)).toBe("user@contoso.com");
  });

  it("falls back to upn and email", () => {
    const withUpn = createAccessToken({ upn: " upn@contoso.com " });
    expect(readPrincipalNameFromAccessToken(withUpn)).toBe("upn@contoso.com");

    const withEmail = createAccessToken({ email: " email@contoso.com " });
    expect(readPrincipalNameFromAccessToken(withEmail)).toBe("email@contoso.com");
  });
});

describe("readPrincipalDisplayNameFromAccessToken", () => {
  it("prefers name claim", () => {
    const token = createAccessToken({ name: " Azure User ", preferred_username: "user@contoso.com" });
    expect(readPrincipalDisplayNameFromAccessToken(token)).toBe("Azure User");
  });

  it("falls back to principal name and appid", () => {
    const withPrincipalName = createAccessToken({ preferred_username: "user@contoso.com" });
    expect(readPrincipalDisplayNameFromAccessToken(withPrincipalName)).toBe("user@contoso.com");

    const withAppId = createAccessToken({ appid: " app-id " });
    expect(readPrincipalDisplayNameFromAccessToken(withAppId)).toBe("app-id");
  });
});

describe("readPrincipalTypeFromAccessToken", () => {
  it("detects user and service principal", () => {
    const userToken = createAccessToken({ idtyp: "user" });
    expect(readPrincipalTypeFromAccessToken(userToken)).toBe("user");

    const appToken = createAccessToken({ idtyp: "app" });
    expect(readPrincipalTypeFromAccessToken(appToken)).toBe("servicePrincipal");
  });

  it("detects managed identity and unknown types", () => {
    const managedIdentityToken = createAccessToken({ xms_mirid: "/subscriptions/s/resourceGroups/rg" });
    expect(readPrincipalTypeFromAccessToken(managedIdentityToken)).toBe("managedIdentity");

    const unknownToken = createAccessToken({});
    expect(readPrincipalTypeFromAccessToken(unknownToken)).toBe("unknown");
  });
});

describe("isLikelyAzureAuthError", () => {
  it("returns true for Azure login/authentication failures", () => {
    expect(
      isLikelyAzureAuthError(
        new Error("AuthenticationRequiredError: Automatic authentication has been disabled."),
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
