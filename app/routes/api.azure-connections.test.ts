import { describe, expect, it } from "vitest";
import { readTenantIdFromAccessToken } from "./api.azure-connections";

function createAccessToken(payload: unknown): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encodedPayload}.signature`;
}

describe("readTenantIdFromAccessToken", () => {
  it("returns tid when present", () => {
    const token = createAccessToken({ tid: " tenant-a " });
    expect(readTenantIdFromAccessToken(token)).toBe("tenant-a");
  });

  it("falls back to tenantId when tid is not present", () => {
    const token = createAccessToken({ tenantId: "tenant-b" });
    expect(readTenantIdFromAccessToken(token)).toBe("tenant-b");
  });

  it("prefers tid over tenantId when both are present", () => {
    const token = createAccessToken({ tid: "tenant-priority", tenantId: "tenant-fallback" });
    expect(readTenantIdFromAccessToken(token)).toBe("tenant-priority");
  });

  it("returns empty string for invalid token format", () => {
    expect(readTenantIdFromAccessToken("invalid-token")).toBe("");
  });

  it("returns empty string for invalid payload JSON", () => {
    const encodedPayload = Buffer.from("not-json").toString("base64url");
    const token = `header.${encodedPayload}.signature`;
    expect(readTenantIdFromAccessToken(token)).toBe("");
  });
});
