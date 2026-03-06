/**
 * Server runtime module.
 */
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_SKILL_NAME_PATTERN,
  FOUNDRY_SKILLS_DIRECTORY_NAME,
  FOUNDRY_USERS_DIRECTORY_NAME,
  SKILL_REGISTRY_LIST_CACHE_TTL_MS,
  SKILL_REGISTRY_TREE_CACHE_TTL_MS,
} from "~/lib/constants";
import { resolveFoundryWorkspaceUserSkillsDirectory } from "~/lib/foundry/config";
import { parseSkillFrontmatter, validateSkillFrontmatter } from "~/lib/home/skills/frontmatter";
import {
  parseSkillRegistrySkillName,
  readSkillRegistryOptionById,
  readSkillRegistrySkillNameValidationMessage,
  SKILL_REGISTRY_OPTIONS,
  type SkillRegistryId,
  type SkillRegistryOption,
} from "~/lib/home/skills/registry";
import type { SkillRegistryCatalog } from "~/lib/home/skills/types";
import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";

type ResolveSkillRegistryOptions = {
  workspaceUserId: number;
  foundryConfigDirectory?: string;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  appDataDirectory?: string | null;
};

type SkillRegistryInstallOptions = ResolveSkillRegistryOptions & {
  registryId: SkillRegistryId;
  skillName: string;
};

type SkillRegistryDeleteOptions = ResolveSkillRegistryOptions & {
  registryId: SkillRegistryId;
  skillName: string;
};

type SkillRegistryCatalogDiscoveryResult = {
  catalogs: SkillRegistryCatalog[];
  warnings: string[];
};

type SkillRegistryInstallResult = {
  skillName: string;
  installLocation: string;
  operation: "installed" | "updated" | "unchanged";
};

type SkillRegistryDeleteResult = {
  skillName: string;
  installLocation: string;
  removed: boolean;
};

type GithubContentsDirectoryEntry = {
  name: string;
  type: string;
};

type RegistryBlobEntry = {
  path: string;
  sha: string;
};

type RegistryCatalogSkill = {
  id: string;
  name: string;
  tag: string | null;
};

type InstalledSkillMetadata = {
  formatVersion: number;
  registryId: string;
  sourcePath: string;
  skillName: string;
  skillPath: string;
  versionChecksum: string;
};

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_RAW_BASE_URL = "https://raw.githubusercontent.com";
const REGISTRY_LIST_CACHE_KEY_PREFIX = "skill_registry_list:";
const REGISTRY_TREE_CACHE_KEY_PREFIX = "skill_registry_tree:";
const CACHE_VERSION = "v1";
const INSTALLED_SKILL_METADATA_FILE_NAME = ".local-playground-skill.json";

export async function discoverSkillRegistries(
  options: ResolveSkillRegistryOptions,
): Promise<SkillRegistryCatalogDiscoveryResult> {
  const appDataSkillsRoot = resolveAppDataSkillsRoot(options);
  const catalogs: SkillRegistryCatalog[] = [];
  const warnings: string[] = [];

  for (const registry of SKILL_REGISTRY_OPTIONS) {
    try {
      catalogs.push(await readSkillRegistryCatalog(registry, appDataSkillsRoot));
    } catch (error) {
      warnings.push(
        `Failed to load ${registry.label} registry: ${readErrorMessage(error)}`,
      );
      catalogs.push({
        registryId: registry.id,
        registryLabel: registry.label,
        registryDescription: registry.description,
        repository: registry.repository,
        repositoryUrl: buildRepositoryUrl(registry.repository),
        sourcePath: registry.sourcePath,
        skills: [],
      });
    }
  }

  return {
    catalogs,
    warnings,
  };
}

