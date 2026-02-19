import type { ReactNode } from "react";

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

  return (
    <section className={buildClassName("setting-group", className)}>
      <div className="setting-group-header">
        <h3 className="setting-group-title">{title}</h3>
        {description ? <p className="setting-group-description">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
