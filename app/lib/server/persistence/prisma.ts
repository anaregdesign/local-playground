/**
 * Server runtime module.
 */
import { PrismaClient } from "@prisma/client";
import {
  buildSqlDatabaseUrlWithPassword,
  resolvePersistenceDatabaseConfig,
} from "~/lib/server/persistence/database-config";
import {
  resolveSqlAzureIdentityDatabaseUrl,
  type SqlAzureIdentityTokenState,
} from "~/lib/server/persistence/sql-azure-identity";
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
  __localPlaygroundSqlAzureIdentityToken?: SqlAzureIdentityTokenState;
};

export let prisma = createPrismaClient(initialDatabaseUrl);

const shouldCachePrismaOnGlobal =
  process.env.NODE_ENV !== "production" &&
  !(
    resolvedDatabaseProvider !== "sqlite" &&
    resolvedDatabaseConfig.sqlAuthentication?.method === "azure_identity"
  );

if (shouldCachePrismaOnGlobal) {
  prisma = globalForPrisma.__localPlaygroundPrisma ?? prisma;
  globalForPrisma.__localPlaygroundPrisma = prisma;
}

let ensureSqliteDatabaseReadyPromise: Promise<void> | null = null;
let ensureRelationalDatabaseReadyPromise: Promise<void> | null = null;
let refreshSqlAzureIdentityTokenPromise: Promise<void> | null = null;
let sqlAzureIdentityToken =
  process.env.NODE_ENV !== "production" &&
  resolvedDatabaseProvider !== "sqlite" &&
  resolvedDatabaseConfig.sqlAuthentication?.method === "azure_identity"
    ? (globalForPrisma.__localPlaygroundSqlAzureIdentityToken ?? null)
    : null;

export async function ensurePersistenceDatabaseReady(): Promise<void> {
  if (resolvedDatabaseProvider !== "sqlite") {
    if (resolvedDatabaseConfig.sqlAuthentication?.method === "azure_identity") {
      await ensureSqlAzureIdentityToken();
    }
    if (!ensureRelationalDatabaseReadyPromise) {
      ensureRelationalDatabaseReadyPromise = (async () => {
        await prisma.$queryRawUnsafe("SELECT 1");
      })().catch((error) => {
        ensureRelationalDatabaseReadyPromise = null;
        throw error;
      });
    }
    await ensureRelationalDatabaseReadyPromise;
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
  if (resolvedDatabaseProvider === "sqlite") {
    return resolvedDatabaseUrl;
  }

  if (resolvedDatabaseConfig.sqlAuthentication?.method !== "access_token") {
    return resolvedDatabaseUrl;
  }

  return buildSqlDatabaseUrlWithPassword({
    provider: resolvedDatabaseProvider,
    databaseUrl: resolvedDatabaseUrl,
    password: resolvedDatabaseConfig.sqlAuthentication.accessToken,
  });
}

async function ensureSqlAzureIdentityToken(): Promise<void> {
  if (resolvedDatabaseProvider === "sqlite") {
    return;
  }

  const sqlAuthentication = resolvedDatabaseConfig.sqlAuthentication;
  if (!sqlAuthentication || sqlAuthentication.method !== "azure_identity") {
    return;
  }

  const tokenRefreshThresholdMs = 2 * 60 * 1000;
  if (sqlAzureIdentityToken) {
    const remainingMs = sqlAzureIdentityToken.expiresOnTimestamp - Date.now();
    if (remainingMs > tokenRefreshThresholdMs) {
      return;
    }
  }

  if (!refreshSqlAzureIdentityTokenPromise) {
    refreshSqlAzureIdentityTokenPromise = (async () => {
      const nextCredential = await resolveSqlAzureIdentityDatabaseUrl({
        provider: resolvedDatabaseProvider,
        databaseUrl: resolvedDatabaseUrl,
        azureIdentityClientId: sqlAuthentication.clientId,
        scope: sqlAuthentication.scope,
      });
      process.env.DATABASE_URL = nextCredential.databaseUrl;

      const nextPrisma = createPrismaClient(nextCredential.databaseUrl);
      await nextPrisma.$queryRawUnsafe("SELECT 1");

      const previousPrisma = prisma;
      prisma = nextPrisma;
      if (shouldCachePrismaOnGlobal) {
        globalForPrisma.__localPlaygroundPrisma = prisma;
      }

      sqlAzureIdentityToken = nextCredential.tokenState;
      if (process.env.NODE_ENV !== "production") {
        globalForPrisma.__localPlaygroundSqlAzureIdentityToken = sqlAzureIdentityToken;
      }

      if (previousPrisma !== nextPrisma) {
        void previousPrisma.$disconnect().catch(() => undefined);
      }
    })().finally(() => {
      refreshSqlAzureIdentityTokenPromise = null;
    });
  }

  await refreshSqlAzureIdentityTokenPromise;
}