export async function installSkillFromRegistry(
  options: SkillRegistryInstallOptions,
): Promise<SkillRegistryInstallResult> {
  const registry = readSkillRegistryOptionById(options.registryId);
  if (!registry) {
    throw new Error("Unsupported skill registry.");
  }

  const parsedSkillName = parseSkillRegistrySkillName(registry.id, options.skillName);
  if (!parsedSkillName) {
    throw new Error(readSkillRegistrySkillNameValidationMessage(registry.id));
  }
  const registrySkillName = parsedSkillName.normalizedSkillName;
  const normalizedSkillName = parsedSkillName.skillName;

  const appDataSkillsRoot = resolveAppDataSkillsRoot(options);
  const registryInstallRoot = path.join(appDataSkillsRoot, registry.installDirectoryName);
  const skillInstallRoot = path.join(registryInstallRoot, ...registrySkillName.split("/"));
  const installLocation = path.join(skillInstallRoot, "SKILL.md");
  const sourceRootPath = normalizeRepoPath(registry.sourcePath);
  const skillPrefix = `${sourceRootPath}/${registrySkillName}/`;
  const matchingBlobEntries = await readRegistrySkillBlobEntries({
    registry,
    sourceRootPath,
    skillPath: registrySkillName,
  });
  const remoteVersionChecksum = buildVersionChecksumFromBlobEntries(matchingBlobEntries);

  await mkdir(registryInstallRoot, { recursive: true });
  const alreadyInstalled = await directoryExists(skillInstallRoot);
  if (alreadyInstalled) {
    const installedMetadata = await readInstalledSkillMetadata(skillInstallRoot);
    const isCurrentVersion = isInstalledSkillMetadataCurrent({
      metadata: installedMetadata,
      registryId: registry.id,
      sourceRootPath,
      skillPath: registrySkillName,
      remoteVersionChecksum,
    });
    if (isCurrentVersion) {
      return {
        skillName: registrySkillName,
        installLocation,
        operation: "unchanged",
      };
    }

    await rm(skillInstallRoot, { recursive: true, force: true });
  }

  await mkdir(skillInstallRoot, { recursive: true });
  try {
    const contentChecksumHash = createHash("sha256");
    for (const blobEntry of matchingBlobEntries) {
      const blobPath = blobEntry.path;
      const relativePath = blobPath.slice(skillPrefix.length);
      if (!isSafeRelativePath(relativePath)) {
        throw new Error(`Registry file path is invalid: ${blobPath}`);
      }

      const destinationPath = path.resolve(skillInstallRoot, relativePath);
      const normalizedRoot = path.resolve(skillInstallRoot);
      if (
        destinationPath !== normalizedRoot &&
        !destinationPath.startsWith(`${normalizedRoot}${path.sep}`)
      ) {
        throw new Error(`Registry file path escapes skill root: ${blobPath}`);
      }

      await mkdir(path.dirname(destinationPath), { recursive: true });
      const sourceFileUrl = buildRawFileUrl({
        repository: registry.repository,
        ref: registry.ref,
        filePath: blobPath,
      });
      const bytes = await fetchBytes(sourceFileUrl);
      contentChecksumHash.update(relativePath);
      contentChecksumHash.update("\0");
      contentChecksumHash.update(Buffer.from(bytes));
      await writeFile(destinationPath, Buffer.from(bytes));
    }

    await validateInstalledSkill(skillInstallRoot, normalizedSkillName);
    await writeInstalledSkillMetadata({
      skillInstallRoot,
      registry,
      skillName: normalizedSkillName,
      skillPath: registrySkillName,
      sourceRootPath,
      versionChecksum: remoteVersionChecksum,
      contentChecksum: contentChecksumHash.digest("hex"),
    });
  } catch (error) {
    await rm(skillInstallRoot, { recursive: true, force: true });
    throw error;
  }

  await invalidateSkillRegistryListCache(registry.id);
  return {
    skillName: registrySkillName,
    installLocation,
    operation: alreadyInstalled ? "updated" : "installed",
  };
}

