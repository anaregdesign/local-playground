/**
 * Server runtime module.
 */
import type { AzureDependencies } from "~/lib/azure/dependencies";
import { getAzureDependencies } from "~/lib/azure/dependencies";
import { AZURE_ARM_SCOPE } from "~/lib/constants";

export type AzurePrincipalType = "user" | "servicePrincipal" | "managedIdentity" | "unknown";

export type AzureUserIdentity = {
  tenantId: string;
  principalId: string;
};

export type AzureArmUserContext = AzureUserIdentity & {
  token: string;
  displayName: string;
  principalName: string;
  principalType: AzurePrincipalType;
};

export async function readAzureArmUserContext(
  dependencies: AzureDependencies = getAzureDependencies(),
): Promise<AzureArmUserContext | null> {
  try {
    const token = await dependencies.getAzureBearerToken(AZURE_ARM_SCOPE);
    const tenantId = readTenantIdFromAccessToken(token);
    const principalId = readPrincipalIdFromAccessToken(token);
    if (!tenantId || !principalId) {
      return null;
    }

    return {
      token,
      tenantId,
      principalId,
      displayName: readPrincipalDisplayNameFromAccessToken(token),
      principalName: readPrincipalNameFromAccessToken(token),
      principalType: readPrincipalTypeFromAccessToken(token),
    };
  } catch {
    return null;
  }
}

export function readTenantIdFromAccessToken(accessToken: string): string {
  const payload = readAccessTokenPayload(accessToken);
  if (!payload) {
    return "";
  }

  return typeof payload.tid === "string" ? payload.tid.trim() : "";
}

export function readPrincipalIdFromAccessToken(accessToken: string): string {
  const payload = readAccessTokenPayload(accessToken);
  if (!payload) {
    return "";
  }

  return typeof payload.oid === "string" ? payload.oid.trim() : "";
}

export function readPrincipalDisplayNameFromAccessToken(accessToken: string): string {
  const payload = readAccessTokenPayload(accessToken);
  if (!payload) {
    return "";
  }

  const displayName =
    typeof payload.name === "string"
      ? payload.name.trim()
      : "";
  if (displayName) {
    return displayName;
  }

  const principalName = readPrincipalNameFromAccessToken(accessToken);
  if (principalName) {
    return principalName;
  }

  return typeof payload.appid === "string" ? payload.appid.trim() : "";
}

export function readPrincipalNameFromAccessToken(accessToken: string): string {
  const payload = readAccessTokenPayload(accessToken);
  if (!payload) {
    return "";
  }

  const preferredUsername =
    typeof payload.preferred_username === "string" ? payload.preferred_username.trim() : "";
  if (preferredUsername) {
    return preferredUsername;
  }

  const upn = typeof payload.upn === "string" ? payload.upn.trim() : "";
  if (upn) {
    return upn;
  }

  return typeof payload.email === "string" ? payload.email.trim() : "";
}

export function readPrincipalTypeFromAccessToken(accessToken: string): AzurePrincipalType {
  const payload = readAccessTokenPayload(accessToken);
  if (!payload) {
    return "unknown";
  }

  const idType = typeof payload.idtyp === "string" ? payload.idtyp.trim().toLowerCase() : "";
  if (idType === "app") {
    return "servicePrincipal";
  }
  if (idType === "user") {
    return "user";
  }

  const managedIdentityResourceId =
    typeof payload.xms_mirid === "string" ? payload.xms_mirid.trim() : "";
  if (managedIdentityResourceId) {
    return "managedIdentity";
  }

  const appId = typeof payload.appid === "string" ? payload.appid.trim() : "";
  if (appId) {
    return "servicePrincipal";
  }

  const principalName = readPrincipalNameFromAccessToken(accessToken);
  if (principalName) {
    return "user";
  }

  return "unknown";
}

function readAccessTokenPayload(accessToken: string): Record<string, unknown> | null {
  const parts = accessToken.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
