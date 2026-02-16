import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readFoundryConfigTextFile,
  resolveFoundryConfigDirectory,
  resolveFoundryConfigFilePaths,
} from "./foundry-config";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directoryPath) =>
      rm(directoryPath, { recursive: true, force: true }),
    ),
  );
});

describe("resolveFoundryConfigDirectory", () => {
  it("uses APPDATA on Windows when available", () => {
    const resolved = resolveFoundryConfigDirectory({
      platform: "win32",
      homeDirectory: "C:\\Users\\hiroki",
      appDataDirectory: "C:\\Users\\hiroki\\AppData\\Roaming",
    });
    expect(resolved).toBe("C:\\Users\\hiroki\\AppData\\Roaming\\FoundryLocalPlayground");
  });

  it("falls back to legacy home path on Windows when APPDATA is missing", () => {
    const resolved = resolveFoundryConfigDirectory({
      platform: "win32",
      homeDirectory: "C:\\Users\\hiroki",
      appDataDirectory: "",
    });
    expect(resolved).toBe("C:\\Users\\hiroki\\.foundry_local_playground");
  });

  it("uses legacy hidden directory on non-Windows", () => {
    const resolved = resolveFoundryConfigDirectory({
      platform: "darwin",
      homeDirectory: "/Users/hiroki",
    });
    expect(resolved).toBe("/Users/hiroki/.foundry_local_playground");
  });
});

describe("resolveFoundryConfigFilePaths", () => {
  it("provides legacy fallback path when primary differs", () => {
    const paths = resolveFoundryConfigFilePaths("mcp-servers.json", {
      platform: "win32",
      homeDirectory: "C:\\Users\\hiroki",
      appDataDirectory: "C:\\Users\\hiroki\\AppData\\Roaming",
    });

    expect(paths.primaryFilePath).toBe(
      "C:\\Users\\hiroki\\AppData\\Roaming\\FoundryLocalPlayground\\mcp-servers.json",
    );
    expect(paths.legacyFilePath).toBe("C:\\Users\\hiroki\\.foundry_local_playground\\mcp-servers.json");
  });

  it("omits legacy fallback when primary equals legacy", () => {
    const paths = resolveFoundryConfigFilePaths("azure-selection.json", {
      platform: "linux",
      homeDirectory: "/home/hiroki",
    });

    expect(paths.primaryFilePath).toBe("/home/hiroki/.foundry_local_playground/azure-selection.json");
    expect(paths.legacyFilePath).toBeNull();
  });
});

describe("readFoundryConfigTextFile", () => {
  it("reads from legacy file path when primary path is missing", async () => {
    const baseDirectory = await mkdtemp(path.join(tmpdir(), "foundry-config-test-"));
    tempDirectories.push(baseDirectory);
    const legacyDirectoryPath = path.join(baseDirectory, "legacy");
    const legacyFilePath = path.join(legacyDirectoryPath, "mcp-servers.json");
    await mkdir(legacyDirectoryPath, { recursive: true });
    await writeFile(legacyFilePath, "[{\"name\":\"sample\"}]\n", "utf8");

    const content = await readFoundryConfigTextFile({
      primaryDirectoryPath: path.join(baseDirectory, "primary"),
      primaryFilePath: path.join(baseDirectory, "primary", "mcp-servers.json"),
      legacyFilePath,
    });

    expect(content).toBe("[{\"name\":\"sample\"}]\n");
  });

  it("returns null when both primary and legacy files are absent", async () => {
    const baseDirectory = await mkdtemp(path.join(tmpdir(), "foundry-config-test-"));
    tempDirectories.push(baseDirectory);

    const content = await readFoundryConfigTextFile({
      primaryDirectoryPath: path.join(baseDirectory, "primary"),
      primaryFilePath: path.join(baseDirectory, "primary", "azure-selection.json"),
      legacyFilePath: path.join(baseDirectory, "legacy", "azure-selection.json"),
    });

    expect(content).toBeNull();
  });
});
