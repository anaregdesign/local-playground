import type { ReactNode } from "react";
import { LabeledTooltip } from "~/components/home/shared/LabeledTooltip";

type ConfigSectionProps = {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
};

function buildClassName(...values: Array<string | undefined>): string {
  return values.filter((value) => value && value.trim().length > 0).join(" ");
}

export function ConfigSection(props: ConfigSectionProps) {
  const { title, description, className, children } = props;
  const normalizedDescription = description?.trim() ?? "";

  return (
    <section className={buildClassName("setting-group", className)}>
      <div className="setting-group-header">
        <div className="setting-group-title-row">
          <h3 className="setting-group-title">{title}</h3>
          {normalizedDescription ? (
            <LabeledTooltip
              title={`${title} Description`}
              lines={[normalizedDescription]}
              className="setting-group-tooltip-target"
            >
              <span
                className="setting-group-tooltip-icon"
                aria-label={`${title} description`}
                title={`${title} description`}
              >
                ⓘ
              </span>
            </LabeledTooltip>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}
