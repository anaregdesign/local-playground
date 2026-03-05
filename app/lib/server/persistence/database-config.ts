/**
 * Persistence database configuration helpers.
 */
import { resolveFoundryDatabaseUrl } from "~/lib/foundry/config";

export type PersistenceDatabaseProvider =
  | "sqlite"
  | "postgresql"
  | "mysql"
  | "cockroachdb"
  | "sqlserver";

type PersistenceRelationalDatabaseProvider = Exclude<PersistenceDatabaseProvider, "sqlite">;

export type PersistenceSqlAuthenticationMethod = "password" | "azure_identity" | "access_token";

export type PersistenceSqlAuthenticationConfig =
  | {
      method: "password";
    }
  | {
      method: "azure_identity";
      clientId: string;
      scope: string;
    }
  | {
      method: "access_token";
      accessToken: string;
    };

export type PersistenceDatabaseConfig = {
  provider: PersistenceDatabaseProvider;
  databaseUrl: string;
  sqlAuthentication: PersistenceSqlAuthenticationConfig | null;
};

type ResolvePersistenceDatabaseConfigOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  appDataDirectory?: string | null;
  cwd?: string;
};

const DEFAULT_POSTGRES_PORT = "5432";
const DEFAULT_POSTGRES_SSLMODE = "require";
const DEFAULT_OSS_RDBMS_AZURE_IDENTITY_SCOPE =
  "https://ossrdbms-aad.database.windows.net/.default";
const DEFAULT_SQLSERVER_AZURE_IDENTITY_SCOPE = "https://database.windows.net/.default";

export function resolvePersistenceDatabaseConfig(
  options: ResolvePersistenceDatabaseConfigOptions = {},
): PersistenceDatabaseConfig {
  const env = options.env ?? process.env;
  const configuredProvider = readConfiguredProvider(env);
  const configuredDatabaseUrl = readConfiguredDatabaseUrl(env);
  const providerFromDatabaseUrl = detectProviderFromDatabaseUrl(configuredDatabaseUrl);
  const postgresComponents = readPostgresComponents(env);
  const provider =
    configuredProvider ??
    providerFromDatabaseUrl ??
    (postgresComponents.hasAnyValue ? "postgresql" : "sqlite");

  if (
    configuredProvider &&
    providerFromDatabaseUrl &&
    configuredProvider !== providerFromDatabaseUrl
  ) {
    throw new Error(
      `Database provider (${configuredProvider}) does not match database URL scheme (${providerFromDatabaseUrl}).`,
    );
  }

  if (provider === "sqlite") {
    return {
      provider,
      databaseUrl: resolveFoundryDatabaseUrl({
        envDatabaseUrl: configuredDatabaseUrl,
        platform: options.platform,
        homeDirectory: options.homeDirectory,
        appDataDirectory: options.appDataDirectory,
        cwd: options.cwd,
      }),
      sqlAuthentication: null,
    };
  }

  const databaseUrl = resolveRelationalDatabaseUrl({
    provider,
    configuredDatabaseUrl,
    postgresComponents,
  });
  const sqlAuthentication = resolveSqlAuthenticationConfig(provider, env);

  return {
    provider,
    databaseUrl,
    sqlAuthentication,
  };
}

export function buildSqlDatabaseUrlWithPassword(options: {
  provider: PersistenceRelationalDatabaseProvider;
  databaseUrl: string;
  password: string;
}): string {
  const normalizedUrl = options.databaseUrl.trim();
  if (!normalizedUrl) {
    throw new Error("Database URL is required to inject a password.");
  }

  if (options.provider === "sqlserver") {
    return buildSqlServerDatabaseUrlWithPassword(normalizedUrl, options.password);
  }

  if (!isDatabaseUrlForProvider(normalizedUrl, options.provider)) {
    throw new Error(
      `Database URL must use the ${options.provider} scheme to inject a password.`,
    );
  }

  const parsed = new URL(normalizedUrl);
  parsed.password = options.password;
  return parsed.toString();
}

function resolveRelationalDatabaseUrl(options: {
  provider: PersistenceRelationalDatabaseProvider;
  configuredDatabaseUrl: string;
  postgresComponents: PostgresComponents;
}): string {
  if (options.provider === "postgresql") {
    return resolvePostgresDatabaseUrl({
      configuredDatabaseUrl: options.configuredDatabaseUrl,
      postgresComponents: options.postgresComponents,
    });
  }

  return resolveNonPostgresDatabaseUrl(options.provider, options.configuredDatabaseUrl);
}

