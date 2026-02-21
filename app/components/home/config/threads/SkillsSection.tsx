import { AutoDismissStatusMessageList } from "~/components/home/shared/AutoDismissStatusMessageList";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { FluentUI } from "~/components/home/shared/fluent";
import type { SkillCatalogSource } from "~/lib/home/skills/types";

const { Button, Checkbox, Spinner } = FluentUI;

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
      <div className="thread-skills-header-row">
        <p className="thread-skills-count">Enabled: {selectedSkillCount}</p>
        <Button
          type="button"
          appearance="subtle"
          size="small"
          className="thread-skills-reload-btn"
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
      {skillOptions.length === 0 ? (
        <p className="field-hint">No Skills discovered in workspace/CODEX_HOME skills directories.</p>
      ) : (
        <div className="thread-skills-list" role="list" aria-label="Thread Skills">
          {skillOptions.map((skill) => {
            const sourceLabel = skill.source === "workspace" ? "Workspace" : "CODEX_HOME";
            return (
              <article
                key={skill.location}
                role="listitem"
                className={`thread-skill-item${skill.isSelected ? " is-selected" : ""}${
                  skill.isAvailable ? "" : " is-unavailable"
                }`}
              >
                <div className="thread-skill-item-top-row">
                  <Checkbox
                    checked={skill.isSelected}
                    onChange={() => {
                      onToggleSkill(skill.location);
                    }}
                    label={skill.name}
                    disabled={
                      isSending || isThreadReadOnly || (!skill.isAvailable && !skill.isSelected)
                    }
                  />
                  <span className="thread-skill-source">{sourceLabel}</span>
                </div>
                <p className="thread-skill-description">{skill.description}</p>
                <p className="thread-skill-location">{skill.location}</p>
              </article>
            );
          })}
        </div>
      )}
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