export async function deleteInstalledSkillFromRegistry(
  options: SkillRegistryDeleteOptions,
): Promise<SkillRegistryDeleteResult> {
  const registry = readSkillRegistryOptionById(options.registryId);
  if (!registry) {
    throw new Error("Unsupported skill registry.");
  }

  const parsedSkillName = parseSkillRegistrySkillName(registry.id, options.skillName);
  if (!parsedSkillName) {
    throw new Error(readSkillRegistrySkillNameValidationMessage(registry.id));
  }
  const registrySkillName = parsedSkillName.normalizedSkillName;

  const appDataSkillsRoot = resolveAppDataSkillsRoot(options);
  const registryInstallRoot = path.join(appDataSkillsRoot, registry.installDirectoryName);
  const skillInstallRoot = path.join(registryInstallRoot, ...registrySkillName.split("/"));
  const installLocation = path.join(skillInstallRoot, "SKILL.md");

  const exists = await directoryExists(skillInstallRoot);
  if (!exists) {
    return {
      skillName: registrySkillName,
      installLocation,
      removed: false,
    };
  }

  await rm(skillInstallRoot, { recursive: true, force: true });
  await removeEmptyAncestorDirectories(skillInstallRoot, registryInstallRoot);
  await removeDirectoryWhenEmpty(registryInstallRoot);
  await invalidateSkillRegistryListCache(registry.id);
  return {
    skillName: registrySkillName,
    installLocation,
    removed: true,
  };
}

async function readSkillRegistryCatalog(
  registry: SkillRegistryOption,
  appDataSkillsRoot: string,
): Promise<SkillRegistryCatalog> {
  const registrySkills = await readRegistrySkills(registry);
  const registryInstallRoot = path.join(appDataSkillsRoot, registry.installDirectoryName);
  const sourceRootPath = normalizeRepoPath(registry.sourcePath);
  const installedSkillEntries = await Promise.all(
    registrySkills.map(async (registrySkill) => {
      const skillInstallRoot = path.join(
        registryInstallRoot,
        ...registrySkill.id.split("/"),
      );
      const installLocation = path.join(skillInstallRoot, "SKILL.md");
      const isInstalled = await fileExists(installLocation);
      const metadata = isInstalled ? await readInstalledSkillMetadata(skillInstallRoot) : null;

      return {
        id: registrySkill.id,
        installLocation,
        isInstalled,
        metadata,
      };
    }),
  );
  const hasInstalledSkills = installedSkillEntries.some((entry) => entry.isInstalled);
  const versionChecksumBySkillPath = hasInstalledSkills
    ? await readRegistryVersionChecksumBySkillPath({
        registry,
        sourceRootPath,
      })
    : new Map<string, string>();
  const installedSkillEntryById = new Map(
    installedSkillEntries.map((entry) => [entry.id, entry]),
  );
  const skills = await Promise.all(
    registrySkills.map(async (registrySkill) => {
      const installedSkillEntry = installedSkillEntryById.get(registrySkill.id);
      const installLocation = installedSkillEntry?.installLocation
        ? installedSkillEntry.installLocation
        : path.join(registryInstallRoot, ...registrySkill.id.split("/"), "SKILL.md");
      const isInstalled = installedSkillEntry?.isInstalled === true;
      const remoteVersionChecksum = versionChecksumBySkillPath.get(registrySkill.id) ?? "";
      const isUpdateAvailable =
        isInstalled &&
        Boolean(remoteVersionChecksum) &&
        !isInstalledSkillMetadataCurrent({
          metadata: installedSkillEntry?.metadata ?? null,
          registryId: registry.id,
          sourceRootPath,
          skillPath: registrySkill.id,
          remoteVersionChecksum,
        });

      return {
        id: registrySkill.id,
        name: registrySkill.name,
        description: `Install ${registrySkill.name} from ${registry.label}.`,
        tag: registrySkill.tag,
        remotePath: `${sourceRootPath}/${registrySkill.id}`,
        installLocation,
        isInstalled,
        isUpdateAvailable,
      };
    }),
  );

  return {
    registryId: registry.id,
    registryLabel: registry.label,
    registryDescription: registry.description,
    repository: registry.repository,
    repositoryUrl: buildRepositoryUrl(registry.repository),
    sourcePath: registry.sourcePath,
    skills,
  };
}

