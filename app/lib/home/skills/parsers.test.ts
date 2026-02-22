import { describe, expect, it } from "vitest";
import {
  readSkillCatalogList,
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
