import { describe, expect, it } from "vitest";
import { parseAzureSelectionPreference } from "./api.azure-selection";

describe("parseAzureSelectionPreference", () => {
  it("parses and trims a valid selection payload", () => {
    const result = parseAzureSelectionPreference({
      tenantId: " tenant-a ",
      principalId: " principal-a ",
      projectId: " project-a ",
      deploymentName: " deploy-a ",
    });

    expect(result).not.toBeNull();
    expect(result?.tenantId).toBe("tenant-a");
    expect(result?.principalId).toBe("principal-a");
    expect(result?.projectId).toBe("project-a");
    expect(result?.deploymentName).toBe("deploy-a");
  });

  it("returns null when required fields are missing", () => {
    expect(
      parseAzureSelectionPreference({
        tenantId: "tenant-a",
        principalId: "principal-a",
        projectId: "project-a",
      }),
    ).toBeNull();
    expect(
      parseAzureSelectionPreference({
        tenantId: "tenant-a",
        principalId: "principal-a",
        projectId: "",
        deploymentName: "deploy-a",
      }),
    ).toBeNull();
    expect(parseAzureSelectionPreference("invalid")).toBeNull();
  });
});
