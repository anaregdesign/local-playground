/**
 * Test module verifying api.azure.session behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AZURE_ARM_SCOPE } from "~/lib/constants";

const {
  authenticateAzure,
  resetAzureDependencies,
  logServerRouteEvent,
  readAzureArmUserContext,
  getOrCreateUserByIdentity,
  readMostRecentWorkspaceUserTenantId,
  ensureDefaultMcpServersForUser,
} = vi.hoisted(() => ({
  authenticateAzure: vi.fn(async () => undefined),
  resetAzureDependencies: vi.fn(),
  logServerRouteEvent: vi.fn(async () => undefined),
  readAzureArmUserContext: vi.fn(
    async (): Promise<{ tenantId: string; principalId: string } | null> => ({
      tenantId: "tenant-a",
      principalId: "principal-a",
    }),
  ),
  getOrCreateUserByIdentity: vi.fn(async () => ({
    id: 10,
    tenantId: "tenant-a",
    principalId: "principal-a",
  })),
  readMostRecentWorkspaceUserTenantId: vi.fn(async () => ""),
  ensureDefaultMcpServersForUser: vi.fn(async () => undefined),
}));

vi.mock("~/lib/azure/dependencies", () => ({
  getAzureDependencies: () => ({
    authenticateAzure,
  }),
  resetAzureDependencies,
}));

vi.mock("~/lib/server/observability/runtime-event-log", () => ({
  installGlobalServerErrorLogging: vi.fn(),
  logServerRouteEvent,
}));

vi.mock("~/lib/server/auth/azure-user", () => ({
  readAzureArmUserContext,
}));

vi.mock("~/lib/server/persistence/user", () => ({
  getOrCreateUserByIdentity,
  readMostRecentWorkspaceUserTenantId,
}));

vi.mock("./api.mcp.servers", () => ({
  ensureDefaultMcpServersForUser,
}));

import { action, loader } from "./api.azure.session";

describe("/api/azure/session", () => {
  beforeEach(() => {
    authenticateAzure.mockReset();
    authenticateAzure.mockResolvedValue(undefined);
    resetAzureDependencies.mockReset();
    logServerRouteEvent.mockReset();
    logServerRouteEvent.mockResolvedValue(undefined);
    readAzureArmUserContext.mockReset();
    readAzureArmUserContext.mockResolvedValue({
      tenantId: "tenant-a",
      principalId: "principal-a",
    });
    getOrCreateUserByIdentity.mockReset();
    getOrCreateUserByIdentity.mockResolvedValue({
      id: 10,
      tenantId: "tenant-a",
      principalId: "principal-a",
    });
    readMostRecentWorkspaceUserTenantId.mockReset();
    readMostRecentWorkspaceUserTenantId.mockResolvedValue("");
    ensureDefaultMcpServersForUser.mockReset();
    ensureDefaultMcpServersForUser.mockResolvedValue(undefined);
  });

  it("returns 405 for loader and includes Allow", async () => {
    const response = loader();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PUT, DELETE");
    expect(await response.json()).toEqual({
      code: "method_not_allowed",
      error: "Method not allowed.",
    });
  });

  it("returns 405 for unsupported methods", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure/session", { method: "GET" }),
    } as never);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PUT, DELETE");
  });

  it("runs interactive azure authentication on PUT", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure/session", { method: "PUT" }),
    } as never);
    const payload = (await response.json()) as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("Azure login completed. Azure projects were refreshed.");
    expect(authenticateAzure).toHaveBeenCalledTimes(1);
    expect(authenticateAzure).toHaveBeenCalledWith(AZURE_ARM_SCOPE);
    expect(getOrCreateUserByIdentity).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      principalId: "principal-a",
    });
    expect(ensureDefaultMcpServersForUser).toHaveBeenCalledWith(10);
  });

  it("uses requested tenantId when provided on PUT", async () => {
    readAzureArmUserContext.mockResolvedValueOnce({
      tenantId: "tenant-b",
      principalId: "principal-b",
    });
    getOrCreateUserByIdentity.mockResolvedValueOnce({
      id: 11,
      tenantId: "tenant-b",
      principalId: "principal-b",
    });

    const response = await action({
      request: new Request("http://localhost/api/azure/session", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenantId: " tenant-b ",
        }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(authenticateAzure).toHaveBeenCalledTimes(1);
    expect(authenticateAzure).toHaveBeenCalledWith(AZURE_ARM_SCOPE, "tenant-b");
    expect(getOrCreateUserByIdentity).toHaveBeenCalledWith({
      tenantId: "tenant-b",
      principalId: "principal-b",
    });
    expect(readMostRecentWorkspaceUserTenantId).not.toHaveBeenCalled();
  });

  it("uses the most recent persisted tenant when PUT body omits tenantId", async () => {
    readMostRecentWorkspaceUserTenantId.mockResolvedValueOnce(" tenant-z ");
    readAzureArmUserContext.mockResolvedValueOnce({
      tenantId: "tenant-z",
      principalId: "principal-z",
    });
    getOrCreateUserByIdentity.mockResolvedValueOnce({
      id: 12,
      tenantId: "tenant-z",
      principalId: "principal-z",
    });

    const response = await action({
      request: new Request("http://localhost/api/azure/session", { method: "PUT" }),
    } as never);

    expect(response.status).toBe(200);
    expect(readMostRecentWorkspaceUserTenantId).toHaveBeenCalledTimes(1);
    expect(authenticateAzure).toHaveBeenCalledWith(AZURE_ARM_SCOPE, "tenant-z");
  });

  it("returns 500 when identity is unavailable after authentication", async () => {
    readAzureArmUserContext.mockResolvedValueOnce(null);

    const response = await action({
      request: new Request("http://localhost/api/azure/session", { method: "PUT" }),
    } as never);

    expect(response.status).toBe(500);
    expect(getOrCreateUserByIdentity).not.toHaveBeenCalled();
    expect(ensureDefaultMcpServersForUser).not.toHaveBeenCalled();
    expect(logServerRouteEvent).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when resolved tenant differs from requested tenant", async () => {
    readAzureArmUserContext.mockResolvedValueOnce({
      tenantId: "tenant-a",
      principalId: "principal-a",
    });

    const response = await action({
      request: new Request("http://localhost/api/azure/session", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenantId: "tenant-b",
        }),
      }),
    } as never);

    expect(response.status).toBe(500);
    expect(logServerRouteEvent).toHaveBeenCalledTimes(1);
  });

  it("resets azure dependencies on DELETE and returns success message", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure/session", { method: "DELETE" }),
    } as never);
    const payload = (await response.json()) as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("Azure logout completed. Sign in again when needed.");
    expect(resetAzureDependencies).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when PUT body is invalid JSON", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure/session", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{",
      }),
    } as never);
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid request body.");
    expect(authenticateAzure).not.toHaveBeenCalled();
  });

  it("returns 500 when authentication fails", async () => {
    authenticateAzure.mockRejectedValueOnce(new Error("manual login cancelled"));

    const response = await action({
      request: new Request("http://localhost/api/azure/session", { method: "PUT" }),
    } as never);
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(payload.error).toContain("Failed to run Azure login");
    expect(logServerRouteEvent).toHaveBeenCalledTimes(1);
  });
});
