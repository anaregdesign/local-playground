/**
 * Home UI component module.
 */
import type { ComponentProps } from "react";
import { SkillsSection } from "~/components/home/config/skills/SkillsSection";
import type { MainViewTab } from "~/lib/home/shared/view-types";

type SkillsTabProps = {
  activeMainTab: MainViewTab;
  skillsSectionProps: ComponentProps<typeof SkillsSection>;
};

export function SkillsTab(props: SkillsTabProps) {
  const { activeMainTab, skillsSectionProps } = props;

  return (
    <section
      className="skills-shell"
      aria-label="Skill settings"
      id="panel-skills"
      role="tabpanel"
      aria-labelledby="tab-skills"
      hidden={activeMainTab !== "skills"}
    >
      <div className="skills-content">
        <SkillsSection {...skillsSectionProps} />
      </div>
    </section>
  );
}