async function readRegistrySkills(registry: SkillRegistryOption): Promise<RegistryCatalogSkill[]> {
  if (registry.skillPathLayout === "tagged") {
    return await readTaggedRepositorySkills(registry);
  }

  const cacheKey = buildRegistryListCacheKey(registry);
  return await readCacheValue(cacheKey, async () => {
    const endpoint = buildRepositoryContentsApiUrl({
      repository: registry.repository,
      ref: registry.ref,
      contentPath: registry.sourcePath,
    });
    const payload = await fetchJson(endpoint);
    const skills = readSkillNamesFromContentsPayload(payload).map((skillName) => ({
      id: skillName,
      name: skillName,
      tag: null,
    }));
    if (skills.length === 0) {
      throw new Error(`No installable Skill directories were found for ${registry.label}.`);
    }
    return skills;
  }, SKILL_REGISTRY_LIST_CACHE_TTL_MS);
}

async function readTaggedRepositorySkills(
  registry: SkillRegistryOption,
): Promise<RegistryCatalogSkill[]> {
  const cacheKey = buildRegistryListCacheKey(registry);
  return await readCacheValue(cacheKey, async () => {
    const blobEntries = await readRegistryBlobEntries(registry);
    const sourceRootPath = normalizeRepoPath(registry.sourcePath);
    const sourcePrefix = `${sourceRootPath}/`;
    const skills = new Map<string, RegistryCatalogSkill>();

    for (const blobEntry of blobEntries) {
      if (!blobEntry.path.startsWith(sourcePrefix)) {
        continue;
      }

      const relativePath = blobEntry.path.slice(sourcePrefix.length);
      const segments = relativePath
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
      if (segments.length !== 3) {
        continue;
      }

      const [tag, skillName, fileName] = segments;
      if (!tag || !skillName || fileName !== "SKILL.md") {
        continue;
      }

      const parsed = parseSkillRegistrySkillName(registry.id, `${tag}/${skillName}`);
      if (!parsed) {
        continue;
      }

      skills.set(parsed.normalizedSkillName, {
        id: parsed.normalizedSkillName,
        name: parsed.skillName,
        tag: parsed.tag,
      });
    }

    const sortedSkills = Array.from(skills.values()).sort((left, right) => {
      const leftTag = left.tag ?? "";
      const rightTag = right.tag ?? "";
      const byTag = leftTag.localeCompare(rightTag);
      if (byTag !== 0) {
        return byTag;
      }

      return left.name.localeCompare(right.name);
    });
    if (sortedSkills.length === 0) {
      throw new Error(`No installable Skill directories were found for ${registry.label}.`);
    }

    return sortedSkills;
  }, SKILL_REGISTRY_LIST_CACHE_TTL_MS);
}

async function readRegistryBlobEntries(
  registry: SkillRegistryOption,
): Promise<RegistryBlobEntry[]> {
  const cacheKey = buildRegistryTreeCacheKey(registry);
  return await readCacheValue(cacheKey, async () => {
    const endpoint = buildRepositoryTreeApiUrl({
      repository: registry.repository,
      ref: registry.ref,
    });
    const payload = await fetchJson(endpoint);
    return readBlobEntriesFromTreePayload(payload);
  }, SKILL_REGISTRY_TREE_CACHE_TTL_MS);
}

async function validateInstalledSkill(
  skillInstallRoot: string,
  expectedSkillName: string,
): Promise<void> {
  const skillFilePath = path.join(skillInstallRoot, "SKILL.md");
  const skillFileContent = await readFile(skillFilePath, "utf8").catch(() => "");
  const frontmatter = parseSkillFrontmatter(skillFileContent);
  if (!frontmatter) {
    throw new Error("Installed Skill is missing valid frontmatter.");
  }

  const validationError = validateSkillFrontmatter(frontmatter, expectedSkillName);
  if (validationError) {
    throw new Error(validationError);
  }
}

