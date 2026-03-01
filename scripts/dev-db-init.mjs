/**
 * Project maintenance script.
 */
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const SQLITE_FILE_NAME = "local-playground.sqlite";
const LEGACY_CONFIG_DIRECTORY = ".foundry_local_playground";
const WINDOWS_CONFIG_DIRECTORY = "FoundryLocalPlayground";

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  const databasePath = resolveSqliteDatabaseFilePath(databaseUrl);

  if (databasePath) {
    await mkdir(path.dirname(databasePath), { recursive: true });
    await rm(databasePath, { force: true });
    await rm(`${databasePath}-wal`, { force: true });
    await rm(`${databasePath}-shm`, { force: true });
    console.log(`[dev:db:init] removed: ${databasePath}`);
  } else {
    console.log("[dev:db:init] database URL is not a file-based SQLite path. Skipping file removal.");
  }

  await initializeSchema(databaseUrl);
  console.log(`[dev:db:init] initialized: ${databaseUrl}`);
}

function resolveDatabaseUrl() {
  const configuredUrl = (process.env.LOCAL_PLAYGROUND_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();
  if (configuredUrl) {
    return normalizeDatabaseUrl(configuredUrl);
  }

  const databasePath = resolveDefaultDatabaseFilePath();
  return buildPrismaSqliteDatabaseUrl(databasePath);
}

function resolveDefaultDatabaseFilePath() {
  if (process.platform === "win32") {
    const appDataDirectory = (process.env.APPDATA ?? "").trim();
    if (appDataDirectory) {
      return path.win32.join(appDataDirectory, WINDOWS_CONFIG_DIRECTORY, SQLITE_FILE_NAME);
    }

    return path.win32.join(homedir(), LEGACY_CONFIG_DIRECTORY, SQLITE_FILE_NAME);
  }

  if (process.platform === "darwin" || process.platform === "linux") {
    return path.posix.join(homedir(), LEGACY_CONFIG_DIRECTORY, SQLITE_FILE_NAME);
  }

  return path.posix.join(homedir(), LEGACY_CONFIG_DIRECTORY, SQLITE_FILE_NAME);
}

function resolveSqliteDatabaseFilePath(databaseUrl) {
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
  if (path.isAbsolute(decodedPath)) {
    return decodedPath;
  }

  return path.resolve(decodedPath);
}

function normalizeDatabaseUrl(databaseUrl) {
  if (!databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }

  if (
    databaseUrl === "file:memory" ||
    databaseUrl === "file::memory:" ||
    /[?&]mode=memory(?:&|$)/i.test(databaseUrl)
  ) {
    return databaseUrl;
  }

  const absolutePath = resolveSqliteDatabaseFilePath(databaseUrl);
  if (!absolutePath) {
    return databaseUrl;
  }

  const queryIndex = databaseUrl.indexOf("?");
  const query = queryIndex >= 0 ? databaseUrl.slice(queryIndex) : "";
  return `${buildPrismaSqliteDatabaseUrl(absolutePath)}${query}`;
}

function buildPrismaSqliteDatabaseUrl(databasePath) {
  if (process.platform === "win32") {
    const normalizedPath = databasePath.replaceAll("\\", "/");
    if (/^[A-Za-z]:\//.test(normalizedPath)) {
      return `file:/${normalizedPath}`;
    }

    return `file:${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
  }

  return `file:${databasePath}`;
}

async function initializeSchema(databaseUrl) {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "WorkspaceUser" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "tenantId" TEXT NOT NULL,
        "principalId" TEXT NOT NULL
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceUser_tenantId_principalId_key"
      ON "WorkspaceUser" ("tenantId", "principalId")
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AzureSelectionPreference" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "userId" INTEGER NOT NULL UNIQUE,
        "projectId" TEXT NOT NULL,
        "deploymentName" TEXT NOT NULL,
        FOREIGN KEY ("userId") REFERENCES "WorkspaceUser" ("id") ON DELETE CASCADE
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "WorkspaceMcpServerProfile" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        "profileOrder" INTEGER NOT NULL,
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
  } finally {
    await prisma.$disconnect();
  }
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`[dev:db:init] ${message}`);
  process.exitCode = 1;
});
