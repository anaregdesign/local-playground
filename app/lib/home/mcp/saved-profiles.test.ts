import { describe, expect, it } from "vitest";
import {
  isMcpServersAuthRequired,
  shouldScheduleSavedMcpLoginRetry,
} from "~/lib/home/mcp/saved-profiles";

describe("isMcpServersAuthRequired", () => {
  it("returns true for HTTP 401 even without payload", () => {
    expect(isMcpServersAuthRequired(401, null)).toBe(true);
  });

  it("returns true when payload explicitly requires auth", () => {
    expect(isMcpServersAuthRequired(500, { authRequired: true })).toBe(true);
  });

  it("returns false for non-auth failures", () => {
    expect(isMcpServersAuthRequired(500, { authRequired: false })).toBe(false);
    expect(isMcpServersAuthRequired(400, undefined)).toBe(false);
  });
});

describe("shouldScheduleSavedMcpLoginRetry", () => {
  it("returns true only when auth has just recovered and key exists", () => {
    expect(shouldScheduleSavedMcpLoginRetry(true, "tenant::principal")).toBe(true);
  });

  it("returns false when auth was not required or key is empty", () => {
    expect(shouldScheduleSavedMcpLoginRetry(false, "tenant::principal")).toBe(false);
    expect(shouldScheduleSavedMcpLoginRetry(true, "")).toBe(false);
    expect(shouldScheduleSavedMcpLoginRetry(true, "   ")).toBe(false);
  });
});