async function writeInstalledSkillMetadata(options: {
  skillInstallRoot: string;
  registry: SkillRegistryOption;
  skillName: string;
  skillPath: string;
  sourceRootPath: string;
  versionChecksum: string;
  contentChecksum: string;
}): Promise<void> {
  const metadata = {
    formatVersion: 1,
    registryId: options.registry.id,
    registryLabel: options.registry.label,
    repository: options.registry.repository,
    ref: options.registry.ref,
    sourcePath: options.sourceRootPath,
    skillName: options.skillName,
    skillPath: options.skillPath,
    installedAt: new Date().toISOString(),
    versionChecksum: options.versionChecksum,
    contentChecksum: options.contentChecksum,
  };

  const metadataPath = path.join(options.skillInstallRoot, INSTALLED_SKILL_METADATA_FILE_NAME);
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function readRegistrySkillBlobEntries(options: {
  registry: SkillRegistryOption;
  sourceRootPath: string;
  skillPath: string;
}): Promise<RegistryBlobEntry[]> {
  const blobEntries = await readRegistryBlobEntries(options.registry);
  const skillPrefix = `${options.sourceRootPath}/${options.skillPath}/`;
  const matchingBlobEntries = blobEntries
    .filter((blobEntry) => blobEntry.path.startsWith(skillPrefix))
    .sort((left, right) => left.path.localeCompare(right.path));

  if (matchingBlobEntries.length === 0) {
    throw new Error(`Skill "${options.skillPath}" was not found in ${options.registry.label}.`);
  }

  return matchingBlobEntries;
}

async function readRegistryVersionChecksumBySkillPath(options: {
  registry: SkillRegistryOption;
  sourceRootPath: string;
}): Promise<Map<string, string>> {
  const blobEntries = await readRegistryBlobEntries(options.registry);
  const blobEntriesBySkillPath = new Map<string, RegistryBlobEntry[]>();

  for (const blobEntry of blobEntries) {
    const skillPath = readRegistrySkillPathFromBlobPath({
      registry: options.registry,
      sourceRootPath: options.sourceRootPath,
      blobPath: blobEntry.path,
    });
    if (!skillPath) {
      continue;
    }

    const current = blobEntriesBySkillPath.get(skillPath) ?? [];
    current.push(blobEntry);
    blobEntriesBySkillPath.set(skillPath, current);
  }

  const checksumBySkillPath = new Map<string, string>();
  for (const [skillPath, skillBlobEntries] of blobEntriesBySkillPath.entries()) {
    checksumBySkillPath.set(skillPath, buildVersionChecksumFromBlobEntries(skillBlobEntries));
  }

  return checksumBySkillPath;
}

function readRegistrySkillPathFromBlobPath(options: {
  registry: SkillRegistryOption;
  sourceRootPath: string;
  blobPath: string;
}): string | null {
  const sourcePrefix = `${options.sourceRootPath}/`;
  if (!options.blobPath.startsWith(sourcePrefix)) {
    return null;
  }

  const relativePath = options.blobPath.slice(sourcePrefix.length);
  const segments = relativePath
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return null;
  }

  const rawSkillPath =
    options.registry.skillPathLayout === "tagged"
      ? segments.length >= 3
        ? `${segments[0]}/${segments[1]}`
        : ""
      : segments[0];
  if (!rawSkillPath) {
    return null;
  }

  const parsed = parseSkillRegistrySkillName(options.registry.id, rawSkillPath);
  return parsed ? parsed.normalizedSkillName : null;
}

