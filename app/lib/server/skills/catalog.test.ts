/**
 * Test module verifying catalog behavior.
 */
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverSkillCatalog,
  resolveCodexHomeDirectory,
  resolveSkillCatalogRoots,
} from "~/lib/server/skills/catalog";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0, tempDirectories.length).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("resolveCodexHomeDirectory", () => {
  it("uses explicit codex home when provided", () => {
    expect(resolveCodexHomeDirectory("/tmp/.codex-custom")).toBe("/tmp/.codex-custom");
  });
});

describe("resolveSkillCatalogRoots", () => {
  it("builds workspace default, CODEX_HOME, and app data skill roots", () => {
    const roots = resolveSkillCatalogRoots({
      workspaceRoot: "/repo/project",
      codexHome: "/Users/hiroki/.codex",
      foundryConfigDirectory: "/Users/hiroki/.foundry_local_playground",
    });

    expect(roots).toEqual([
      {
        path: "/repo/project/skills/default",
        source: "workspace",
        createIfMissing: false,
      },
      {
        path: "/Users/hiroki/.codex/skills",
        source: "codex_home",
        createIfMissing: false,
      },
      {
        path: "/Users/hiroki/.foundry_local_playground/skills",
        source: "app_data",
        createIfMissing: true,
      },
    ]);
  });

  it("uses SQLite directory for app data skills when DATABASE_URL is set", () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousLocalPlaygroundDatabaseUrl = process.env.LOCAL_PLAYGROUND_DATABASE_URL;
    process.env.DATABASE_URL = "file:/tmp/local-playground.sqlite";
    delete process.env.LOCAL_PLAYGROUND_DATABASE_URL;

    try {
      const roots = resolveSkillCatalogRoots({
        workspaceRoot: "/repo/project",
        codexHome: "/Users/hiroki/.codex",
      });

      expect(roots[2]).toEqual({
        path: "/tmp/skills",
        source: "app_data",
        createIfMissing: true,
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }

      if (previousLocalPlaygroundDatabaseUrl === undefined) {
        delete process.env.LOCAL_PLAYGROUND_DATABASE_URL;
      } else {
        process.env.LOCAL_PLAYGROUND_DATABASE_URL = previousLocalPlaygroundDatabaseUrl;
      }
    }
  });
});

describe("discoverSkillCatalog", () => {
  it("discovers valid skills from workspace default skills directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "skill-workspace-"));
    const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
    const foundryConfigDirectory = await mkdtemp(path.join(tmpdir(), "skill-foundry-"));
    tempDirectories.push(workspaceRoot, codexHome, foundryConfigDirectory);

    const skillDirectory = path.join(workspaceRoot, "skills", "default", "local-playground-dev");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      path.join(skillDirectory, "SKILL.md"),
      [
        "---",
        "name: local-playground-dev",
        "description: Local Playground compliance workflow",
        "---",
        "# Skill",
      ].join("\n"),
      "utf8",
    );

    const result = await discoverSkillCatalog({
      workspaceRoot,
      codexHome,
      foundryConfigDirectory,
    });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      name: "local-playground-dev",
      description: "Local Playground compliance workflow",
      source: "workspace",
    });
    expect(result.warnings).toEqual([]);
  });

  it("reports warnings for invalid frontmatter", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "skill-invalid-"));
    const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
    const foundryConfigDirectory = await mkdtemp(path.join(tmpdir(), "skill-foundry-"));
    tempDirectories.push(workspaceRoot, codexHome, foundryConfigDirectory);

    const skillDirectory = path.join(workspaceRoot, "skills", "default", "bad-skill");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, "SKILL.md"), "# missing frontmatter", "utf8");

    const result = await discoverSkillCatalog({
      workspaceRoot,
      codexHome,
      foundryConfigDirectory,
    });

    expect(result.skills).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("creates app data skills directory when missing", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "skill-workspace-"));
    const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
    const foundryConfigDirectory = path.join(
      await mkdtemp(path.join(tmpdir(), "skill-foundry-parent-")),
      "nested-config",
    );
    tempDirectories.push(workspaceRoot, codexHome, path.dirname(foundryConfigDirectory));

    await discoverSkillCatalog({
      workspaceRoot,
      codexHome,
      foundryConfigDirectory,
    });

    const appDataSkillsDirectory = path.join(foundryConfigDirectory, "skills");
    const directoryStats = await stat(appDataSkillsDirectory);
    expect(directoryStats.isDirectory()).toBe(true);
  });

  it("discovers app data skills nested under a registry directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "skill-workspace-"));
    const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
    const foundryConfigDirectory = await mkdtemp(path.join(tmpdir(), "skill-foundry-"));
    tempDirectories.push(workspaceRoot, codexHome, foundryConfigDirectory);

    const nestedSkillDirectory = path.join(
      foundryConfigDirectory,
      "skills",
      "openai-curated",
      "gh-fix-ci",
    );
    await mkdir(nestedSkillDirectory, { recursive: true });
    await writeFile(
      path.join(nestedSkillDirectory, "SKILL.md"),
      [
        "---",
        "name: gh-fix-ci",
        "description: GitHub checks troubleshooting workflow",
        "---",
        "# Skill",
      ].join("\n"),
      "utf8",
    );

    const result = await discoverSkillCatalog({
      workspaceRoot,
      codexHome,
      foundryConfigDirectory,
    });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      name: "gh-fix-ci",
      description: "GitHub checks troubleshooting workflow",
      source: "app_data",
    });
    expect(result.skills[0]?.location.endsWith("/skills/openai-curated/gh-fix-ci/SKILL.md")).toBe(
      true,
    );
    expect(result.warnings).toEqual([]);
  });
});
