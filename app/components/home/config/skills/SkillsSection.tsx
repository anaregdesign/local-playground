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
import type { SkillCatalogSource } from "~/lib/home/skills/types";

const { Button, Spinner } = FluentUI;

export type ThreadSkillOption = {
  name: string;
  description: string;
  location: string;
  source: SkillCatalogSource;
  badge: string;
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

  const groupedSkillMap = new Map<string, ThreadSkillOption[]>();
  for (const skill of skillOptions) {
    const groupName = skill.badge || "Skills";
    const list = groupedSkillMap.get(groupName) ?? [];
    list.push(skill);
    groupedSkillMap.set(groupName, list);
  }
  const groupedSkills = Array.from(groupedSkillMap.entries())
    .sort(
      ([left], [right]) =>
        readSkillGroupPriority(left) - readSkillGroupPriority(right) ||
        left.localeCompare(right),
    )
    .map(([groupName, groupSkills], index) => {
      const selectedCount = groupSkills.filter((skill) => skill.isSelected).length;
      const items = groupSkills.map((skill) => ({
        id: skill.location,
        name: skill.name,
        description: skill.description,
        detail: skill.location,
        isSelected: skill.isSelected,
        isAvailable: skill.isAvailable,
      }));

      const group: CollapsibleSelectableCardGroup = {
        id: groupName,
        label: groupName,
        description: readSkillGroupDescription(groupName),
        selectedCount,
        totalCount: items.length,
        items,
        listAriaLabel: `Thread Skills (${groupName})`,
        emptyHint: `No Skills in ${groupName}.`,
        defaultOpen: selectedCount > 0 || index === 0,
        onToggleItem: onToggleSkill,
      };
      return group;
    });

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
      <CollapsibleSelectableCardGroupList
        groups={groupedSkills}
        emptyHint="No Skills discovered in workspace default, CODEX_HOME, or app data skills directories."
        isActionDisabled={isSending || isThreadReadOnly}
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

function readSkillGroupPriority(groupName: string): number {
  switch (groupName) {
    case "Workspace":
      return 1;
    case "CODEX_HOME":
      return 2;
    case "OpenAI Curated":
      return 3;
    case "Anthropic Public":
      return 4;
    case "App Data":
      return 5;
    default:
      return 9;
  }
}

function readSkillGroupDescription(groupName: string): string {
  switch (groupName) {
    case "Workspace":
      return "Skills discovered from workspace default directories.";
    case "CODEX_HOME":
      return "Skills discovered from shared CODEX_HOME directories.";
    case "OpenAI Curated":
      return "Skills installed from openai/skills (.curated).";
    case "Anthropic Public":
      return "Skills installed from anthropics/skills.";
    case "App Data":
      return "Skills discovered from app data shared directories.";
    default:
      return "";
  }
}
