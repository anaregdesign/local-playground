import { uniqueStringsCaseInsensitive } from "~/lib/home/shared/collections";

export type AzureConnectionOption = {
  id: string;
  projectName: string;
  baseUrl: string;
  apiVersion: string;
};

export type AzurePrincipalProfile = {
  tenantId: string;
  principalId: string;
  displayName: string;
  principalName: string;
  principalType: "user" | "servicePrincipal" | "managedIdentity" | "unknown";
};

export type AzureSelectionPreference = {
  tenantId: string;
  principalId: string;
  projectId: string;
  deploymentName: string;
};

export function readTenantIdFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readPrincipalIdFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readAzurePrincipalProfileFromUnknown(
  value: unknown,
  fallbackTenantId = "",
  fallbackPrincipalId = "",
): AzurePrincipalProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const tenantId = readTenantIdFromUnknown(value.tenantId) || fallbackTenantId.trim();
  const principalId = readPrincipalIdFromUnknown(value.principalId) || fallbackPrincipalId.trim();
  if (!tenantId || !principalId) {
    return null;
  }

  const principalName =
    typeof value.principalName === "string" ? value.principalName.trim() : "";
  const displayNameCandidate =
    typeof value.displayName === "string" ? value.displayName.trim() : "";
  const displayName = displayNameCandidate || principalName || principalId;
  const principalType = readAzurePrincipalTypeFromUnknown(value.principalType);

  return {
    tenantId,
    principalId,
    displayName,
    principalName,
    principalType,
  };
}

export function readAzureSelectionFromUnknown(
  value: unknown,
  expectedTenantId: string,
  expectedPrincipalId: string,
): AzureSelectionPreference | null {
  if (!isRecord(value)) {
    return null;
  }

  const tenantId = typeof value.tenantId === "string" ? value.tenantId.trim() : "";
  const principalId = typeof value.principalId === "string" ? value.principalId.trim() : "";
  const projectId = typeof value.projectId === "string" ? value.projectId.trim() : "";
  const deploymentName = typeof value.deploymentName === "string" ? value.deploymentName.trim() : "";
  if (!tenantId || !principalId || !projectId || !deploymentName) {
    return null;
  }

  if (expectedTenantId && tenantId !== expectedTenantId) {
    return null;
  }

  if (expectedPrincipalId && principalId !== expectedPrincipalId) {
    return null;
  }

  return {
    tenantId,
    principalId,
    projectId,
    deploymentName,
  };
}

export function readAzureProjectList(value: unknown): AzureConnectionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const projects: AzureConnectionOption[] = [];
  for (const entry of value) {
    const project = readAzureProjectFromUnknown(entry);
    if (!project) {
      continue;
    }

    projects.push(project);
  }

  return projects;
}

export function readAzureDeploymentList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStringsCaseInsensitive(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function readAzureProjectFromUnknown(value: unknown): AzureConnectionOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const projectName = typeof value.projectName === "string" ? value.projectName.trim() : "";
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  const apiVersion = typeof value.apiVersion === "string" ? value.apiVersion.trim() : "";

  if (!id || !projectName || !baseUrl || !apiVersion) {
    return null;
  }

  return {
    id,
    projectName,
    baseUrl,
    apiVersion,
  };
}

function readAzurePrincipalTypeFromUnknown(
  value: unknown,
): AzurePrincipalProfile["principalType"] {
  if (value === "user" || value === "servicePrincipal" || value === "managedIdentity") {
    return value;
  }
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
