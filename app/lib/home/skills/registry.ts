/**
 * Home runtime support module.
 */
export const SKILL_REGISTRY_OPTIONS = [
  {
    id: "openai_curated",
    label: "OpenAI Curated",
    description: "Official curated Skill registry from openai/skills.",
    repository: "openai/skills",
    ref: "main",
    sourcePath: "skills/.curated",
    sourceUrl: "https://github.com/openai/skills/tree/main/skills/.curated",
    installDirectoryName: "openai-curated",
  },
  {
    id: "anthropic_public",
    label: "Anthropic Public",
    description: "Public Skill registry from anthropics/skills.",
    repository: "anthropics/skills",
    ref: "main",
    sourcePath: "skills",
    sourceUrl: "https://github.com/anthropics/skills/tree/main/skills",
    installDirectoryName: "anthropic-public",
  },
] as const;

export type SkillRegistryOption = (typeof SKILL_REGISTRY_OPTIONS)[number];
export type SkillRegistryId = SkillRegistryOption["id"];

export function isSkillRegistryId(value: unknown): value is SkillRegistryId {
  if (typeof value !== "string") {
    return false;
  }

  return SKILL_REGISTRY_OPTIONS.some((option) => option.id === value);
}

export function readSkillRegistryOptionById(
  registryId: string,
): SkillRegistryOption | null {
  const normalizedRegistryId = registryId.trim();
  if (!normalizedRegistryId) {
    return null;
  }

  for (const option of SKILL_REGISTRY_OPTIONS) {
    if (option.id === normalizedRegistryId) {
      return option;
    }
  }

  return null;
}

export function readSkillRegistryLabelFromSkillLocation(
  location: string,
): string | null {
  const normalizedLocation = location.trim().replaceAll("\\", "/");
  if (!normalizedLocation) {
    return null;
  }

  const segments = normalizedLocation.split("/").filter((segment) => segment.length > 0);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== "skills") {
      continue;
    }

    const registryDirectoryName = segments[index + 1] ?? "";
    const registry = SKILL_REGISTRY_OPTIONS.find(
      (option) => option.installDirectoryName === registryDirectoryName,
    );
    if (registry) {
      return registry.label;
    }
  }

  return null;
}
