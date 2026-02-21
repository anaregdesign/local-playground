import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  it("builds workspace and codex skill roots", () => {
    const roots = resolveSkillCatalogRoots({
      workspaceRoot: "/repo/project",
      codexHome: "/Users/hiroki/.codex",
    });

    expect(roots).toEqual([
      {
        path: "/repo/project/skills",
        source: "workspace",
      },
      {
        path: "/Users/hiroki/.codex/skills",
        source: "codex_home",
      },
    ]);
  });
});

describe("discoverSkillCatalog", () => {
  it("discovers valid skills from workspace skills directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "skill-workspace-"));
    const codexHome = await mkdtemp(path.join(tmpdir(), "skill-codex-"));
    tempDirectories.push(workspaceRoot, codexHome);

    const skillDirectory = path.join(workspaceRoot, "skills", "local-playground-dev");
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
    tempDirectories.push(workspaceRoot, codexHome);

    const skillDirectory = path.join(workspaceRoot, "skills", "bad-skill");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, "SKILL.md"), "# missing frontmatter", "utf8");

    const result = await discoverSkillCatalog({
      workspaceRoot,
      codexHome,
    });

    expect(result.skills).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
