/**
 * Server runtime module.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveFoundryDatabaseUrl } from "~/lib/foundry/config";

const resolvedDatabaseUrl = resolveDatabaseUrl();
process.env.DATABASE_URL = resolvedDatabaseUrl;

const globalForPrisma = globalThis as typeof globalThis & {
  __localPlaygroundPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__localPlaygroundPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: resolvedDatabaseUrl,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__localPlaygroundPrisma = prisma;
}

let ensureDatabaseReadyPromise: Promise<void> | null = null;

export async function ensurePersistenceDatabaseReady(): Promise<void> {
  if (!ensureDatabaseReadyPromise) {
    ensureDatabaseReadyPromise = (async () => {
      await ensureDatabaseParentDirectoryExists(resolvedDatabaseUrl);
      await ensureDatabaseSchema();
    })().catch((error) => {
      ensureDatabaseReadyPromise = null;
      throw error;
    });
  }

  await ensureDatabaseReadyPromise;
}

function resolveDatabaseUrl(): string {
  return resolveFoundryDatabaseUrl({
    envDatabaseUrl: resolveConfiguredDatabaseUrlFromEnvironment(),
  });
}

function resolveConfiguredDatabaseUrlFromEnvironment(): string {
  const candidateKeys = [
    "LOCAL_PLAYGROUND_DATABASE_URL",
    "DATABASE_URL",
  ];

  for (const key of candidateKeys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

async function ensureDatabaseParentDirectoryExists(databaseUrl: string): Promise<void> {
  const databaseFilePath = resolveSqliteDatabaseFilePath(databaseUrl);
  if (!databaseFilePath) {
    return;
  }

  await mkdir(path.dirname(databaseFilePath), { recursive: true });
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
      return fileURLToPath(databaseUrl);
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
  await ensureThreadSchema();
  await ensureAppEventLogSchema();
  await ensureSkillRegistryCacheSchema();
}

async function ensureUserSchema(): Promise<void> {
  await createUserTable();
}

async function createUserTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "tenantId" TEXT NOT NULL,
      "principalId" TEXT NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "User_tenantId_principalId_key"
    ON "User" ("tenantId", "principalId")
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
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
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

async function ensureMcpServerProfileSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "McpServerProfile" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" INTEGER NOT NULL,
      "sortOrder" INTEGER NOT NULL,
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
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "McpServerProfile_userId_configKey_key"
    ON "McpServerProfile" ("userId", "configKey")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "McpServerProfile_userId_sortOrder_idx"
    ON "McpServerProfile" ("userId", "sortOrder")
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
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
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
      "sortOrder" INTEGER NOT NULL,
      "role" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "turnId" TEXT NOT NULL,
      "attachmentsJson" TEXT NOT NULL,
      FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadMessage_threadId_sortOrder_idx"
    ON "ThreadMessage" ("threadId", "sortOrder")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ThreadMcpServer" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "threadId" TEXT NOT NULL,
      "sortOrder" INTEGER NOT NULL,
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

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadMcpServer_threadId_sortOrder_idx"
    ON "ThreadMcpServer" ("threadId", "sortOrder")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ThreadMcpRpcLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "threadId" TEXT NOT NULL,
      "sortOrder" INTEGER NOT NULL,
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
    "ThreadMcpRpcLog",
    "operationType",
    "TEXT NOT NULL DEFAULT 'mcp'",
  );

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadMcpRpcLog_threadId_sortOrder_idx"
    ON "ThreadMcpRpcLog" ("threadId", "sortOrder")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ThreadSkillSelection" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "threadId" TEXT NOT NULL,
      "sortOrder" INTEGER NOT NULL,
      "skillName" TEXT NOT NULL,
      "skillPath" TEXT NOT NULL,
      FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadSkillSelection_threadId_sortOrder_idx"
    ON "ThreadSkillSelection" ("threadId", "sortOrder")
  `);
}

async function ensureAppEventLogSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AppEventLog" (
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
      "context" TEXT NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AppEventLog_createdAt_idx"
    ON "AppEventLog" ("createdAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AppEventLog_level_createdAt_idx"
    ON "AppEventLog" ("level", "createdAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AppEventLog_source_category_createdAt_idx"
    ON "AppEventLog" ("source", "category", "createdAt")
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
