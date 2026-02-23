/**
 * Home UI component module.
 */
import { AutoDismissStatusMessageList } from "~/components/home/shared/AutoDismissStatusMessageList";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { FluentUI } from "~/components/home/shared/fluent";
import { SelectableCardList } from "~/components/home/shared/SelectableCardList";
import { isSkillRegistryId, type SkillRegistryId } from "~/lib/home/skills/registry";

const { Button, Field, Select, Spinner } = FluentUI;

export type SkillRegistryOption = {
  id: SkillRegistryId;
  label: string;
  description: string;
  skillCount: number;
  installedCount: number;
};

export type SkillRegistryEntryOption = {
  name: string;
  description: string;
  detail: string;
  isInstalled: boolean;
};

type SkillRegistrySectionProps = {
  registryOptions: SkillRegistryOption[];
  selectedRegistryId: SkillRegistryId;
  selectedRegistryDescription: string;
  registrySkillOptions: SkillRegistryEntryOption[];
  isLoadingSkillRegistries: boolean;
  isMutatingSkillRegistries: boolean;
  skillRegistryError: string | null;
  skillRegistryWarning: string | null;
  skillRegistrySuccess: string | null;
  onSelectedRegistryChange: (registryId: SkillRegistryId) => void;
  onReloadSkillRegistries: () => void;
  onToggleRegistrySkill: (skillName: string) => void;
  onClearSkillRegistryWarning: () => void;
  onClearSkillRegistrySuccess: () => void;
};

export function SkillRegistrySection(props: SkillRegistrySectionProps) {
  const {
    registryOptions,
    selectedRegistryId,
    selectedRegistryDescription,
    registrySkillOptions,
    isLoadingSkillRegistries,
    isMutatingSkillRegistries,
    skillRegistryError,
    skillRegistryWarning,
    skillRegistrySuccess,
    onSelectedRegistryChange,
    onReloadSkillRegistries,
    onToggleRegistrySkill,
    onClearSkillRegistryWarning,
    onClearSkillRegistrySuccess,
  } = props;

  const selectedRegistry = registryOptions.find((option) => option.id === selectedRegistryId);
  const selectedRegistryInstalledCount = selectedRegistry?.installedCount ?? 0;

  const selectableRegistrySkillItems = registrySkillOptions.map((skill) => ({
    id: skill.name,
    name: skill.name,
    description: skill.description,
    detail: skill.detail,
    isSelected: skill.isInstalled,
    isAvailable: true,
  }));

  return (
    <ConfigSection
      className="setting-group-skill-registry"
      title="Install Skills 📦"
      description="Browse supported registries and install or remove Skills under app data skills storage."
    >
      <Field label="Registry">
        <Select
          className="skill-registry-select"
          value={selectedRegistryId}
          title="Select a Skill registry."
          onChange={(event) => {
            const nextRegistryId = event.target.value;
            if (isSkillRegistryId(nextRegistryId)) {
              onSelectedRegistryChange(nextRegistryId);
            }
          }}
          disabled={isLoadingSkillRegistries || isMutatingSkillRegistries}
        >
          {registryOptions.map((registry) => (
            <option key={registry.id} value={registry.id}>
              {registry.label}
            </option>
          ))}
        </Select>
      </Field>
      {selectedRegistryDescription ? (
        <p className="field-hint skill-registry-description">{selectedRegistryDescription}</p>
      ) : null}
      <div className="selectable-card-header-row">
        <p className="selectable-card-count">Installed: {selectedRegistryInstalledCount}</p>
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
      <SelectableCardList
        items={selectableRegistrySkillItems}
        listAriaLabel="Registry Skills"
        emptyHint="No Skills are currently available from this registry."
        isActionDisabled={isLoadingSkillRegistries || isMutatingSkillRegistries}
        onToggleItem={onToggleRegistrySkill}
        addButtonLabel="Install"
        selectedButtonLabel="Remove"
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
