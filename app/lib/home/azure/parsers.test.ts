/**
 * Test module verifying parsers behavior.
 */
import { describe, expect, it } from "vitest";
import {
  readAzureDeploymentList,
  readAzurePrincipalProfileFromUnknown,
  readAzureProjectList,
  readAzureSelectionFromUnknown,
  readPrincipalIdFromUnknown,
  readTenantIdFromUnknown,
} from "./parsers";

describe("readTenantIdFromUnknown", () => {
  it("returns trimmed tenantId for string values", () => {
    expect(readTenantIdFromUnknown(" tenant-a ")).toBe("tenant-a");
  });

  it("returns empty string for non-string values", () => {
    expect(readTenantIdFromUnknown(100)).toBe("");
    expect(readTenantIdFromUnknown(null)).toBe("");
  });
});

describe("readPrincipalIdFromUnknown", () => {
  it("returns trimmed principalId for string values", () => {
    expect(readPrincipalIdFromUnknown(" principal-a ")).toBe("principal-a");
  });

  it("returns empty string for non-string values", () => {
    expect(readPrincipalIdFromUnknown(100)).toBe("");
    expect(readPrincipalIdFromUnknown(null)).toBe("");
  });
});

describe("readAzurePrincipalProfileFromUnknown", () => {
  it("returns normalized principal profile when values are valid", () => {
    expect(
      readAzurePrincipalProfileFromUnknown(
        {
          tenantId: " tenant-a ",
          principalId: " principal-a ",
          displayName: " Azure User ",
          principalName: " user@contoso.com ",
          principalType: "user",
        },
      ),
    ).toEqual({
      tenantId: "tenant-a",
      principalId: "principal-a",
      displayName: "Azure User",
      principalName: "user@contoso.com",
      principalType: "user",
    });
  });

  it("uses fallback tenant/principal ids when omitted from payload", () => {
    expect(
      readAzurePrincipalProfileFromUnknown(
        {
          displayName: "Fallback User",
          principalType: "servicePrincipal",
        },
        "tenant-a",
        "principal-a",
      ),
    ).toEqual({
      tenantId: "tenant-a",
      principalId: "principal-a",
      displayName: "Fallback User",
      principalName: "",
      principalType: "servicePrincipal",
    });
  });

  it("returns null when tenant and principal are unavailable", () => {
    expect(readAzurePrincipalProfileFromUnknown({})).toBeNull();
    expect(readAzurePrincipalProfileFromUnknown("invalid")).toBeNull();
  });

  it("normalizes unknown principal type and display name fallback", () => {
    expect(
      readAzurePrincipalProfileFromUnknown({
        tenantId: "tenant-a",
        principalId: "principal-a",
        principalName: "user@contoso.com",
        principalType: "external",
      }),
    ).toEqual({
      tenantId: "tenant-a",
      principalId: "principal-a",
      displayName: "user@contoso.com",
      principalName: "user@contoso.com",
      principalType: "unknown",
    });
  });
});

describe("readAzureSelectionFromUnknown", () => {
  it("returns normalized selection when tenant and principal match", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: " tenant-a ",
          principalId: " principal-a ",
          playground: {
            projectId: " project-a ",
            deploymentName: " deploy-a ",
          },
          utility: {
            projectId: " project-b ",
            deploymentName: " deploy-b ",
            reasoningEffort: "low",
          },
        },
        "tenant-a",
        "principal-a",
      ),
    ).toEqual({
      tenantId: "tenant-a",
      principalId: "principal-a",
      playground: {
        projectId: "project-a",
        deploymentName: "deploy-a",
      },
      utility: {
        projectId: "project-b",
        deploymentName: "deploy-b",
        reasoningEffort: "low",
      },
    });
  });

  it("allows one context to be unset", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: "tenant-a",
          principalId: "principal-a",
          playground: {
            projectId: "project-a",
            deploymentName: "deploy-a",
          },
          utility: null,
        },
        "tenant-a",
        "principal-a",
      ),
    ).toEqual({
      tenantId: "tenant-a",
      principalId: "principal-a",
      playground: {
        projectId: "project-a",
        deploymentName: "deploy-a",
      },
      utility: null,
    });
  });

  it("returns null when utility target has invalid reasoning effort", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: "tenant-a",
          principalId: "principal-a",
          utility: {
            projectId: "project-a",
            deploymentName: "deploy-a",
            reasoningEffort: "fast",
          },
        },
        "tenant-a",
        "principal-a",
      ),
    ).toBeNull();
  });

  it("returns null when tenant does not match expected tenant", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: "tenant-a",
          principalId: "principal-a",
          playground: {
            projectId: "project-a",
            deploymentName: "deploy-a",
          },
        },
        "tenant-b",
        "principal-a",
      ),
    ).toBeNull();
  });

  it("returns null when principal does not match expected principal", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: "tenant-a",
          principalId: "principal-a",
          utility: {
            projectId: "project-a",
            deploymentName: "deploy-a",
            reasoningEffort: "high",
          },
        },
        "tenant-a",
        "principal-b",
      ),
    ).toBeNull();
  });

  it("returns null for invalid payload", () => {
    expect(readAzureSelectionFromUnknown({}, "tenant-a", "principal-a")).toBeNull();
    expect(readAzureSelectionFromUnknown("invalid", "tenant-a", "principal-a")).toBeNull();
  });

  it("returns null when both playground and utility are missing", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: "tenant-a",
          principalId: "principal-a",
        },
        "tenant-a",
        "principal-a",
      ),
    ).toBeNull();
  });
});

describe("readAzureProjectList", () => {
  it("reads only valid projects", () => {
    expect(
      readAzureProjectList([
        { id: "id-1", projectName: "proj", baseUrl: "https://example", apiVersion: "2025-01-01" },
        { id: "id-2" },
      ]),
    ).toEqual([
      { id: "id-1", projectName: "proj", baseUrl: "https://example", apiVersion: "2025-01-01" },
    ]);
  });
});

describe("readAzureDeploymentList", () => {
  it("deduplicates deployments case-insensitively", () => {
    expect(readAzureDeploymentList(["A", "a", "B", " b "])).toEqual(["A", "B"]);
  });
});
