/**
 * Test module verifying /mcp/cmd behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_LOCAL_PLAYGROUND_THREAD_ID_HEADER } from "~/lib/constants";

const {
  readAzureArmUserContextMock,
  getOrCreateUserByIdentityMock,
  installGlobalServerErrorLoggingMock,
  logServerRouteEventMock,
} = vi.hoisted(() => ({
  readAzureArmUserContextMock: vi.fn(),
  getOrCreateUserByIdentityMock: vi.fn(),
  installGlobalServerErrorLoggingMock: vi.fn(),
  logServerRouteEventMock: vi.fn(),
}));

vi.mock("~/lib/server/auth/azure-user", () => ({
  readAzureArmUserContext: readAzureArmUserContextMock,
}));

vi.mock("~/lib/server/persistence/user", () => ({
  getOrCreateUserByIdentity: getOrCreateUserByIdentityMock,
}));

vi.mock("~/lib/server/observability/runtime-event-log", () => ({
  installGlobalServerErrorLogging: installGlobalServerErrorLoggingMock,
  logServerRouteEvent: logServerRouteEventMock,
}));

import { action, loader, mcpCmdRouteTestUtils } from "./mcp.cmd";

describe("mcp cmd route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpCmdRouteTestUtils.clearThreadCommandConsent();

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
    logServerRouteEventMock.mockResolvedValue(undefined);
  });

  it("returns a method error for GET requests", async () => {
    const response = await loader({
      request: new Request("http://localhost/mcp/cmd", {
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
        message: "Method not allowed. Use POST /mcp/cmd.",
      },
      id: null,
    });
    expect(installGlobalServerErrorLoggingMock).toHaveBeenCalledTimes(1);
    expect(readAzureArmUserContextMock).not.toHaveBeenCalled();
  });

  it("returns authentication error for unauthenticated requests", async () => {
    readAzureArmUserContextMock.mockResolvedValue(null);

    const response = await action({
      request: new Request("http://localhost/mcp/cmd", {
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

  it("publishes shell command execution tool through tools/list", async () => {
    const response = await action({
      request: new Request("http://localhost/mcp/cmd", {
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

    const commandTool = body.result.tools.find(
      (entry: { name?: string }) => entry.name === "shell_execute_command",
    );
    expect(commandTool).toBeTruthy();
    expect(typeof commandTool.description).toBe("string");
    expect(commandTool.description).toContain("stdout/stderr");
    expect(commandTool.description).toContain("first command execution in a thread");
    expect(commandTool.inputSchema).toEqual(
      expect.objectContaining({
        type: "object",
        required: ["command"],
        properties: expect.objectContaining({
          threadId: expect.objectContaining({
            type: "string",
            minLength: 1,
          }),
          command: expect.objectContaining({
            type: "string",
            minLength: 1,
            maxLength: 32000,
          }),
          workingDirectory: expect.objectContaining({
            type: "string",
            minLength: 1,
          }),
          timeoutSeconds: expect.objectContaining({
            type: "integer",
            minimum: 1,
            maximum: 600,
          }),
          confirmedByUser: expect.objectContaining({
            type: "boolean",
          }),
          confirmationMessage: expect.objectContaining({
            type: "string",
            minLength: 1,
            maxLength: 4000,
          }),
        }),
      }),
    );
  });

  it("requires explicit confirmation for first execution in a thread", async () => {
    const response = await callShellExecuteTool({
      threadId: "thread-1",
      argumentsValue: {
        command: "echo local-playground-cmd-output",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.error).toBeUndefined();

    expect(body.result?.structuredContent).toEqual({
      executed: false,
      approvalRequired: true,
      requiresUserConfirmation: true,
      reason:
        "First command execution in this thread requires explicit user confirmation before running terminal commands.",
      consentScope: "thread",
      threadContext: {
        threadId: "thread-1",
        turnId: null,
      },
      nextCallArguments: {
        threadId: "thread-1",
        command: "echo local-playground-cmd-output",
        workingDirectory: null,
        timeoutSeconds: 120,
        confirmedByUser: true,
        confirmationMessage: "User confirmed terminal command execution for this thread.",
      },
    });
  });

  it("executes shell command and returns stdout/stderr details after confirmation", async () => {
    const defaultWorkingDirectoryResult = mcpCmdRouteTestUtils.resolveWorkingDirectory(
      42,
      "thread-2",
      null,
    );
    expect(defaultWorkingDirectoryResult.ok).toBe(true);
    const expectedWorkingDirectory =
      defaultWorkingDirectoryResult.ok ? defaultWorkingDirectoryResult.value : "";

    const response = await callShellExecuteTool({
      threadId: "thread-2",
      argumentsValue: {
        command: "echo local-playground-cmd-output",
        confirmedByUser: true,
        confirmationMessage: "User approved terminal command execution.",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.error).toBeUndefined();

    const payload = body.result?.structuredContent;
    expect(payload.executed).toBe(true);
    expect(payload.approvalRequired).toBe(false);
    expect(payload.command).toBe("echo local-playground-cmd-output");
    expect(payload.workingDirectory).toBe(expectedWorkingDirectory);
    expect(payload.stdout).toContain("local-playground-cmd-output");
    expect(typeof payload.stderr).toBe("string");
    expect(payload.stdoutTruncated).toBe(false);
    expect(payload.stderrTruncated).toBe(false);
    expect(payload.exitCode).toBe(0);
    expect(payload.signal).toBeNull();
    expect(payload.timedOut).toBe(false);
    expect(typeof payload.durationMs).toBe("number");
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(payload.threadContext).toEqual({
      threadId: "thread-2",
      turnId: null,
    });
    expect(payload.consentScope).toBe("thread");
    expect(payload.consentGrantedInThisCall).toBe(true);

    expect(payload.shell).toMatchObject({
      executable: expect.any(String),
      argsPrefix: expect.any(Array),
      family: expect.any(String),
      source: expect.any(String),
      platform: process.platform,
    });
  });

  it("skips reconfirmation after thread consent was already granted", async () => {
    const firstResponse = await callShellExecuteTool({
      threadId: "thread-3",
      argumentsValue: {
        command: "echo first-run",
        confirmedByUser: true,
        confirmationMessage: "User approved.",
      },
    });

    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.result?.structuredContent?.executed).toBe(true);

    const secondResponse = await callShellExecuteTool({
      threadId: "thread-3",
      argumentsValue: {
        command: "echo second-run",
      },
    });

    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json();
    const secondPayload = secondBody.result?.structuredContent;
    expect(secondPayload.executed).toBe(true);
    expect(secondPayload.stdout).toContain("second-run");
    expect(secondPayload.consentScope).toBe("thread");
    expect(secondPayload.consentGrantedInThisCall).toBe(false);
  });

  it("requires confirmation for each request when thread context is missing", async () => {
    const response = await callShellExecuteTool({
      argumentsValue: {
        command: "echo no-thread",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result?.structuredContent).toEqual({
      executed: false,
      approvalRequired: true,
      requiresUserConfirmation: true,
      reason:
        "threadContext.threadId is missing. Explicit user confirmation is required for this command execution.",
      consentScope: "request",
      threadContext: {
        threadId: null,
        turnId: null,
      },
      nextCallArguments: {
        command: "echo no-thread",
        workingDirectory: null,
        timeoutSeconds: 120,
        confirmedByUser: true,
        confirmationMessage: "User confirmed terminal command execution for this request.",
      },
    });
  });

  it("requires explicit workingDirectory when thread context is missing", async () => {
    const response = await callShellExecuteTool({
      argumentsValue: {
        command: "echo no-thread",
        confirmedByUser: true,
        confirmationMessage: "User confirmed terminal command execution for this request.",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result?.structuredContent).toEqual({
      executed: false,
      approvalRequired: false,
      error:
        "threadContext.threadId is required when workingDirectory is omitted. Provide `workingDirectory` explicitly for threadless requests.",
      threadContext: {
        threadId: null,
        turnId: null,
      },
    });
  });

  it("uses client-provided threadId from tool arguments", async () => {
    const firstResponse = await callShellExecuteTool({
      argumentsValue: {
        threadId: "thread-from-client",
        command: "echo from-client-thread",
      },
    });

    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.result?.structuredContent).toEqual({
      executed: false,
      approvalRequired: true,
      requiresUserConfirmation: true,
      reason:
        "First command execution in this thread requires explicit user confirmation before running terminal commands.",
      consentScope: "thread",
      threadContext: {
        threadId: "thread-from-client",
        turnId: null,
      },
      nextCallArguments: {
        threadId: "thread-from-client",
        command: "echo from-client-thread",
        workingDirectory: null,
        timeoutSeconds: 120,
        confirmedByUser: true,
        confirmationMessage: "User confirmed terminal command execution for this thread.",
      },
    });

    const defaultWorkingDirectoryResult = mcpCmdRouteTestUtils.resolveWorkingDirectory(
      42,
      "thread-from-client",
      null,
    );
    expect(defaultWorkingDirectoryResult.ok).toBe(true);
    const expectedWorkingDirectory =
      defaultWorkingDirectoryResult.ok ? defaultWorkingDirectoryResult.value : "";

    const secondResponse = await callShellExecuteTool({
      argumentsValue: {
        threadId: "thread-from-client",
        command: "echo from-client-thread",
        confirmedByUser: true,
        confirmationMessage: "User approved terminal command execution.",
      },
    });

    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json();
    const payload = secondBody.result?.structuredContent;
    expect(payload.executed).toBe(true);
    expect(payload.threadContext).toEqual({
      threadId: "thread-from-client",
      turnId: null,
    });
    expect(payload.workingDirectory).toBe(expectedWorkingDirectory);
    expect(payload.stdout).toContain("from-client-thread");
  });
});

async function callShellExecuteTool(options: {
  threadId?: string;
  argumentsValue: Record<string, unknown>;
}): Promise<Response> {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  });

  if (typeof options.threadId === "string") {
    headers.set(MCP_LOCAL_PLAYGROUND_THREAD_ID_HEADER, options.threadId);
  }

  return await action({
    request: new Request("http://localhost/mcp/cmd", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "shell_execute_command",
          arguments: options.argumentsValue,
        },
      }),
    }),
  });
}
