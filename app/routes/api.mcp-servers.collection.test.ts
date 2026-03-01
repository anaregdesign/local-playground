/**
 * Test module verifying api.mcp-servers collection route behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readAzureArmUserContext,
  getOrCreateUserByIdentity,
  findMany,
  createMany,
  deleteMany,
  logServerRouteEvent,
} = vi.hoisted(() => ({
  readAzureArmUserContext: vi.fn(async () => ({
    tenantId: "tenant-a",
    principalId: "principal-a",
  })),
  getOrCreateUserByIdentity: vi.fn(async () => ({
    id: 1,
    tenantId: "tenant-a",
    principalId: "principal-a",
  })),
  findMany: vi.fn(async () => []),
  createMany: vi.fn(async () => ({ count: 0 })),
  deleteMany: vi.fn(async () => ({ count: 0 })),
  logServerRouteEvent: vi.fn(async () => undefined),
}));

vi.mock("~/lib/server/auth/azure-user", () => ({
  readAzureArmUserContext,
}));

vi.mock("~/lib/server/persistence/user", () => ({
  getOrCreateUserByIdentity,
}));

vi.mock("~/lib/server/persistence/prisma", () => ({
  ensurePersistenceDatabaseReady: vi.fn(async () => undefined),
  prisma: {
    workspaceMcpServerProfile: {
      findMany,
      createMany,
      deleteMany,
    },
    $transaction: vi.fn(async () => undefined),
  },
}));

vi.mock("~/lib/server/observability/app-event-log", () => ({
  installGlobalServerErrorLogging: vi.fn(),
  logServerRouteEvent,
}));

import { action, loader } from "./api.mcp-servers";

describe("/api/mcp-servers collection", () => {
  beforeEach(() => {
    readAzureArmUserContext.mockReset();
    readAzureArmUserContext.mockResolvedValue({
      tenantId: "tenant-a",
      principalId: "principal-a",
    });
    getOrCreateUserByIdentity.mockReset();
    getOrCreateUserByIdentity.mockResolvedValue({
      id: 1,
      tenantId: "tenant-a",
      principalId: "principal-a",
    });
    findMany.mockReset();
    findMany.mockResolvedValue([]);
    createMany.mockReset();
    createMany.mockResolvedValue({ count: 0 });
    deleteMany.mockReset();
    deleteMany.mockResolvedValue({ count: 0 });
    logServerRouteEvent.mockReset();
    logServerRouteEvent.mockResolvedValue(undefined);
  });

  it("returns 200 for GET without writing profiles", async () => {
    const response = await loader({
      request: new Request("http://localhost/api/mcp-servers", { method: "GET" }),
    } as never);

    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(createMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("returns 405 with Allow for unsupported loader methods", async () => {
    const response = await loader({
      request: new Request("http://localhost/api/mcp-servers", { method: "DELETE" }),
    } as never);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });

  it("returns 405 with Allow for unsupported action methods", async () => {
    const response = await action({
      request: new Request("http://localhost/api/mcp-servers", { method: "PUT" }),
    } as never);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });
});
