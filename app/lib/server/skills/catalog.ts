/**
 * Server runtime module.
 */
import { constants as fsConstants, type Dirent } from "node:fs";
import { access, mkdir, open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_SKILL_FILE_MAX_BYTES,
  AGENT_SKILLS_DIRECTORY_NAME,
} from "~/lib/constants";
import { resolveFoundrySkillsDirectory } from "~/lib/foundry/config";
import {
  parseSkillFrontmatter,
  type SkillFrontmatter,
  validateSkillFrontmatter,
} from "~/lib/home/skills/frontmatter";
import type { SkillCatalogEntry, SkillCatalogSource } from "~/lib/home/skills/types";

type SkillCatalogRoot = {
  path: string;
  source: SkillCatalogSource;
  createIfMissing: boolean;
};

export type SkillCatalogDiscoveryResult = {
  skills: SkillCatalogEntry[];
  warnings: string[];
};

type ResolveSkillCatalogRootsOptions = {
  workspaceUserId: number;
  codexHome?: string;
  foundryConfigDirectory?: string;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  appDataDirectory?: string | null;
};

const SKILL_FRONTMATTER_READ_CHUNK_BYTES = 4 * 1024;
const SKILL_FRONTMATTER_READ_MAX_BYTES = 128 * 1024;

export function resolveSkillCatalogRoots(
  options: ResolveSkillCatalogRootsOptions,
): SkillCatalogRoot[] {
  const codexHomeRoot = path.resolve(
    resolveCodexHomeDirectory(options.codexHome),
    AGENT_SKILLS_DIRECTORY_NAME,
  );
  const configuredFoundryDirectory =
    typeof options.foundryConfigDirectory === "string" ? options.foundryConfigDirectory.trim() : "";
  const foundrySkillsRoot = resolveAppDataSkillsRoot({
    workspaceUserId: options.workspaceUserId,
    configuredFoundryDirectory,
    platform: options.platform,
    homeDirectory: options.homeDirectory,
    appDataDirectory: options.appDataDirectory,
  });

  const roots: SkillCatalogRoot[] = [
    { path: codexHomeRoot, source: "codex_home", createIfMissing: false },
    { path: foundrySkillsRoot, source: "app_data", createIfMissing: true },
  ];

  const dedupe = new Set<string>();
  const uniqueRoots: SkillCatalogRoot[] = [];
  for (const root of roots) {
    const normalizedPath = root.path.trim();
    if (!normalizedPath || dedupe.has(normalizedPath)) {
      continue;
    }

    dedupe.add(normalizedPath);
    uniqueRoots.push({
      ...root,
      path: normalizedPath,
    });
  }

  return uniqueRoots;
}

export async function discoverSkillCatalog(
  options: ResolveSkillCatalogRootsOptions,
): Promise<SkillCatalogDiscoveryResult> {
  const roots = resolveSkillCatalogRoots(options);
  const skills: SkillCatalogEntry[] = [];
  const warnings: string[] = [];
  const seenCanonicalLocations = new Set<string>();

  for (const root of roots) {
    if (root.createIfMissing) {
      await mkdir(root.path, { recursive: true }).catch((error) => {
        warnings.push(`Failed to prepare Skills directory (${root.path}): ${readErrorMessage(error)}`);
      });
    }

    const skillFileCandidates = await readSkillFileCandidates(root.path);
    for (const filePath of skillFileCandidates) {
      const canonicalLocation = await realpath(filePath).catch(() => path.resolve(filePath));
      if (seenCanonicalLocations.has(canonicalLocation)) {
        continue;
      }

      const frontmatterResult = await readSkillFrontmatterForDiscovery(canonicalLocation);
      if (!frontmatterResult.ok) {
        warnings.push(frontmatterResult.error);
        continue;
      }

      const directoryName = path.basename(path.dirname(canonicalLocation));
      const validationError = validateSkillFrontmatter(frontmatterResult.frontmatter, directoryName);
      if (validationError) {
        warnings.push(`${canonicalLocation}: ${validationError}`);
        continue;
      }

      seenCanonicalLocations.add(canonicalLocation);
      skills.push({
        name: frontmatterResult.frontmatter.name,
        description: frontmatterResult.frontmatter.description,
        location: canonicalLocation,
        source: root.source,
      });
    }
  }

  skills.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }

    return left.location.localeCompare(right.location);
  });

  return {
    skills,
    warnings,
  };
}

export async function readSkillMarkdown(
  location: string,
  maxBytes = AGENT_SKILL_FILE_MAX_BYTES,
): Promise<string> {
  const normalizedLocation = await validateSkillMarkdownLocation(location, maxBytes);
  return await readFile(normalizedLocation, "utf8");
}

export async function readSkillFrontmatter(
  location: string,
  maxBytes = AGENT_SKILL_FILE_MAX_BYTES,
): Promise<SkillFrontmatter> {
  const normalizedLocation = await validateSkillMarkdownLocation(location, maxBytes);
  const headerContent = await readSkillMarkdownHeaderContent(normalizedLocation);
  const frontmatter = parseSkillFrontmatter(headerContent);
  if (!frontmatter) {
    throw new Error("Skill frontmatter is missing or invalid.");
  }

  return frontmatter;
}

export function resolveCodexHomeDirectory(codexHome?: string): string {
  const configured = typeof codexHome === "string" ? codexHome.trim() : "";
  if (configured) {
    return path.resolve(configured);
  }

  const envConfigured =
    typeof process.env.CODEX_HOME === "string" ? process.env.CODEX_HOME.trim() : "";
  if (envConfigured) {
    return path.resolve(envConfigured);
  }

  return path.resolve(homedir(), ".codex");
}

const SKILL_DISCOVERY_MAX_DEPTH = 4;