function buildVersionChecksumFromBlobEntries(blobEntries: RegistryBlobEntry[]): string {
  const checksumHash = createHash("sha256");
  const sortedBlobEntries = [...blobEntries].sort((left, right) => left.path.localeCompare(right.path));
  for (const blobEntry of sortedBlobEntries) {
    checksumHash.update(blobEntry.path);
    checksumHash.update(":");
    checksumHash.update(blobEntry.sha);
    checksumHash.update("\n");
  }
  return checksumHash.digest("hex");
}

async function readInstalledSkillMetadata(skillInstallRoot: string): Promise<InstalledSkillMetadata | null> {
  const metadataPath = path.join(skillInstallRoot, INSTALLED_SKILL_METADATA_FILE_NAME);
  const metadataContent = await readFile(metadataPath, "utf8").catch(() => "");
  if (!metadataContent.trim()) {
    return null;
  }

  try {
    const raw = JSON.parse(metadataContent) as unknown;
    return readInstalledSkillMetadataFromUnknown(raw);
  } catch {
    return null;
  }
}

function readInstalledSkillMetadataFromUnknown(value: unknown): InstalledSkillMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const formatVersion =
    typeof value.formatVersion === "number" && Number.isInteger(value.formatVersion)
      ? value.formatVersion
      : 0;
  const registryId = typeof value.registryId === "string" ? value.registryId.trim() : "";
  const sourcePath = typeof value.sourcePath === "string" ? normalizeRepoPath(value.sourcePath) : "";
  const skillName = typeof value.skillName === "string" ? value.skillName.trim() : "";
  const skillPath = typeof value.skillPath === "string" ? normalizeRepoPath(value.skillPath) : "";
  const versionChecksum =
    typeof value.versionChecksum === "string" ? value.versionChecksum.trim() : "";
  if (
    formatVersion !== 1 ||
    !registryId ||
    !sourcePath ||
    !skillName ||
    !skillPath ||
    !versionChecksum
  ) {
    return null;
  }

  return {
    formatVersion,
    registryId,
    sourcePath,
    skillName,
    skillPath,
    versionChecksum,
  };
}

function isInstalledSkillMetadataCurrent(options: {
  metadata: InstalledSkillMetadata | null;
  registryId: string;
  sourceRootPath: string;
  skillPath: string;
  remoteVersionChecksum: string;
}): boolean {
  if (!options.metadata || !options.remoteVersionChecksum.trim()) {
    return false;
  }

  return (
    options.metadata.registryId === options.registryId &&
    options.metadata.sourcePath === options.sourceRootPath &&
    options.metadata.skillPath === options.skillPath &&
    options.metadata.versionChecksum === options.remoteVersionChecksum
  );
}

function resolveAppDataSkillsRoot(options: ResolveSkillRegistryOptions): string {
  const workspaceUserSkillsDirectoryName = readWorkspaceUserSkillsDirectoryName(
    options.workspaceUserId,
  );
  const configuredFoundryDirectory =
    typeof options.foundryConfigDirectory === "string" ? options.foundryConfigDirectory.trim() : "";
  if (configuredFoundryDirectory) {
    return path.resolve(
      configuredFoundryDirectory,
      FOUNDRY_USERS_DIRECTORY_NAME,
      workspaceUserSkillsDirectoryName,
      FOUNDRY_SKILLS_DIRECTORY_NAME,
    );
  }

  const configuredDatabaseUrl = resolveConfiguredDatabaseUrlFromEnvironment();
  if (configuredDatabaseUrl) {
    const sqliteFilePath = resolveSqliteDatabaseFilePath(configuredDatabaseUrl);
    if (sqliteFilePath) {
      return path.resolve(
        path.dirname(sqliteFilePath),
        FOUNDRY_USERS_DIRECTORY_NAME,
        workspaceUserSkillsDirectoryName,
        FOUNDRY_SKILLS_DIRECTORY_NAME,
      );
    }
  }

  return resolveFoundryWorkspaceUserSkillsDirectory({
    workspaceUserId: options.workspaceUserId,
    platform: options.platform,
    homeDirectory: options.homeDirectory,
    appDataDirectory: options.appDataDirectory,
  });
}

