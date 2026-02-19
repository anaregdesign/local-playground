import type { ComponentProps } from "react";
import { AzureConnectionSection } from "~/components/home/AzureConnectionSection";
import { InstructionSection } from "~/components/home/InstructionSection";
import type { MainViewTab } from "~/components/home/types";

type SettingsTabProps = {
  activeMainTab: MainViewTab;
  azureConnectionSectionProps: ComponentProps<typeof AzureConnectionSection>;
  instructionSectionProps: ComponentProps<typeof InstructionSection>;
};

export function SettingsTab(props: SettingsTabProps) {
  const { activeMainTab, azureConnectionSectionProps, instructionSectionProps } = props;

  return (
    <section
      className="settings-shell"
      aria-label="Playground settings"
      id="panel-settings"
      role="tabpanel"
      aria-labelledby="tab-settings"
      hidden={activeMainTab !== "settings"}
    >
      <div className="settings-content">
        <AzureConnectionSection {...azureConnectionSectionProps} />
        <InstructionSection {...instructionSectionProps} />
      </div>
    </section>
  );
}
