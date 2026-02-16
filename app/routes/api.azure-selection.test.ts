import { describe, expect, it } from "vitest";
import { parseAzureSelectionPreference } from "./api.azure-selection";

describe("parseAzureSelectionPreference", () => {
  it("parses and trims a valid selection payload", () => {
    const result = parseAzureSelectionPreference({
      tenantId: " tenant-a ",
      projectId: " project-a ",
      deploymentName: " deploy-a ",
    });

    expect(result).not.toBeNull();
    expect(result?.tenantId).toBe("tenant-a");
    expect(result?.projectId).toBe("project-a");
    expect(result?.deploymentName).toBe("deploy-a");
    expect(typeof result?.updatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(result?.updatedAt ?? ""))).toBe(false);
  });

  it("returns null when required fields are missing", () => {
    expect(
      parseAzureSelectionPreference({
        tenantId: "tenant-a",
        projectId: "project-a",
      }),
    ).toBeNull();
    expect(
      parseAzureSelectionPreference({
        tenantId: "tenant-a",
        projectId: "",
        deploymentName: "deploy-a",
      }),
    ).toBeNull();
    expect(parseAzureSelectionPreference("invalid")).toBeNull();
  });
});
