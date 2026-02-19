import {
  DEFAULT_MCP_AZURE_AUTH_SCOPE,
  DEFAULT_MCP_TIMEOUT_SECONDS,
  MAX_MCP_TIMEOUT_SECONDS,
  MIN_MCP_TIMEOUT_SECONDS,
} from "~/lib/home/mcp/http-inputs";
import { ENV_KEY_PATTERN } from "~/lib/home/mcp/stdio-inputs";

export type McpHttpServerConfig = {
  id: string;
  name: string;
  transport: "streamable_http" | "sse";
  url: string;
  headers: Record<string, string>;
  useAzureAuth: boolean;
  azureAuthScope: string;
  timeoutSeconds: number;
};

export type McpStdioServerConfig = {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
};

export type McpServerConfig = McpHttpServerConfig | McpStdioServerConfig;

export type SaveMcpServerRequest =
  | Omit<McpHttpServerConfig, "id">
  | Omit<McpStdioServerConfig, "id">;

const MAX_MCP_HTTP_HEADERS = 64;
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MAX_MCP_AZURE_AUTH_SCOPE_LENGTH = 512;

export function buildMcpServerKey(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    const argsKey = server.args.join("\u0000");
    const cwdKey = (server.cwd ?? "").toLowerCase();
    const envKey = Object.entries(server.env)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\u0000");
    return `stdio:${server.command.toLowerCase()}:${argsKey}:${cwdKey}:${envKey}`;
  }

  const headersKey = buildHttpHeadersKey(server.headers);
  const authKey = server.useAzureAuth ? "azure-auth:on" : "azure-auth:off";
  const scopeKey = server.useAzureAuth ? server.azureAuthScope.toLowerCase() : "";
  return `${server.transport}:${server.url.toLowerCase()}:${headersKey}:${authKey}:${scopeKey}:${server.timeoutSeconds}`;
}

export function readMcpServerList(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const servers: McpServerConfig[] = [];
  for (const entry of value) {
    const server = readMcpServerFromUnknown(entry);
    if (!server) {
      continue;
    }
    servers.push(server);
  }

  return servers;
}

export function readMcpServerFromUnknown(value: unknown): McpServerConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) {
    return null;
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) {
    return null;
  }

  const transport = value.transport;
  if (transport === "stdio") {
    const command = typeof value.command === "string" ? value.command.trim() : "";
    if (!command) {
      return null;
    }

    if (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string")) {
      return null;
    }

    const envValue = value.env;
    if (!isRecord(envValue) || !Object.values(envValue).every((entry) => typeof entry === "string")) {
      return null;
    }

    return {
      id,
      name,
      transport,
      command,
      args: value.args.map((arg) => arg.trim()).filter(Boolean),
      cwd: typeof value.cwd === "string" && value.cwd.trim() ? value.cwd.trim() : undefined,
      env: Object.fromEntries(
        Object.entries(envValue)
          .filter(([key, entry]) => ENV_KEY_PATTERN.test(key) && typeof entry === "string")
          .map(([key, entry]) => [key, entry as string]),
      ),
    };
  }

  if (transport !== "streamable_http" && transport !== "sse") {
    return null;
  }

  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url) {
    return null;
  }

  const headers = readHttpHeadersFromUnknown(value.headers);
  if (headers === null) {
    return null;
  }

  return {
    id,
    name,
    transport,
    url,
    headers,
    useAzureAuth: value.useAzureAuth === true,
    azureAuthScope: readAzureAuthScopeFromUnknown(value.azureAuthScope),
    timeoutSeconds: readMcpTimeoutSecondsFromUnknown(value.timeoutSeconds),
  };
}

export function serializeMcpServerForSave(server: McpServerConfig): SaveMcpServerRequest {
  if (server.transport === "stdio") {
    return {
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: server.env,
    };
  }

  return {
    name: server.name,
    transport: server.transport,
    url: server.url,
    headers: server.headers,
    useAzureAuth: server.useAzureAuth,
    azureAuthScope: server.azureAuthScope,
    timeoutSeconds: server.timeoutSeconds,
  };
}

export function upsertMcpServer(current: McpServerConfig[], profile: McpServerConfig): McpServerConfig[] {
  const existingIndex = current.findIndex((entry) => entry.id === profile.id);
  if (existingIndex < 0) {
    return [...current, profile];
  }

  return current.map((entry, index) => (index === existingIndex ? profile : entry));
}

export function formatMcpServerOption(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    return `${server.name} (stdio: ${server.command})`;
  }

  const headerCount = Object.keys(server.headers).length;
  const azureAuthLabel = server.useAzureAuth ? `, Azure auth (${server.azureAuthScope})` : "";
  const timeoutLabel = `, timeout ${server.timeoutSeconds}s`;
  if (headerCount > 0) {
    return `${server.name} (${server.transport}, +${headerCount} headers${azureAuthLabel}${timeoutLabel})`;
  }
  return `${server.name} (${server.transport}${azureAuthLabel}${timeoutLabel})`;
}

function buildHttpHeadersKey(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000");
}

function readHttpHeadersFromUnknown(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    return null;
  }

  const headers: Record<string, string> = {};
  let count = 0;
  for (const [key, rawValue] of Object.entries(value)) {
    if (!HTTP_HEADER_NAME_PATTERN.test(key)) {
      return null;
    }
    if (key.toLowerCase() === "content-type") {
      continue;
    }
    if (typeof rawValue !== "string") {
      return null;
    }

    headers[key] = rawValue;
    count += 1;
    if (count > MAX_MCP_HTTP_HEADERS) {
      return null;
    }
  }

  return headers;
}

function readAzureAuthScopeFromUnknown(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_MCP_AZURE_AUTH_SCOPE;
  }

  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return DEFAULT_MCP_AZURE_AUTH_SCOPE;
  }

  if (trimmed.length > MAX_MCP_AZURE_AUTH_SCOPE_LENGTH) {
    return DEFAULT_MCP_AZURE_AUTH_SCOPE;
  }

  return trimmed;
}

function readMcpTimeoutSecondsFromUnknown(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return DEFAULT_MCP_TIMEOUT_SECONDS;
  }

  if (value < MIN_MCP_TIMEOUT_SECONDS || value > MAX_MCP_TIMEOUT_SECONDS) {
    return DEFAULT_MCP_TIMEOUT_SECONDS;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
