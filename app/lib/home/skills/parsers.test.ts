/**
 * Test module verifying parsers behavior.
 */
import { describe, expect, it } from "vitest";
import {
  readSkillCatalogList,
  readSkillRegistryCatalogList,
  readThreadSkillSelectionList,
} from "~/lib/home/skills/parsers";

describe("readSkillCatalogList", () => {
  it("parses valid entries and de-duplicates by location", () => {
    const result = readSkillCatalogList([
      {
        name: "local-playground-dev",
        description: "Local Playground workflow",
        location: "/repo/skills/default/local-playground-dev/SKILL.md",
        source: "workspace",
      },
      {
        name: "codex-shared",
        description: "Loaded from CODEX_HOME",
        location: "/Users/hiroki/.codex/skills/codex-shared/SKILL.md",
        source: "codex_home",
      },
      {
        name: "shared-skill",
        description: "Shared from app data",
        location: "/Users/hiroki/.foundry_local_playground/skills/shared-skill/SKILL.md",
        source: "app_data",
      },
      {
        name: "invalid",
      },
    ]);

    expect(result).toEqual([
      {
        name: "local-playground-dev",
        description: "Local Playground workflow",
        location: "/repo/skills/default/local-playground-dev/SKILL.md",
        source: "workspace",
      },
      {
        name: "codex-shared",
        description: "Loaded from CODEX_HOME",
        location: "/Users/hiroki/.codex/skills/codex-shared/SKILL.md",
        source: "codex_home",
      },
      {
        name: "shared-skill",
        description: "Shared from app data",
        location: "/Users/hiroki/.foundry_local_playground/skills/shared-skill/SKILL.md",
        source: "app_data",
      },
    ]);
  });
});

describe("readThreadSkillSelectionList", () => {
  it("parses valid selections and removes duplicates", () => {
    const result = readThreadSkillSelectionList([
      {
        name: "local-playground-dev",
        location: "/repo/skills/default/local-playground-dev/SKILL.md",
      },
      {
        name: "duplicate",
        location: "/repo/skills/default/local-playground-dev/SKILL.md",
      },
      {
        name: "",
        location: "/repo/skills/invalid/SKILL.md",
      },
    ]);

    expect(result).toEqual([
      {
        name: "local-playground-dev",
        location: "/repo/skills/default/local-playground-dev/SKILL.md",
      },
    ]);
  });
});

describe("readSkillRegistryCatalogList", () => {
  it("parses catalogs and de-duplicates by registry id and skill name", () => {
    const result = readSkillRegistryCatalogList([
      {
        registryId: "openai_curated",
        registryLabel: "OpenAI Curated",
        registryDescription: "Official curated skills",
        repository: "openai/skills",
        repositoryUrl: "https://github.com/openai/skills",
        sourcePath: "skills/.curated",
        skills: [
          {
            name: "gh-fix-ci",
            description: "Fix CI checks",
            remotePath: "skills/.curated/gh-fix-ci",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/openai-curated/gh-fix-ci/SKILL.md",
            isInstalled: false,
          },
          {
            name: "gh-fix-ci",
            description: "duplicate",
            remotePath: "skills/.curated/gh-fix-ci",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/openai-curated/gh-fix-ci/SKILL.md",
            isInstalled: false,
          },
        ],
      },
      {
        registryId: "openai_curated",
        registryLabel: "duplicate",
        registryDescription: "duplicate",
        repository: "openai/skills",
        repositoryUrl: "https://github.com/openai/skills",
        sourcePath: "skills/.curated",
        skills: [],
      },
      {
        registryId: "anthropic_public",
        registryLabel: "Anthropic Public",
        registryDescription: "Public skills",
        repository: "anthropics/skills",
        repositoryUrl: "https://github.com/anthropics/skills",
        sourcePath: "skills",
        skills: [
          {
            name: "pdf",
            description: "Work with PDF files",
            remotePath: "skills/pdf",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/anthropic-public/pdf/SKILL.md",
            isInstalled: true,
          },
        ],
      },
      {
        registryId: "invalid_registry",
        registryLabel: "invalid",
        registryDescription: "invalid",
        repository: "invalid/repo",
        repositoryUrl: "https://example.com",
        sourcePath: "skills",
        skills: [],
      },
    ]);

    expect(result).toEqual([
      {
        registryId: "openai_curated",
        registryLabel: "OpenAI Curated",
        registryDescription: "Official curated skills",
        repository: "openai/skills",
        repositoryUrl: "https://github.com/openai/skills",
        sourcePath: "skills/.curated",
        skills: [
          {
            name: "gh-fix-ci",
            description: "Fix CI checks",
            remotePath: "skills/.curated/gh-fix-ci",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/openai-curated/gh-fix-ci/SKILL.md",
            isInstalled: false,
          },
        ],
      },
      {
        registryId: "anthropic_public",
        registryLabel: "Anthropic Public",
        registryDescription: "Public skills",
        repository: "anthropics/skills",
        repositoryUrl: "https://github.com/anthropics/skills",
        sourcePath: "skills",
        skills: [
          {
            name: "pdf",
            description: "Work with PDF files",
            remotePath: "skills/pdf",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/anthropic-public/pdf/SKILL.md",
            isInstalled: true,
          },
        ],
      },
    ]);
  });
});
