/**
 * Server runtime module.
 */
import nodeFsPromises from "node:fs/promises";
import path from "node:path";
import nodeUrl from "node:url";
import { DefaultAzureCredential } from "@azure/identity";
import { PrismaClient } from "@prisma/client";
import {
  buildPostgresDatabaseUrlWithPassword,
  resolvePersistenceDatabaseConfig,
} from "~/lib/server/persistence/database-config";

const resolvedDatabaseConfig = resolvePersistenceDatabaseConfig();
const resolvedDatabaseProvider = resolvedDatabaseConfig.provider;
const resolvedDatabaseUrl = resolvedDatabaseConfig.databaseUrl;
process.env.DATABASE_PROVIDER = resolvedDatabaseProvider;
process.env.DATABASE_URL = resolvedDatabaseUrl;

type ManagedIdentityTokenState = {
  token: string;
  expiresOnTimestamp: number;
};

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
      await ensureDatabaseParentDirectoryExists(resolvedDatabaseUrl);
      await ensureDatabaseSchema();
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
      const credential = new DefaultAzureCredential({
        managedIdentityClientId: resolvedDatabaseConfig.managedIdentity.clientId || undefined,
      });
      const accessToken = await credential.getToken(
        resolvedDatabaseConfig.managedIdentity.scope,
      );
      if (!accessToken?.token) {
        throw new Error(
          "DefaultAzureCredential did not return a PostgreSQL access token for Managed Identity authentication.",
        );
      }

      const databaseUrlWithToken = buildPostgresDatabaseUrlWithPassword(
        resolvedDatabaseUrl,
        accessToken.token,
      );
      process.env.DATABASE_URL = databaseUrlWithToken;

      const nextPrisma = createPrismaClient(databaseUrlWithToken);
      await nextPrisma.$queryRawUnsafe("SELECT 1");

      const previousPrisma = prisma;
      prisma = nextPrisma;
      if (shouldCachePrismaOnGlobal) {
        globalForPrisma.__localPlaygroundPrisma = prisma;
      }

      managedIdentityToken = {
        token: accessToken.token,
        expiresOnTimestamp: accessToken.expiresOnTimestamp,
      };
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

async function ensureDatabaseParentDirectoryExists(databaseUrl: string): Promise<void> {
  const databaseFilePath = resolveSqliteDatabaseFilePath(databaseUrl);
  if (!databaseFilePath) {
    return;
  }

  await nodeFsPromises.mkdir(path.dirname(databaseFilePath), { recursive: true });
}

function resolveSqliteDatabaseFilePath(databaseUrl: string): string | null {
  if (!databaseUrl.startsWith("file:")) {
    return null;
  }

  if (
    databaseUrl === "file:memory" ||
    databaseUrl === "file::memory:" ||
    /[?&]mode=memory(?:&|$)/i.test(databaseUrl)
  ) {
    return null;
  }

  try {
    if (databaseUrl.startsWith("file://")) {
      return nodeUrl.fileURLToPath(databaseUrl);
    }
  } catch {
    return null;
  }

  const withoutPrefix = databaseUrl.slice("file:".length);
  const queryIndex = withoutPrefix.indexOf("?");
  const rawPath = (queryIndex >= 0 ? withoutPrefix.slice(0, queryIndex) : withoutPrefix).trim();
  if (!rawPath || rawPath === ":memory:") {
    return null;
  }

  const decodedPath = decodeURIComponent(rawPath);
  if (process.platform === "win32") {
    const windowsPath = normalizeWindowsAbsolutePath(decodedPath);
    if (path.win32.isAbsolute(windowsPath)) {
      return windowsPath;
    }
  }

  if (path.isAbsolute(decodedPath)) {
    return decodedPath;
  }

  return path.resolve(decodedPath);
}

function normalizeWindowsAbsolutePath(filePath: string): string {
  const withBackslashes = filePath.replaceAll("/", "\\");
  const driveNormalized = withBackslashes.replace(/^\\([A-Za-z]:\\)/, "$1");
  return path.win32.normalize(driveNormalized);
}