function buildRepositoryUrl(repository: string): string {
  return `https://github.com/${repository}`;
}

function buildRepositoryContentsApiUrl(options: {
  repository: string;
  ref: string;
  contentPath: string;
}): string {
  return `${GITHUB_API_BASE_URL}/repos/${options.repository}/contents/${encodeRepoPath(
    options.contentPath,
  )}?ref=${encodeURIComponent(options.ref)}`;
}

function buildRepositoryTreeApiUrl(options: {
  repository: string;
  ref: string;
}): string {
  return `${GITHUB_API_BASE_URL}/repos/${options.repository}/git/trees/${encodeURIComponent(
    options.ref,
  )}?recursive=1`;
}

function buildRawFileUrl(options: {
  repository: string;
  ref: string;
  filePath: string;
}): string {
  return `${GITHUB_RAW_BASE_URL}/${options.repository}/${encodeURIComponent(options.ref)}/${encodeRepoPath(
    options.filePath,
  )}`;
}

function encodeRepoPath(value: string): string {
  return normalizeRepoPath(value)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeRepoPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");
}

function readSkillNamesFromContentsPayload(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    throw new Error("Unexpected registry listing response.");
  }

  const names = new Set<string>();
  for (const entry of payload) {
    const normalizedEntry = readGithubContentsDirectoryEntry(entry);
    if (!normalizedEntry || normalizedEntry.type !== "dir") {
      continue;
    }

    const normalizedName = normalizeSkillName(normalizedEntry.name);
    if (!normalizedName) {
      continue;
    }

    names.add(normalizedName);
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function readBlobEntriesFromTreePayload(payload: unknown): RegistryBlobEntry[] {
  if (!isRecord(payload)) {
    throw new Error("Unexpected git tree response.");
  }

  const truncated = payload.truncated === true;
  if (truncated) {
    throw new Error("Git tree response is truncated. Narrow the source path.");
  }

  const tree = payload.tree;
  if (!Array.isArray(tree)) {
    throw new Error("Git tree payload is invalid.");
  }

  const blobEntries = new Map<string, string>();
  for (const entry of tree) {
    if (!isRecord(entry)) {
      continue;
    }

    const type = typeof entry.type === "string" ? entry.type.trim() : "";
    const blobPath = typeof entry.path === "string" ? normalizeRepoPath(entry.path) : "";
    const blobSha = typeof entry.sha === "string" ? entry.sha.trim() : "";
    if (type !== "blob" || !blobPath || !blobSha) {
      continue;
    }

    blobEntries.set(blobPath, blobSha);
  }

  return Array.from(blobEntries.entries())
    .map(([blobPath, blobSha]) => ({
      path: blobPath,
      sha: blobSha,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function readGithubContentsDirectoryEntry(
  value: unknown,
): GithubContentsDirectoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const type = typeof value.type === "string" ? value.type.trim() : "";
  if (!name || !type) {
    return null;
  }

  return {
    name,
    type,
  };
}

function normalizeSkillName(value: string): string {
  const normalized = value.trim();
  if (!normalized || !AGENT_SKILL_NAME_PATTERN.test(normalized)) {
    return "";
  }

  return normalized;
}

function isSafeRelativePath(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("/") || normalized.startsWith("\\")) {
    return false;
  }

  const segments = normalized.replaceAll("\\", "/").split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: buildGitHubRequestHeaders(),
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}).`);
  }

  return await response.json();
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    method: "GET",
    headers: buildGitHubRequestHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Skill file download failed (${response.status}).`);
  }

  return await response.arrayBuffer();
}

