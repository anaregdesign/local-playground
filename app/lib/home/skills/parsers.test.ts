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
        location: "/repo/skills/local-playground-dev/SKILL.md",
        source: "workspace",
      },
      {
        name: "duplicate",
        description: "Duplicate",
        location: "/repo/skills/local-playground-dev/SKILL.md",
        source: "workspace",
      },
      {
        name: "invalid",
      },
    ]);

    expect(result).toEqual([
      {
        name: "local-playground-dev",
        description: "Local Playground workflow",
        location: "/repo/skills/local-playground-dev/SKILL.md",
        source: "workspace",
      },
    ]);
  });
});

describe("readThreadSkillSelectionList", () => {
  it("parses valid selections and removes duplicates", () => {
    const result = readThreadSkillSelectionList([
      {
        name: "local-playground-dev",
        location: "/repo/skills/local-playground-dev/SKILL.md",
      },
      {
        name: "duplicate",
        location: "/repo/skills/local-playground-dev/SKILL.md",
      },
      {
        name: "",
        location: "/repo/skills/invalid/SKILL.md",
      },
    ]);

    expect(result).toEqual([
      {
        name: "local-playground-dev",
        location: "/repo/skills/local-playground-dev/SKILL.md",
      },
    ]);
  });
});
