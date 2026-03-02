/**
 * API route module for /api/mcp/servers.
 */
import {
  ENV_KEY_PATTERN,
  HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS,
  HTTP_HEADER_NAME_PATTERN,
  MCP_AZURE_AUTH_SCOPE_MAX_LENGTH,
  MCP_DEFAULT_AZURE_AUTH_SCOPE,
  MCP_DEFAULT_TIMEOUT_SECONDS,
  MCP_HTTP_HEADERS_MAX,
  MCP_LEGACY_UNAVAILABLE_DEFAULT_STDIO_NPX_PACKAGE_NAMES,
  MCP_SERVER_NAME_MAX_LENGTH,
  MCP_STDIO_ARGS_MAX,
  MCP_STDIO_ENV_VARS_MAX,
  MCP_TIMEOUT_SECONDS_MAX,
  MCP_TIMEOUT_SECONDS_MIN,
} from "~/lib/constants";
import { buildMcpServerConfigKey } from "~/lib/mcp/config-key";
import {
  resolveFoundryConfigDirectory,
  resolveFoundryWorkspaceUserDirectory,
} from "~/lib/foundry/config";
import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import { getOrCreateUserByIdentity } from "~/lib/server/persistence/user";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import { methodNotAllowedResponse } from "~/lib/server/http";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/runtime-event-log";
import type { Route } from "./+types/api.mcp.servers";

type McpTransport = "streamable_http" | "sse" | "stdio";

type WorkspaceMcpServerProfileHttpConfig = {
  id: string;
  name: string;
  connectOnThreadCreate: boolean;
  transport: "streamable_http" | "sse";
  url: string;
  headers: Record<string, string>;
  useAzureAuth: boolean;
  azureAuthScope: string;
  timeoutSeconds: number;
};

type WorkspaceMcpServerProfileStdioConfig = {
  id: string;
  name: string;
  connectOnThreadCreate: boolean;
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
};

export type WorkspaceMcpServerProfileConfig = WorkspaceMcpServerProfileHttpConfig | WorkspaceMcpServerProfileStdioConfig;
type IncomingMcpHttpServerConfig =
  Omit<WorkspaceMcpServerProfileHttpConfig, "id" | "connectOnThreadCreate"> &
  { id?: string; connectOnThreadCreate?: boolean };
type IncomingMcpStdioServerConfig =
  Omit<WorkspaceMcpServerProfileStdioConfig, "id" | "connectOnThreadCreate"> &
  { id?: string; connectOnThreadCreate?: boolean };
export type IncomingMcpServerConfig = IncomingMcpHttpServerConfig | IncomingMcpStdioServerConfig;
type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
const legacyUnavailableDefaultStdioNpxPackageNameSet = new Set<string>(
  MCP_LEGACY_UNAVAILABLE_DEFAULT_STDIO_NPX_PACKAGE_NAMES,
);
type HomeDefaultWorkspaceMcpServerProfileRow =
  (typeof HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS)[number];
type HomeDefaultWorkspaceMcpServerProfileStdioRow = Extract<
  HomeDefaultWorkspaceMcpServerProfileRow,
  { transport: "stdio" }
>;
const defaultMermaidWorkspaceMcpServerProfile =
  HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS.find(
    (profile): profile is HomeDefaultWorkspaceMcpServerProfileStdioRow =>
      profile.transport === "stdio" && profile.name === "mcp-mermaid",
  ) ?? null;
const defaultFilesystemWorkspaceMcpServerProfile =
  HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS.find(
    (profile): profile is HomeDefaultWorkspaceMcpServerProfileStdioRow =>
      profile.transport === "stdio" && profile.name === "filesystem",
  ) ?? null;
