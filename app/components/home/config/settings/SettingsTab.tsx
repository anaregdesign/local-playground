import type { ComponentProps } from "react";
import { AzureConnectionSection } from "~/components/home/config/settings/AzureConnectionSection";
import { InstructionSection } from "~/components/home/config/settings/InstructionSection";
import type { MainViewTab } from "~/components/home/shared/types";

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
