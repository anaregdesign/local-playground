import { describe, expect, it } from "vitest";
import { azureLogoutRouteTestUtils } from "./api.azure-logout";

const { isNoActiveAccountError } = azureLogoutRouteTestUtils;

describe("isNoActiveAccountError", () => {
  it("returns true for known no-active-session messages", () => {
    expect(
      isNoActiveAccountError(
        new Error("ERROR: Please run 'az login' to setup account."),
      ),
    ).toBe(true);
    expect(isNoActiveAccountError(new Error("No active account found."))).toBe(true);
    expect(isNoActiveAccountError(new Error("No subscriptions found for user."))).toBe(true);
  });

  it("returns false for unrelated failures", () => {
    expect(isNoActiveAccountError(new Error("Command timed out."))).toBe(false);
    expect(isNoActiveAccountError("invalid")).toBe(false);
  });
});
