/**
 * API route module for /api/mcp-servers.
 */
import {
  ENV_KEY_PATTERN,
  HTTP_HEADER_NAME_PATTERN,
  MCP_AZURE_AUTH_SCOPE_MAX_LENGTH,
  MCP_DEFAULT_AZURE_MCP_SERVER_ARGS,
  MCP_DEFAULT_AZURE_MCP_SERVER_COMMAND,
  MCP_DEFAULT_AZURE_MCP_SERVER_NAME,
  MCP_DEFAULT_AZURE_AUTH_SCOPE,
  MCP_DEFAULT_MICROSOFT_LEARN_SERVER_NAME,
  MCP_DEFAULT_MICROSOFT_LEARN_SERVER_URL,
  MCP_DEFAULT_MERMAID_MCP_SERVER_ARGS,
  MCP_DEFAULT_MERMAID_MCP_SERVER_COMMAND,
  MCP_DEFAULT_MERMAID_MCP_SERVER_NAME,
  MCP_DEFAULT_OPENAI_DOCS_SERVER_NAME,
  MCP_DEFAULT_OPENAI_DOCS_SERVER_URL,
  MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_ARGS,
  MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_COMMAND,
  MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_NAME,
  MCP_DEFAULT_WORKIQ_SERVER_ARGS,
  MCP_DEFAULT_WORKIQ_SERVER_COMMAND,
  MCP_DEFAULT_WORKIQ_SERVER_NAME,
  MCP_DEFAULT_TIMEOUT_SECONDS,
  MCP_HTTP_HEADERS_MAX,
  MCP_SERVER_NAME_MAX_LENGTH,
  MCP_STDIO_ARGS_MAX,
  MCP_STDIO_ENV_VARS_MAX,
  MCP_TIMEOUT_SECONDS_MAX,
  MCP_TIMEOUT_SECONDS_MIN,
} from "~/lib/constants";
import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import { getOrCreateUserByIdentity } from "~/lib/server/persistence/user";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
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

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const user = await readAuthenticatedUser();
  if (!user) {
    return Response.json(
      {
        authRequired: true,
        error: "Azure login is required. Click Azure Login to continue.",
      },
      { status: 401 },
    );
  }

  try {
    const currentProfiles = await readSavedMcpServers(user.id);
    const profiles = mergeDefaultMcpServers(currentProfiles);
    if (profiles.length !== currentProfiles.length) {
      await writeSavedMcpServers(user.id, profiles);
    }
    return Response.json({ profiles });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/mcp-servers",
      eventName: "read_mcp_servers_failed",
      action: "read_saved_profiles",
      statusCode: 500,
      error,
      userId: user.id,
    });

    return Response.json(
      {
        error: `Failed to read MCP servers from database: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

export async function action({ request }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const user = await readAuthenticatedUser();
  if (!user) {
    return Response.json(
      {
        authRequired: true,
        error: "Azure login is required. Click Azure Login to continue.",
      },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await logServerRouteEvent({
      request,
      route: "/api/mcp-servers",
      eventName: "invalid_json_body",
      action: "parse_request_body",
      level: "warning",
      statusCode: 400,
      message: "Invalid JSON body.",
      userId: user.id,
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let incomingMcpServer: IncomingMcpServerConfig | null = null;
  if (request.method === "POST") {
    const incomingResult = parseIncomingMcpServer(payload);
    if (!incomingResult.ok) {
      await logServerRouteEvent({
        request,
        route: "/api/mcp-servers",
        eventName: "invalid_mcp_server_payload",
        action: "validate_payload",
        level: "warning",
        statusCode: 400,
        message: incomingResult.error,
        userId: user.id,
      });

      return Response.json({ error: incomingResult.error }, { status: 400 });
    }

    incomingMcpServer = incomingResult.value;
  }

  try {
    const currentProfiles = await readSavedMcpServers(user.id);
    if (request.method === "DELETE") {
      const deleteIdResult = parseDeleteSavedMcpServerPayload(payload);
      if (!deleteIdResult.ok) {
        await logServerRouteEvent({
          request,
          route: "/api/mcp-servers",
          eventName: "invalid_mcp_server_delete_payload",
          action: "validate_payload",
          level: "warning",
          statusCode: 400,
          message: deleteIdResult.error,
          userId: user.id,
        });
        return Response.json({ error: deleteIdResult.error }, { status: 400 });
      }

      const deleteResult = deleteSavedMcpServer(currentProfiles, deleteIdResult.value);
      if (!deleteResult.deleted) {
        return Response.json({ error: "Selected MCP server is not available." }, { status: 404 });
      }

      await writeSavedMcpServers(user.id, deleteResult.profiles);
      return Response.json({ profiles: deleteResult.profiles });
    }

    if (!incomingMcpServer) {
      return Response.json({ error: "Invalid MCP server payload." }, { status: 400 });
    }

    const { profile, profiles, warning } = upsertSavedMcpServer(currentProfiles, incomingMcpServer);
    await writeSavedMcpServers(user.id, profiles);

    if (warning) {
      await logServerRouteEvent({
        request,
        route: "/api/mcp-servers",
        eventName: "mcp_server_duplicate_reused",
        action: "upsert_saved_profile",
        level: "warning",
        statusCode: 200,
        message: warning,
        userId: user.id,
        context: {
          profileId: profile.id,
          transport: profile.transport,
        },
      });
    }

    return Response.json({ profile, profiles, warning });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/mcp-servers",
      eventName: "save_mcp_servers_failed",
      action: "write_saved_profiles",
      statusCode: 500,
      error,
      userId: user.id,
    });

    return Response.json(
      {
        error: `Failed to update MCP servers in database: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

async function readSavedMcpServers(userId: number): Promise<SavedMcpServerConfig[]> {
  await ensurePersistenceDatabaseReady();
  const records = await prisma.mcpServerProfile.findMany({
    where: {
      userId,
    },
    orderBy: {
      sortOrder: "asc",
    },
  });

  const profiles: SavedMcpServerConfig[] = [];
  const keys = new Set<string>();

  for (const record of records) {
    const normalized = normalizeStoredMcpServerRecord(record);
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

async function writeSavedMcpServers(userId: number, profiles: SavedMcpServerConfig[]): Promise<void> {
  await ensurePersistenceDatabaseReady();
  await prisma.$transaction(async (transaction) => {
    await transaction.mcpServerProfile.deleteMany({
      where: { userId },
    });
    if (profiles.length === 0) {
      return;
    }

    await transaction.mcpServerProfile.createMany({
      data: profiles.map((profile, index) => mapProfileToDatabaseRecord(userId, profile, index)),
    });
  });
}

function mergeDefaultMcpServers(currentProfiles: SavedMcpServerConfig[]): SavedMcpServerConfig[] {
  const mergedProfiles = [...currentProfiles];
  const profileKeys = new Set(mergedProfiles.map((profile) => buildProfileKey(profile)));
  for (const profile of buildDefaultMcpServerProfiles()) {
    const profileKey = buildProfileKey(profile);
    if (profileKeys.has(profileKey)) {
      continue;
    }

    profileKeys.add(profileKey);
    mergedProfiles.push(profile);
  }

  return mergedProfiles;
}

function buildDefaultMcpServerProfiles(): SavedMcpServerConfig[] {
  return [
    {
      id: createRandomId(),
      name: MCP_DEFAULT_OPENAI_DOCS_SERVER_NAME,
      transport: "streamable_http",
      url: MCP_DEFAULT_OPENAI_DOCS_SERVER_URL,
      headers: {},
      useAzureAuth: false,
      azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
      timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
    },
    {
      id: createRandomId(),
      name: MCP_DEFAULT_MICROSOFT_LEARN_SERVER_NAME,
      transport: "streamable_http",
      url: MCP_DEFAULT_MICROSOFT_LEARN_SERVER_URL,
      headers: {},
      useAzureAuth: false,
      azureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
      timeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
    },
    {
      id: createRandomId(),
      name: MCP_DEFAULT_WORKIQ_SERVER_NAME,
      transport: "stdio",
      command: MCP_DEFAULT_WORKIQ_SERVER_COMMAND,
      args: [...MCP_DEFAULT_WORKIQ_SERVER_ARGS],
      env: {},
    },
    {
      id: createRandomId(),
      name: MCP_DEFAULT_AZURE_MCP_SERVER_NAME,
      transport: "stdio",
      command: MCP_DEFAULT_AZURE_MCP_SERVER_COMMAND,
      args: [...MCP_DEFAULT_AZURE_MCP_SERVER_ARGS],
      env: {},
    },
    {
      id: createRandomId(),
      name: MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_NAME,
      transport: "stdio",
      command: MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_COMMAND,
      args: [...MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_ARGS],
      env: {},
    },
    {
      id: createRandomId(),
      name: MCP_DEFAULT_MERMAID_MCP_SERVER_NAME,
      transport: "stdio",
      command: MCP_DEFAULT_MERMAID_MCP_SERVER_COMMAND,
      args: [...MCP_DEFAULT_MERMAID_MCP_SERVER_ARGS],
      env: {},
    },
  ];
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

function parseDeleteSavedMcpServerPayload(payload: unknown): ParseResult<string> {
  if (!isRecord(payload)) {
    return { ok: false, error: "Invalid MCP server payload." };
  }

  const id = normalizeOptionalId(payload.id);
  if (!id) {
    return { ok: false, error: "`id` is required." };
  }

  return { ok: true, value: id };
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
        : createRandomId();

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

function deleteSavedMcpServer(
  currentProfiles: SavedMcpServerConfig[],
  id: string,
): { profiles: SavedMcpServerConfig[]; deleted: boolean } {
  const nextProfiles = currentProfiles.filter((profile) => profile.id !== id);
  return {
    profiles: nextProfiles,
    deleted: nextProfiles.length !== currentProfiles.length,
  };
}

function normalizeStoredMcpServer(entry: unknown): SavedMcpServerConfig | null {
  const parsed = parseIncomingMcpServer(entry);
  if (!parsed.ok) {
    return null;
  }

  const id =
    isRecord(entry) && typeof entry.id === "string" && entry.id.trim()
      ? entry.id.trim()
      : createRandomId();

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

function normalizeStoredMcpServerRecord(entry: {
  id: string;
  name: string;
  transport: string;
  url: string | null;
  headersJson: string | null;
  useAzureAuth: boolean;
  azureAuthScope: string | null;
  timeoutSeconds: number | null;
  command: string | null;
  argsJson: string | null;
  cwd: string | null;
  envJson: string | null;
}): SavedMcpServerConfig | null {
  const transport = readTransport(entry.transport);
  if (!transport) {
    return null;
  }

  if (transport === "stdio") {
    const args = parseStringArrayJson(entry.argsJson);
    const env = parseStringMapJson(entry.envJson);
    if (!args || !env || !entry.command) {
      return null;
    }

    return normalizeStoredMcpServer({
      id: entry.id,
      name: entry.name,
      transport: "stdio",
      command: entry.command,
      args,
      cwd: entry.cwd ?? undefined,
      env,
    });
  }

  const headers = parseStringMapJson(entry.headersJson);
  if (!headers || !entry.url) {
    return null;
  }

  return normalizeStoredMcpServer({
    id: entry.id,
    name: entry.name,
    transport,
    url: entry.url,
    headers,
    useAzureAuth: entry.useAzureAuth,
    azureAuthScope: entry.azureAuthScope ?? MCP_DEFAULT_AZURE_AUTH_SCOPE,
    timeoutSeconds: entry.timeoutSeconds ?? MCP_DEFAULT_TIMEOUT_SECONDS,
  });
}

function mapProfileToDatabaseRecord(userId: number, profile: SavedMcpServerConfig, sortOrder: number): {
  id: string;
  userId: number;
  sortOrder: number;
  configKey: string;
  name: string;
  transport: string;
  url: string | null;
  headersJson: string | null;
  useAzureAuth: boolean;
  azureAuthScope: string | null;
  timeoutSeconds: number | null;
  command: string | null;
  argsJson: string | null;
  cwd: string | null;
  envJson: string | null;
} {
  if (profile.transport === "stdio") {
    return {
      id: profile.id,
      userId,
      sortOrder,
      configKey: buildProfileKey(profile),
      name: profile.name,
      transport: profile.transport,
      url: null,
      headersJson: null,
      useAzureAuth: false,
      azureAuthScope: null,
      timeoutSeconds: null,
      command: profile.command,
      argsJson: JSON.stringify(profile.args),
      cwd: profile.cwd ?? null,
      envJson: JSON.stringify(profile.env),
    };
  }

  return {
    id: profile.id,
    userId,
    sortOrder,
    configKey: buildProfileKey(profile),
    name: profile.name,
    transport: profile.transport,
    url: profile.url,
    headersJson: JSON.stringify(profile.headers),
    useAzureAuth: profile.useAzureAuth,
    azureAuthScope: profile.azureAuthScope,
    timeoutSeconds: profile.timeoutSeconds,
    command: null,
    argsJson: null,
    cwd: null,
    envJson: null,
  };
}

function parseStringArrayJson(value: string | null): string[] | null {
  if (typeof value !== "string") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  if (parsed.some((entry) => typeof entry !== "string")) {
    return null;
  }

  return [...parsed];
}

function parseStringMapJson(value: string | null): Record<string, string> | null {
  if (typeof value !== "string") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const normalized: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(parsed)) {
    if (typeof entryValue !== "string") {
      return null;
    }
    normalized[key] = entryValue;
  }

  return normalized;
}

function parseArgs(argsValue: unknown): ParseResult<string[]> {
  if (argsValue === undefined || argsValue === null) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(argsValue)) {
    return { ok: false, error: "`args` must be an array of strings." };
  }

  if (argsValue.length > MCP_STDIO_ARGS_MAX) {
    return {
      ok: false,
      error: `\`args\` can include up to ${MCP_STDIO_ARGS_MAX} entries.`,
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
  if (entries.length > MCP_STDIO_ENV_VARS_MAX) {
    return {
      ok: false,
      error: `\`env\` can include up to ${MCP_STDIO_ENV_VARS_MAX} entries.`,
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
  if (entries.length > MCP_HTTP_HEADERS_MAX) {
    return {
      ok: false,
      error: `\`headers\` can include up to ${MCP_HTTP_HEADERS_MAX} entries.`,
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
    return { ok: true, value: MCP_DEFAULT_AZURE_AUTH_SCOPE };
  }

  if (typeof rawScope !== "string") {
    return { ok: false, error: "`azureAuthScope` must be a string." };
  }

  const trimmed = rawScope.trim() || MCP_DEFAULT_AZURE_AUTH_SCOPE;
  if (trimmed.length > MCP_AZURE_AUTH_SCOPE_MAX_LENGTH) {
    return {
      ok: false,
      error: `\`azureAuthScope\` must be ${MCP_AZURE_AUTH_SCOPE_MAX_LENGTH} characters or fewer.`,
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
    return { ok: true, value: MCP_DEFAULT_TIMEOUT_SECONDS };
  }

  if (typeof rawTimeout !== "number" || !Number.isSafeInteger(rawTimeout)) {
    return { ok: false, error: "`timeoutSeconds` must be an integer." };
  }

  if (rawTimeout < MCP_TIMEOUT_SECONDS_MIN || rawTimeout > MCP_TIMEOUT_SECONDS_MAX) {
    return {
      ok: false,
      error: `\`timeoutSeconds\` must be between ${MCP_TIMEOUT_SECONDS_MIN} and ${MCP_TIMEOUT_SECONDS_MAX}.`,
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
  return normalized.slice(0, MCP_SERVER_NAME_MAX_LENGTH);
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

async function readAuthenticatedUser(): Promise<{ id: number } | null> {
  const userContext = await readAzureArmUserContext();
  if (!userContext) {
    return null;
  }

  const user = await getOrCreateUserByIdentity({
    tenantId: userContext.tenantId,
    principalId: userContext.principalId,
  });
  return { id: user.id };
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

function createRandomId(): string {
  const maybeCrypto = globalThis.crypto;
  if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const mcpServersRouteTestUtils = {
  parseIncomingMcpServer,
  upsertSavedMcpServer,
  deleteSavedMcpServer,
  buildIncomingProfileKey,
  mergeDefaultMcpServers,
};