async function ensureDatabaseSchema(): Promise<void> {
  await ensureUserSchema();
  await ensureAzureSelectionSchema();
  await ensureMcpServerProfileSchema();
  await ensureSkillProfileSchema();
  await ensureThreadSchema();
  await ensureRuntimeEventLogSchema();
  await ensureSkillRegistryCacheSchema();
}

async function ensureUserSchema(): Promise<void> {
  await createUserTable();
  await ensureTableColumn("WorkspaceUser", "lastUsedAt", "TEXT NOT NULL DEFAULT ''");
}

async function createUserTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WorkspaceUser" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "tenantId" TEXT NOT NULL,
      "principalId" TEXT NOT NULL,
      "lastUsedAt" TEXT NOT NULL DEFAULT ''
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceUser_tenantId_principalId_key"
    ON "WorkspaceUser" ("tenantId", "principalId")
  `);
}

async function ensureAzureSelectionSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AzureSelectionPreference" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "userId" INTEGER NOT NULL UNIQUE,
      "projectId" TEXT NOT NULL DEFAULT '',
      "deploymentName" TEXT NOT NULL DEFAULT '',
      "utilityProjectId" TEXT NOT NULL DEFAULT '',
      "utilityDeploymentName" TEXT NOT NULL DEFAULT '',
      "utilityReasoningEffort" TEXT NOT NULL DEFAULT 'high',
      FOREIGN KEY ("userId") REFERENCES "WorkspaceUser" ("id") ON DELETE CASCADE
    )
  `);

  await ensureTableColumn(
    "AzureSelectionPreference",
    "utilityProjectId",
    "TEXT NOT NULL DEFAULT ''",
  );
  await ensureTableColumn(
    "AzureSelectionPreference",
    "utilityDeploymentName",
    "TEXT NOT NULL DEFAULT ''",
  );
  await ensureTableColumn(
    "AzureSelectionPreference",
    "utilityReasoningEffort",
    "TEXT NOT NULL DEFAULT 'high'",
  );
}

async function ensureTableColumn(
  tableName: string,
  columnName: string,
  columnDefinition: string,
): Promise<void> {
  const columns = await readTableColumns(tableName);
  if (columns.has(columnName)) {
    return;
  }

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnDefinition}`,
  );
}

async function readTableColumns(tableName: string): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name?: string | null }>>(
    `PRAGMA table_info("${tableName}")`,
  );

  const columns = new Set<string>();
  for (const row of rows) {
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (name) {
      columns.add(name);
    }
  }

  return columns;
}

async function renameTableColumnIfExists(
  tableName: string,
  fromColumnName: string,
  toColumnName: string,
): Promise<void> {
  const columns = await readTableColumns(tableName);
  if (columns.has(toColumnName) || !columns.has(fromColumnName)) {
    return;
  }

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${tableName}" RENAME COLUMN "${fromColumnName}" TO "${toColumnName}"`,
  );
}

