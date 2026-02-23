/**
 * Project maintenance script.
 */
import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "local-playground-dev";
const SKILL_DIRECTORY_SEGMENTS = ["skills", ".dev", SKILL_NAME];

async function main() {
  const codexHome = resolveCodexHome();
  const repoRoot = resolveRepositoryRoot();
  const sourceSkillPath = path.join(repoRoot, ...SKILL_DIRECTORY_SEGMENTS);
  const codexSkillsDirectory = path.join(codexHome, "skills");
  const destinationSkillPath = path.join(codexSkillsDirectory, SKILL_NAME);

  await assertSourceSkillExists(sourceSkillPath);
  await mkdir(codexSkillsDirectory, { recursive: true });
  await ensureDestinationIsReady(destinationSkillPath, sourceSkillPath);
  await createSkillLink(sourceSkillPath, destinationSkillPath);

  console.log(`[skill:enable] linked: ${destinationSkillPath} -> ${sourceSkillPath}`);
}

function resolveCodexHome() {
  const codexHome = (process.env.CODEX_HOME ?? "").trim();
  if (!codexHome) {
    throw new Error(
      "[skill:enable] CODEX_HOME is not set. Set CODEX_HOME first (for example: export CODEX_HOME=\"$HOME/.codex\").",
    );
  }
  return codexHome;
}

function resolveRepositoryRoot() {
  const scriptFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(scriptFilePath), "..");
}

async function assertSourceSkillExists(sourceSkillPath) {
  try {
    const sourceStats = await lstat(sourceSkillPath);
    if (!sourceStats.isDirectory()) {
      throw new Error(`[skill:enable] source skill path is not a directory: ${sourceSkillPath}`);
    }
  } catch (error) {
    if (isPathMissingError(error)) {
      throw new Error(`[skill:enable] source skill path not found: ${sourceSkillPath}`);
    }
    throw error;
  }
}

async function ensureDestinationIsReady(destinationSkillPath, sourceSkillPath) {
  let destinationStats = null;
  try {
    destinationStats = await lstat(destinationSkillPath);
  } catch (error) {
    if (!isPathMissingError(error)) {
      throw error;
    }
  }

  if (!destinationStats) {
    return;
  }

  if (!destinationStats.isSymbolicLink()) {
    throw new Error(
      `[skill:enable] destination already exists and is not a symlink: ${destinationSkillPath}. Remove it manually first.`,
    );
  }

  const currentLinkTarget = await readlink(destinationSkillPath);
  const resolvedCurrentTarget = path.resolve(path.dirname(destinationSkillPath), currentLinkTarget);
  if (resolvedCurrentTarget === sourceSkillPath) {
    console.log(`[skill:enable] already enabled: ${destinationSkillPath}`);
    process.exit(0);
  }

  await rm(destinationSkillPath, { recursive: true, force: true });
}

async function createSkillLink(sourceSkillPath, destinationSkillPath) {
  const symlinkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(sourceSkillPath, destinationSkillPath, symlinkType);
}

function isPathMissingError(error) {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
