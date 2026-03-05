/**
 * Runs `prisma generate` with Local Playground defaults.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "..");
const schemaFilePath = path.join(workspaceRoot, "prisma", "schema.prisma");

const normalizedProvider = readDatabaseProvider(
  process.env.LOCAL_PLAYGROUND_DATABASE_PROVIDER || process.env.DATABASE_PROVIDER,
);
let temporarySchemaDirectory = "";
let schemaPathForGeneration = schemaFilePath;
let finalExitCode = 0;

try {
  if (normalizedProvider !== "sqlite") {
    temporarySchemaDirectory = await mkdtemp(
      path.join(workspaceRoot, ".tmp-prisma-schema-"),
    );
    schemaPathForGeneration = path.join(temporarySchemaDirectory, "schema.prisma");
    const originalSchema = await readFile(schemaFilePath, "utf8");
    const nextSchema = originalSchema.replace(
      /datasource db \{\s*provider = "(sqlite|postgresql|mysql|cockroachdb|sqlserver)"/,
      `datasource db {\n  provider = "${normalizedProvider}"`,
    );
    if (nextSchema === originalSchema) {
      throw new Error("Failed to rewrite datasource provider in prisma/schema.prisma.");
    }
    await writeFile(
      schemaPathForGeneration,
      nextSchema,
      "utf8",
    );
  }

  const command = process.platform === "win32" ? "prisma.cmd" : "prisma";
  const args = ["generate", "--schema", schemaPathForGeneration];
  finalExitCode = await runCommand(command, args);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  finalExitCode = 1;
} finally {
  if (temporarySchemaDirectory) {
    await rm(temporarySchemaDirectory, { recursive: true, force: true });
  }
}

process.exit(finalExitCode);

function readDatabaseProvider(rawValue) {
  const normalized = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
  if (!normalized || normalized === "sqlite") {
    return "sqlite";
  }
  if (normalized === "postgresql" || normalized === "postgres") {
    return "postgresql";
  }
  if (normalized === "mysql") {
    return "mysql";
  }
  if (normalized === "cockroachdb" || normalized === "cockroach") {
    return "cockroachdb";
  }
  if (normalized === "sqlserver" || normalized === "mssql") {
    return "sqlserver";
  }

  throw new Error(
    "DATABASE_PROVIDER must be one of `sqlite`, `postgresql`, `mysql`, `cockroachdb`, or `sqlserver`.",
  );
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 1);
    });

    child.on("error", reject);
  });
}
