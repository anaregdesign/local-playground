import { beforeEach, describe, expect, it, vi } from "vitest";
import { AZURE_ARM_SCOPE } from "~/lib/constants";

const { authenticateAzure, logServerRouteEvent } = vi.hoisted(() => ({
  authenticateAzure: vi.fn(async () => undefined),
  logServerRouteEvent: vi.fn(async () => undefined),
}));

vi.mock("~/lib/azure/dependencies", () => ({
  getAzureDependencies: () => ({
    authenticateAzure,
  }),
}));

vi.mock("~/lib/server/observability/app-event-log", () => ({
  installGlobalServerErrorLogging: vi.fn(),
  logServerRouteEvent,
}));

import { action, loader } from "./api.azure-login";

describe("/api/azure-login", () => {
  beforeEach(() => {
    authenticateAzure.mockReset();
    authenticateAzure.mockResolvedValue(undefined);
    logServerRouteEvent.mockReset();
    logServerRouteEvent.mockResolvedValue(undefined);
  });

  it("returns 405 from loader", async () => {
    const response = loader({} as never);
    expect(response.status).toBe(405);
  });

  it("returns 405 for non-POST action requests", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure-login", { method: "GET" }),
    } as never);
    expect(response.status).toBe(405);
  });

  it("runs interactive azure authentication on POST", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure-login", { method: "POST" }),
    } as never);
    const payload = (await response.json()) as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("Azure login completed. Azure connections were refreshed.");
    expect(authenticateAzure).toHaveBeenCalledTimes(1);
    expect(authenticateAzure).toHaveBeenCalledWith(AZURE_ARM_SCOPE);
  });

  it("returns 500 when authentication fails", async () => {
    authenticateAzure.mockRejectedValueOnce(new Error("manual login cancelled"));

    const response = await action({
      request: new Request("http://localhost/api/azure-login", { method: "POST" }),
    } as never);
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(payload.error).toContain("Failed to run Azure login");
    expect(logServerRouteEvent).toHaveBeenCalledTimes(1);
  });
});
