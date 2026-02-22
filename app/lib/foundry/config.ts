import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
};

type ResolveFoundryDatabaseUrlOptions = ResolveFoundryConfigDirectoryOptions & {
  envDatabaseUrl?: string | null;
  cwd?: string;
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
  const legacyDirectory = resolveLegacyFoundryConfigDirectory(options);

  if (platform !== "win32") {
    return legacyDirectory;
  }

  const appDataDirectory = (options.appDataDirectory ?? process.env.APPDATA ?? "").trim();
  if (!appDataDirectory) {
    return legacyDirectory;
  }

  return path.win32.join(appDataDirectory, FOUNDRY_WINDOWS_CONFIG_DIRECTORY_NAME);
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
  const configuredUrl =
    typeof options.envDatabaseUrl === "string" ? options.envDatabaseUrl.trim() : "";
  if (configuredUrl) {
    return configuredUrl;
  }

  const resolvedPath = resolveFoundryDatabaseFilePath(options);
  const fallbackPath =
    resolvedPath.trim() || path.resolve(options.cwd ?? process.cwd(), "local-playground.sqlite");
  return pathToFileURL(fallbackPath).toString();
}
