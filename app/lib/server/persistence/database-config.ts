/**
 * Persistence database configuration helpers.
 */
import { resolveFoundryDatabaseUrl } from "~/lib/foundry/config";

export type PersistenceDatabaseProvider = "sqlite" | "postgresql";

export type PersistencePostgresAuthenticationMethod =
  | "password"
  | "azure_identity"
  | "access_token";

export type PersistencePostgresAuthenticationConfig =
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
  postgresAuthentication: PersistencePostgresAuthenticationConfig | null;
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
const DEFAULT_POSTGRES_AZURE_IDENTITY_SCOPE =
  "https://ossrdbms-aad.database.windows.net/.default";

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
      postgresAuthentication: null,
    };
  }

  const databaseUrl = resolvePostgresDatabaseUrl({
    configuredDatabaseUrl,
    postgresComponents,
  });
  const postgresAuthentication = resolvePostgresAuthenticationConfig(env);

  return {
    provider,
    databaseUrl,
    postgresAuthentication,
  };
}

export function buildPostgresDatabaseUrlWithPassword(
  databaseUrl: string,
  password: string,
): string {
  const normalizedUrl = databaseUrl.trim();
  if (!isPostgresDatabaseUrl(normalizedUrl)) {
    throw new Error("PostgreSQL database URL is required to inject a password.");
  }

  const parsed = new URL(normalizedUrl);
  parsed.password = password;
  return parsed.toString();
}

function resolvePostgresDatabaseUrl(options: {
  configuredDatabaseUrl: string;
  postgresComponents: PostgresComponents;
}): string {
  if (options.configuredDatabaseUrl) {
    if (!isPostgresDatabaseUrl(options.configuredDatabaseUrl)) {
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

  throw new Error(
    "`LOCAL_PLAYGROUND_DATABASE_PROVIDER` (or `DATABASE_PROVIDER`) must be `sqlite` or `postgresql`.",
  );
}

function readConfiguredDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return readTrimmedEnvironmentValue(
    env.LOCAL_PLAYGROUND_DATABASE_URL || env.DATABASE_URL,
  );
}

function detectProviderFromDatabaseUrl(databaseUrl: string): PersistenceDatabaseProvider | null {
  if (!databaseUrl) {
    return null;
  }
  if (databaseUrl.startsWith("file:")) {
    return "sqlite";
  }
  if (isPostgresDatabaseUrl(databaseUrl)) {
    return "postgresql";
  }
  return null;
}

function isPostgresDatabaseUrl(databaseUrl: string): boolean {
  const normalized = databaseUrl.toLowerCase();
  return normalized.startsWith("postgresql://") || normalized.startsWith("postgres://");
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

function resolvePostgresAuthenticationConfig(
  env: NodeJS.ProcessEnv,
): PersistencePostgresAuthenticationConfig {
  const method = readPostgresAuthenticationMethod(env);
  if (method === "password") {
    return {
      method,
    };
  }

  if (method === "azure_identity") {
    return {
      method,
      clientId: readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_POSTGRES_AZURE_IDENTITY_CLIENT_ID),
      scope:
        readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_POSTGRES_AZURE_IDENTITY_SCOPE) ||
        DEFAULT_POSTGRES_AZURE_IDENTITY_SCOPE,
    };
  }

  const accessToken = readTrimmedEnvironmentValue(env.LOCAL_PLAYGROUND_POSTGRES_ACCESS_TOKEN);
  if (!accessToken) {
    throw new Error(
      "PostgreSQL access token authentication requires `LOCAL_PLAYGROUND_POSTGRES_ACCESS_TOKEN`.",
    );
  }

  return {
    method,
    accessToken,
  };
}

function readPostgresAuthenticationMethod(
  env: NodeJS.ProcessEnv,
): PersistencePostgresAuthenticationMethod {
  const configuredMethod = readTrimmedEnvironmentValue(
    env.LOCAL_PLAYGROUND_POSTGRES_AUTH_METHOD,
  )
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
    "`LOCAL_PLAYGROUND_POSTGRES_AUTH_METHOD` must be `password`, `azure_identity`, or `access_token`.",
  );
}

function readTrimmedEnvironmentValue(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
