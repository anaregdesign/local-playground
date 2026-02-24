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
  it("parses catalogs and de-duplicates by registry id and skill id", () => {
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
            id: "gh-fix-ci",
            name: "gh-fix-ci",
            description: "Fix CI checks",
            tag: null,
            remotePath: "skills/.curated/gh-fix-ci",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/openai-curated/gh-fix-ci/SKILL.md",
            isInstalled: false,
          },
          {
            id: "gh-fix-ci",
            name: "gh-fix-ci",
            description: "duplicate",
            tag: null,
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
            id: "pdf",
            name: "pdf",
            description: "Work with PDF files",
            tag: null,
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
      {
        registryId: "anaregdesign_public",
        registryLabel: "Anaregdesign Public",
        registryDescription: "Tagged skills",
        repository: "anaregdesign/skills",
        repositoryUrl: "https://github.com/anaregdesign/skills",
        sourcePath: "skills",
        skills: [
          {
            id: "example/python-current-time",
            name: "python-current-time",
            description: "Read current time",
            tag: "example",
            remotePath: "skills/example/python-current-time",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/anaregdesign-public/example/python-current-time/SKILL.md",
            isInstalled: false,
          },
          {
            id: "finance/nisa-growth-tech",
            name: "nisa-growth-tech",
            description: "NISA helper",
            tag: "finance",
            remotePath: "skills/finance/nisa-growth-tech",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/anaregdesign-public/finance/nisa-growth-tech/SKILL.md",
            isInstalled: true,
          },
        ],
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
            id: "gh-fix-ci",
            name: "gh-fix-ci",
            description: "Fix CI checks",
            tag: null,
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
            id: "pdf",
            name: "pdf",
            description: "Work with PDF files",
            tag: null,
            remotePath: "skills/pdf",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/anthropic-public/pdf/SKILL.md",
            isInstalled: true,
          },
        ],
      },
      {
        registryId: "anaregdesign_public",
        registryLabel: "Anaregdesign Public",
        registryDescription: "Tagged skills",
        repository: "anaregdesign/skills",
        repositoryUrl: "https://github.com/anaregdesign/skills",
        sourcePath: "skills",
        skills: [
          {
            id: "example/python-current-time",
            name: "python-current-time",
            description: "Read current time",
            tag: "example",
            remotePath: "skills/example/python-current-time",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/anaregdesign-public/example/python-current-time/SKILL.md",
            isInstalled: false,
          },
          {
            id: "finance/nisa-growth-tech",
            name: "nisa-growth-tech",
            description: "NISA helper",
            tag: "finance",
            remotePath: "skills/finance/nisa-growth-tech",
            installLocation:
              "/Users/hiroki/.foundry_local_playground/skills/anaregdesign-public/finance/nisa-growth-tech/SKILL.md",
            isInstalled: true,
          },
        ],
      },
    ]);
  });
});