function resolvePostgresDatabaseUrl(options: {
  configuredDatabaseUrl: string;
  postgresComponents: PostgresComponents;
}): string {
  if (options.configuredDatabaseUrl) {
    if (!isDatabaseUrlForProvider(options.configuredDatabaseUrl, "postgresql")) {
      throw new Error(
        "PostgreSQL provider requires `LOCAL_PLAYGROUND_DATABASE_URL`/`DATABASE_URL` to use a postgres:// or postgresql:// URL.",
      );
    }

    return applyPostgresQueryDefaults(new URL(options.configuredDatabaseUrl), {
      sslMode:
        options.postgresComponents.sslMode ||
        readPostgresSslModeFromUrl(options.configuredDatabaseUrl) ||
        DEFAULT_POSTGRES_SSLMODE,
      schema: options.postgresComponents.schema,
    }).toString();
  }

  const missingFields: string[] = [];
  if (!options.postgresComponents.host) {
    missingFields.push("LOCAL_PLAYGROUND_POSTGRES_HOST (or PGHOST)");
  }
  if (!options.postgresComponents.database) {
    missingFields.push("LOCAL_PLAYGROUND_POSTGRES_DATABASE (or PGDATABASE)");
  }
  if (!options.postgresComponents.user) {
    missingFields.push("LOCAL_PLAYGROUND_POSTGRES_USER (or PGUSER)");
  }
  if (missingFields.length > 0) {
    throw new Error(
      `PostgreSQL provider requires connection settings: ${missingFields.join(", ")}.`,
    );
  }

  const parsed = new URL("postgresql://localhost");
  parsed.hostname = options.postgresComponents.host;
  parsed.port = options.postgresComponents.port || DEFAULT_POSTGRES_PORT;
  parsed.username = options.postgresComponents.user;
  parsed.password = options.postgresComponents.password;
  parsed.pathname = `/${options.postgresComponents.database}`;

  return applyPostgresQueryDefaults(parsed, {
    sslMode: options.postgresComponents.sslMode || DEFAULT_POSTGRES_SSLMODE,
    schema: options.postgresComponents.schema,
  }).toString();
}

function resolveNonPostgresDatabaseUrl(
  provider: Exclude<PersistenceRelationalDatabaseProvider, "postgresql">,
  configuredDatabaseUrl: string,
): string {
  if (!configuredDatabaseUrl) {
    throw new Error(
      `${formatProviderLabel(provider)} provider requires \`LOCAL_PLAYGROUND_DATABASE_URL\`/\`DATABASE_URL\` to be set.`,
    );
  }
  if (!isDatabaseUrlForProvider(configuredDatabaseUrl, provider)) {
    throw new Error(
      `${formatProviderLabel(provider)} provider requires \`LOCAL_PLAYGROUND_DATABASE_URL\`/\`DATABASE_URL\` to use the ${provider}:// URL scheme.`,
    );
  }
  return configuredDatabaseUrl;
}

function applyPostgresQueryDefaults(
  parsedUrl: URL,
  options: {
    sslMode: string;
    schema: string;
  },
): URL {
  if (!parsedUrl.searchParams.get("sslmode") && options.sslMode) {
    parsedUrl.searchParams.set("sslmode", options.sslMode);
  }
  if (!parsedUrl.searchParams.get("schema") && options.schema) {
    parsedUrl.searchParams.set("schema", options.schema);
  }
  return parsedUrl;
}

function readPostgresSslModeFromUrl(databaseUrl: string): string {
  try {
    return readTrimmedEnvironmentValue(new URL(databaseUrl).searchParams.get("sslmode"));
  } catch {
    return "";
  }
}

function readConfiguredProvider(env: NodeJS.ProcessEnv): PersistenceDatabaseProvider | null {
  const configuredProvider = readTrimmedEnvironmentValue(
    env.LOCAL_PLAYGROUND_DATABASE_PROVIDER || env.DATABASE_PROVIDER,
  ).toLowerCase();
  if (!configuredProvider) {
    return null;
  }

  if (configuredProvider === "sqlite") {
    return "sqlite";
  }
  if (configuredProvider === "postgresql" || configuredProvider === "postgres") {
    return "postgresql";
  }
  if (configuredProvider === "mysql") {
    return "mysql";
  }
  if (configuredProvider === "cockroachdb" || configuredProvider === "cockroach") {
    return "cockroachdb";
  }
  if (configuredProvider === "sqlserver" || configuredProvider === "mssql") {
    return "sqlserver";
  }

  throw new Error(
    "`LOCAL_PLAYGROUND_DATABASE_PROVIDER` (or `DATABASE_PROVIDER`) must be one of `sqlite`, `postgresql`, `mysql`, `cockroachdb`, or `sqlserver`.",
  );
}

function readConfiguredDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_DATABASE_URL || env.DATABASE_URL);
}

function detectProviderFromDatabaseUrl(databaseUrl: string): PersistenceDatabaseProvider | null {
  const normalized = databaseUrl.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("file:")) {
    return "sqlite";
  }
  if (normalized.startsWith("postgresql://") || normalized.startsWith("postgres://")) {
    return "postgresql";
  }
  if (normalized.startsWith("mysql://")) {
    return "mysql";
  }
  if (normalized.startsWith("cockroachdb://")) {
    return "cockroachdb";
  }
  if (normalized.startsWith("sqlserver://")) {
    return "sqlserver";
  }
  return null;
}

