/**
 * Server runtime module.
 */
import { PrismaClient } from "@prisma/client";
import { resolvePersistenceDatabaseConfig } from "~/lib/server/persistence/database-config";
import {
  resolvePostgresManagedIdentityDatabaseUrl,
  type ManagedIdentityTokenState,
} from "~/lib/server/persistence/postgres-managed-identity";
import {
  ensureSqliteDatabaseParentDirectoryExists,
  ensureSqliteDatabaseSchema,
} from "~/lib/server/persistence/sqlite-schema";

const resolvedDatabaseConfig = resolvePersistenceDatabaseConfig();
const resolvedDatabaseProvider = resolvedDatabaseConfig.provider;
const resolvedDatabaseUrl = resolvedDatabaseConfig.databaseUrl;
process.env.DATABASE_PROVIDER = resolvedDatabaseProvider;
process.env.DATABASE_URL = resolvedDatabaseUrl;

const globalForPrisma = globalThis as typeof globalThis & {
  __localPlaygroundPrisma?: PrismaClient;
  __localPlaygroundManagedIdentityToken?: ManagedIdentityTokenState;
};

export let prisma = createPrismaClient(resolvedDatabaseUrl);

const shouldCachePrismaOnGlobal =
  process.env.NODE_ENV !== "production" &&
  !(resolvedDatabaseProvider === "postgresql" && resolvedDatabaseConfig.managedIdentity.enabled);

if (shouldCachePrismaOnGlobal) {
  prisma = globalForPrisma.__localPlaygroundPrisma ?? prisma;
  globalForPrisma.__localPlaygroundPrisma = prisma;
}

let ensureSqliteDatabaseReadyPromise: Promise<void> | null = null;
let ensurePostgresSchemaReadyPromise: Promise<void> | null = null;
let refreshPostgresManagedIdentityTokenPromise: Promise<void> | null = null;
let managedIdentityToken =
  process.env.NODE_ENV !== "production" && resolvedDatabaseConfig.managedIdentity.enabled
    ? (globalForPrisma.__localPlaygroundManagedIdentityToken ?? null)
    : null;

export async function ensurePersistenceDatabaseReady(): Promise<void> {
  if (resolvedDatabaseProvider === "postgresql") {
    if (resolvedDatabaseConfig.managedIdentity.enabled) {
      await ensurePostgresManagedIdentityToken();
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

async function ensurePostgresManagedIdentityToken(): Promise<void> {
  if (!resolvedDatabaseConfig.managedIdentity.enabled) {
    return;
  }

  const tokenRefreshThresholdMs = 2 * 60 * 1000;
  if (managedIdentityToken) {
    const remainingMs = managedIdentityToken.expiresOnTimestamp - Date.now();
    if (remainingMs > tokenRefreshThresholdMs) {
      return;
    }
  }

  if (!refreshPostgresManagedIdentityTokenPromise) {
    refreshPostgresManagedIdentityTokenPromise = (async () => {
      const nextCredential = await resolvePostgresManagedIdentityDatabaseUrl({
        databaseUrl: resolvedDatabaseUrl,
        managedIdentityClientId: resolvedDatabaseConfig.managedIdentity.clientId,
        scope: resolvedDatabaseConfig.managedIdentity.scope,
      });
      process.env.DATABASE_URL = nextCredential.databaseUrl;

      const nextPrisma = createPrismaClient(nextCredential.databaseUrl);
      await nextPrisma.$queryRawUnsafe("SELECT 1");

      const previousPrisma = prisma;
      prisma = nextPrisma;
      if (shouldCachePrismaOnGlobal) {
        globalForPrisma.__localPlaygroundPrisma = prisma;
      }

      managedIdentityToken = nextCredential.tokenState;
      if (process.env.NODE_ENV !== "production") {
        globalForPrisma.__localPlaygroundManagedIdentityToken = managedIdentityToken;
      }

      if (previousPrisma !== nextPrisma) {
        void previousPrisma.$disconnect().catch(() => undefined);
      }
    })().finally(() => {
      refreshPostgresManagedIdentityTokenPromise = null;
    });
  }

  await refreshPostgresManagedIdentityTokenPromise;
}
