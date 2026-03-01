/**
 * Home runtime support module.
 */
import { buildMcpServerKey, type McpServerConfig } from "~/lib/home/mcp/profile";

type McpServersAuthLike = {
  authRequired?: boolean;
};

/**
 * View model used by `SelectableCardList` in the MCP saved profile section.
 */
export type WorkspaceMcpServerProfileOption = {
  id: string;
  name: string;
  badge?: string;
  description: string;
  detail: string;
  isSelected: boolean;
  isAvailable: boolean;
};

/**
 * Treats either explicit HTTP 401 or server payload `authRequired` as an auth-required state.
 */
export function isMcpServersAuthRequired(
  status: number,
  payload: McpServersAuthLike | null | undefined,
): boolean {
  return status === 401 || payload?.authRequired === true;
}

/**
 * Schedules a retry only when auth was previously required and the workspace identity is known.
 */
export function shouldScheduleWorkspaceMcpServerProfileLoginRetry(
  wasAzureAuthRequired: boolean,
  workspaceMcpServerProfileUserKey: string,
): boolean {
  return wasAzureAuthRequired && workspaceMcpServerProfileUserKey.trim().length > 0;
}

/**
 * Maps persisted MCP profiles into `SelectableCardList` options for the MCP Servers tab.
 */
export function buildWorkspaceMcpServerProfileOptions(
  workspaceMcpServerProfiles: McpServerConfig[],
  activeMcpServers: McpServerConfig[],
): WorkspaceMcpServerProfileOption[] {
  const activeMcpServerKeySet = new Set(activeMcpServers.map((server) => buildMcpServerKey(server)));
  return workspaceMcpServerProfiles
    .map((server) => {
      const key = buildMcpServerKey(server);
      return {
        id: server.id,
        name: server.name,
        badge: resolveMcpTransportBadge(server),
        description: describeWorkspaceMcpServerProfile(server),
        detail: describeWorkspaceMcpServerProfileDetail(server),
        isSelected: activeMcpServerKeySet.has(key),
        isAvailable: true,
      };
    })
    .sort((left, right) => {
      if (left.isSelected !== right.isSelected) {
        return left.isSelected ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

/**
 * Returns how many saved MCP options are currently connected to the active thread.
 */
export function countSelectedWorkspaceMcpServerProfileOptions(options: WorkspaceMcpServerProfileOption[]): number {
  return options.filter((option) => option.isSelected).length;
}

/**
 * Compact transport label used by selectable MCP cards.
 */
export function resolveMcpTransportBadge(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    return "STDIO";
  }

  if (server.transport === "sse") {
    return "SSE";
  }

  return "HTTP";
}

/**
 * Human-readable summary line shown under each saved MCP server card.
 */
export function describeWorkspaceMcpServerProfile(server: McpServerConfig): string {
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

/**
 * Secondary detail line shown under each saved MCP server card.
 */
export function describeWorkspaceMcpServerProfileDetail(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    return `Working directory: ${server.cwd ?? "(inherit current workspace)"}`;
  }

  return server.url;
}
