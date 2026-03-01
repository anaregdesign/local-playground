/**
 * Home runtime support module.
 */
import { isSkillRegistryId } from "~/lib/home/skills/registry";
import type {
  SkillCatalogEntry,
  SkillCatalogSource,
  SkillRegistryCatalog,
  SkillRegistrySkillEntry,
  ThreadSkillActivation,
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

export function readThreadSkillActivationList(value: unknown): ThreadSkillActivation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const selections: ThreadSkillActivation[] = [];
  const seenLocations = new Set<string>();

  for (const entry of value) {
    const parsed = readThreadSkillActivationFromUnknown(entry);
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

export function readThreadSkillActivationFromUnknown(value: unknown): ThreadSkillActivation | null {
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
  const seenById = new Set<string>();

  for (const entry of value) {
    const parsed = readSkillRegistrySkillEntryFromUnknown(entry);
    if (!parsed || seenById.has(parsed.id)) {
      continue;
    }

    seenById.add(parsed.id);
    entries.push(parsed);
  }

  return entries;
}

function readSkillRegistrySkillEntryFromUnknown(value: unknown): SkillRegistrySkillEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readTrimmedString(value.id);
  const name = readTrimmedString(value.name);
  const description = readTrimmedString(value.description);
  const tag = readNullableTrimmedString(value.tag);
  const remotePath = readTrimmedString(value.remotePath);
  const installLocation = readTrimmedString(value.installLocation);
  const isInstalled = readBoolean(value.isInstalled);
  if (
    !id ||
    !name ||
    !description ||
    tag === undefined ||
    !remotePath ||
    !installLocation ||
    isInstalled === null
  ) {
    return null;
  }

  return {
    id,
    name,
    description,
    tag,
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

function readNullableTrimmedString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
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
