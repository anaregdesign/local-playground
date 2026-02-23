import type { McpServerConfig } from "~/lib/home/mcp/profile";

type McpServersAuthLike = {
  authRequired?: boolean;
};

export function isMcpServersAuthRequired(
  status: number,
  payload: McpServersAuthLike | null | undefined,
): boolean {
  return status === 401 || payload?.authRequired === true;
}

export function shouldScheduleSavedMcpLoginRetry(
  wasAzureAuthRequired: boolean,
  savedMcpUserKey: string,
): boolean {
  return wasAzureAuthRequired && savedMcpUserKey.trim().length > 0;
}

export function resolveMcpTransportBadge(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    return "STDIO";
  }

  if (server.transport === "sse") {
    return "SSE";
  }

  return "HTTP";
}

export function describeSavedMcpServer(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    const argsSuffix = server.args.length > 0 ? ` ${server.args.join(" ")}` : "";
    const envCount = Object.keys(server.env).length;
    return `Command: ${server.command}${argsSuffix}; Environment variables: ${envCount}`;
  }

  const headersCount = Object.keys(server.headers).length;
  const azureAuthLabel = server.useAzureAuth
    ? `Azure auth: enabled (${server.azureAuthScope})`
    : "Azure auth: disabled";
  return `Transport: ${server.transport}; Headers: ${headersCount}; Timeout: ${server.timeoutSeconds}s; ${azureAuthLabel}`;
}

export function describeSavedMcpServerDetail(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    return `Working directory: ${server.cwd ?? "(inherit current workspace)"}`;
  }

  return server.url;
}
