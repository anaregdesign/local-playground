/**
 * Shared MCP server configuration key helpers.
 */
type McpServerConfigKeyHttpInput = {
  transport: "streamable_http" | "sse";
  url: string;
  headers: Record<string, string>;
  useAzureAuth: boolean;
  azureAuthScope: string;
  timeoutSeconds: number;
};

type McpServerConfigKeyStdioInput = {
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
};

export type McpServerConfigKeyInput = McpServerConfigKeyHttpInput | McpServerConfigKeyStdioInput;

export function buildMcpHttpHeadersConfigKey(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000");
}

export function buildMcpServerConfigKey(config: McpServerConfigKeyInput): string {
  if (config.transport === "stdio") {
    const envKey = Object.entries(config.env)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\u0000");
    return `${config.transport}:${config.command.toLowerCase()}:${config.args.join("\u0000")}:${(config.cwd ?? "").toLowerCase()}:${envKey}`;
  }

  const headersKey = buildMcpHttpHeadersConfigKey(config.headers);
  const authKey = config.useAzureAuth ? "azure-auth:on" : "azure-auth:off";
  const scopeKey = config.useAzureAuth ? config.azureAuthScope.toLowerCase() : "";
  return `${config.transport}:${config.url.toLowerCase()}:${headersKey}:${authKey}:${scopeKey}:${config.timeoutSeconds}`;
}
