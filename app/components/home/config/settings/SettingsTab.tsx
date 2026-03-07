/**
 * Home UI component module.
 */
import type { ComponentProps } from "react";
import { AppearanceSection } from "~/components/home/config/settings/AppearanceSection";
import { AzureConnectionSection } from "~/components/home/config/settings/AzureConnectionSection";
import { UtilityModelSection } from "~/components/home/config/settings/UtilityModelSection";
import type { MainViewTab } from "~/lib/home/shared/view-types";

type SettingsTabProps = {
  activeMainTab: MainViewTab;
  appearanceSectionProps: ComponentProps<typeof AppearanceSection>;
  azureConnectionSectionProps: ComponentProps<typeof AzureConnectionSection>;
  utilityModelSectionProps: ComponentProps<typeof UtilityModelSection>;
};

export function SettingsTab(props: SettingsTabProps) {
  const {
    activeMainTab,
    appearanceSectionProps,
    azureConnectionSectionProps,
    utilityModelSectionProps,
  } = props;

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
        <AppearanceSection {...appearanceSectionProps} />
        <AzureConnectionSection {...azureConnectionSectionProps} />
        <UtilityModelSection {...utilityModelSectionProps} />
      </div>
    </section>
  );
}
