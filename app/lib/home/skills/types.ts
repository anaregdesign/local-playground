/**
 * Home runtime support module.
 */
import type { SkillRegistryId } from "~/lib/home/skills/registry";

export type SkillCatalogSource = "workspace" | "codex_home" | "app_data";

export type SkillCatalogEntry = {
  name: string;
  description: string;
  location: string;
  source: SkillCatalogSource;
};

export type ThreadSkillActivation = {
  name: string;
  location: string;
};

export type SkillRegistrySkillEntry = {
  id: string;
  name: string;
  description: string;
  tag: string | null;
  remotePath: string;
  installLocation: string;
  isInstalled: boolean;
};

export type SkillRegistryCatalog = {
  registryId: SkillRegistryId;
  registryLabel: string;
  registryDescription: string;
  repository: string;
  repositoryUrl: string;
  sourcePath: string;
  skills: SkillRegistrySkillEntry[];
};
