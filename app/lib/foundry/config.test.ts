import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
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

  it("uses ~/.foundry_local_playground on macOS", () => {
    const resolved = resolveFoundryConfigDirectory({
      platform: "darwin",
      homeDirectory: "/Users/hiroki",
    });
    expect(resolved).toBe("/Users/hiroki/.foundry_local_playground");
  });

  it("uses ~/.foundry_local_playground on Linux", () => {
    const resolved = resolveFoundryConfigDirectory({
      platform: "linux",
      homeDirectory: "/home/hiroki",
    });

    expect(resolved).toBe("/home/hiroki/.foundry_local_playground");
  });
});

describe("resolveFoundryDatabaseFilePath", () => {
  it("builds SQLite path in the primary config directory", () => {
    const resolved = resolveFoundryDatabaseFilePath({
      platform: "darwin",
      homeDirectory: "/Users/hiroki",
    });

    expect(resolved).toBe("/Users/hiroki/.foundry_local_playground/local-playground.sqlite");
  });
});

describe("resolveFoundrySkillsDirectory", () => {
  it("builds Skills path in the primary config directory", () => {
    const resolved = resolveFoundrySkillsDirectory({
      platform: "darwin",
      homeDirectory: "/Users/hiroki",
    });

    expect(resolved).toBe("/Users/hiroki/.foundry_local_playground/skills");
  });
});

describe("resolveFoundryDatabaseUrl", () => {
  it("uses explicit env URL when provided", () => {
    const resolved = resolveFoundryDatabaseUrl({
      envDatabaseUrl: "file:/tmp/custom.sqlite",
    });

    expect(resolved).toBe("file:/tmp/custom.sqlite");
  });

  it("normalizes encoded sqlite file URLs for Prisma compatibility", () => {
    const resolved = resolveFoundryDatabaseUrl({
      envDatabaseUrl: "file:///tmp/foundry%20playground/custom.sqlite",
    });

    expect(resolved).toBe("file:/tmp/foundry playground/custom.sqlite");
  });

  it("falls back to file URL derived from resolved database path", () => {
    const resolved = resolveFoundryDatabaseUrl({
      platform: "linux",
      homeDirectory: "/home/hiroki",
    });

    expect(resolved).toBe("file:/home/hiroki/.foundry_local_playground/local-playground.sqlite");
  });

  it("returns a sqlite URL that Prisma can connect to even when path has spaces", async () => {
    const workingDirectory = await mkdtemp(path.join(tmpdir(), "foundry-db-url-"));
    const databaseFilePath = path.join(
      workingDirectory,
      "Application Support",
      "local-playground.sqlite",
    );
    await mkdir(path.dirname(databaseFilePath), { recursive: true });

    const encodedFileUrl = pathToFileURL(databaseFilePath).toString();
    const databaseUrl = resolveFoundryDatabaseUrl({
      envDatabaseUrl: encodedFileUrl,
    });
    expect(databaseUrl.includes("%20")).toBe(false);

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PrismaConnectionProbe" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
        )
      `);
    } finally {
      await prisma.$disconnect();
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });
});
