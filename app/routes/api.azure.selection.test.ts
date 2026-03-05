/**
 * Test module verifying api.azure.selection behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readAzureArmUserContextMock,
  installGlobalServerErrorLoggingMock,
  logServerRouteEventMock,
  ensurePersistenceDatabaseReadyMock,
  workspaceUserFindUniqueMock,
  workspaceUserUpsertMock,
  azureSelectionFindUniqueMock,
  azureSelectionUpsertMock,
  azureSelectionDeleteManyMock,
} = vi.hoisted(() => ({
  readAzureArmUserContextMock: vi.fn(),
  installGlobalServerErrorLoggingMock: vi.fn(),
  logServerRouteEventMock: vi.fn(),
  ensurePersistenceDatabaseReadyMock: vi.fn(),
  workspaceUserFindUniqueMock: vi.fn(),
  workspaceUserUpsertMock: vi.fn(),
  azureSelectionFindUniqueMock: vi.fn(),
  azureSelectionUpsertMock: vi.fn(),
  azureSelectionDeleteManyMock: vi.fn(),
}));

vi.mock("~/lib/server/auth/azure-user", () => ({
  readAzureArmUserContext: readAzureArmUserContextMock,
}));

vi.mock("~/lib/server/observability/runtime-event-log", () => ({
  installGlobalServerErrorLogging: installGlobalServerErrorLoggingMock,
  logServerRouteEvent: logServerRouteEventMock,
}));

vi.mock("~/lib/server/persistence/prisma", () => ({
  ensurePersistenceDatabaseReady: ensurePersistenceDatabaseReadyMock,
  prisma: {
    workspaceUser: {
      findUnique: workspaceUserFindUniqueMock,
      upsert: workspaceUserUpsertMock,
    },
    azureSelectionPreference: {
      findUnique: azureSelectionFindUniqueMock,
      upsert: azureSelectionUpsertMock,
      deleteMany: azureSelectionDeleteManyMock,
    },
  },
}));

import { action, loader, parseAzureSelectionPreference } from "./api.azure.selection";

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

describe("/api/azure/selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readAzureArmUserContextMock.mockResolvedValue({
      tenantId: "tenant-a",
      principalId: "principal-a",
    });
    ensurePersistenceDatabaseReadyMock.mockResolvedValue(undefined);
    workspaceUserFindUniqueMock.mockResolvedValue({
      tenantId: "tenant-a",
      principalId: "principal-a",
      azureSelection: {
        projectId: "project-a",
        deploymentName: "deploy-a",
        utilityProjectId: "project-b",
        utilityDeploymentName: "deploy-b",
        utilityReasoningEffort: "medium",
      },
    });
    workspaceUserUpsertMock.mockResolvedValue({ id: 10, tenantId: "tenant-a", principalId: "principal-a" });
    azureSelectionFindUniqueMock.mockResolvedValue({ userId: 10 });
    azureSelectionUpsertMock.mockResolvedValue({
      projectId: "project-a",
      deploymentName: "deploy-a",
      utilityProjectId: "project-b",
      utilityDeploymentName: "deploy-b",
      utilityReasoningEffort: "medium",
    });
    azureSelectionDeleteManyMock.mockResolvedValue({ count: 1 });
    logServerRouteEventMock.mockResolvedValue(undefined);
  });

  it("returns 405 with Allow for unsupported methods", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure/selection", { method: "PUT" }),
    } as never);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, PATCH, DELETE");
  });

  it("returns 401 when unauthenticated", async () => {
    readAzureArmUserContextMock.mockResolvedValueOnce(null);

    const response = await action({
      request: new Request("http://localhost/api/azure/selection", { method: "PATCH" }),
    } as never);

    expect(response.status).toBe(401);
  });

  it("returns 201 and Location when creating a new selection", async () => {
    azureSelectionFindUniqueMock.mockResolvedValueOnce(null);

    const response = await action({
      request: new Request("http://localhost/api/azure/selection", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target: "playground",
          projectId: "project-a",
          deploymentName: "deploy-a",
        }),
      }),
    } as never);

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe("/api/azure/selection");
  });

  it("returns 422 for invalid patch payload", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure/selection", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target: "playground",
          projectId: "",
        }),
      }),
    } as never);

    expect(response.status).toBe(422);
  });

  it("deletes selection and returns 204", async () => {
    workspaceUserFindUniqueMock.mockResolvedValueOnce({ id: 10 });
    azureSelectionDeleteManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await action({
      request: new Request("http://localhost/api/azure/selection", {
        method: "DELETE",
      }),
    } as never);

    expect(response.status).toBe(204);
  });

  it("returns 404 when deleting non-existing selection", async () => {
    workspaceUserFindUniqueMock.mockResolvedValueOnce({ id: 10 });
    azureSelectionDeleteManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await action({
      request: new Request("http://localhost/api/azure/selection", {
        method: "DELETE",
      }),
    } as never);

    expect(response.status).toBe(404);
  });

  it("loader returns 405 for unsupported methods", async () => {
    const response = await loader({
      request: new Request("http://localhost/api/azure/selection", { method: "POST" }),
    } as never);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, PATCH, DELETE");
  });
});
