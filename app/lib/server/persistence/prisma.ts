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
    "FOUNDRY_LOCAL_PLAYGROUND_DATABASE_URL",
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
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AzureSelectionPreference" (
      "tenantId" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "deploymentName" TEXT NOT NULL,
      "updatedAt" DATETIME NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "McpServerProfile" (
      "id" TEXT NOT NULL PRIMARY KEY,
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
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "McpServerProfile_configKey_key"
    ON "McpServerProfile" ("configKey")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "McpServerProfile_sortOrder_idx"
    ON "McpServerProfile" ("sortOrder")
  `);
}
