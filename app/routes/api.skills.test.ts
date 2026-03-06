/**
 * Test module verifying api.skills behavior.
 */
import { describe, expect, it } from "vitest";
import { skillsRouteTestUtils } from "./api.skills";

const { parseSkillRegistryMutationPath } = skillsRouteTestUtils;
const { readSkillRegistryRefreshQueryFlag } = skillsRouteTestUtils;
const { readWorkspaceSkillProfileReconcilePayloadFromUnknown } = skillsRouteTestUtils;

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

describe("readSkillRegistryRefreshQueryFlag", () => {
  it("returns true for supported refresh query values", () => {
    expect(readSkillRegistryRefreshQueryFlag("http://localhost/api/skills?refresh=1")).toBe(true);
    expect(readSkillRegistryRefreshQueryFlag("http://localhost/api/skills?refresh=true")).toBe(true);
    expect(readSkillRegistryRefreshQueryFlag("http://localhost/api/skills?refresh=yes")).toBe(true);
  });

  it("returns false for unsupported or missing refresh query values", () => {
    expect(readSkillRegistryRefreshQueryFlag("http://localhost/api/skills")).toBe(false);
    expect(readSkillRegistryRefreshQueryFlag("http://localhost/api/skills?refresh=0")).toBe(false);
    expect(readSkillRegistryRefreshQueryFlag("http://localhost/api/skills?refresh=no")).toBe(false);
    expect(readSkillRegistryRefreshQueryFlag("not-a-url")).toBe(false);
  });
});

describe("readWorkspaceSkillProfileReconcilePayloadFromUnknown", () => {
  it("defaults to forceRefresh=false when omitted", () => {
    expect(readWorkspaceSkillProfileReconcilePayloadFromUnknown({})).toEqual({
      ok: true,
      value: {
        forceRefresh: false,
      },
    });
  });

  it("accepts explicit boolean forceRefresh value", () => {
    expect(
      readWorkspaceSkillProfileReconcilePayloadFromUnknown({
        forceRefresh: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        forceRefresh: true,
      },
    });
  });

  it("rejects non-object and invalid forceRefresh values", () => {
    expect(readWorkspaceSkillProfileReconcilePayloadFromUnknown(null)).toEqual({
      ok: false,
      error: "Request body must be a JSON object.",
    });
    expect(
      readWorkspaceSkillProfileReconcilePayloadFromUnknown({
        forceRefresh: "true",
      }),
    ).toEqual({
      ok: false,
      error: "`forceRefresh` must be a boolean.",
    });
  });
});
