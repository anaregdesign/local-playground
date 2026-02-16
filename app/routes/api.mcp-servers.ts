import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { getFoundryConfigFilePaths, readFoundryConfigTextFile } from "~/lib/foundry-config";
import type { Route } from "./+types/api.mcp-servers";

type McpTransport = "streamable_http" | "sse" | "stdio";

type SavedMcpHttpServerConfig = {
  id: string;
  name: string;
  transport: "streamable_http" | "sse";
  url: string;
  headers: Record<string, string>;
  useAzureAuth: boolean;
  azureAuthScope: string;
  timeoutSeconds: number;
};

type SavedMcpStdioServerConfig = {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
};

type SavedMcpServerConfig = SavedMcpHttpServerConfig | SavedMcpStdioServerConfig;
type IncomingMcpHttpServerConfig = Omit<SavedMcpHttpServerConfig, "id"> & { id?: string };
type IncomingMcpStdioServerConfig = Omit<SavedMcpStdioServerConfig, "id"> & { id?: string };
type IncomingMcpServerConfig = IncomingMcpHttpServerConfig | IncomingMcpStdioServerConfig;
type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_MCP_SERVER_NAME_LENGTH = 80;
const MAX_MCP_STDIO_ARGS = 64;
const MAX_MCP_STDIO_ENV_VARS = 64;
const MAX_MCP_HTTP_HEADERS = 64;
const MAX_MCP_AZURE_AUTH_SCOPE_LENGTH = 512;
const MIN_MCP_TIMEOUT_SECONDS = 1;
const MAX_MCP_TIMEOUT_SECONDS = 600;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DEFAULT_MCP_AZURE_AUTH_SCOPE = "https://cognitiveservices.azure.com/.default";
const DEFAULT_MCP_TIMEOUT_SECONDS = 30;
const MCP_CONFIG_FILE_PATHS = getFoundryConfigFilePaths("mcp-servers.json");

