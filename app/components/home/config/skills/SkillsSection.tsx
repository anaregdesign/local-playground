import { AutoDismissStatusMessageList } from "~/components/home/shared/AutoDismissStatusMessageList";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { FluentUI } from "~/components/home/shared/fluent";
import { SelectableCardList } from "~/components/home/shared/SelectableCardList";
import type { SkillCatalogSource } from "~/lib/home/skills/types";

const { Button, Spinner } = FluentUI;

export type ThreadSkillOption = {
  name: string;
  description: string;
  location: string;
  source: SkillCatalogSource;
  isSelected: boolean;
  isAvailable: boolean;
};

type SkillsSectionProps = {
  skillOptions: ThreadSkillOption[];
  selectedSkillCount: number;
  isLoadingSkills: boolean;
  isSending: boolean;
  isThreadReadOnly: boolean;
  skillsError: string | null;
  skillsWarning: string | null;
  onReloadSkills: () => void;
  onToggleSkill: (location: string) => void;
  onClearSkillsWarning: () => void;
};

export function SkillsSection(props: SkillsSectionProps) {
  const {
    skillOptions,
    selectedSkillCount,
    isLoadingSkills,
    isSending,
    isThreadReadOnly,
    skillsError,
    skillsWarning,
    onReloadSkills,
    onToggleSkill,
    onClearSkillsWarning,
  } = props;

  const selectableSkillItems = skillOptions.map((skill) => ({
    id: skill.location,
    name: skill.name,
    badge:
      skill.source === "workspace"
        ? "Workspace"
        : skill.source === "codex_home"
          ? "CODEX_HOME"
          : "App Data",
    description: skill.description,
    detail: skill.location,
    isSelected: skill.isSelected,
    isAvailable: skill.isAvailable,
  }));

  return (
    <ConfigSection
      className="setting-group-thread-skills"
      title="Skills 🧠"
      description="Enable agentskills-compatible SKILL.md instructions for the current thread."
    >
      {isThreadReadOnly ? (
        <p className="field-hint">
          This thread is archived and read-only. Restore it from Archives to edit skill selections.
        </p>
      ) : null}
      <div className="selectable-card-header-row">
        <p className="selectable-card-count">Enabled: {selectedSkillCount}</p>
        <Button
          type="button"
          appearance="subtle"
          size="small"
          className="selectable-card-reload-btn"
          title="Reload skill list from local skills directories."
          onClick={onReloadSkills}
          disabled={isLoadingSkills || isSending}
        >
          ↻ Reload
        </Button>
      </div>
      {isLoadingSkills ? (
        <p className="azure-loading-notice" role="status" aria-live="polite">
          <Spinner size="tiny" />
          Loading Skills...
        </p>
      ) : null}
      <SelectableCardList
        items={selectableSkillItems}
        listAriaLabel="Thread Skills"
        emptyHint="No Skills discovered in workspace default, CODEX_HOME, or app data skills directories."
        isActionDisabled={isSending || isThreadReadOnly}
        onToggleItem={onToggleSkill}
      />
      <AutoDismissStatusMessageList
        messages={[
          { intent: "error", text: skillsError },
          {
            intent: "warning",
            text: skillsWarning,
            onClear: onClearSkillsWarning,
          },
        ]}
      />
    </ConfigSection>
  );
}
