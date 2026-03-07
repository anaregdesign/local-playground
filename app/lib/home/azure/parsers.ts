/**
 * Home runtime support module.
 */
import { HOME_DEFAULT_THEME, HOME_REASONING_EFFORT_OPTIONS } from "~/lib/constants";
import type { HomeTheme, ReasoningEffort } from "~/lib/home/shared/view-types";
import { readHomeThemeFromUnknown } from "~/lib/home/theme/preference";

export type AzureProjectOption = {
  id: string;
  projectName: string;
  baseUrl: string;
  apiVersion: string;
};

export type AzureTenantOption = {
  tenantId: string;
  displayName: string;
  defaultDomain: string;
};

export type AzureDeploymentOption = {
  name: string;
  reasoningEffortOptions: ReasoningEffort[];
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
  homeTheme: HomeTheme;
  playground: AzureSelectionTargetPreference | null;
  utility: AzureUtilitySelectionTargetPreference | null;
};

export type AzureSelectionTargetPreference = {
  projectId: string;
  deploymentName: string;
};

export type AzureUtilitySelectionTargetPreference = AzureSelectionTargetPreference & {
  reasoningEffort: ReasoningEffort;
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
  if (!tenantId || !principalId) {
    return null;
  }

  if (expectedTenantId && tenantId !== expectedTenantId) {
    return null;
  }

  if (expectedPrincipalId && principalId !== expectedPrincipalId) {
    return null;
  }

  const playground = readAzureSelectionTargetFromUnknown(value.playground);
  const utility = readAzureUtilitySelectionTargetFromUnknown(value.utility);
  const homeTheme = readHomeThemeFromUnknown(value.homeTheme);
  if (!playground && !utility && !homeTheme) {
    return null;
  }

  return {
    tenantId,
    principalId,
    homeTheme: homeTheme ?? HOME_DEFAULT_THEME,
    playground,
    utility,
  };
}

export function readAzureProjectList(value: unknown): AzureProjectOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const projects: AzureProjectOption[] = [];
  for (const entry of value) {
    const project = readAzureProjectFromUnknown(entry);
    if (!project) {
      continue;
    }

    projects.push(project);
  }

  return projects;
}

export function readAzureTenantList(value: unknown): AzureTenantOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tenants: AzureTenantOption[] = [];
  const dedupeTenantId = new Set<string>();
  for (const entry of value) {
    const tenant = readAzureTenantFromUnknown(entry);
    if (!tenant) {
      continue;
    }

    const tenantKey = tenant.tenantId.toLowerCase();
    if (dedupeTenantId.has(tenantKey)) {
      continue;
    }
    dedupeTenantId.add(tenantKey);
    tenants.push(tenant);
  }

  return tenants;
}

export function readAzureDeploymentList(value: unknown): AzureDeploymentOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deploymentByName = new Map<string, AzureDeploymentOption>();
  for (const entry of value) {
    const deployment = readAzureDeploymentFromUnknown(entry);
    if (!deployment) {
      continue;
    }

    const deploymentKey = deployment.name.toLowerCase();
    const existing = deploymentByName.get(deploymentKey);
    if (existing) {
      existing.reasoningEffortOptions = mergeReasoningEffortOptions(
        existing.reasoningEffortOptions,
        deployment.reasoningEffortOptions,
      );
      continue;
    }

    deploymentByName.set(deploymentKey, deployment);
  }

  return [...deploymentByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function readAzureProjectFromUnknown(value: unknown): AzureProjectOption | null {
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

function readAzureTenantFromUnknown(value: unknown): AzureTenantOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const tenantId = typeof value.tenantId === "string" ? value.tenantId.trim() : "";
  if (!tenantId) {
    return null;
  }

  const defaultDomain =
    typeof value.defaultDomain === "string" ? value.defaultDomain.trim() : "";
  const displayNameRaw =
    typeof value.displayName === "string" ? value.displayName.trim() : "";
  const displayName = displayNameRaw || defaultDomain || tenantId;

  return {
    tenantId,
    displayName,
    defaultDomain,
  };
}

function readAzureDeploymentFromUnknown(value: unknown): AzureDeploymentOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) {
    return null;
  }

  const reasoningEffortOptions = readReasoningEffortOptionsFromUnknown(value.reasoningEffortOptions);

  return {
    name,
    reasoningEffortOptions,
  };
}

function readAzureSelectionTargetFromUnknown(
  value: unknown,
): AzureSelectionTargetPreference | null {
  if (!isRecord(value)) {
    return null;
  }

  const projectId = typeof value.projectId === "string" ? value.projectId.trim() : "";
  const deploymentName = typeof value.deploymentName === "string" ? value.deploymentName.trim() : "";
  if (!projectId || !deploymentName) {
    return null;
  }

  return {
    projectId,
    deploymentName,
  };
}

function readAzureUtilitySelectionTargetFromUnknown(
  value: unknown,
): AzureUtilitySelectionTargetPreference | null {
  if (!isRecord(value)) {
    return null;
  }

  const base = readAzureSelectionTargetFromUnknown(value);
  if (!base) {
    return null;
  }

  const reasoningEffort = readReasoningEffortFromUnknown(value.reasoningEffort);
  if (!reasoningEffort) {
    return null;
  }

  return {
    ...base,
    reasoningEffort,
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

function readReasoningEffortFromUnknown(value: unknown): ReasoningEffort | null {
  if (
    typeof value === "string" &&
    HOME_REASONING_EFFORT_OPTIONS.includes(value as ReasoningEffort)
  ) {
    return value as ReasoningEffort;
  }

  return null;
}

function readReasoningEffortOptionsFromUnknown(value: unknown): ReasoningEffort[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const options: ReasoningEffort[] = [];
  for (const entry of value) {
    const effort = readReasoningEffortFromUnknown(entry);
    if (!effort || options.includes(effort)) {
      continue;
    }
    options.push(effort);
  }

  return orderReasoningEffortOptions(options);
}

function mergeReasoningEffortOptions(
  current: ReasoningEffort[],
  incoming: ReasoningEffort[],
): ReasoningEffort[] {
  if (current.length === 0) {
    return [...incoming];
  }
  if (incoming.length === 0) {
    return [...current];
  }

  return orderReasoningEffortOptions([...current, ...incoming]);
}

function orderReasoningEffortOptions(options: ReasoningEffort[]): ReasoningEffort[] {
  const optionSet = new Set(options);
  return HOME_REASONING_EFFORT_OPTIONS.filter((effort) => optionSet.has(effort));
}
