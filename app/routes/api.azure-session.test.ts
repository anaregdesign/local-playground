/**
 * Test module verifying api.azure-session behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AZURE_ARM_SCOPE } from "~/lib/constants";

const { authenticateAzure, resetAzureDependencies, logServerRouteEvent } = vi.hoisted(() => ({
  authenticateAzure: vi.fn(async () => undefined),
  resetAzureDependencies: vi.fn(),
  logServerRouteEvent: vi.fn(async () => undefined),
}));

vi.mock("~/lib/azure/dependencies", () => ({
  getAzureDependencies: () => ({
    authenticateAzure,
  }),
  resetAzureDependencies,
}));

vi.mock("~/lib/server/observability/app-event-log", () => ({
  installGlobalServerErrorLogging: vi.fn(),
  logServerRouteEvent,
}));

import { action, loader } from "./api.azure-session";

describe("/api/azure-session", () => {
  beforeEach(() => {
    authenticateAzure.mockReset();
    authenticateAzure.mockResolvedValue(undefined);
    resetAzureDependencies.mockReset();
    logServerRouteEvent.mockReset();
    logServerRouteEvent.mockResolvedValue(undefined);
  });

  it("returns 405 for loader and includes Allow", async () => {
    const response = loader();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, DELETE");
    expect(await response.json()).toEqual({ error: "Method not allowed." });
  });

  it("returns 405 for unsupported methods", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure-session", { method: "GET" }),
    } as never);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, DELETE");
  });

  it("runs interactive azure authentication on POST", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure-session", { method: "POST" }),
    } as never);
    const payload = (await response.json()) as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("Azure login completed. Azure connections were refreshed.");
    expect(authenticateAzure).toHaveBeenCalledTimes(1);
    expect(authenticateAzure).toHaveBeenCalledWith(AZURE_ARM_SCOPE);
  });

  it("resets azure dependencies on DELETE and returns success message", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure-session", { method: "DELETE" }),
    } as never);
    const payload = (await response.json()) as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("Azure logout completed. Sign in again when needed.");
    expect(resetAzureDependencies).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when authentication fails", async () => {
    authenticateAzure.mockRejectedValueOnce(new Error("manual login cancelled"));

    const response = await action({
      request: new Request("http://localhost/api/azure-session", { method: "POST" }),
    } as never);
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(payload.error).toContain("Failed to run Azure login");
    expect(logServerRouteEvent).toHaveBeenCalledTimes(1);
  });
});
