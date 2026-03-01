/**
 * Test module verifying api.skills behavior.
 */
import { describe, expect, it } from "vitest";
import { skillsRouteTestUtils } from "./api.skills";

const { parseSkillRegistryMutationPath } = skillsRouteTestUtils;

describe("parseSkillRegistryMutationPath", () => {
  it("parses a valid skill mutation request", () => {
    const result = parseSkillRegistryMutationPath("openai_curated", "gh-fix-ci");

    expect(result).toEqual({
      ok: true,
      value: {
        registryId: "openai_curated",
        skillName: "gh-fix-ci",
      },
    });
  });

  it("parses a valid tagged-registry request", () => {
    const result = parseSkillRegistryMutationPath(
      "anaregdesign_public",
      "finance/nisa-growth-tech",
    );

    expect(result).toEqual({
      ok: true,
      value: {
        registryId: "anaregdesign_public",
        skillName: "finance/nisa-growth-tech",
      },
    });
  });

  it("rejects invalid mutation path inputs", () => {
    expect(parseSkillRegistryMutationPath("invalid_registry", "gh-fix-ci")).toEqual({
      ok: false,
      error: "`registryId` is invalid.",
    });

    expect(parseSkillRegistryMutationPath("openai_curated", "Invalid Name")).toEqual({
      ok: false,
      error: "`skillName` must be lower-case kebab-case.",
    });

    expect(parseSkillRegistryMutationPath("anaregdesign_public", "nisa-growth-tech")).toEqual({
      ok: false,
      error:
        "`skillName` must be `<tag>/<skill-name>`, and `<skill-name>` must be lower-case kebab-case.",
    });
  });
});
