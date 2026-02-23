/**
 * Test module verifying errors behavior.
 */
import { describe, expect, it } from "vitest";
import { isLikelyChatAzureAuthError } from "~/lib/home/azure/errors";

describe("isLikelyChatAzureAuthError", () => {
  it("returns true for typical Azure auth failures", () => {
    expect(isLikelyChatAzureAuthError("Azure login is required.")).toBe(true);
    expect(isLikelyChatAzureAuthError("AADSTS70043: refresh token expired")).toBe(true);
    expect(isLikelyChatAzureAuthError("DefaultAzureCredential failed to retrieve a token")).toBe(true);
  });

  it("returns false for non-auth messages", () => {
    expect(isLikelyChatAzureAuthError("Network timeout while loading projects.")).toBe(false);
    expect(isLikelyChatAzureAuthError("")).toBe(false);
    expect(isLikelyChatAzureAuthError(null)).toBe(false);
  });
});
