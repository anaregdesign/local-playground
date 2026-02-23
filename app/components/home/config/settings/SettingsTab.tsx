/**
 * Home UI component module.
 */
import type { ComponentProps } from "react";
import { AzureConnectionSection } from "~/components/home/config/settings/AzureConnectionSection";
import { UtilityModelSection } from "~/components/home/config/settings/UtilityModelSection";
import type { MainViewTab } from "~/lib/home/shared/view-types";

type SettingsTabProps = {
  activeMainTab: MainViewTab;
  azureConnectionSectionProps: ComponentProps<typeof AzureConnectionSection>;
  utilityModelSectionProps: ComponentProps<typeof UtilityModelSection>;
};

export function SettingsTab(props: SettingsTabProps) {
  const { activeMainTab, azureConnectionSectionProps, utilityModelSectionProps } = props;

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
        <UtilityModelSection {...utilityModelSectionProps} />
      </div>
    </section>
  );
}