async function ensureMcpServerProfileSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WorkspaceMcpServerProfile" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" INTEGER NOT NULL,
      "profileOrder" INTEGER NOT NULL,
      "connectOnThreadCreate" BOOLEAN NOT NULL DEFAULT false,
      "configKey" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "transport" TEXT NOT NULL,
      "url" TEXT,
      "headersJson" TEXT,
      "useAzureAuth" BOOLEAN NOT NULL DEFAULT false,
      "azureAuthScope" TEXT,
      "timeoutSeconds" INTEGER,
      "command" TEXT,
      "argsJson" TEXT,
      "cwd" TEXT,
      "envJson" TEXT,
      FOREIGN KEY ("userId") REFERENCES "WorkspaceUser" ("id") ON DELETE CASCADE
    )
  `);

  await renameTableColumnIfExists(
    "WorkspaceMcpServerProfile",
    "sortOrder",
    "profileOrder",
  );
  await ensureTableColumn(
    "WorkspaceMcpServerProfile",
    "profileOrder",
    "INTEGER NOT NULL DEFAULT 0",
  );
  const hadConnectOnThreadCreateColumn = (
    await readTableColumns("WorkspaceMcpServerProfile")
  ).has("connectOnThreadCreate");
  await ensureTableColumn(
    "WorkspaceMcpServerProfile",
    "connectOnThreadCreate",
    "BOOLEAN NOT NULL DEFAULT false",
  );
  if (!hadConnectOnThreadCreateColumn) {
    await prisma.$executeRawUnsafe(`
      UPDATE "WorkspaceMcpServerProfile"
      SET "connectOnThreadCreate" = true
      WHERE "transport" = 'stdio'
        AND "command" = 'npx'
        AND "argsJson" = '["-y","@modelcontextprotocol/server-filesystem","."]'
    `);

    await prisma.$executeRawUnsafe(`
      UPDATE "WorkspaceMcpServerProfile"
      SET "connectOnThreadCreate" = true
      WHERE "transport" IN ('streamable_http', 'sse')
        AND (
          LOWER(COALESCE("url", '')) IN ('/mcp/system', '/mcp/system/')
          OR LOWER(COALESCE("name", '')) = 'system'
        )
    `);
  }

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceMcpServerProfile_userId_configKey_key"
    ON "WorkspaceMcpServerProfile" ("userId", "configKey")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WorkspaceMcpServerProfile_userId_profileOrder_idx"
    ON "WorkspaceMcpServerProfile" ("userId", "profileOrder")
  `);
}