export async function loader({ request }: Route.LoaderArgs) {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  try {
    const profiles = await readSavedMcpServers();
    return Response.json({ profiles });
  } catch (error) {
    return Response.json(
      {
        error: `Failed to read MCP server config file: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const incomingResult = parseIncomingMcpServer(payload);
  if (!incomingResult.ok) {
    return Response.json({ error: incomingResult.error }, { status: 400 });
  }

  try {
    const currentProfiles = await readSavedMcpServers();
    const { profile, profiles, warning } = upsertSavedMcpServer(
      currentProfiles,
      incomingResult.value,
    );
    await writeSavedMcpServers(profiles);

    return Response.json({ profile, profiles, warning });
  } catch (error) {
    return Response.json(
      {
        error: `Failed to update MCP server config file: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

async function readSavedMcpServers(): Promise<SavedMcpServerConfig[]> {
  const content = await readFoundryConfigTextFile(MCP_CONFIG_FILE_PATHS);
  if (content === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const profiles: SavedMcpServerConfig[] = [];
  const keys = new Set<string>();

  for (const entry of parsed) {
    const normalized = normalizeStoredMcpServer(entry);
    if (!normalized) {
      continue;
    }

    const key = buildProfileKey(normalized);
    if (keys.has(key)) {
      continue;
    }

    keys.add(key);
    profiles.push(normalized);
  }

  return profiles;
}

async function writeSavedMcpServers(profiles: SavedMcpServerConfig[]): Promise<void> {
  await mkdir(MCP_CONFIG_FILE_PATHS.primaryDirectoryPath, { recursive: true });
  await writeFile(MCP_CONFIG_FILE_PATHS.primaryFilePath, JSON.stringify(profiles, null, 2) + "\n", "utf8");
}

function parseIncomingMcpServer(payload: unknown): ParseResult<IncomingMcpServerConfig> {
  if (!isRecord(payload)) {
    return { ok: false, error: "Invalid MCP server payload." };
  }

  const transport = readTransport(payload.transport);
  if (!transport) {
    return {
      ok: false,
      error: "`transport` must be \"streamable_http\", \"sse\", or \"stdio\".",
    };
  }

  if (transport === "stdio") {
    return parseIncomingStdioMcpServer(payload);
  }

  return parseIncomingHttpMcpServer(payload, transport);
}

function parseIncomingHttpMcpServer(
  payload: Record<string, unknown>,
  transport: "streamable_http" | "sse",
): ParseResult<IncomingMcpServerConfig> {
  const rawUrl = typeof payload.url === "string" ? payload.url.trim() : "";
  if (!rawUrl) {
    return { ok: false, error: "`url` is required." };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { ok: false, error: "`url` is invalid." };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { ok: false, error: "`url` must start with http:// or https://." };
  }

  const name = normalizeName(payload.name, parsedUrl.hostname);
  if (!name) {
    return { ok: false, error: "`name` is required." };
  }

  const headersResult = parseHttpHeaders(payload.headers);
  if (!headersResult.ok) {
    return headersResult;
  }
  const useAzureAuth = payload.useAzureAuth === true;
  const azureAuthScopeResult = parseAzureAuthScope(payload.azureAuthScope, useAzureAuth);
  if (!azureAuthScopeResult.ok) {
    return azureAuthScopeResult;
  }
  const timeoutResult = parseTimeoutSeconds(payload.timeoutSeconds);
  if (!timeoutResult.ok) {
    return timeoutResult;
  }

  const id = normalizeOptionalId(payload.id);
  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      name,
      transport,
      url: parsedUrl.toString(),
      headers: headersResult.value,
      useAzureAuth,
      azureAuthScope: azureAuthScopeResult.value,
      timeoutSeconds: timeoutResult.value,
    },
  };
}

function parseIncomingStdioMcpServer(
  payload: Record<string, unknown>,
): ParseResult<IncomingMcpServerConfig> {
  const command = typeof payload.command === "string" ? payload.command.trim() : "";
  if (!command) {
    return { ok: false, error: "`command` is required for stdio transport." };
  }

  if (/\s/.test(command)) {
    return { ok: false, error: "`command` must not include spaces." };
  }

  const argsResult = parseArgs(payload.args);
  if (!argsResult.ok) {
    return argsResult;
  }

  const envResult = parseEnv(payload.env);
  if (!envResult.ok) {
    return envResult;
  }

  const cwd = typeof payload.cwd === "string" ? payload.cwd.trim() : "";
  const name = normalizeName(payload.name, command);
  if (!name) {
    return { ok: false, error: "`name` is required." };
  }

  const id = normalizeOptionalId(payload.id);
  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      name,
      transport: "stdio",
      command,
      args: argsResult.value,
      cwd: cwd || undefined,
      env: envResult.value,
    },
  };
}

function upsertSavedMcpServer(
  currentProfiles: SavedMcpServerConfig[],
  incoming: IncomingMcpServerConfig,
): { profile: SavedMcpServerConfig; profiles: SavedMcpServerConfig[]; warning: string | null } {
  const incomingKey = buildIncomingProfileKey(incoming);
  const keyIndex = currentProfiles.findIndex(
    (profile) => buildProfileKey(profile) === incomingKey,
  );

  const idIndex =
    incoming.id === undefined
      ? -1
      : currentProfiles.findIndex((profile) => profile.id === incoming.id);

  const index = keyIndex >= 0 ? keyIndex : idIndex;
  const previousProfile = index >= 0 ? currentProfiles[index] : null;
  const profileId =
    index >= 0
      ? currentProfiles[index].id
      : incoming.id && !currentProfiles.some((profile) => profile.id === incoming.id)
        ? incoming.id
        : randomUUID();

  const profile: SavedMcpServerConfig =
    incoming.transport === "stdio"
      ? {
          id: profileId,
          name: incoming.name,
          transport: incoming.transport,
          command: incoming.command,
          args: incoming.args,
          cwd: incoming.cwd,
          env: incoming.env,
        }
      : {
          id: profileId,
          name: incoming.name,
          transport: incoming.transport,
          url: incoming.url,
          headers: incoming.headers,
          useAzureAuth: incoming.useAzureAuth,
          azureAuthScope: incoming.azureAuthScope,
          timeoutSeconds: incoming.timeoutSeconds,
        };

  const profiles =
    index >= 0
      ? currentProfiles.map((entry, entryIndex) => (entryIndex === index ? profile : entry))
      : [...currentProfiles, profile];

  let warning: string | null = null;
  if (keyIndex >= 0 && previousProfile) {
    warning =
      previousProfile.name === incoming.name
        ? "An MCP server with the same configuration already exists. Reused the existing saved profile."
        : `An MCP server with the same configuration already exists. Renamed it from "${previousProfile.name}" to "${incoming.name}".`;
  }

  return { profile, profiles, warning };
}

function normalizeStoredMcpServer(entry: unknown): SavedMcpServerConfig | null {
  const parsed = parseIncomingMcpServer(entry);
  if (!parsed.ok) {
    return null;
  }

  const id =
    isRecord(entry) && typeof entry.id === "string" && entry.id.trim()
      ? entry.id.trim()
      : randomUUID();

  return parsed.value.transport === "stdio"
    ? {
        id,
        name: parsed.value.name,
        transport: parsed.value.transport,
        command: parsed.value.command,
        args: parsed.value.args,
        cwd: parsed.value.cwd,
        env: parsed.value.env,
      }
    : {
        id,
        name: parsed.value.name,
        transport: parsed.value.transport,
        url: parsed.value.url,
        headers: parsed.value.headers,
        useAzureAuth: parsed.value.useAzureAuth,
        azureAuthScope: parsed.value.azureAuthScope,
        timeoutSeconds: parsed.value.timeoutSeconds,
      };
}

function parseArgs(argsValue: unknown): ParseResult<string[]> {
  if (argsValue === undefined || argsValue === null) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(argsValue)) {
    return { ok: false, error: "`args` must be an array of strings." };
  }

  if (argsValue.length > MAX_MCP_STDIO_ARGS) {
    return {
      ok: false,
      error: `\`args\` can include up to ${MAX_MCP_STDIO_ARGS} entries.`,
    };
  }

  const args: string[] = [];
  for (const [index, arg] of argsValue.entries()) {
    if (typeof arg !== "string") {
      return { ok: false, error: `args[${index}] must be a string.` };
    }

    const trimmed = arg.trim();
    if (!trimmed) {
      return { ok: false, error: `args[${index}] must not be empty.` };
    }

    args.push(trimmed);
  }

  return { ok: true, value: args };
}

