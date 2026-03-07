/**
 * Home UI component module.
 */
import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { HOME_THEME_OPTIONS } from "~/lib/constants";
import type { HomeTheme } from "~/lib/home/shared/view-types";

const { Select } = FluentUI;

type AppearanceSectionProps = {
  homeTheme: HomeTheme;
  onHomeThemeChange: (nextTheme: HomeTheme) => void;
};

export function AppearanceSection(props: AppearanceSectionProps) {
  const { homeTheme, onHomeThemeChange } = props;

  return (
    <ConfigSection
      className="setting-group-appearance"
      title="Appearance 🎨"
      description="Choose a theme for Playground UI. Changes apply immediately."
    >
      <label className="input-label" htmlFor="appearance-theme-select">
        Theme
      </label>
      <Select
        id="appearance-theme-select"
        value={homeTheme}
        onChange={(_, data) => {
          const nextTheme = data.value;
          if (nextTheme === "light" || nextTheme === "dark") {
            onHomeThemeChange(nextTheme);
          }
        }}
        title="Select Playground theme."
      >
        {HOME_THEME_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
      <p className="field-hint">Theme preference is saved locally on this device.</p>
    </ConfigSection>
  );
}
