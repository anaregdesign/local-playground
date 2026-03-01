/**
 * Test module verifying api.skills behavior.
 */
import { describe, expect, it } from "vitest";
import { skillsRouteTestUtils } from "./api.skills";

const { parseSkillRegistryMutationRequest } = skillsRouteTestUtils;

describe("parseSkillRegistryMutationRequest", () => {
  it("parses a valid skill mutation request", () => {
    const result = parseSkillRegistryMutationRequest(
      "http://localhost/api/skills?registryId=openai_curated&skillName=gh-fix-ci",
    );

    expect(result).toEqual({
      ok: true,
      value: {
        registryId: "openai_curated",
        skillName: "gh-fix-ci",
      },
    });
  });

  it("parses a valid tagged-registry request", () => {
    const result = parseSkillRegistryMutationRequest(
      "http://localhost/api/skills?registryId=anaregdesign_public&skillName=finance/nisa-growth-tech",
    );

    expect(result).toEqual({
      ok: true,
      value: {
        registryId: "anaregdesign_public",
        skillName: "finance/nisa-growth-tech",
      },
    });
  });

  it("rejects invalid request URLs", () => {
    expect(
      parseSkillRegistryMutationRequest(
        "http://localhost/api/skills?registryId=invalid_registry&skillName=gh-fix-ci",
      ),
    ).toEqual({
      ok: false,
      error: "`registryId` is invalid.",
    });

    expect(
      parseSkillRegistryMutationRequest(
        "http://localhost/api/skills?registryId=openai_curated&skillName=Invalid Name",
      ),
    ).toEqual({
      ok: false,
      error: "`skillName` must be lower-case kebab-case.",
    });

    expect(
      parseSkillRegistryMutationRequest(
        "http://localhost/api/skills?registryId=anaregdesign_public&skillName=nisa-growth-tech",
      ),
    ).toEqual({
      ok: false,
      error:
        "`skillName` must be `<tag>/<skill-name>`, and `<skill-name>` must be lower-case kebab-case.",
    });
  });
});