async function readSkillFileCandidates(rootPath: string): Promise<string[]> {
  if (!(await directoryExists(rootPath))) {
    return [];
  }

  const candidates = new Set<string>();
  await collectSkillFileCandidates(rootPath, 0, candidates);
  return Array.from(candidates).sort((left, right) => left.localeCompare(right));
}

async function collectSkillFileCandidates(
  directoryPath: string,
  depth: number,
  candidates: Set<string>,
): Promise<void> {
  if (depth > SKILL_DISCOVERY_MAX_DEPTH) {
    return;
  }

  const skillFile = path.join(directoryPath, "SKILL.md");
  if (await fileExists(skillFile)) {
    candidates.add(skillFile);
  }

  if (depth === SKILL_DISCOVERY_MAX_DEPTH) {
    return;
  }

  let entries: Dirent[];
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    // Ignore unreadable directories so one permission issue does not block full catalog discovery.
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    await collectSkillFileCandidates(
      path.join(directoryPath, entry.name),
      depth + 1,
      candidates,
    );
  }
}

async function readSkillFrontmatterForDiscovery(location: string): Promise<
  | {
      ok: true;
      frontmatter: {
        name: string;
        description: string;
      };
    }
  | {
      ok: false;
      error: string;
    }
> {
  try {
    const parsed = await readSkillFrontmatter(location, AGENT_SKILL_FILE_MAX_BYTES);
    return {
      ok: true,
      frontmatter: parsed,
    };
  } catch (error) {
    return {
      ok: false,
      error: `${location}: ${readErrorMessage(error)}`,
    };
  }
}

async function validateSkillMarkdownLocation(
  location: string,
  maxBytes: number,
): Promise<string> {
  const normalizedLocation = location.trim();
  if (!normalizedLocation) {
    throw new Error("Skill location is required.");
  }

  if (path.basename(normalizedLocation) !== "SKILL.md") {
    throw new Error("Skill location must point to SKILL.md.");
  }

  const fileStats = await stat(normalizedLocation);
  if (!fileStats.isFile()) {
    throw new Error("Skill location is not a file.");
  }

  if (fileStats.size > maxBytes) {
    throw new Error(`Skill file exceeds ${maxBytes} bytes.`);
  }

  return normalizedLocation;
}

async function readSkillMarkdownHeaderContent(location: string): Promise<string> {
  const fileHandle = await open(location, "r");
  const chunks: Buffer[] = [];
  let totalBytesRead = 0;

  try {
    while (totalBytesRead < SKILL_FRONTMATTER_READ_MAX_BYTES) {
      const remaining = SKILL_FRONTMATTER_READ_MAX_BYTES - totalBytesRead;
      const readSize = Math.min(SKILL_FRONTMATTER_READ_CHUNK_BYTES, remaining);
      const readBuffer = Buffer.alloc(readSize);
      const readResult = await fileHandle.read(readBuffer, 0, readSize, null);
      if (readResult.bytesRead === 0) {
        break;
      }

      const currentChunk = readBuffer.subarray(0, readResult.bytesRead);
      chunks.push(currentChunk);
      totalBytesRead += readResult.bytesRead;

      const content = Buffer.concat(chunks).toString("utf8");
      if (hasCompleteFrontmatterHeader(content)) {
        return content;
      }
    }
  } finally {
    await fileHandle.close();
  }

  throw new Error(
    `Skill frontmatter header exceeds ${SKILL_FRONTMATTER_READ_MAX_BYTES} bytes or is incomplete.`,
  );
}

function hasCompleteFrontmatterHeader(content: string): boolean {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length === 0 || lines[0]?.trim() !== "---") {
    return false;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      return true;
    }
  }

  return false;
}

async function directoryExists(location: string): Promise<boolean> {
  try {
    const stats = await stat(location);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(location: string): Promise<boolean> {
  try {
    await access(location, fsConstants.R_OK);
    const fileStats = await stat(location);
    return fileStats.isFile();
  } catch {
    return false;
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function resolveAppDataSkillsRoot(options: {
  workspaceUserId: number;
  configuredFoundryDirectory: string;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  appDataDirectory?: string | null;
}): string {
  const workspaceUserSkillsDirectoryName = readWorkspaceUserSkillsDirectoryName(
    options.workspaceUserId,
  );

  if (options.configuredFoundryDirectory) {
    return path.resolve(
      options.configuredFoundryDirectory,
      AGENT_SKILLS_DIRECTORY_NAME,
      workspaceUserSkillsDirectoryName,
    );
  }

  const configuredDatabaseUrl = resolveConfiguredDatabaseUrlFromEnvironment();
  if (configuredDatabaseUrl) {
    const sqliteFilePath = resolveSqliteDatabaseFilePath(configuredDatabaseUrl);
    if (sqliteFilePath) {
      return path.resolve(
        path.dirname(sqliteFilePath),
        AGENT_SKILLS_DIRECTORY_NAME,
        workspaceUserSkillsDirectoryName,
      );
    }
  }

  return path.resolve(
    resolveFoundrySkillsDirectory({
      platform: options.platform,
      homeDirectory: options.homeDirectory,
      appDataDirectory: options.appDataDirectory,
    }),
    workspaceUserSkillsDirectoryName,
  );
}

function readWorkspaceUserSkillsDirectoryName(workspaceUserId: number): string {
  if (!Number.isInteger(workspaceUserId) || workspaceUserId <= 0) {
    throw new Error("`workspaceUserId` must be a positive integer.");
  }

  return String(workspaceUserId);
}

function resolveConfiguredDatabaseUrlFromEnvironment(): string {
  const candidateKeys = ["LOCAL_PLAYGROUND_DATABASE_URL", "DATABASE_URL"];
  for (const key of candidateKeys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
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
