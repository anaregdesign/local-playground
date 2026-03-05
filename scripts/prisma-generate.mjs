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
const env = {
  ...process.env,
};

const normalizedProvider = readDatabaseProvider(
  env.LOCAL_PLAYGROUND_DATABASE_PROVIDER || env.DATABASE_PROVIDER,
);
let temporarySchemaDirectory = "";
let schemaPathForGeneration = schemaFilePath;
let finalExitCode = 0;

try {
  if (normalizedProvider === "postgresql") {
    temporarySchemaDirectory = await mkdtemp(
      path.join(workspaceRoot, ".tmp-prisma-schema-"),
    );
    schemaPathForGeneration = path.join(temporarySchemaDirectory, "schema.prisma");
    const originalSchema = await readFile(schemaFilePath, "utf8");
    await writeFile(
      schemaPathForGeneration,
      originalSchema.replace(
        /datasource db \{\s*provider = "sqlite"/,
        'datasource db {\n  provider = "postgresql"',
      ),
      "utf8",
    );
  }

  const command = process.platform === "win32" ? "prisma.cmd" : "prisma";
  const args = ["generate", "--schema", schemaPathForGeneration];
  finalExitCode = await runCommand(command, args, env);
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

  throw new Error("DATABASE_PROVIDER must be `sqlite` or `postgresql`.");
}

function runCommand(command, args, commandEnvironment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: commandEnvironment,
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