function parseEnv(envValue: unknown): ParseResult<Record<string, string>> {
  if (envValue === undefined || envValue === null) {
    return { ok: true, value: {} };
  }

  if (!isRecord(envValue)) {
    return { ok: false, error: "`env` must be an object." };
  }

  const entries = Object.entries(envValue);
  if (entries.length > MAX_MCP_STDIO_ENV_VARS) {
    return {
      ok: false,
      error: `\`env\` can include up to ${MAX_MCP_STDIO_ENV_VARS} entries.`,
    };
  }

  const env: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!ENV_KEY_PATTERN.test(key)) {
      return { ok: false, error: `Invalid env key: ${key}` };
    }
    if (typeof value !== "string") {
      return { ok: false, error: `env[${key}] must be a string.` };
    }
    env[key] = value;
  }

  return { ok: true, value: env };
}

function parseHttpHeaders(
  headersValue: unknown,
): ParseResult<Record<string, string>> {
  if (headersValue === undefined || headersValue === null) {
    return { ok: true, value: {} };
  }

  if (!isRecord(headersValue)) {
    return { ok: false, error: "`headers` must be an object." };
  }

  const entries = Object.entries(headersValue);
  if (entries.length > MAX_MCP_HTTP_HEADERS) {
    return {
      ok: false,
      error: `\`headers\` can include up to ${MAX_MCP_HTTP_HEADERS} entries.`,
    };
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!HTTP_HEADER_NAME_PATTERN.test(key)) {
      return { ok: false, error: `Invalid header key: ${key}` };
    }

    if (key.toLowerCase() === "content-type") {
      return {
        ok: false,
        error: '`headers` must not include "Content-Type". It is fixed to "application/json".',
      };
    }

    if (typeof value !== "string") {
      return { ok: false, error: `headers[${key}] must be a string.` };
    }

    headers[key] = value;
  }

  return { ok: true, value: headers };
}

