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
  registryUrl?: string;
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

  const collapsibleRegistryGroups: CollapsibleSelectableCardGroup[] = skillRegistryGroups.map(
    (registry) => ({
      id: registry.registryId,
      label: registry.label,
      description: registry.description,
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
      addButtonLabel: "Install",
      selectedButtonLabel: "Remove",
      onToggleItem: (skillName) => {
        onToggleRegistrySkill(registry.registryId, skillName);
      },
    }),
  );
  const registrySourceLinks = dedupeRegistrySourceLinks(skillRegistryGroups);

  return (
    <ConfigSection
      className="setting-group-skill-registry"
      title="Install Skills 📦"
      description="Browse supported registries and install or remove Skills under app data skills storage."
    >
      <div className="selectable-card-header-row selectable-card-header-row-right">
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
      {registrySourceLinks.length > 0 ? (
        <p className="registry-source-links">
          <span className="registry-source-links-label">Registry sources:</span>
          {registrySourceLinks.map((registry, index) => (
            <span key={registry.url} className="registry-source-link-item">
              <a
                className="registry-source-link"
                href={registry.url}
                target="_blank"
                rel="noreferrer"
                title={`Open ${registry.label} registry source`}
              >
                {registry.label}
              </a>
              {index < registrySourceLinks.length - 1 ? (
                <span className="registry-source-link-separator" aria-hidden="true">
                  ·
                </span>
              ) : null}
            </span>
          ))}
        </p>
      ) : null}
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

function dedupeRegistrySourceLinks(
  groups: SkillRegistryGroupOption[],
): Array<{ label: string; url: string }> {
  const links = new Map<string, { label: string; url: string }>();

  for (const group of groups) {
    const normalizedUrl = (group.registryUrl ?? "").trim();
    if (!normalizedUrl || !/^https?:\/\//.test(normalizedUrl)) {
      continue;
    }

    if (!links.has(normalizedUrl)) {
      links.set(normalizedUrl, {
        label: group.label,
        url: normalizedUrl,
      });
    }
  }

  return Array.from(links.values());
}
