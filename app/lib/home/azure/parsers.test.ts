import { describe, expect, it } from "vitest";
import {
  readAzureDeploymentList,
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

describe("readAzureSelectionFromUnknown", () => {
  it("returns normalized selection when tenant and principal match", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: " tenant-a ",
          principalId: " principal-a ",
          projectId: " project-a ",
          deploymentName: " deploy-a ",
        },
        "tenant-a",
        "principal-a",
      ),
    ).toEqual({
      tenantId: "tenant-a",
      principalId: "principal-a",
      projectId: "project-a",
      deploymentName: "deploy-a",
    });
  });

  it("returns null when tenant does not match expected tenant", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: "tenant-a",
          principalId: "principal-a",
          projectId: "project-a",
          deploymentName: "deploy-a",
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
          projectId: "project-a",
          deploymentName: "deploy-a",
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
