/**
 * Test module verifying registry helper behavior.
 */
import { describe, expect, it } from "vitest";
import { skillRegistryServerTestUtils } from "~/lib/server/skills/registry";

const {
  normalizeSkillName,
  readSkillNamesFromContentsPayload,
  readBlobEntriesFromTreePayload,
  readRegistrySkillPathFromBlobPath,
  buildVersionChecksumFromBlobEntries,
  isInstalledSkillMetadataCurrent,
  readInstalledSkillMetadataFromUnknown,
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

describe("buildVersionChecksumFromBlobEntries", () => {
  it("returns the same checksum for equivalent entries regardless of order", () => {
    const left = buildVersionChecksumFromBlobEntries([
      { path: "skills/.curated/gh-fix-ci/scripts/run.mjs", sha: "sha-script" },
      { path: "skills/.curated/gh-fix-ci/SKILL.md", sha: "sha-skill" },
    ]);
    const right = buildVersionChecksumFromBlobEntries([
      { path: "skills/.curated/gh-fix-ci/SKILL.md", sha: "sha-skill" },
      { path: "skills/.curated/gh-fix-ci/scripts/run.mjs", sha: "sha-script" },
    ]);

    expect(left).toBe(right);
  });
});

describe("readRegistrySkillPathFromBlobPath", () => {
  it("extracts normalized skill path for flat registry layouts", () => {
    const skillPath = readRegistrySkillPathFromBlobPath({
      registry: {
        id: "openai_curated",
        label: "OpenAI Curated",
        description: "Official curated Skill registry from openai/skills.",
        repository: "openai/skills",
        ref: "main",
        sourcePath: "skills/.curated",
        sourceUrl: "https://github.com/openai/skills/tree/main/skills/.curated",
        installDirectoryName: "openai-curated",
        skillPathLayout: "flat",
      },
      sourceRootPath: "skills/.curated",
      blobPath: "skills/.curated/gh-fix-ci/SKILL.md",
    });

    expect(skillPath).toBe("gh-fix-ci");
  });

  it("extracts normalized skill path for tagged registry layouts", () => {
    const skillPath = readRegistrySkillPathFromBlobPath({
      registry: {
        id: "anaregdesign_public",
        label: "Anaregdesign Public",
        description: "Public tagged Skill registry from anaregdesign/skills.",
        repository: "anaregdesign/skills",
        ref: "main",
        sourcePath: "skills",
        sourceUrl: "https://github.com/anaregdesign/skills/tree/main/skills",
        installDirectoryName: "anaregdesign-public",
        skillPathLayout: "tagged",
      },
      sourceRootPath: "skills",
      blobPath: "skills/example/python-current-time/SKILL.md",
    });

    expect(skillPath).toBe("example/python-current-time");
  });
});

describe("readInstalledSkillMetadataFromUnknown", () => {
  it("reads valid metadata payloads", () => {
    const metadata = readInstalledSkillMetadataFromUnknown({
      formatVersion: 1,
      registryId: "openai_curated",
      sourcePath: "skills/.curated",
      skillName: "gh-fix-ci",
      skillPath: "gh-fix-ci",
      versionChecksum: "abc123",
    });

    expect(metadata).toEqual({
      formatVersion: 1,
      registryId: "openai_curated",
      sourcePath: "skills/.curated",
      skillName: "gh-fix-ci",
      skillPath: "gh-fix-ci",
      versionChecksum: "abc123",
    });
  });

  it("returns null for invalid metadata payloads", () => {
    expect(
      readInstalledSkillMetadataFromUnknown({
        formatVersion: 1,
        registryId: "openai_curated",
      }),
    ).toBeNull();
  });
});

describe("isInstalledSkillMetadataCurrent", () => {
  it("returns true when metadata matches the current remote version", () => {
    const isCurrent = isInstalledSkillMetadataCurrent({
      metadata: {
        formatVersion: 1,
        registryId: "openai_curated",
        sourcePath: "skills/.curated",
        skillName: "gh-fix-ci",
        skillPath: "gh-fix-ci",
        versionChecksum: "checksum",
      },
      registryId: "openai_curated",
      sourceRootPath: "skills/.curated",
      skillPath: "gh-fix-ci",
      remoteVersionChecksum: "checksum",
    });

    expect(isCurrent).toBe(true);
  });

  it("returns false when metadata does not match current remote version", () => {
    const isCurrent = isInstalledSkillMetadataCurrent({
      metadata: {
        formatVersion: 1,
        registryId: "openai_curated",
        sourcePath: "skills/.curated",
        skillName: "gh-fix-ci",
        skillPath: "gh-fix-ci",
        versionChecksum: "old",
      },
      registryId: "openai_curated",
      sourceRootPath: "skills/.curated",
      skillPath: "gh-fix-ci",
      remoteVersionChecksum: "new",
    });

    expect(isCurrent).toBe(false);
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

    expect(rootPath).toBe("/Users/hiroki/.foundry_local_playground/users/42/skills");
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

      expect(rootPath).toBe("/tmp/users/9/skills");
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
