import type { AzureDependencies } from "~/lib/azure/dependencies";
import { getAzureDependencies } from "~/lib/azure/dependencies";
import { AZURE_ARM_SCOPE } from "~/lib/constants";

export type AzureUserIdentity = {
  tenantId: string;
  principalId: string;
};

export type AzureArmUserContext = AzureUserIdentity & {
  token: string;
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
