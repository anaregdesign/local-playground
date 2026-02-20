import { describe, expect, it } from "vitest";
import { parseAzureSelectionPreference } from "./api.azure-selection";

describe("parseAzureSelectionPreference", () => {
  it("parses and trims a valid selection payload", () => {
    const result = parseAzureSelectionPreference({
      projectId: " project-a ",
      deploymentName: " deploy-a ",
    });

    expect(result).not.toBeNull();
    expect(result?.projectId).toBe("project-a");
    expect(result?.deploymentName).toBe("deploy-a");
  });

  it("returns null when required fields are missing", () => {
    expect(
      parseAzureSelectionPreference({
        projectId: "project-a",
      }),
    ).toBeNull();
    expect(
      parseAzureSelectionPreference({
        projectId: "",
        deploymentName: "deploy-a",
      }),
    ).toBeNull();
    expect(parseAzureSelectionPreference("invalid")).toBeNull();
  });
});
