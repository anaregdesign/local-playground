/**
 * Server runtime module.
 */
import { PrismaClient } from "@prisma/client";
import {
  buildPostgresDatabaseUrlWithPassword,
  resolvePersistenceDatabaseConfig,
} from "~/lib/server/persistence/database-config";
import {
  resolvePostgresAzureIdentityDatabaseUrl,
  type PostgresAzureIdentityTokenState,
} from "~/lib/server/persistence/postgres-azure-identity";
import {
  ensureSqliteDatabaseParentDirectoryExists,
  ensureSqliteDatabaseSchema,
} from "~/lib/server/persistence/sqlite-schema";

const resolvedDatabaseConfig = resolvePersistenceDatabaseConfig();
const resolvedDatabaseProvider = resolvedDatabaseConfig.provider;
const resolvedDatabaseUrl = resolvedDatabaseConfig.databaseUrl;
const initialDatabaseUrl = resolveInitialDatabaseUrl();
process.env.DATABASE_PROVIDER = resolvedDatabaseProvider;
process.env.DATABASE_URL = initialDatabaseUrl;

const globalForPrisma = globalThis as typeof globalThis & {
  __localPlaygroundPrisma?: PrismaClient;
  __localPlaygroundPostgresAzureIdentityToken?: PostgresAzureIdentityTokenState;
};

export let prisma = createPrismaClient(initialDatabaseUrl);

const shouldCachePrismaOnGlobal =
  process.env.NODE_ENV !== "production" &&
  !(
    resolvedDatabaseProvider === "postgresql" &&
    resolvedDatabaseConfig.postgresAuthentication?.method === "azure_identity"
  );

if (shouldCachePrismaOnGlobal) {
  prisma = globalForPrisma.__localPlaygroundPrisma ?? prisma;
  globalForPrisma.__localPlaygroundPrisma = prisma;
}

let ensureSqliteDatabaseReadyPromise: Promise<void> | null = null;
let ensurePostgresSchemaReadyPromise: Promise<void> | null = null;
let refreshPostgresAzureIdentityTokenPromise: Promise<void> | null = null;
let postgresAzureIdentityToken =
  process.env.NODE_ENV !== "production" &&
  resolvedDatabaseProvider === "postgresql" &&
  resolvedDatabaseConfig.postgresAuthentication?.method === "azure_identity"
    ? (globalForPrisma.__localPlaygroundPostgresAzureIdentityToken ?? null)
    : null;

export async function ensurePersistenceDatabaseReady(): Promise<void> {
  if (resolvedDatabaseProvider === "postgresql") {
    if (resolvedDatabaseConfig.postgresAuthentication?.method === "azure_identity") {
      await ensurePostgresAzureIdentityToken();
    }
    if (!ensurePostgresSchemaReadyPromise) {
      ensurePostgresSchemaReadyPromise = (async () => {
        await prisma.$queryRawUnsafe("SELECT 1");
      })().catch((error) => {
        ensurePostgresSchemaReadyPromise = null;
        throw error;
      });
    }
    await ensurePostgresSchemaReadyPromise;
    return;
  }

  if (!ensureSqliteDatabaseReadyPromise) {
    ensureSqliteDatabaseReadyPromise = (async () => {
      await ensureSqliteDatabaseParentDirectoryExists(resolvedDatabaseUrl);
      await ensureSqliteDatabaseSchema(prisma);
    })().catch((error) => {
      ensureSqliteDatabaseReadyPromise = null;
      throw error;
    });
  }

  await ensureSqliteDatabaseReadyPromise;
}

function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
}

function resolveInitialDatabaseUrl(): string {
  if (resolvedDatabaseProvider !== "postgresql") {
    return resolvedDatabaseUrl;
  }
  if (resolvedDatabaseConfig.postgresAuthentication?.method !== "access_token") {
    return resolvedDatabaseUrl;
  }
  return buildPostgresDatabaseUrlWithPassword(
    resolvedDatabaseUrl,
    resolvedDatabaseConfig.postgresAuthentication.accessToken,
  );
}

async function ensurePostgresAzureIdentityToken(): Promise<void> {
  if (resolvedDatabaseProvider !== "postgresql") {
    return;
  }

  const postgresAuthentication = resolvedDatabaseConfig.postgresAuthentication;
  if (!postgresAuthentication || postgresAuthentication.method !== "azure_identity") {
    return;
  }

  const tokenRefreshThresholdMs = 2 * 60 * 1000;
  if (postgresAzureIdentityToken) {
    const remainingMs = postgresAzureIdentityToken.expiresOnTimestamp - Date.now();
    if (remainingMs > tokenRefreshThresholdMs) {
      return;
    }
  }

  if (!refreshPostgresAzureIdentityTokenPromise) {
    refreshPostgresAzureIdentityTokenPromise = (async () => {
      const nextCredential = await resolvePostgresAzureIdentityDatabaseUrl({
        databaseUrl: resolvedDatabaseUrl,
        azureIdentityClientId: postgresAuthentication.clientId,
        scope: postgresAuthentication.scope,
      });
      process.env.DATABASE_URL = nextCredential.databaseUrl;

      const nextPrisma = createPrismaClient(nextCredential.databaseUrl);
      await nextPrisma.$queryRawUnsafe("SELECT 1");

      const previousPrisma = prisma;
      prisma = nextPrisma;
      if (shouldCachePrismaOnGlobal) {
        globalForPrisma.__localPlaygroundPrisma = prisma;
      }

      postgresAzureIdentityToken = nextCredential.tokenState;
      if (process.env.NODE_ENV !== "production") {
        globalForPrisma.__localPlaygroundPostgresAzureIdentityToken =
          postgresAzureIdentityToken;
      }

      if (previousPrisma !== nextPrisma) {
        void previousPrisma.$disconnect().catch(() => undefined);
      }
    })().finally(() => {
      refreshPostgresAzureIdentityTokenPromise = null;
    });
  }

  await refreshPostgresAzureIdentityTokenPromise;
}
