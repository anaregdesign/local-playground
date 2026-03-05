/**
 * SQLite schema initialization helpers.
 */
import nodeFsPromises from "node:fs/promises";
import path from "node:path";
import nodeUrl from "node:url";
import type { PrismaClient } from "@prisma/client";

export async function ensureSqliteDatabaseParentDirectoryExists(
  databaseUrl: string,
): Promise<void> {
  const databaseFilePath = resolveSqliteDatabaseFilePath(databaseUrl);
  if (!databaseFilePath) {
    return;
  }

  await nodeFsPromises.mkdir(path.dirname(databaseFilePath), { recursive: true });
}

export async function ensureSqliteDatabaseSchema(prisma: PrismaClient): Promise<void> {
  await ensureUserSchema(prisma);
  await ensureAzureSelectionSchema(prisma);
  await ensureMcpServerProfileSchema(prisma);
  await ensureSkillProfileSchema(prisma);
  await ensureThreadSchema(prisma);
  await ensureRuntimeEventLogSchema(prisma);
  await ensureSkillRegistryCacheSchema(prisma);
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

async function ensureUserSchema(prisma: PrismaClient): Promise<void> {
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

async function ensureAzureSelectionSchema(prisma: PrismaClient): Promise<void> {
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
}

async function ensureMcpServerProfileSchema(prisma: PrismaClient): Promise<void> {
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

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceMcpServerProfile_userId_configKey_key"
    ON "WorkspaceMcpServerProfile" ("userId", "configKey")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "WorkspaceMcpServerProfile_userId_profileOrder_idx"
    ON "WorkspaceMcpServerProfile" ("userId", "profileOrder")
  `);
}

async function ensureSkillProfileSchema(prisma: PrismaClient): Promise<void> {
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

async function ensureThreadSchema(prisma: PrismaClient): Promise<void> {
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

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadOperationLog_threadId_conversationOrder_idx"
    ON "ThreadOperationLog" ("threadId", "conversationOrder")
  `);

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

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadSkillActivation_threadId_selectionOrder_idx"
    ON "ThreadSkillActivation" ("threadId", "selectionOrder")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ThreadSkillActivation_skillProfileId_idx"
    ON "ThreadSkillActivation" ("skillProfileId")
  `);
}

async function ensureRuntimeEventLogSchema(prisma: PrismaClient): Promise<void> {
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

async function ensureSkillRegistryCacheSchema(prisma: PrismaClient): Promise<void> {
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
