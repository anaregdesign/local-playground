/**
 * Test module verifying api.skill-registries.$registryId.skills.$ behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  parseSkillRegistryMutationPath,
  readAuthenticatedUser,
  syncWorkspaceSkillMasters,
  readErrorMessage,
  installSkillFromRegistry,
  deleteInstalledSkillFromRegistry,
  discoverSkillCatalog,
  discoverSkillRegistries,
  logServerRouteEvent,
} = vi.hoisted(() => ({
  parseSkillRegistryMutationPath: vi.fn(() => ({
    ok: true as const,
    value: {
      registryId: "openai_curated",
      skillName: "gh-fix-ci",
    },
  })),
  readAuthenticatedUser: vi.fn(async () => ({ id: 1 })),
  syncWorkspaceSkillMasters: vi.fn(async () => undefined),
  readErrorMessage: vi.fn(() => "Unknown error."),
  installSkillFromRegistry: vi.fn(async () => ({
    skillName: "gh-fix-ci",
    installLocation: "/tmp/gh-fix-ci/SKILL.md",
    installed: true,
    skippedAsDuplicate: false,
  })),
  deleteInstalledSkillFromRegistry: vi.fn(async () => ({
    skillName: "gh-fix-ci",
    installLocation: "/tmp/gh-fix-ci/SKILL.md",
    removed: true,
  })),
  discoverSkillCatalog: vi.fn(async () => ({ skills: [], warnings: [] })),
  discoverSkillRegistries: vi.fn(async () => ({ catalogs: [], warnings: [] })),
  logServerRouteEvent: vi.fn(async () => undefined),
}));

vi.mock("./api.skills", () => ({
  parseSkillRegistryMutationPath,
  readAuthenticatedUser,
  syncWorkspaceSkillMasters,
  readErrorMessage,
}));

vi.mock("~/lib/server/skills/registry", () => ({
  installSkillFromRegistry,
  deleteInstalledSkillFromRegistry,
  discoverSkillRegistries,
}));

vi.mock("~/lib/server/skills/catalog", () => ({
  discoverSkillCatalog,
}));

vi.mock("~/lib/server/observability/runtime-event-log", () => ({
  installGlobalServerErrorLogging: vi.fn(),
  logServerRouteEvent,
}));

import { action, loader } from "./api.skill-registries.$registryId.skills.$";

describe("/api/skill-registries/:registryId/skills/*", () => {
  beforeEach(() => {
    parseSkillRegistryMutationPath.mockReset();
    parseSkillRegistryMutationPath.mockReturnValue({
      ok: true,
      value: {
        registryId: "openai_curated",
        skillName: "gh-fix-ci",
      },
    });
    readAuthenticatedUser.mockReset();
    readAuthenticatedUser.mockResolvedValue({ id: 1 });
    syncWorkspaceSkillMasters.mockReset();
    syncWorkspaceSkillMasters.mockResolvedValue(undefined);
    readErrorMessage.mockReset();
    readErrorMessage.mockReturnValue("Unknown error.");
    installSkillFromRegistry.mockReset();
    installSkillFromRegistry.mockResolvedValue({
      skillName: "gh-fix-ci",
      installLocation: "/tmp/gh-fix-ci/SKILL.md",
      installed: true,
      skippedAsDuplicate: false,
    });
    deleteInstalledSkillFromRegistry.mockReset();
    deleteInstalledSkillFromRegistry.mockResolvedValue({
      skillName: "gh-fix-ci",
      installLocation: "/tmp/gh-fix-ci/SKILL.md",
      removed: true,
    });
    discoverSkillCatalog.mockReset();
    discoverSkillCatalog.mockResolvedValue({ skills: [], warnings: [] });
    discoverSkillRegistries.mockReset();
    discoverSkillRegistries.mockResolvedValue({ catalogs: [], warnings: [] });
    logServerRouteEvent.mockReset();
    logServerRouteEvent.mockResolvedValue(undefined);
  });

  it("returns 405 response with Allow header for loader", async () => {
    const response = loader();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PUT, DELETE");
  });

  it("returns 405 for unsupported methods", async () => {
    const response = await action({
      request: new Request("http://localhost/api/skill-registries/openai_curated/skills/gh-fix-ci", {
        method: "GET",
      }),
      params: {
        registryId: "openai_curated",
        "*": "gh-fix-ci",
      },
    } as never);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PUT, DELETE");
  });

  it("returns 201 and Location for new install", async () => {
    const response = await action({
      request: new Request("http://localhost/api/skill-registries/openai_curated/skills/gh-fix-ci", {
        method: "PUT",
      }),
      params: {
        registryId: "openai_curated",
        "*": "gh-fix-ci",
      },
    } as never);

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      "/api/skill-registries/openai_curated/skills/gh-fix-ci",
    );
  });
});
