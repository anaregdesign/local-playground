/**
 * Test module verifying /mcp/system behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MCP_LOCAL_PLAYGROUND_CLIENT_PLATFORM_HEADER,
  MCP_LOCAL_PLAYGROUND_THREAD_ID_HEADER,
  MCP_LOCAL_PLAYGROUND_TURN_ID_HEADER,
} from "~/lib/constants";

const {
  readAzureArmUserContextMock,
  getOrCreateUserByIdentityMock,
  installGlobalServerErrorLoggingMock,
  logServerRouteEventMock,
  ensurePersistenceDatabaseReadyMock,
  threadFindFirstMock,
  azureSelectionFindUniqueMock,
  listAzureProjectsMock,
  parseProjectIdMock,
} = vi.hoisted(() => ({
  readAzureArmUserContextMock: vi.fn(),
  getOrCreateUserByIdentityMock: vi.fn(),
  installGlobalServerErrorLoggingMock: vi.fn(),
  logServerRouteEventMock: vi.fn(),
  ensurePersistenceDatabaseReadyMock: vi.fn(),
  threadFindFirstMock: vi.fn(),
  azureSelectionFindUniqueMock: vi.fn(),
  listAzureProjectsMock: vi.fn(),
  parseProjectIdMock: vi.fn(),
}));

vi.mock("~/lib/server/auth/azure-user", () => ({
  readAzureArmUserContext: readAzureArmUserContextMock,
}));

vi.mock("~/lib/server/persistence/user", () => ({
  getOrCreateUserByIdentity: getOrCreateUserByIdentityMock,
}));

vi.mock("~/lib/server/persistence/prisma", () => ({
  ensurePersistenceDatabaseReady: ensurePersistenceDatabaseReadyMock,
  prisma: {
    thread: {
      findFirst: threadFindFirstMock,
    },
    azureSelectionPreference: {
      findUnique: azureSelectionFindUniqueMock,
    },
  },
}));

vi.mock("./api.azure.projects", () => ({
  listAzureProjects: listAzureProjectsMock,
  parseProjectId: parseProjectIdMock,
}));

vi.mock("~/lib/server/observability/runtime-event-log", () => ({
  installGlobalServerErrorLogging: installGlobalServerErrorLoggingMock,
  logServerRouteEvent: logServerRouteEventMock,
}));

import { action, loader } from "./mcp.system";

describe("mcp system route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readAzureArmUserContextMock.mockResolvedValue({
      token: "arm-token-1",
      tenantId: "eecca864-7a91-4b48-9327-e19aa5cc3f35",
      principalId: "25f7c3da-6559-4543-9eb0-fd01d3116fad",
      displayName: "Hiroki Mizukami",
      principalName: "hmizukami@MngEnvMCAP321368.onmicrosoft.com",
      principalType: "user",
    });
    getOrCreateUserByIdentityMock.mockResolvedValue({
      id: 42,
      tenantId: "eecca864-7a91-4b48-9327-e19aa5cc3f35",
      principalId: "25f7c3da-6559-4543-9eb0-fd01d3116fad",
    });
    ensurePersistenceDatabaseReadyMock.mockResolvedValue(undefined);
    logServerRouteEventMock.mockResolvedValue(undefined);
    threadFindFirstMock.mockResolvedValue({ name: "Newest Thread" });
    azureSelectionFindUniqueMock.mockResolvedValue({
      projectId: "project-ref-1",
      deploymentName: "gpt-5.2",
    });
    listAzureProjectsMock.mockResolvedValue([
      {
        id: "project-ref-1",
        projectName: "gp52-project-resource",
        baseUrl: "https://gp52-project-resource.cognitiveservices.azure.com/openai/v1/",
        apiVersion: "v1",
      },
    ]);
    parseProjectIdMock.mockReturnValue({
      subscriptionId: "sub-1",
      resourceGroup: "rg-1",
      accountName: "gp52-project-resource",
    });
  });

  it("returns a method error for GET requests", async () => {
    const response = await loader({
      request: new Request("http://localhost/mcp/system", {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
        },
      }),
    });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed. Use POST /mcp/system.",
      },
      id: null,
    });
    expect(installGlobalServerErrorLoggingMock).toHaveBeenCalledTimes(1);
    expect(readAzureArmUserContextMock).not.toHaveBeenCalled();
  });

  it("returns authentication error for unauthenticated requests", async () => {
    readAzureArmUserContextMock.mockResolvedValue(null);

    const response = await action({
      request: new Request("http://localhost/mcp/system", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "tools-1",
          method: "tools/list",
          params: {},
        }),
      }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Authentication required. Click Azure Login in Settings and try again.",
      },
      id: null,
    });
    expect(getOrCreateUserByIdentityMock).not.toHaveBeenCalled();
  });

  it("publishes detailed identifier guide through tools/list", async () => {
    const response = await action({
      request: new Request("http://localhost/mcp/system", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "tools-1",
          method: "tools/list",
          params: {},
        }),
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.error).toBeUndefined();
    expect(Array.isArray(body.result?.tools)).toBe(true);

    const contextTool = body.result.tools.find(
      (entry: { name?: string }) => entry.name === "system_read_thread_context",
    );
    expect(contextTool).toBeTruthy();
    expect(typeof contextTool.description).toBe("string");
    expect(contextTool.description).toContain("canonical identifiers");
    expect(contextTool.description).toContain("do not guess or synthesize IDs");
    expect(contextTool.description).toContain("azureContext.playgroundProject");
    expect(contextTool.description).toContain("azureContext.endpoint");
    expect(contextTool.description).toContain("userContext.userId");
    expect(contextTool.description).toContain("threadContext.threadId");
    expect(contextTool.description).toContain("threadContext.turnId");
    expect(contextTool.description).toContain("latestThreadName");
    expect(contextTool.description).toContain("systemContext.clientOperatingSystem");
    expect(contextTool.description).toContain("systemContext.serverOperatingSystem");
    expect(contextTool.inputSchema).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("returns dynamic principal and playground metadata", async () => {
    const response = await action({
      request: new Request("http://localhost/mcp/system", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          [MCP_LOCAL_PLAYGROUND_CLIENT_PLATFORM_HEADER]: "\"Windows\"",
          [MCP_LOCAL_PLAYGROUND_THREAD_ID_HEADER]: "thread-1",
          [MCP_LOCAL_PLAYGROUND_TURN_ID_HEADER]: "turn-1",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "call-1",
          method: "tools/call",
          params: {
            name: "system_read_thread_context",
            arguments: {},
          },
        }),
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.error).toBeUndefined();
    expect(body.result?.structuredContent).toMatchObject({
      userContext: {
        userId: 42,
      },
      threadContext: {
        threadId: "thread-1",
        turnId: "turn-1",
      },
      systemContext: {
        clientOperatingSystem: {
          name: "Windows",
          version: null,
          source: "sec-ch-ua-platform",
        },
        serverOperatingSystem: {
          name: expect.any(String),
          platform: process.platform,
          release: expect.any(String),
          architecture: expect.any(String),
        },
      },
      latestThreadName: "Newest Thread",
      azureContext: {
        principalDisplayName: "Hiroki Mizukami",
        principalName: "hmizukami@MngEnvMCAP321368.onmicrosoft.com",
        principalType: "User",
        tenantId: "eecca864-7a91-4b48-9327-e19aa5cc3f35",
        principalId: "25f7c3da-6559-4543-9eb0-fd01d3116fad",
        playgroundProject: "gp52-project-resource",
        playgroundProjectId: "project-ref-1",
        playgroundDeployment: "gpt-5.2",
        endpoint: "https://gp52-project-resource.cognitiveservices.azure.com/openai/v1/",
        apiVersion: "v1",
      },
      descriptions: {
        clientOperatingSystem: {
          fieldPath: "systemContext.clientOperatingSystem",
        },
        serverOperatingSystem: {
          fieldPath: "systemContext.serverOperatingSystem",
        },
        principalId: {
          fieldPath: "azureContext.principalId",
        },
        playgroundProject: {
          fieldPath: "azureContext.playgroundProject",
        },
      },
    });
    expect(getOrCreateUserByIdentityMock).toHaveBeenCalledWith({
      tenantId: "eecca864-7a91-4b48-9327-e19aa5cc3f35",
      principalId: "25f7c3da-6559-4543-9eb0-fd01d3116fad",
    });
    expect(azureSelectionFindUniqueMock).toHaveBeenCalledWith({
      where: {
        userId: 42,
      },
      select: {
        projectId: true,
        deploymentName: true,
      },
    });
    expect(listAzureProjectsMock).toHaveBeenCalledWith("arm-token-1");
  });
});
