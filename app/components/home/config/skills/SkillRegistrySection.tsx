/**
 * Home UI component module.
 */
import { AutoDismissStatusMessageList } from "~/components/home/shared/AutoDismissStatusMessageList";
import {
  CollapsibleSelectableCardGroupList,
  type CollapsibleSelectableCardGroup,
} from "~/components/home/shared/CollapsibleSelectableCardGroupList";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { FluentUI } from "~/components/home/shared/fluent";
import type { SkillRegistryId } from "~/lib/home/skills/registry";

const { Button, Spinner } = FluentUI;

export type SkillRegistryGroupOption = {
  registryId: SkillRegistryId;
  label: string;
  description: string;
  skillCount: number;
  installedCount: number;
  skills: SkillRegistryEntryOption[];
};

export type SkillRegistryEntryOption = {
  name: string;
  description: string;
  detail: string;
  isInstalled: boolean;
};

type SkillRegistrySectionProps = {
  skillRegistryGroups: SkillRegistryGroupOption[];
  isLoadingSkillRegistries: boolean;
  isMutatingSkillRegistries: boolean;
  skillRegistryError: string | null;
  skillRegistryWarning: string | null;
  skillRegistrySuccess: string | null;
  onReloadSkillRegistries: () => void;
  onToggleRegistrySkill: (registryId: SkillRegistryId, skillName: string) => void;
  onClearSkillRegistryWarning: () => void;
  onClearSkillRegistrySuccess: () => void;
};

export function SkillRegistrySection(props: SkillRegistrySectionProps) {
  const {
    skillRegistryGroups,
    isLoadingSkillRegistries,
    isMutatingSkillRegistries,
    skillRegistryError,
    skillRegistryWarning,
    skillRegistrySuccess,
    onReloadSkillRegistries,
    onToggleRegistrySkill,
    onClearSkillRegistryWarning,
    onClearSkillRegistrySuccess,
  } = props;

  const totalInstalledCount = skillRegistryGroups.reduce(
    (sum, registry) => sum + registry.installedCount,
    0,
  );
  const totalSkillCount = skillRegistryGroups.reduce(
    (sum, registry) => sum + registry.skillCount,
    0,
  );
  const collapsibleRegistryGroups: CollapsibleSelectableCardGroup[] = skillRegistryGroups.map(
    (registry, index) => ({
      id: registry.registryId,
      label: registry.label,
      description: registry.description,
      selectedCount: registry.installedCount,
      totalCount: registry.skillCount,
      items: registry.skills.map((skill) => ({
        id: skill.name,
        name: skill.name,
        description: skill.description,
        detail: skill.detail,
        isSelected: skill.isInstalled,
        isAvailable: true,
      })),
      listAriaLabel: `Registry Skills (${registry.label})`,
      emptyHint: `No Skills are currently available from ${registry.label}.`,
      defaultOpen: registry.installedCount > 0 || index === 0,
      addButtonLabel: "Install",
      selectedButtonLabel: "Remove",
      onToggleItem: (skillName) => {
        onToggleRegistrySkill(registry.registryId, skillName);
      },
    }),
  );

  return (
    <ConfigSection
      className="setting-group-skill-registry"
      title="Install Skills 📦"
      description="Browse supported registries and install or remove Skills under app data skills storage."
    >
      <div className="selectable-card-header-row">
        <p className="selectable-card-count">
          Installed: {totalInstalledCount} / {totalSkillCount}
        </p>
        <Button
          type="button"
          appearance="subtle"
          size="small"
          className="selectable-card-reload-btn"
          title="Reload registry skill list."
          onClick={onReloadSkillRegistries}
          disabled={isLoadingSkillRegistries || isMutatingSkillRegistries}
        >
          ↻ Reload
        </Button>
      </div>
      {isLoadingSkillRegistries ? (
        <p className="azure-loading-notice" role="status" aria-live="polite">
          <Spinner size="tiny" />
          Loading registries...
        </p>
      ) : null}
      <CollapsibleSelectableCardGroupList
        groups={collapsibleRegistryGroups}
        emptyHint="No Skills are currently available from supported registries."
        isActionDisabled={isLoadingSkillRegistries || isMutatingSkillRegistries}
      />
      <AutoDismissStatusMessageList
        messages={[
          { intent: "error", text: skillRegistryError },
          {
            intent: "warning",
            text: skillRegistryWarning,
            onClear: onClearSkillRegistryWarning,
          },
          {
            intent: "success",
            text: skillRegistrySuccess,
            onClear: onClearSkillRegistrySuccess,
          },
        ]}
      />
    </ConfigSection>
  );
}
