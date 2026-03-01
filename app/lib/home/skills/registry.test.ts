/**
 * Test module verifying skill registry option helpers.
 */
import { describe, expect, it } from "vitest";
import {
  isSkillRegistryId,
  parseSkillRegistrySkillName,
  readSkillRegistryLabelFromSkillLocation,
  readSkillRegistrySkillNameValidationMessage,
} from "~/lib/home/skills/registry";

describe("isSkillRegistryId", () => {
  it("includes known registry ids", () => {
    expect(isSkillRegistryId("openai_curated")).toBe(true);
    expect(isSkillRegistryId("anaregdesign_public")).toBe(true);
    expect(isSkillRegistryId("invalid_registry")).toBe(false);
  });
});

describe("parseSkillRegistrySkillName", () => {
  it("parses flat registry skill names", () => {
    expect(parseSkillRegistrySkillName("openai_curated", "gh-fix-ci")).toEqual({
      normalizedSkillName: "gh-fix-ci",
      skillName: "gh-fix-ci",
      tag: null,
    });
  });

  it("rejects flat registry names with path separators", () => {
    expect(parseSkillRegistrySkillName("openai_curated", "finance/nisa-growth-tech")).toBeNull();
  });

  it("parses tagged registry skill names", () => {
    expect(parseSkillRegistrySkillName("anaregdesign_public", "finance/nisa-growth-tech")).toEqual(
      {
        normalizedSkillName: "finance/nisa-growth-tech",
        skillName: "nisa-growth-tech",
        tag: "finance",
      },
    );
  });

  it("rejects tagged registry values without tag", () => {
    expect(parseSkillRegistrySkillName("anaregdesign_public", "nisa-growth-tech")).toBeNull();
  });
});

describe("readSkillRegistrySkillNameValidationMessage", () => {
  it("returns a registry-specific message", () => {
    expect(readSkillRegistrySkillNameValidationMessage("openai_curated")).toBe(
      "`skillName` must be lower-case kebab-case.",
    );
    expect(readSkillRegistrySkillNameValidationMessage("anaregdesign_public")).toBe(
      "`skillName` must be `<tag>/<skill-name>`, and `<skill-name>` must be lower-case kebab-case.",
    );
  });
});

describe("readSkillRegistryLabelFromSkillLocation", () => {
  it("returns the registry label for installed app-data paths", () => {
    expect(
      readSkillRegistryLabelFromSkillLocation(
        "/Users/test/.foundry_local_playground/skills/42/anaregdesign-public/finance/nisa-growth-tech/SKILL.md",
      ),
    ).toBe("Anaregdesign Public");
  });
});