function buildGitHubRequestHeaders(): HeadersInit {
  const tokenCandidates = [process.env.GITHUB_TOKEN, process.env.GH_TOKEN];
  const token = tokenCandidates
    .map((candidate) => (typeof candidate === "string" ? candidate.trim() : ""))
    .find((candidate) => candidate.length > 0);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "local-playground-skill-registry",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function buildRegistryListCacheKey(registry: SkillRegistryOption): string {
  return `${REGISTRY_LIST_CACHE_KEY_PREFIX}${CACHE_VERSION}:${registry.id}:${registry.repository}:${registry.ref}:${registry.sourcePath}`;
}

function buildRegistryTreeCacheKey(registry: SkillRegistryOption): string {
  return `${REGISTRY_TREE_CACHE_KEY_PREFIX}${CACHE_VERSION}:${registry.id}:${registry.repository}:${registry.ref}`;
}

async function invalidateSkillRegistryListCache(registryId: SkillRegistryId): Promise<void> {
  await ensurePersistenceDatabaseReady();
  const listPrefix = `${REGISTRY_LIST_CACHE_KEY_PREFIX}${CACHE_VERSION}:${registryId}:`;
  await prisma.skillRegistryCache.deleteMany({
    where: {
      cacheKey: {
        startsWith: listPrefix,
      },
    },
  });
}

async function readCacheValue<T>(
  cacheKey: string,
  load: () => Promise<T>,
  ttlMs: number,
): Promise<T> {
  const cached = await readCachedPayload<T>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const loaded = await load();
  await writeCachedPayload(cacheKey, loaded, ttlMs);
  return loaded;
}

async function readCachedPayload<T>(cacheKey: string): Promise<T | null> {
  await ensurePersistenceDatabaseReady();
  const row = await prisma.skillRegistryCache.findUnique({
    where: {
      cacheKey,
    },
  });
  if (!row) {
    return null;
  }

  const nowTime = Date.now();
  const expiresAtTime = Date.parse(row.expiresAt);
  if (Number.isNaN(expiresAtTime) || expiresAtTime <= nowTime) {
    await prisma.skillRegistryCache.delete({
      where: {
        cacheKey,
      },
    }).catch(() => undefined);
    return null;
  }

  try {
    return JSON.parse(row.payloadJson) as T;
  } catch {
    await prisma.skillRegistryCache.delete({
      where: {
        cacheKey,
      },
    }).catch(() => undefined);
    return null;
  }
}

async function writeCachedPayload<T>(
  cacheKey: string,
  payload: T,
  ttlMs: number,
): Promise<void> {
  await ensurePersistenceDatabaseReady();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(1_000, ttlMs));
  await prisma.skillRegistryCache.upsert({
    where: {
      cacheKey,
    },
    create: {
      cacheKey,
      payloadJson: JSON.stringify(payload),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    update: {
      payloadJson: JSON.stringify(payload),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  });
}

async function removeDirectoryWhenEmpty(directoryPath: string): Promise<void> {
  if (!(await directoryExists(directoryPath))) {
    return;
  }

  const entries = await readdir(directoryPath);
  if (entries.length === 0) {
    await rm(directoryPath, { recursive: true, force: true });
  }
}

async function removeEmptyAncestorDirectories(
  childPath: string,
  stopAtPath: string,
): Promise<void> {
  const normalizedStopPath = path.resolve(stopAtPath);
  let currentPath = path.resolve(path.dirname(childPath));

  while (currentPath.startsWith(`${normalizedStopPath}${path.sep}`)) {
    await removeDirectoryWhenEmpty(currentPath);

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }

    currentPath = parentPath;
  }
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    await access(directoryPath, fsConstants.F_OK | fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK | fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
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

export const skillRegistryServerTestUtils = {
  normalizeSkillName,
  readSkillNamesFromContentsPayload,
  readBlobEntriesFromTreePayload,
  readRegistrySkillPathFromBlobPath,
  buildVersionChecksumFromBlobEntries,
  isInstalledSkillMetadataCurrent,
  readInstalledSkillMetadataFromUnknown,
  buildRegistryListCacheKey,
  buildRegistryTreeCacheKey,
  isSafeRelativePath,
  resolveAppDataSkillsRoot,
};