function isDatabaseUrlForProvider(databaseUrl: string, provider: PersistenceDatabaseProvider): boolean {
  const normalized = databaseUrl.trim().toLowerCase();
  if (provider === "sqlite") {
    return normalized.startsWith("file:");
  }
  if (provider === "postgresql") {
    return normalized.startsWith("postgresql://") || normalized.startsWith("postgres://");
  }
  if (provider === "mysql") {
    return normalized.startsWith("mysql://");
  }
  if (provider === "cockroachdb") {
    return normalized.startsWith("cockroachdb://");
  }
  return normalized.startsWith("sqlserver://");
}

type PostgresComponents = {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  sslMode: string;
  schema: string;
  hasAnyValue: boolean;
};

function readPostgresComponents(env: NodeJS.ProcessEnv): PostgresComponents {
  const host = readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_POSTGRES_HOST || env.PGHOST);
  const port = readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_POSTGRES_PORT || env.PGPORT);
  const database = readTrimmedEnvironmentValue(
    env.LOCAL_PLAYGROUND_POSTGRES_DATABASE || env.PGDATABASE,
  );
  const user = readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_POSTGRES_USER || env.PGUSER);
  const password = readTrimmedEnvironmentValue(
    env.LOCAL_PLAYGROUND_POSTGRES_PASSWORD || env.PGPASSWORD,
  );
  const sslMode = readTrimmedEnvironmentValue(
    env.LOCAL_PLAYGROUND_POSTGRES_SSLMODE || env.PGSSLMODE,
  );
  const schema = readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_POSTGRES_SCHEMA);

  return {
    host,
    port,
    database,
    user,
    password,
    sslMode,
    schema,
    hasAnyValue: [host, port, database, user, password, sslMode, schema].some(
      (entry) => entry.length > 0,
    ),
  };
}

function resolveSqlAuthenticationConfig(
  provider: PersistenceRelationalDatabaseProvider,
  env: NodeJS.ProcessEnv,
): PersistenceSqlAuthenticationConfig {
  const method = readSqlAuthenticationMethod(env);
  if (provider === "sqlserver" && method !== "password") {
    throw new Error(
      "SQL Server currently supports only `password` authentication in Local Playground. Use `LOCAL_PLAYGROUND_DATABASE_AUTH_METHOD=password`.",
    );
  }

  if (method === "password") {
    return {
      method,
    };
  }

  if (method === "azure_identity") {
    return {
      method,
      clientId: readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_DATABASE_AZURE_IDENTITY_CLIENT_ID),
      scope:
        readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_DATABASE_AZURE_IDENTITY_SCOPE) ||
        resolveDefaultAzureIdentityScope(provider),
    };
  }

  const accessToken = readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_DATABASE_ACCESS_TOKEN);
  if (!accessToken) {
    throw new Error(
      "SQL access token authentication requires `LOCAL_PLAYGROUND_DATABASE_ACCESS_TOKEN`.",
    );
  }

  return {
    method,
    accessToken,
  };
}

function readSqlAuthenticationMethod(env: NodeJS.ProcessEnv): PersistenceSqlAuthenticationMethod {
  const configuredMethod = readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_DATABASE_AUTH_METHOD)
    .toLowerCase()
    .replaceAll("-", "_");
  if (!configuredMethod || configuredMethod === "password") {
    return "password";
  }
  if (configuredMethod === "azure_identity") {
    return "azure_identity";
  }
  if (configuredMethod === "access_token") {
    return "access_token";
  }

  throw new Error(
    "`LOCAL_PLAYGROUND_DATABASE_AUTH_METHOD` must be `password`, `azure_identity`, or `access_token`.",
  );
}

function resolveDefaultAzureIdentityScope(provider: PersistenceRelationalDatabaseProvider): string {
  if (provider === "sqlserver") {
    return DEFAULT_SQLSERVER_AZURE_IDENTITY_SCOPE;
  }
  return DEFAULT_OSS_RDBMS_AZURE_IDENTITY_SCOPE;
}

function formatProviderLabel(provider: PersistenceRelationalDatabaseProvider): string {
  if (provider === "postgresql") {
    return "PostgreSQL";
  }
  if (provider === "mysql") {
    return "MySQL";
  }
  if (provider === "cockroachdb") {
    return "CockroachDB";
  }
  return "SQL Server";
}

function buildSqlServerDatabaseUrlWithPassword(databaseUrl: string, password: string): string {
  if (!isDatabaseUrlForProvider(databaseUrl, "sqlserver")) {
    throw new Error("Database URL must use the sqlserver:// scheme to inject a password.");
  }

  const segments = databaseUrl.split(";");
  let hasPasswordSegment = false;
  const nextSegments = segments.map((segment, index) => {
    if (index === 0) {
      return segment;
    }

    const equalsIndex = segment.indexOf("=");
    if (equalsIndex <= 0) {
      return segment;
    }

    const key = segment.slice(0, equalsIndex).trim().toLowerCase();
    if (key !== "password") {
      return segment;
    }

    hasPasswordSegment = true;
    return `${segment.slice(0, equalsIndex)}=${password}`;
  });

  if (!hasPasswordSegment) {
    nextSegments.push(`password=${password}`);
  }

  return nextSegments.join(";");
}

function readTrimmedEnvironmentValue(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
