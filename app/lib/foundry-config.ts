import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const LEGACY_CONFIG_DIRECTORY_NAME = ".foundry_local_playground";
const WINDOWS_CONFIG_DIRECTORY_NAME = "FoundryLocalPlayground";

type ResolveFoundryConfigDirectoryOptions = {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  appDataDirectory?: string | null;
};

export type FoundryConfigFilePaths = {
  primaryDirectoryPath: string;
  primaryFilePath: string;
  legacyFilePath: string | null;
};

export function resolveLegacyFoundryConfigDirectory(
  options: ResolveFoundryConfigDirectoryOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  return pathModule.join(homeDirectory, LEGACY_CONFIG_DIRECTORY_NAME);
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

  return path.win32.join(appDataDirectory, WINDOWS_CONFIG_DIRECTORY_NAME);
}

export function resolveFoundryConfigFilePaths(
  fileName: string,
  options: ResolveFoundryConfigDirectoryOptions = {},
): FoundryConfigFilePaths {
  const platform = options.platform ?? process.platform;
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  const primaryDirectoryPath = resolveFoundryConfigDirectory(options);
  const legacyDirectoryPath = resolveLegacyFoundryConfigDirectory(options);
  const primaryFilePath = pathModule.join(primaryDirectoryPath, fileName);
  const legacyFilePathCandidate = pathModule.join(legacyDirectoryPath, fileName);

  return {
    primaryDirectoryPath,
    primaryFilePath,
    legacyFilePath: primaryFilePath === legacyFilePathCandidate ? null : legacyFilePathCandidate,
  };
}

export function getFoundryConfigFilePaths(fileName: string): FoundryConfigFilePaths {
  return resolveFoundryConfigFilePaths(fileName);
}

export async function readFoundryConfigTextFile(
  filePaths: FoundryConfigFilePaths,
): Promise<string | null> {
  try {
    return await readFile(filePaths.primaryFilePath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  if (!filePaths.legacyFilePath) {
    return null;
  }

  try {
    return await readFile(filePaths.legacyFilePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
