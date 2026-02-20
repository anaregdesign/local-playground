import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveFoundryDatabaseUrl } from "~/lib/foundry/config";

const DEFAULT_DATABASE_URL = resolveFoundryDatabaseUrl({
  envDatabaseUrl: resolveConfiguredDatabaseUrlFromEnvironment(),
});

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DEFAULT_DATABASE_URL;
}

const globalForPrisma = globalThis as typeof globalThis & {
  __localPlaygroundPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__localPlaygroundPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: DEFAULT_DATABASE_URL,
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
      await ensureDatabaseParentDirectoryExists(DEFAULT_DATABASE_URL);
      await ensureDatabaseSchema();
    })().catch((error) => {
      ensureDatabaseReadyPromise = null;
      throw error;
    });
  }

  await ensureDatabaseReadyPromise;
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
  if (path.isAbsolute(decodedPath)) {
    return decodedPath;
  }

  return path.resolve(decodedPath);
}

async function ensureDatabaseSchema(): Promise<void> {
  await ensureUserSchema();
  await ensureAzureSelectionSchema();
  await ensureMcpServerProfileSchema();
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
      "projectId" TEXT NOT NULL,
      "deploymentName" TEXT NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
    )
  `);
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
