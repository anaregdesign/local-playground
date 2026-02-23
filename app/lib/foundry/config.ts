import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOUNDRY_SQLITE_DATABASE_FILE_NAME,
  FOUNDRY_LEGACY_CONFIG_DIRECTORY_NAME,
  FOUNDRY_SKILLS_DIRECTORY_NAME,
  FOUNDRY_WINDOWS_CONFIG_DIRECTORY_NAME,
} from "~/lib/constants";

type ResolveFoundryConfigDirectoryOptions = {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  appDataDirectory?: string | null;
  xdgDataHomeDirectory?: string | null;
};

type ResolveFoundryDatabaseUrlOptions = ResolveFoundryConfigDirectoryOptions & {
  envDatabaseUrl?: string | null;
  cwd?: string;
};

type NormalizePrismaSqliteDatabaseUrlOptions = {
  cwd?: string;
  platform: NodeJS.Platform;
};

export function resolveLegacyFoundryConfigDirectory(
  options: ResolveFoundryConfigDirectoryOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  return pathModule.join(homeDirectory, FOUNDRY_LEGACY_CONFIG_DIRECTORY_NAME);
}

export function resolveFoundryConfigDirectory(
  options: ResolveFoundryConfigDirectoryOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();

  if (platform === "win32") {
    const appDataDirectory = (options.appDataDirectory ?? process.env.APPDATA ?? "").trim();
    if (!appDataDirectory) {
      return path.win32.join(homeDirectory, FOUNDRY_LEGACY_CONFIG_DIRECTORY_NAME);
    }

    return path.win32.join(appDataDirectory, FOUNDRY_WINDOWS_CONFIG_DIRECTORY_NAME);
  }

  if (platform === "darwin" || platform === "linux") {
    return path.posix.join(homeDirectory, FOUNDRY_LEGACY_CONFIG_DIRECTORY_NAME);
  }

  return resolveLegacyFoundryConfigDirectory(options);
}

export function resolveFoundryDatabaseFilePath(
  options: ResolveFoundryConfigDirectoryOptions = {},
): string {
  const primaryDirectoryPath = resolveFoundryConfigDirectory(options);
  const platform = options.platform ?? process.platform;
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  return pathModule.join(primaryDirectoryPath, FOUNDRY_SQLITE_DATABASE_FILE_NAME);
}

export function resolveFoundrySkillsDirectory(
  options: ResolveFoundryConfigDirectoryOptions = {},
): string {
  const primaryDirectoryPath = resolveFoundryConfigDirectory(options);
  const platform = options.platform ?? process.platform;
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  return pathModule.join(primaryDirectoryPath, FOUNDRY_SKILLS_DIRECTORY_NAME);
}

export function resolveFoundryDatabaseUrl(
  options: ResolveFoundryDatabaseUrlOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const configuredUrl =
    typeof options.envDatabaseUrl === "string" ? options.envDatabaseUrl.trim() : "";
  if (configuredUrl) {
    return normalizePrismaSqliteDatabaseUrl(configuredUrl, {
      cwd: options.cwd,
      platform,
    });
  }

  const resolvedPath = resolveFoundryDatabaseFilePath(options);
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  const fallbackPath =
    resolvedPath.trim() || pathModule.resolve(options.cwd ?? process.cwd(), "local-playground.sqlite");
  return buildPrismaSqliteDatabaseUrl(fallbackPath, platform);
}

function normalizePrismaSqliteDatabaseUrl(
  databaseUrl: string,
  options: NormalizePrismaSqliteDatabaseUrlOptions,
): string {
  if (!databaseUrl.startsWith("file:") || isInMemorySqliteDatabaseUrl(databaseUrl)) {
    return databaseUrl;
  }

  const absoluteDatabasePath = resolveSqliteDatabaseFilePath(databaseUrl, options);
  if (!absoluteDatabasePath) {
    return databaseUrl;
  }

  const queryIndex = databaseUrl.indexOf("?");
  const query = queryIndex >= 0 ? databaseUrl.slice(queryIndex) : "";
  return `${buildPrismaSqliteDatabaseUrl(absoluteDatabasePath, options.platform)}${query}`;
}

function isInMemorySqliteDatabaseUrl(databaseUrl: string): boolean {
  return (
    databaseUrl === "file:memory" ||
    databaseUrl === "file::memory:" ||
    /[?&]mode=memory(?:&|$)/i.test(databaseUrl)
  );
}

function resolveSqliteDatabaseFilePath(
  databaseUrl: string,
  options: NormalizePrismaSqliteDatabaseUrlOptions,
): string | null {
  const pathModule = options.platform === "win32" ? path.win32 : path.posix;

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
  if (pathModule.isAbsolute(decodedPath)) {
    return pathModule.normalize(decodedPath);
  }

  return pathModule.resolve(options.cwd ?? process.cwd(), decodedPath);
}

function buildPrismaSqliteDatabaseUrl(databaseFilePath: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    const normalizedPath = databaseFilePath.replaceAll("\\", "/");
    if (/^[A-Za-z]:\//.test(normalizedPath)) {
      return `file:/${normalizedPath}`;
    }

    return `file:${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
  }

  return `file:${databaseFilePath}`;
}