const MCP_SERVERS_COLLECTION_ALLOWED_METHODS = ["GET", "POST"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return methodNotAllowedResponse(MCP_SERVERS_COLLECTION_ALLOWED_METHODS);
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
    const profiles = await readWorkspaceMcpServerProfiles(user.id);
    return Response.json({ profiles });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/mcp/servers",
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

  if (request.method !== "POST") {
    return methodNotAllowedResponse(MCP_SERVERS_COLLECTION_ALLOWED_METHODS);
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
      route: "/api/mcp/servers",
      eventName: "invalid_json_body",
      action: "parse_request_body",
      level: "warning",
      statusCode: 400,
      message: "Invalid JSON body.",
      userId: user.id,
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (isRecord(payload) && payload.id !== undefined) {
    await logServerRouteEvent({
      request,
      route: "/api/mcp/servers",
      eventName: "invalid_mcp_server_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: "`id` must not be provided for POST.",
      userId: user.id,
    });
    return Response.json({ error: "`id` must not be provided for POST." }, { status: 400 });
  }

  const incomingResult = parseIncomingMcpServer(payload);
  if (!incomingResult.ok) {
    await logServerRouteEvent({
      request,
      route: "/api/mcp/servers",
      eventName: "invalid_mcp_server_payload",
      action: "validate_payload",
      level: "warning",
      statusCode: 400,
      message: incomingResult.error,
      userId: user.id,
    });

    return Response.json({ error: incomingResult.error }, { status: 400 });
  }
  const incomingMcpServer = incomingResult.value;

  try {
    const currentProfiles = await readWorkspaceMcpServerProfiles(user.id);
    const profilesWithDefaults = mergeDefaultWorkspaceMcpServerProfiles(currentProfiles, user.id);
    const existingIds = new Set(profilesWithDefaults.map((profile) => profile.id));
    const { profile, profiles, warning } = upsertWorkspaceMcpServerProfile(
      profilesWithDefaults,
      incomingMcpServer,
    );
    await writeWorkspaceMcpServerProfiles(user.id, profiles);
    const created = !existingIds.has(profile.id);
    const status = created ? 201 : 200;

    if (warning) {
      await logServerRouteEvent({
        request,
        route: "/api/mcp/servers",
        eventName: "mcp_server_duplicate_reused",
        action: "upsert_saved_profile",
        level: "warning",
        statusCode: status,
        message: warning,
        userId: user.id,
        context: {
          profileId: profile.id,
          transport: profile.transport,
        },
      });
    }

    return Response.json(
      { profile, profiles, warning },
      {
        status,
        headers: created
          ? {
              Location: `/api/mcp/servers/${encodeURIComponent(profile.id)}`,
            }
          : undefined,
      },
    );
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/mcp/servers",
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

export async function readWorkspaceMcpServerProfiles(userId: number): Promise<WorkspaceMcpServerProfileConfig[]> {
  await ensurePersistenceDatabaseReady();
  const records = await prisma.workspaceMcpServerProfile.findMany({
    where: {
      userId,
    },
    orderBy: {
      profileOrder: "asc",
    },
  });

  const profiles: WorkspaceMcpServerProfileConfig[] = [];
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

export async function writeWorkspaceMcpServerProfiles(
  userId: number,
  profiles: WorkspaceMcpServerProfileConfig[],
): Promise<void> {
  await ensurePersistenceDatabaseReady();
  await prisma.$transaction(async (transaction) => {
    await transaction.workspaceMcpServerProfile.deleteMany({
      where: { userId },
    });
    if (profiles.length === 0) {
      return;
    }

    await transaction.workspaceMcpServerProfile.createMany({
      data: profiles.map((profile, index) => mapProfileToDatabaseRecord(userId, profile, index)),
    });
  });
}

export function mergeDefaultWorkspaceMcpServerProfiles(
  currentProfiles: WorkspaceMcpServerProfileConfig[],
  workspaceUserId: number,
): WorkspaceMcpServerProfileConfig[] {
  const mergedProfiles = normalizeLegacyDefaultProfiles(currentProfiles, workspaceUserId);
  const profileKeys = new Set(mergedProfiles.map((profile) => buildProfileKey(profile)));
  for (const profile of buildDefaultMcpServerProfiles(workspaceUserId)) {
    const profileKey = buildProfileKey(profile);
    if (profileKeys.has(profileKey)) {
      continue;
    }

    profileKeys.add(profileKey);
    mergedProfiles.push(profile);
  }

  return mergedProfiles;
}

export async function ensureDefaultMcpServersForUser(userId: number): Promise<void> {
  const currentProfiles = await readWorkspaceMcpServerProfiles(userId);
  const nextProfiles = mergeDefaultWorkspaceMcpServerProfiles(currentProfiles, userId);
  if (nextProfiles.length === currentProfiles.length) {
    return;
  }

  await writeWorkspaceMcpServerProfiles(userId, nextProfiles);
}

function buildDefaultMcpServerProfiles(
  workspaceUserId: number,
): WorkspaceMcpServerProfileConfig[] {
  const defaultStdioWorkingDirectory = resolveDefaultFilesystemWorkingDirectory(workspaceUserId);
  return HOME_DEFAULT_WORKSPACE_MCP_SERVER_PROFILE_ROWS.map((defaultProfile) => {
    if (defaultProfile.transport === "stdio") {
      return {
        id: createRandomId(),
        name: defaultProfile.name,
        connectOnThreadCreate: defaultProfile.connectOnThreadCreate,
        transport: "stdio",
        command: defaultProfile.command,
        args: [...defaultProfile.args],
        cwd:
          defaultProfile.cwd === "default" ? defaultStdioWorkingDirectory : undefined,
        env: { ...defaultProfile.env },
      };
    }

    return {
      id: createRandomId(),
      name: defaultProfile.name,
      connectOnThreadCreate: defaultProfile.connectOnThreadCreate,
      transport: defaultProfile.transport,
      url: defaultProfile.url,
      headers: { ...defaultProfile.headers },
      useAzureAuth: defaultProfile.useAzureAuth,
      azureAuthScope: defaultProfile.azureAuthScope,
      timeoutSeconds: defaultProfile.timeoutSeconds,
    };
  });
}

function normalizeLegacyDefaultProfiles(
  currentProfiles: WorkspaceMcpServerProfileConfig[],
  workspaceUserId: number,
): WorkspaceMcpServerProfileConfig[] {
  const defaultWorkingDirectory = resolveDefaultFilesystemWorkingDirectory(workspaceUserId);
  const legacyDefaultWorkingDirectory = resolveLegacyFilesystemWorkingDirectory();
  const normalizedProfiles: WorkspaceMcpServerProfileConfig[] = [];

  for (const profile of currentProfiles) {
    if (isLegacyUnavailableDefaultStdioProfile(profile)) {
      continue;
    }

    if (
      !isLegacyDefaultMermaidProfile(profile, legacyDefaultWorkingDirectory) &&
      !isLegacyDefaultFilesystemProfile(profile, legacyDefaultWorkingDirectory)
    ) {
      normalizedProfiles.push(profile);
      continue;
    }

    normalizedProfiles.push({
      ...profile,
      cwd: defaultWorkingDirectory,
    });
  }

  return normalizedProfiles;
}

function isLegacyDefaultMermaidProfile(
  profile: WorkspaceMcpServerProfileConfig,
  legacyDefaultWorkingDirectory: string,
): profile is WorkspaceMcpServerProfileStdioConfig {
  if (profile.transport !== "stdio" || !defaultMermaidWorkspaceMcpServerProfile) {
    return false;
  }

  return (
    profile.command === defaultMermaidWorkspaceMcpServerProfile.command &&
    profile.args.length === defaultMermaidWorkspaceMcpServerProfile.args.length &&
    profile.args.every((arg, index) => arg === defaultMermaidWorkspaceMcpServerProfile.args[index]) &&
    Object.keys(profile.env).length === 0 &&
    isLegacyDefaultWorkingDirectory(profile.cwd, legacyDefaultWorkingDirectory)
  );
}

function isLegacyDefaultFilesystemProfile(
  profile: WorkspaceMcpServerProfileConfig,
  legacyDefaultWorkingDirectory: string,
): profile is WorkspaceMcpServerProfileStdioConfig {
  if (profile.transport !== "stdio" || !defaultFilesystemWorkspaceMcpServerProfile) {
    return false;
  }

  return (
    profile.command === defaultFilesystemWorkspaceMcpServerProfile.command &&
    profile.args.length === defaultFilesystemWorkspaceMcpServerProfile.args.length &&
    profile.args.every(
      (arg, index) => arg === defaultFilesystemWorkspaceMcpServerProfile.args[index],
    ) &&
    Object.keys(profile.env).length === 0 &&
    isLegacyDefaultWorkingDirectory(profile.cwd, legacyDefaultWorkingDirectory)
  );
}

function isLegacyUnavailableDefaultStdioProfile(profile: WorkspaceMcpServerProfileConfig): boolean {
  if (profile.transport !== "stdio") {
    return false;
  }

  return (
    profile.command === "npx" &&
    profile.args.length === 2 &&
    profile.args[0] === "-y" &&
    legacyUnavailableDefaultStdioNpxPackageNameSet.has(profile.args[1]) &&
    !profile.cwd &&
    Object.keys(profile.env).length === 0
  );
}

function resolveDefaultFilesystemWorkingDirectory(workspaceUserId: number): string {
  return resolveFoundryWorkspaceUserDirectory({
    workspaceUserId,
  });
}

function resolveLegacyFilesystemWorkingDirectory(): string {
  return resolveFoundryConfigDirectory();
}

function isLegacyDefaultWorkingDirectory(
  cwd: string | undefined,
  legacyDefaultWorkingDirectory: string,
): boolean {
  if (!cwd) {
    return true;
  }

  return normalizePathForComparison(cwd) === normalizePathForComparison(legacyDefaultWorkingDirectory);
}

function normalizePathForComparison(value: string): string {
  return value.trim().replaceAll("\\", "/").toLowerCase();
}

export function parseIncomingMcpServer(payload: unknown): ParseResult<IncomingMcpServerConfig> {
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

  const parsedUrlResult = parseMcpHttpUrlForWorkspaceProfile(rawUrl);
  if (!parsedUrlResult.ok) {
    return parsedUrlResult;
  }

  const name = normalizeName(payload.name, parsedUrlResult.value.nameFallback);
  if (!name) {
    return { ok: false, error: "`name` is required." };
  }

  const connectOnThreadCreateResult = parseConnectOnThreadCreate(payload.connectOnThreadCreate);
  if (!connectOnThreadCreateResult.ok) {
    return connectOnThreadCreateResult;
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
      ...(connectOnThreadCreateResult.value === undefined
        ? {}
        : { connectOnThreadCreate: connectOnThreadCreateResult.value }),
      name,
      transport,
      url: parsedUrlResult.value.url,
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

  const connectOnThreadCreateResult = parseConnectOnThreadCreate(payload.connectOnThreadCreate);
  if (!connectOnThreadCreateResult.ok) {
    return connectOnThreadCreateResult;
  }

  const id = normalizeOptionalId(payload.id);
  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      ...(connectOnThreadCreateResult.value === undefined
        ? {}
        : { connectOnThreadCreate: connectOnThreadCreateResult.value }),
      name,
      transport: "stdio",
      command,
      args: argsResult.value,
      cwd: cwd || undefined,
      env: envResult.value,
    },
  };
}

function parseMcpHttpUrlForWorkspaceProfile(
  rawUrl: string,
): ParseResult<{
  url: string;
  nameFallback: string;
}> {
  if (rawUrl.startsWith("/") && !rawUrl.startsWith("//")) {
    let parsedRelativeUrl: URL;
    try {
      parsedRelativeUrl = new URL(rawUrl, "http://localhost");
    } catch {
      return { ok: false, error: "`url` is invalid." };
    }

    const pathname = parsedRelativeUrl.pathname || "/";
    const normalizedRelativeUrl = `${pathname}${parsedRelativeUrl.search}`;
    const pathSegments = pathname
      .split("/")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const nameFallback = pathSegments[pathSegments.length - 1] ?? "local";
    return {
      ok: true,
      value: {
        url: normalizedRelativeUrl,
        nameFallback,
      },
    };
  }

  let parsedAbsoluteUrl: URL;
  try {
    parsedAbsoluteUrl = new URL(rawUrl);
  } catch {
    return { ok: false, error: "`url` is invalid." };
  }

  if (parsedAbsoluteUrl.protocol !== "http:" && parsedAbsoluteUrl.protocol !== "https:") {
    return { ok: false, error: "`url` must start with http://, https://, or /." };
  }

  return {
    ok: true,
    value: {
      url: parsedAbsoluteUrl.toString(),
      nameFallback: parsedAbsoluteUrl.hostname,
    },
  };
}

function parseConnectOnThreadCreate(value: unknown): ParseResult<boolean | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== "boolean") {
    return { ok: false, error: "`connectOnThreadCreate` must be a boolean." };
  }

  return { ok: true, value };
}

export function upsertWorkspaceMcpServerProfile(
  currentProfiles: WorkspaceMcpServerProfileConfig[],
  incoming: IncomingMcpServerConfig,
): { profile: WorkspaceMcpServerProfileConfig; profiles: WorkspaceMcpServerProfileConfig[]; warning: string | null } {
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
  const connectOnThreadCreate =
    incoming.connectOnThreadCreate ??
    previousProfile?.connectOnThreadCreate ??
    false;

  const profile: WorkspaceMcpServerProfileConfig =
    incoming.transport === "stdio"
      ? {
          id: profileId,
          name: incoming.name,
          connectOnThreadCreate,
          transport: incoming.transport,
          command: incoming.command,
          args: incoming.args,
          cwd: incoming.cwd,
          env: incoming.env,
        }
      : {
          id: profileId,
          name: incoming.name,
          connectOnThreadCreate,
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

export function deleteWorkspaceMcpServerProfile(
  currentProfiles: WorkspaceMcpServerProfileConfig[],
  id: string,
): { profiles: WorkspaceMcpServerProfileConfig[]; deleted: boolean } {
  const nextProfiles = currentProfiles.filter((profile) => profile.id !== id);
  return {
    profiles: nextProfiles,
    deleted: nextProfiles.length !== currentProfiles.length,
  };
}

function normalizeStoredMcpServer(entry: unknown): WorkspaceMcpServerProfileConfig | null {
  const parsed = parseIncomingMcpServer(entry);
  if (!parsed.ok) {
    return null;
  }

  const id =
    isRecord(entry) && typeof entry.id === "string" && entry.id.trim()
      ? entry.id.trim()
      : createRandomId();
  const connectOnThreadCreate =
    isRecord(entry) && typeof entry.connectOnThreadCreate === "boolean"
      ? entry.connectOnThreadCreate
      : parsed.value.connectOnThreadCreate === true;

  return parsed.value.transport === "stdio"
    ? {
        id,
        name: parsed.value.name,
        connectOnThreadCreate,
        transport: parsed.value.transport,
        command: parsed.value.command,
        args: parsed.value.args,
        cwd: parsed.value.cwd,
        env: parsed.value.env,
      }
    : {
        id,
        name: parsed.value.name,
        connectOnThreadCreate,
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
  connectOnThreadCreate: boolean;
  url: string | null;
  headersJson: string | null;
  useAzureAuth: boolean;
  azureAuthScope: string | null;
  timeoutSeconds: number | null;
  command: string | null;
  argsJson: string | null;
  cwd: string | null;
  envJson: string | null;
}): WorkspaceMcpServerProfileConfig | null {
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
      connectOnThreadCreate: entry.connectOnThreadCreate === true,
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
    connectOnThreadCreate: entry.connectOnThreadCreate === true,
    transport,
    url: entry.url,
    headers,
    useAzureAuth: entry.useAzureAuth,
    azureAuthScope: entry.azureAuthScope ?? MCP_DEFAULT_AZURE_AUTH_SCOPE,
    timeoutSeconds: entry.timeoutSeconds ?? MCP_DEFAULT_TIMEOUT_SECONDS,
  });
}

function mapProfileToDatabaseRecord(userId: number, profile: WorkspaceMcpServerProfileConfig, profileOrder: number): {
  id: string;
  userId: number;
  profileOrder: number;
  connectOnThreadCreate: boolean;
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
      profileOrder,
      connectOnThreadCreate: profile.connectOnThreadCreate,
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
    profileOrder,
    connectOnThreadCreate: profile.connectOnThreadCreate,
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
  return buildMcpServerConfigKey(profile);
}

export async function readAuthenticatedUser(): Promise<{ id: number } | null> {
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

function buildProfileKey(profile: WorkspaceMcpServerProfileConfig): string {
  return buildIncomingProfileKey(profile);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function readErrorMessage(error: unknown): string {
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
  upsertWorkspaceMcpServerProfile,
  deleteWorkspaceMcpServerProfile,
  buildIncomingProfileKey,
  mergeDefaultWorkspaceMcpServerProfiles,
  resolveDefaultFilesystemWorkingDirectory,
};
