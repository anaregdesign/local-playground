/**
 * Home runtime support module.
 */
import { isSkillRegistryId } from "~/lib/home/skills/registry";
import type {
  SkillCatalogEntry,
  SkillCatalogSource,
  SkillRegistryCatalog,
  SkillRegistrySkillEntry,
  ThreadSkillSelection,
} from "~/lib/home/skills/types";

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

export function readSkillRegistryCatalogList(value: unknown): SkillRegistryCatalog[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const catalogs: SkillRegistryCatalog[] = [];
  const seenRegistryIds = new Set<string>();

  for (const entry of value) {
    const parsed = readSkillRegistryCatalogFromUnknown(entry);
    if (!parsed || seenRegistryIds.has(parsed.registryId)) {
      continue;
    }

    seenRegistryIds.add(parsed.registryId);
    catalogs.push(parsed);
  }

  return catalogs;
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

function readSkillRegistryCatalogFromUnknown(value: unknown): SkillRegistryCatalog | null {
  if (!isRecord(value)) {
    return null;
  }

  const registryId = readSkillRegistryId(value.registryId);
  const registryLabel = readTrimmedString(value.registryLabel);
  const registryDescription = readTrimmedString(value.registryDescription);
  const repository = readTrimmedString(value.repository);
  const repositoryUrl = readTrimmedString(value.repositoryUrl);
  const sourcePath = readTrimmedString(value.sourcePath);
  const skills = readSkillRegistrySkillEntryList(value.skills);
  if (
    !registryId ||
    !registryLabel ||
    !registryDescription ||
    !repository ||
    !repositoryUrl ||
    !sourcePath
  ) {
    return null;
  }

  return {
    registryId,
    registryLabel,
    registryDescription,
    repository,
    repositoryUrl,
    sourcePath,
    skills,
  };
}

function readSkillRegistrySkillEntryList(value: unknown): SkillRegistrySkillEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: SkillRegistrySkillEntry[] = [];
  const seenByName = new Set<string>();

  for (const entry of value) {
    const parsed = readSkillRegistrySkillEntryFromUnknown(entry);
    if (!parsed || seenByName.has(parsed.name)) {
      continue;
    }

    seenByName.add(parsed.name);
    entries.push(parsed);
  }

  return entries;
}

function readSkillRegistrySkillEntryFromUnknown(value: unknown): SkillRegistrySkillEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readTrimmedString(value.name);
  const description = readTrimmedString(value.description);
  const remotePath = readTrimmedString(value.remotePath);
  const installLocation = readTrimmedString(value.installLocation);
  const isInstalled = readBoolean(value.isInstalled);
  if (!name || !description || !remotePath || !installLocation || isInstalled === null) {
    return null;
  }

  return {
    name,
    description,
    remotePath,
    installLocation,
    isInstalled,
  };
}

function readSkillCatalogSource(value: unknown): SkillCatalogSource | null {
  if (value === "workspace" || value === "codex_home" || value === "app_data") {
    return value;
  }

  return null;
}

function readSkillRegistryId(value: unknown): SkillRegistryCatalog["registryId"] | null {
  if (!isSkillRegistryId(value)) {
    return null;
  }

  return value;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") {
    return null;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
