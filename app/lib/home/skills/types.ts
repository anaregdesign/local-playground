export type SkillCatalogSource = "workspace" | "codex_home" | "app_data";

export type SkillCatalogEntry = {
  name: string;
  description: string;
  location: string;
  source: SkillCatalogSource;
};

export type ThreadSkillSelection = {
  name: string;
  location: string;
};
