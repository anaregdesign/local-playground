import { describe, expect, it } from "vitest";
import {
  describeSavedMcpServer,
  describeSavedMcpServerDetail,
  isMcpServersAuthRequired,
  resolveMcpTransportBadge,
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

describe("resolveMcpTransportBadge", () => {
  it("returns badges for each transport", () => {
    expect(
      resolveMcpTransportBadge({
        id: "stdio-1",
        name: "local",
        transport: "stdio",
        command: "npx",
        args: [],
        env: {},
      }),
    ).toBe("STDIO");
    expect(
      resolveMcpTransportBadge({
        id: "sse-1",
        name: "sse-server",
        transport: "sse",
        url: "https://example.com/sse",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: "scope",
        timeoutSeconds: 30,
      }),
    ).toBe("SSE");
    expect(
      resolveMcpTransportBadge({
        id: "http-1",
        name: "http-server",
        transport: "streamable_http",
        url: "https://example.com/mcp",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: "scope",
        timeoutSeconds: 30,
      }),
    ).toBe("HTTP");
  });
});

describe("describeSavedMcpServer", () => {
  it("formats stdio server summaries", () => {
    expect(
      describeSavedMcpServer({
        id: "stdio-1",
        name: "local",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@playwright/mcp"],
        env: {
          NODE_ENV: "development",
        },
      }),
    ).toBe("Command: npx -y @playwright/mcp; Environment variables: 1");
  });

  it("formats http server summaries", () => {
    expect(
      describeSavedMcpServer({
        id: "http-1",
        name: "docs",
        transport: "streamable_http",
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer x",
        },
        useAzureAuth: true,
        azureAuthScope: "https://scope/.default",
        timeoutSeconds: 45,
      }),
    ).toBe(
      "Transport: streamable_http; Headers: 1; Timeout: 45s; Azure auth: enabled (https://scope/.default)",
    );
  });
});

describe("describeSavedMcpServerDetail", () => {
  it("formats details for stdio and http transports", () => {
    expect(
      describeSavedMcpServerDetail({
        id: "stdio-1",
        name: "local",
        transport: "stdio",
        command: "npx",
        args: [],
        env: {},
      }),
    ).toBe("Working directory: (inherit current workspace)");
    expect(
      describeSavedMcpServerDetail({
        id: "http-1",
        name: "docs",
        transport: "streamable_http",
        url: "https://example.com/mcp",
        headers: {},
        useAzureAuth: false,
        azureAuthScope: "scope",
        timeoutSeconds: 30,
      }),
    ).toBe("https://example.com/mcp");
  });
});