function parseAzureAuthScope(
  rawScope: unknown,
  useAzureAuth: boolean,
): ParseResult<string> {
  if (rawScope === undefined || rawScope === null) {
    return { ok: true, value: DEFAULT_MCP_AZURE_AUTH_SCOPE };
  }

  if (typeof rawScope !== "string") {
    return { ok: false, error: "`azureAuthScope` must be a string." };
  }

  const trimmed = rawScope.trim() || DEFAULT_MCP_AZURE_AUTH_SCOPE;
  if (trimmed.length > MAX_MCP_AZURE_AUTH_SCOPE_LENGTH) {
    return {
      ok: false,
      error: `\`azureAuthScope\` must be ${MAX_MCP_AZURE_AUTH_SCOPE_LENGTH} characters or fewer.`,
    };
  }

  if (/\s/.test(trimmed)) {
    return { ok: false, error: "`azureAuthScope` must not include spaces." };
  }

  if (useAzureAuth && !trimmed) {
    return { ok: false, error: "`azureAuthScope` is required when `useAzureAuth` is true." };
  }

  return { ok: true, value: trimmed };
}

function parseTimeoutSeconds(
  rawTimeout: unknown,
): ParseResult<number> {
  if (rawTimeout === undefined || rawTimeout === null) {
    return { ok: true, value: DEFAULT_MCP_TIMEOUT_SECONDS };
  }

  if (typeof rawTimeout !== "number" || !Number.isSafeInteger(rawTimeout)) {
    return { ok: false, error: "`timeoutSeconds` must be an integer." };
  }

  if (rawTimeout < MIN_MCP_TIMEOUT_SECONDS || rawTimeout > MAX_MCP_TIMEOUT_SECONDS) {
    return {
      ok: false,
      error: `\`timeoutSeconds\` must be between ${MIN_MCP_TIMEOUT_SECONDS} and ${MAX_MCP_TIMEOUT_SECONDS}.`,
    };
  }

  return { ok: true, value: rawTimeout };
}

function readTransport(value: unknown): McpTransport | null {
  if (value === "streamable_http" || value === "sse" || value === "stdio") {
    return value;
  }
  return null;
}

function normalizeName(rawName: unknown, fallback: string): string {
  const preferred = typeof rawName === "string" ? rawName.trim() : "";
  const normalized = (preferred || fallback).trim();
  return normalized.slice(0, MAX_MCP_SERVER_NAME_LENGTH);
}

function normalizeOptionalId(rawId: unknown): string | null {
  if (typeof rawId !== "string") {
    return null;
  }
  const trimmed = rawId.trim();
  return trimmed ? trimmed : null;
}

function buildIncomingProfileKey(profile: IncomingMcpServerConfig): string {
  if (profile.transport === "stdio") {
    const argsKey = profile.args.join("\u0000");
    const cwdKey = (profile.cwd ?? "").toLowerCase();
    const envKey = Object.entries(profile.env)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\u0000");
    return `${profile.transport}:${profile.command.toLowerCase()}:${argsKey}:${cwdKey}:${envKey}`;
  }

  const headersKey = Object.entries(profile.headers)
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000");
  const authKey = profile.useAzureAuth ? "azure-auth:on" : "azure-auth:off";
  const scopeKey = profile.useAzureAuth ? profile.azureAuthScope.toLowerCase() : "";
  return `${profile.transport}:${profile.url.toLowerCase()}:${headersKey}:${authKey}:${scopeKey}:${profile.timeoutSeconds}`;
}

function buildProfileKey(profile: SavedMcpServerConfig): string {
  return buildIncomingProfileKey(profile);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
