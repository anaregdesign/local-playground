/**
 * Test module verifying api.azure-selection behavior.
 */
import { describe, expect, it } from "vitest";
import { parseAzureSelectionPreference } from "./api.azure-selection";

describe("parseAzureSelectionPreference", () => {
  it("parses and trims a valid selection payload", () => {
    const result = parseAzureSelectionPreference({
      target: "playground",
      projectId: " project-a ",
      deploymentName: " deploy-a ",
    });

    expect(result).not.toBeNull();
    expect(result?.target).toBe("playground");
    expect(result?.projectId).toBe("project-a");
    expect(result?.deploymentName).toBe("deploy-a");
    expect(result?.reasoningEffort).toBeNull();
  });

  it("accepts utility target", () => {
    const result = parseAzureSelectionPreference({
      target: "utility",
      projectId: "project-b",
      deploymentName: "deploy-b",
      reasoningEffort: "medium",
    });

    expect(result).toEqual({
      target: "utility",
      projectId: "project-b",
      deploymentName: "deploy-b",
      reasoningEffort: "medium",
    });
  });

  it("returns null when required fields are missing", () => {
    expect(
      parseAzureSelectionPreference({
        target: "playground",
        projectId: "project-a",
      }),
    ).toBeNull();
    expect(
      parseAzureSelectionPreference({
        target: "playground",
        projectId: "",
        deploymentName: "deploy-a",
      }),
    ).toBeNull();
    expect(
      parseAzureSelectionPreference({
        target: "invalid",
        projectId: "project-a",
        deploymentName: "deploy-a",
      }),
    ).toBeNull();
    expect(
      parseAzureSelectionPreference({
        target: "utility",
        projectId: "project-b",
        deploymentName: "deploy-b",
      }),
    ).toBeNull();
    expect(parseAzureSelectionPreference("invalid")).toBeNull();
  });
});
