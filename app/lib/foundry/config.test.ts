import { describe, expect, it } from "vitest";
import {
  resolveFoundryDatabaseFilePath,
  resolveFoundryDatabaseUrl,
  resolveFoundryConfigDirectory,
  resolveFoundrySkillsDirectory,
} from "./config";

describe("resolveFoundryConfigDirectory", () => {
  it("uses APPDATA on Windows when available", () => {
    const resolved = resolveFoundryConfigDirectory({
      platform: "win32",
      homeDirectory: "C:\\Users\\hiroki",
      appDataDirectory: "C:\\Users\\hiroki\\AppData\\Roaming",
    });
    expect(resolved).toBe("C:\\Users\\hiroki\\AppData\\Roaming\\FoundryLocalPlayground");
  });

  it("falls back to home path on Windows when APPDATA is missing", () => {
    const resolved = resolveFoundryConfigDirectory({
      platform: "win32",
      homeDirectory: "C:\\Users\\hiroki",
      appDataDirectory: "",
    });
    expect(resolved).toBe("C:\\Users\\hiroki\\.foundry_local_playground");
  });

  it("uses Application Support on macOS", () => {
    const resolved = resolveFoundryConfigDirectory({
      platform: "darwin",
      homeDirectory: "/Users/hiroki",
    });
    expect(resolved).toBe("/Users/hiroki/Library/Application Support/FoundryLocalPlayground");
  });

  it("uses XDG_DATA_HOME on Linux when available", () => {
    const resolved = resolveFoundryConfigDirectory({
      platform: "linux",
      homeDirectory: "/home/hiroki",
      xdgDataHomeDirectory: "/home/hiroki/.xdg-data",
    });

    expect(resolved).toBe("/home/hiroki/.xdg-data/FoundryLocalPlayground");
  });

  it("falls back to ~/.local/share on Linux when XDG_DATA_HOME is missing", () => {
    const resolved = resolveFoundryConfigDirectory({
      platform: "linux",
      homeDirectory: "/home/hiroki",
      xdgDataHomeDirectory: "",
    });

    expect(resolved).toBe("/home/hiroki/.local/share/FoundryLocalPlayground");
  });
});

describe("resolveFoundryDatabaseFilePath", () => {
  it("builds SQLite path in the primary config directory", () => {
    const resolved = resolveFoundryDatabaseFilePath({
      platform: "darwin",
      homeDirectory: "/Users/hiroki",
    });

    expect(resolved).toBe(
      "/Users/hiroki/Library/Application Support/FoundryLocalPlayground/local-playground.sqlite",
    );
  });
});

describe("resolveFoundrySkillsDirectory", () => {
  it("builds Skills path in the primary config directory", () => {
    const resolved = resolveFoundrySkillsDirectory({
      platform: "darwin",
      homeDirectory: "/Users/hiroki",
    });

    expect(resolved).toBe("/Users/hiroki/Library/Application Support/FoundryLocalPlayground/skills");
  });
});

describe("resolveFoundryDatabaseUrl", () => {
  it("uses explicit env URL when provided", () => {
    const resolved = resolveFoundryDatabaseUrl({
      envDatabaseUrl: "file:/tmp/custom.sqlite",
    });

    expect(resolved).toBe("file:/tmp/custom.sqlite");
  });

  it("falls back to file URL derived from resolved database path", () => {
    const resolved = resolveFoundryDatabaseUrl({
      platform: "linux",
      homeDirectory: "/home/hiroki",
    });

    expect(resolved).toBe(
      "file:///home/hiroki/.local/share/FoundryLocalPlayground/local-playground.sqlite",
    );
  });
});
