/**
 * Test module verifying api.skills behavior.
 */
import { describe, expect, it } from "vitest";
import { skillsRouteTestUtils } from "./api.skills";

const { parseSkillRegistryActionPayload } = skillsRouteTestUtils;

describe("parseSkillRegistryActionPayload", () => {
  it("parses a valid install request", () => {
    const result = parseSkillRegistryActionPayload({
      action: "install_registry_skill",
      registryId: "openai_curated",
      skillName: "gh-fix-ci",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        action: "install_registry_skill",
        registryId: "openai_curated",
        skillName: "gh-fix-ci",
      },
    });
  });

  it("parses a valid workspace install request", () => {
    const result = parseSkillRegistryActionPayload({
      action: "install_registry_skill",
      registryId: "workspace_local",
      skillName: "local-playground-dev",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        action: "install_registry_skill",
        registryId: "workspace_local",
        skillName: "local-playground-dev",
      },
    });
  });

  it("parses a valid delete request", () => {
    const result = parseSkillRegistryActionPayload({
      action: "delete_registry_skill",
      registryId: "anthropic_public",
      skillName: "pdf",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        action: "delete_registry_skill",
        registryId: "anthropic_public",
        skillName: "pdf",
      },
    });
  });

  it("parses a valid tagged-registry install request", () => {
    const result = parseSkillRegistryActionPayload({
      action: "install_registry_skill",
      registryId: "anaregdesign_public",
      skillName: "finance/nisa-growth-tech",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        action: "install_registry_skill",
        registryId: "anaregdesign_public",
        skillName: "finance/nisa-growth-tech",
      },
    });
  });

  it("rejects invalid payloads", () => {
    expect(parseSkillRegistryActionPayload(null)).toEqual({
      ok: false,
      error: "Invalid request payload.",
    });

    expect(
      parseSkillRegistryActionPayload({
        action: "unsupported",
        registryId: "openai_curated",
        skillName: "gh-fix-ci",
      }),
    ).toEqual({
      ok: false,
      error: "`action` must be \"install_registry_skill\" or \"delete_registry_skill\".",
    });

    expect(
      parseSkillRegistryActionPayload({
        action: "install_registry_skill",
        registryId: "invalid_registry",
        skillName: "gh-fix-ci",
      }),
    ).toEqual({
      ok: false,
      error: "`registryId` is invalid.",
    });

    expect(
      parseSkillRegistryActionPayload({
        action: "install_registry_skill",
        registryId: "openai_curated",
        skillName: "Invalid Name",
      }),
    ).toEqual({
      ok: false,
      error: "`skillName` must be lower-case kebab-case.",
    });

    expect(
      parseSkillRegistryActionPayload({
        action: "install_registry_skill",
        registryId: "anaregdesign_public",
        skillName: "nisa-growth-tech",
      }),
    ).toEqual({
      ok: false,
      error:
        "`skillName` must be `<tag>/<skill-name>`, and `<skill-name>` must be lower-case kebab-case.",
    });
  });
});
