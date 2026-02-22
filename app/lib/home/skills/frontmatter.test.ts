import { describe, expect, it } from "vitest";
import {
  parseSkillFrontmatter,
  validateSkillFrontmatter,
} from "~/lib/home/skills/frontmatter";

describe("parseSkillFrontmatter", () => {
  it("parses name and description from YAML frontmatter", () => {
    const parsed = parseSkillFrontmatter([
      "---",
      "name: local-playground-dev",
      "description: Local Playground compliance workflow",
      "---",
      "# Skill",
      "details",
    ].join("\n"));

    expect(parsed).toEqual({
      name: "local-playground-dev",
      description: "Local Playground compliance workflow",
    });
  });

  it("parses block scalar descriptions", () => {
    const parsed = parseSkillFrontmatter([
      "---",
      "name: local-playground-dev",
      "description: |",
      "  First line",
      "  Second line",
      "---",
      "Body",
    ].join("\n"));

    expect(parsed).toEqual({
      name: "local-playground-dev",
      description: "First line\nSecond line",
    });
  });

  it("returns null when required frontmatter is missing", () => {
    expect(parseSkillFrontmatter("# no frontmatter")).toBeNull();
  });
});

describe("validateSkillFrontmatter", () => {
  it("accepts matching skill names", () => {
    const error = validateSkillFrontmatter(
      {
        name: "local-playground-dev",
        description: "Local Playground compliance workflow",
      },
      "local-playground-dev",
    );

    expect(error).toBeNull();
  });

  it("rejects mismatched directory names", () => {
    const error = validateSkillFrontmatter(
      {
        name: "local-playground-dev",
        description: "Local Playground compliance workflow",
      },
      "another-name",
    );

    expect(error).toBe(
      'Skill directory name "another-name" must match frontmatter name "local-playground-dev".',
    );
  });
});
