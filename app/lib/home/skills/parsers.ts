/**
 * Home runtime support module.
 */
import type { SkillCatalogEntry, SkillCatalogSource, ThreadSkillSelection } from "~/lib/home/skills/types";

export function readSkillCatalogList(value: unknown): SkillCatalogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const skills: SkillCatalogEntry[] = [];
  const seenLocations = new Set<string>();

  for (const entry of value) {
    const parsed = readSkillCatalogEntryFromUnknown(entry);
    if (!parsed || seenLocations.has(parsed.location)) {
      continue;
    }

    seenLocations.add(parsed.location);
    skills.push(parsed);
  }

  return skills;
}

export function readThreadSkillSelectionList(value: unknown): ThreadSkillSelection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const selections: ThreadSkillSelection[] = [];
  const seenLocations = new Set<string>();

  for (const entry of value) {
    const parsed = readThreadSkillSelectionFromUnknown(entry);
    if (!parsed || seenLocations.has(parsed.location)) {
      continue;
    }

    seenLocations.add(parsed.location);
    selections.push(parsed);
  }

  return selections;
}

export function readThreadSkillSelectionFromUnknown(value: unknown): ThreadSkillSelection | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readTrimmedString(value.name);
  const location = readTrimmedString(value.location);
  if (!name || !location) {
    return null;
  }

  return {
    name,
    location,
  };
}

function readSkillCatalogEntryFromUnknown(value: unknown): SkillCatalogEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readTrimmedString(value.name);
  const description = readTrimmedString(value.description);
  const location = readTrimmedString(value.location);
  const source = readSkillCatalogSource(value.source);
  if (!name || !description || !location || !source) {
    return null;
  }

  return {
    name,
    description,
    location,
    source,
  };
}

function readSkillCatalogSource(value: unknown): SkillCatalogSource | null {
  if (value === "workspace" || value === "codex_home" || value === "app_data") {
    return value;
  }

  return null;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
