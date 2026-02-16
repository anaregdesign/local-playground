import { describe, expect, it } from "vitest";
import {
  readAzureSelectionFromUnknown,
  readTenantIdFromUnknown,
  validateContextWindowInput,
} from "./home";

describe("validateContextWindowInput", () => {
  it("accepts integers in the allowed range", () => {
    expect(validateContextWindowInput("10")).toEqual({
      isValid: true,
      value: 10,
      message: null,
    });
  });

  it("rejects non-integer input", () => {
    expect(validateContextWindowInput("1.5")).toEqual({
      isValid: false,
      value: null,
      message: "Context window must be an integer.",
    });
  });

  it("rejects values outside range", () => {
    expect(validateContextWindowInput("0")).toEqual({
      isValid: false,
      value: null,
      message: "Context window must be between 1 and 200.",
    });
    expect(validateContextWindowInput("201")).toEqual({
      isValid: false,
      value: null,
      message: "Context window must be between 1 and 200.",
    });
  });
});

describe("readTenantIdFromUnknown", () => {
  it("returns trimmed tenantId for string values", () => {
    expect(readTenantIdFromUnknown(" tenant-a ")).toBe("tenant-a");
  });

  it("returns empty string for non-string values", () => {
    expect(readTenantIdFromUnknown(100)).toBe("");
    expect(readTenantIdFromUnknown(null)).toBe("");
  });
});

describe("readAzureSelectionFromUnknown", () => {
  it("returns normalized selection when tenant matches", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: " tenant-a ",
          projectId: " project-a ",
          deploymentName: " deploy-a ",
        },
        "tenant-a",
      ),
    ).toEqual({
      tenantId: "tenant-a",
      projectId: "project-a",
      deploymentName: "deploy-a",
    });
  });

  it("returns null when tenant does not match expected tenant", () => {
    expect(
      readAzureSelectionFromUnknown(
        {
          tenantId: "tenant-a",
          projectId: "project-a",
          deploymentName: "deploy-a",
        },
        "tenant-b",
      ),
    ).toBeNull();
  });

  it("returns null for invalid payload", () => {
    expect(readAzureSelectionFromUnknown({}, "tenant-a")).toBeNull();
    expect(readAzureSelectionFromUnknown("invalid", "tenant-a")).toBeNull();
  });
});
