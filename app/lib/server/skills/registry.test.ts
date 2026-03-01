/**
 * Test module verifying registry helper behavior.
 */
import { describe, expect, it } from "vitest";
import { skillRegistryServerTestUtils } from "~/lib/server/skills/registry";

const {
  normalizeSkillName,
  readSkillNamesFromContentsPayload,
  readBlobEntriesFromTreePayload,
  buildRegistryListCacheKey,
  buildRegistryTreeCacheKey,
  isSafeRelativePath,
  resolveAppDataSkillsRoot,
} = skillRegistryServerTestUtils;

describe("normalizeSkillName", () => {
  it("accepts lower-case kebab-case names", () => {
    expect(normalizeSkillName("gh-fix-ci")).toBe("gh-fix-ci");
  });

  it("rejects invalid names", () => {
    expect(normalizeSkillName("GH_FIX_CI")).toBe("");
    expect(normalizeSkillName("gh fix ci")).toBe("");
    expect(normalizeSkillName("")).toBe("");
  });
});

describe("readSkillNamesFromContentsPayload", () => {
  it("parses and de-duplicates valid directory names", () => {
    const result = readSkillNamesFromContentsPayload([
      { name: "gh-fix-ci", type: "dir" },
      { name: "gh-fix-ci", type: "dir" },
      { name: "README.md", type: "file" },
      { name: "Not-Valid", type: "dir" },
    ]);

    expect(result).toEqual(["gh-fix-ci"]);
  });

  it("throws when payload is not an array", () => {
    expect(() => {
      readSkillNamesFromContentsPayload({ invalid: true });
    }).toThrow("Unexpected registry listing response.");
  });
});

describe("readBlobEntriesFromTreePayload", () => {
  it("returns sorted unique blob entries", () => {
    const result = readBlobEntriesFromTreePayload({
      truncated: false,
      tree: [
        { type: "blob", path: "skills/.curated/gh-fix-ci/SKILL.md", sha: "sha-skill" },
        { type: "blob", path: "skills/.curated/gh-fix-ci/scripts/run.mjs", sha: "sha-script" },
        { type: "tree", path: "skills/.curated/gh-fix-ci/scripts" },
        { type: "blob", path: "skills/.curated/gh-fix-ci/SKILL.md", sha: "sha-skill" },
      ],
    });

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { path: "skills/.curated/gh-fix-ci/SKILL.md", sha: "sha-skill" },
        { path: "skills/.curated/gh-fix-ci/scripts/run.mjs", sha: "sha-script" },
      ]),
    );
  });

  it("rejects truncated responses", () => {
    expect(() => {
      readBlobEntriesFromTreePayload({
        truncated: true,
        tree: [],
      });
    }).toThrow("Git tree response is truncated.");
  });
});

describe("cache key helpers", () => {
  it("builds stable cache keys", () => {
    const listCacheKey = buildRegistryListCacheKey({
      id: "openai_curated",
      label: "OpenAI Curated",
      description: "Official curated Skill registry from openai/skills.",
      repository: "openai/skills",
      ref: "main",
      sourcePath: "skills/.curated",
      sourceUrl: "https://github.com/openai/skills/tree/main/skills/.curated",
      installDirectoryName: "openai-curated",
      skillPathLayout: "flat",
    });
    const treeCacheKey = buildRegistryTreeCacheKey({
      id: "openai_curated",
      label: "OpenAI Curated",
      description: "Official curated Skill registry from openai/skills.",
      repository: "openai/skills",
      ref: "main",
      sourcePath: "skills/.curated",
      sourceUrl: "https://github.com/openai/skills/tree/main/skills/.curated",
      installDirectoryName: "openai-curated",
      skillPathLayout: "flat",
    });

    expect(listCacheKey).toContain("skill_registry_list:");
    expect(treeCacheKey).toContain("skill_registry_tree:");
  });
});

describe("isSafeRelativePath", () => {
  it("accepts valid relative file paths", () => {
    expect(isSafeRelativePath("scripts/run.mjs")).toBe(true);
    expect(isSafeRelativePath("SKILL.md")).toBe(true);
  });

  it("rejects invalid paths", () => {
    expect(isSafeRelativePath("../outside.txt")).toBe(false);
    expect(isSafeRelativePath("/absolute/path")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
  });
});

describe("resolveAppDataSkillsRoot", () => {
  it("resolves a user-scoped path from configured Foundry directory", () => {
    const rootPath = resolveAppDataSkillsRoot({
      workspaceUserId: 42,
      foundryConfigDirectory: "/Users/hiroki/.foundry_local_playground",
    });

    expect(rootPath).toBe("/Users/hiroki/.foundry_local_playground/skills/42");
  });

  it("resolves a user-scoped path from DATABASE_URL", () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousLocalPlaygroundDatabaseUrl = process.env.LOCAL_PLAYGROUND_DATABASE_URL;
    process.env.DATABASE_URL = "file:/tmp/local-playground.sqlite";
    delete process.env.LOCAL_PLAYGROUND_DATABASE_URL;

    try {
      const rootPath = resolveAppDataSkillsRoot({
        workspaceUserId: 9,
      });

      expect(rootPath).toBe("/tmp/skills/9");
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
