/**
 * Test module verifying catalog behavior.
 */
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverSkillCatalog,
  readSkillFrontmatter,
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
  it("builds CODEX_HOME and app data skill roots", () => {
    const roots = resolveSkillCatalogRoots({
      codexHome: "/Users/hiroki/.codex",
      foundryConfigDirectory: "/Users/hiroki/.foundry_local_playground",
    });

    expect(roots).toEqual([
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
        codexHome: "/Users/hiroki/.codex",
      });

      expect(roots[1]).toEqual({
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
  it("discovers valid skills from CODEX_HOME skills directory", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
    const foundryConfigDirectory = await mkdtemp(path.join(tmpdir(), "skill-foundry-"));
    tempDirectories.push(codexHome, foundryConfigDirectory);

    const skillDirectory = path.join(codexHome, "skills", "local-playground-dev");
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
      codexHome,
      foundryConfigDirectory,
    });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      name: "local-playground-dev",
      description: "Local Playground compliance workflow",
      source: "codex_home",
    });
    expect(result.warnings).toEqual([]);
  });

  it("reports warnings for invalid frontmatter", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
    const foundryConfigDirectory = await mkdtemp(path.join(tmpdir(), "skill-foundry-"));
    tempDirectories.push(codexHome, foundryConfigDirectory);

    const skillDirectory = path.join(codexHome, "skills", "bad-skill");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, "SKILL.md"), "# missing frontmatter", "utf8");

    const result = await discoverSkillCatalog({
      codexHome,
      foundryConfigDirectory,
    });

    expect(result.skills).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("creates app data skills directory when missing", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
    const foundryConfigDirectory = path.join(
      await mkdtemp(path.join(tmpdir(), "skill-foundry-parent-")),
      "nested-config",
    );
    tempDirectories.push(codexHome, path.dirname(foundryConfigDirectory));

    await discoverSkillCatalog({
      codexHome,
      foundryConfigDirectory,
    });

    const appDataSkillsDirectory = path.join(foundryConfigDirectory, "skills");
    const directoryStats = await stat(appDataSkillsDirectory);
    expect(directoryStats.isDirectory()).toBe(true);
  });

  it("discovers app data skills nested under a registry directory", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
    const foundryConfigDirectory = await mkdtemp(path.join(tmpdir(), "skill-foundry-"));
    tempDirectories.push(codexHome, foundryConfigDirectory);

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

  it.skipIf(process.platform === "win32")(
    "continues discovery when an unreadable directory exists",
    async () => {
      const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
      const foundryConfigDirectory = await mkdtemp(path.join(tmpdir(), "skill-foundry-"));
      tempDirectories.push(codexHome, foundryConfigDirectory);

      const readableSkillDirectory = path.join(codexHome, "skills", "local-playground-dev");
      await mkdir(readableSkillDirectory, { recursive: true });
      await writeFile(
        path.join(readableSkillDirectory, "SKILL.md"),
        [
          "---",
          "name: local-playground-dev",
          "description: Local Playground compliance workflow",
          "---",
          "# Skill",
        ].join("\n"),
        "utf8",
      );

      const unreadableDirectory = path.join(codexHome, "skills", "unreadable");
      await mkdir(path.join(unreadableDirectory, "nested"), { recursive: true });
      await chmod(unreadableDirectory, 0o000);

      try {
        const result = await discoverSkillCatalog({
          codexHome,
          foundryConfigDirectory,
        });

        expect(result.skills).toHaveLength(1);
        expect(result.skills[0]).toMatchObject({
          name: "local-playground-dev",
          source: "codex_home",
        });
      } finally {
        await chmod(unreadableDirectory, 0o755).catch(() => {});
      }
    },
  );
});

describe("readSkillFrontmatter", () => {
  it("reads frontmatter without requiring full markdown parsing", async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
    tempDirectories.push(codexHome);

    const skillDirectory = path.join(codexHome, "skills", "pdf-processing");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      path.join(skillDirectory, "SKILL.md"),
      [
        "---",
        "name: pdf-processing",
        "description: Extract text and tables from PDF files, fill forms, merge documents.",
        "---",
        "# PDF Processing",
        "".padEnd(200_000, "x"),
      ].join("\n"),
      "utf8",
    );

    const frontmatter = await readSkillFrontmatter(path.join(skillDirectory, "SKILL.md"));
    expect(frontmatter).toEqual({
      name: "pdf-processing",
      description: "Extract text and tables from PDF files, fill forms, merge documents.",
    });
  });
});
