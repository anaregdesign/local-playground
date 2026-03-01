/**
 * Home runtime support module.
 */
import { AGENT_SKILL_NAME_PATTERN } from "~/lib/constants";

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
    skillPathLayout: "flat",
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
    skillPathLayout: "flat",
  },
  {
    id: "anaregdesign_public",
    label: "Anaregdesign Public",
    description: "Public tagged Skill registry from anaregdesign/skills.",
    repository: "anaregdesign/skills",
    ref: "main",
    sourcePath: "skills",
    sourceUrl: "https://github.com/anaregdesign/skills/tree/main/skills",
    installDirectoryName: "anaregdesign-public",
    skillPathLayout: "tagged",
  },
] as const;

export type SkillRegistryOption = (typeof SKILL_REGISTRY_OPTIONS)[number];
export type SkillRegistryId = SkillRegistryOption["id"];
export type SkillRegistrySkillPathLayout = SkillRegistryOption["skillPathLayout"];

export type ParsedSkillRegistrySkillName = {
  normalizedSkillName: string;
  skillName: string;
  tag: string | null;
};

const SKILL_REGISTRY_TAG_PATTERN = /^[A-Za-z0-9._-]+$/;

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

export function parseSkillRegistrySkillName(
  registryId: SkillRegistryId,
  skillNameRaw: string,
): ParsedSkillRegistrySkillName | null {
  const registry = readSkillRegistryOptionById(registryId);
  if (!registry) {
    return null;
  }

  const segments = readNormalizedPathSegments(skillNameRaw);
  if (!segments) {
    return null;
  }

  if (registry.skillPathLayout === "flat") {
    if (segments.length !== 1) {
      return null;
    }

    const [skillName] = segments;
    if (!skillName || !AGENT_SKILL_NAME_PATTERN.test(skillName)) {
      return null;
    }

    return {
      normalizedSkillName: skillName,
      skillName,
      tag: null,
    };
  }

  if (segments.length !== 2) {
    return null;
  }

  const [tag, skillName] = segments;
  if (!tag || !skillName) {
    return null;
  }

  if (!SKILL_REGISTRY_TAG_PATTERN.test(tag)) {
    return null;
  }

  if (!AGENT_SKILL_NAME_PATTERN.test(skillName)) {
    return null;
  }

  return {
    normalizedSkillName: `${tag}/${skillName}`,
    skillName,
    tag,
  };
}

export function readSkillRegistrySkillNameValidationMessage(
  registryId: SkillRegistryId,
): string {
  const registry = readSkillRegistryOptionById(registryId);
  if (!registry) {
    return "`skillName` is invalid.";
  }

  if (registry.skillPathLayout === "tagged") {
    return "`skillName` must be `<tag>/<skill-name>`, and `<skill-name>` must be lower-case kebab-case.";
  }

  return "`skillName` must be lower-case kebab-case.";
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

    const firstCandidate = segments[index + 1] ?? "";
    const secondCandidate = segments[index + 2] ?? "";
    const registryDirectoryCandidates = [firstCandidate];
    if (isPositiveIntegerString(firstCandidate)) {
      registryDirectoryCandidates.push(secondCandidate);
    }

    for (const registryDirectoryName of registryDirectoryCandidates) {
      const registry = SKILL_REGISTRY_OPTIONS.find(
        (option) => option.installDirectoryName === registryDirectoryName,
      );
      if (registry) {
        return registry.label;
      }
    }
  }

  return null;
}

function isPositiveIntegerString(value: string): boolean {
  return /^[1-9]\d*$/.test(value.trim());
}

function readNormalizedPathSegments(value: string): string[] | null {
  const normalizedValue = value.trim().replaceAll("\\", "/");
  if (!normalizedValue) {
    return null;
  }

  const rawSegments = normalizedValue.split("/");
  if (rawSegments.length === 0) {
    return null;
  }

  const segments: string[] = [];
  for (const segment of rawSegments) {
    const normalizedSegment = segment.trim();
    if (!normalizedSegment || normalizedSegment === "." || normalizedSegment === "..") {
      return null;
    }

    segments.push(normalizedSegment);
  }

  return segments;
}