async function ensureSkillProfileSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WorkspaceSkillRegistryProfile" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "userId" INTEGER NOT NULL,
      "registryId" TEXT NOT NULL,
      "registryLabel" TEXT NOT NULL,
      "registryDescription" TEXT NOT NULL,
      "repository" TEXT NOT NULL,
      "repositoryUrl" TEXT NOT NULL,
      "sourcePath" TEXT NOT NULL,
      "installDirectoryName" TEXT NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "WorkspaceUser" ("id") ON DELETE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceSkillRegistryProfile_userId_registryId_key"
    ON "WorkspaceSkillRegistryProfile" ("userId", "registryId")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WorkspaceSkillRegistryProfile_userId_registryId_idx"
    ON "WorkspaceSkillRegistryProfile" ("userId", "registryId")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WorkspaceSkillProfile" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "userId" INTEGER NOT NULL,
      "registryProfileId" INTEGER,
      "name" TEXT NOT NULL,
      "location" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "WorkspaceUser" ("id") ON DELETE CASCADE,
      FOREIGN KEY ("registryProfileId") REFERENCES "WorkspaceSkillRegistryProfile" ("id") ON DELETE SET NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceSkillProfile_userId_location_key"
    ON "WorkspaceSkillProfile" ("userId", "location")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WorkspaceSkillProfile_userId_name_idx"
    ON "WorkspaceSkillProfile" ("userId", "name")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WorkspaceSkillProfile_registryProfileId_idx"
    ON "WorkspaceSkillProfile" ("registryProfileId")
  `);
}

async function ensureThreadSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Thread" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      "deletedAt" TEXT,
      "reasoningEffort" TEXT NOT NULL DEFAULT 'none',
      "webSearchEnabled" BOOLEAN NOT NULL DEFAULT false,
      "threadEnvironmentJson" TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY ("userId") REFERENCES "WorkspaceUser" ("id") ON DELETE CASCADE
    )
  `);

  await ensureTableColumn("Thread", "deletedAt", "TEXT");
  await ensureTableColumn(
    "Thread",
    "reasoningEffort",
    "TEXT NOT NULL DEFAULT 'none'",
  );
  await ensureTableColumn(
    "Thread",
    "webSearchEnabled",
    "BOOLEAN NOT NULL DEFAULT false",
  );
  await ensureTableColumn(
    "Thread",
    "threadEnvironmentJson",
    "TEXT NOT NULL DEFAULT '{}'",
  );

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Thread_userId_updatedAt_idx"
    ON "Thread" ("userId", "updatedAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ThreadInstruction" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "threadId" TEXT NOT NULL UNIQUE,
      "content" TEXT NOT NULL,
      FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ThreadMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "threadId" TEXT NOT NULL,
      "conversationOrder" INTEGER NOT NULL,
      "role" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "turnId" TEXT NOT NULL,
      "attachmentsJson" TEXT NOT NULL,
      FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE
    )
  `);

  await renameTableColumnIfExists(
    "ThreadMessage",
    "sortOrder",
    "conversationOrder",
  );
  await renameTableColumnIfExists(
    "ThreadMessage",
    "threadOrder",
    "conversationOrder",
  );
  await ensureTableColumn(
    "ThreadMessage",
    "conversationOrder",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await ensureTableColumn(
    "ThreadMessage",
    "createdAt",
    "TEXT NOT NULL DEFAULT ''",
  );

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadMessage_threadId_conversationOrder_idx"
    ON "ThreadMessage" ("threadId", "conversationOrder")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ThreadMessageSkillActivation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "messageId" TEXT NOT NULL,
      "selectionOrder" INTEGER NOT NULL,
      "skillProfileId" INTEGER NOT NULL,
      FOREIGN KEY ("messageId") REFERENCES "ThreadMessage" ("id") ON DELETE CASCADE,
      FOREIGN KEY ("skillProfileId") REFERENCES "WorkspaceSkillProfile" ("id") ON DELETE CASCADE
    )
  `);

  await renameTableColumnIfExists(
    "ThreadMessageSkillActivation",
    "sortOrder",
    "selectionOrder",
  );
  await ensureTableColumn(
    "ThreadMessageSkillActivation",
    "selectionOrder",
    "INTEGER NOT NULL DEFAULT 0",
  );

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadMessageSkillActivation_messageId_selectionOrder_idx"
    ON "ThreadMessageSkillActivation" ("messageId", "selectionOrder")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadMessageSkillActivation_skillProfileId_idx"
    ON "ThreadMessageSkillActivation" ("skillProfileId")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ThreadMcpConnection" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "threadId" TEXT NOT NULL,
      "selectionOrder" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "transport" TEXT NOT NULL,
      "url" TEXT,
      "headersJson" TEXT,
      "useAzureAuth" BOOLEAN NOT NULL DEFAULT false,
      "azureAuthScope" TEXT,
      "timeoutSeconds" INTEGER,
      "command" TEXT,
      "argsJson" TEXT,
      "cwd" TEXT,
      "envJson" TEXT,
      FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE
    )
  `);

  await renameTableColumnIfExists(
    "ThreadMcpConnection",
    "sortOrder",
    "selectionOrder",
  );
  await renameTableColumnIfExists(
    "ThreadMcpConnection",
    "threadOrder",
    "selectionOrder",
  );
  await ensureTableColumn(
    "ThreadMcpConnection",
    "selectionOrder",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadMcpConnection_threadId_selectionOrder_idx"
    ON "ThreadMcpConnection" ("threadId", "selectionOrder")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ThreadOperationLog" (
      "rowId" TEXT NOT NULL PRIMARY KEY,
      "sourceRpcId" TEXT NOT NULL,
      "threadId" TEXT NOT NULL,
      "conversationOrder" INTEGER NOT NULL,
      "sequence" INTEGER NOT NULL,
      "operationType" TEXT NOT NULL DEFAULT 'mcp',
      "serverName" TEXT NOT NULL,
      "method" TEXT NOT NULL,
      "startedAt" TEXT NOT NULL,
      "completedAt" TEXT NOT NULL,
      "requestJson" TEXT NOT NULL,
      "responseJson" TEXT NOT NULL,
      "isError" BOOLEAN NOT NULL DEFAULT false,
      "turnId" TEXT NOT NULL,
      FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE
    )
  `);

  await ensureTableColumn(
    "ThreadOperationLog",
    "rowId",
    "TEXT NOT NULL DEFAULT ''",
  );

  await ensureTableColumn(
    "ThreadOperationLog",
    "sourceRpcId",
    "TEXT NOT NULL DEFAULT ''",
  );

  await renameTableColumnIfExists(
    "ThreadOperationLog",
    "persistedOrder",
    "conversationOrder",
  );
  await renameTableColumnIfExists(
    "ThreadOperationLog",
    "threadOrder",
    "conversationOrder",
  );
  await ensureTableColumn(
    "ThreadOperationLog",
    "conversationOrder",
    "INTEGER NOT NULL DEFAULT 0",
  );

  await ensureTableColumn(
    "ThreadOperationLog",
    "operationType",
    "TEXT NOT NULL DEFAULT 'mcp'",
  );

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadOperationLog_threadId_conversationOrder_idx"
    ON "ThreadOperationLog" ("threadId", "conversationOrder")
  `);

  await recreateThreadSkillActivationTableIfLegacySchema();

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ThreadSkillActivation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "threadId" TEXT NOT NULL,
      "selectionOrder" INTEGER NOT NULL,
      "skillProfileId" INTEGER NOT NULL,
      FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE,
      FOREIGN KEY ("skillProfileId") REFERENCES "WorkspaceSkillProfile" ("id") ON DELETE CASCADE
    )
  `);

  await renameTableColumnIfExists(
    "ThreadSkillActivation",
    "sortOrder",
    "selectionOrder",
  );
  await renameTableColumnIfExists(
    "ThreadSkillActivation",
    "threadOrder",
    "selectionOrder",
  );
  await ensureTableColumn(
    "ThreadSkillActivation",
    "selectionOrder",
    "INTEGER NOT NULL DEFAULT 0",
  );

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadSkillActivation_threadId_selectionOrder_idx"
    ON "ThreadSkillActivation" ("threadId", "selectionOrder")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadSkillActivation_skillProfileId_idx"
    ON "ThreadSkillActivation" ("skillProfileId")
  `);
}

async function recreateThreadSkillActivationTableIfLegacySchema(): Promise<void> {
  const columns = await readTableColumns("ThreadSkillActivation");
  if (columns.size === 0) {
    return;
  }

  const usesLegacyColumns = columns.has("skillName") || columns.has("skillLocation");
  const missingCurrentColumn = !columns.has("skillProfileId");
  if (!usesLegacyColumns && !missingCurrentColumn) {
    return;
  }

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ThreadSkillActivation"`);
}

async function ensureRuntimeEventLogSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RuntimeEventLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "createdAt" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      "level" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "eventName" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "errorName" TEXT,
      "location" TEXT,
      "action" TEXT,
      "statusCode" INTEGER,
      "httpMethod" TEXT,
      "httpPath" TEXT,
      "threadId" TEXT,
      "tenantId" TEXT,
      "principalId" TEXT,
      "userId" INTEGER,
      "stack" TEXT,
      "contextJson" TEXT NOT NULL
    )
  `);

  await ensureTableColumn(
    "RuntimeEventLog",
    "contextJson",
    "TEXT NOT NULL DEFAULT '{}'",
  );

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "RuntimeEventLog_createdAt_idx"
    ON "RuntimeEventLog" ("createdAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "RuntimeEventLog_level_createdAt_idx"
    ON "RuntimeEventLog" ("level", "createdAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "RuntimeEventLog_source_category_createdAt_idx"
    ON "RuntimeEventLog" ("source", "category", "createdAt")
  `);
}

async function ensureSkillRegistryCacheSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SkillRegistryCache" (
      "cacheKey" TEXT NOT NULL PRIMARY KEY,
      "payloadJson" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      "expiresAt" TEXT NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "SkillRegistryCache_expiresAt_idx"
    ON "SkillRegistryCache" ("expiresAt")
  `);
}
