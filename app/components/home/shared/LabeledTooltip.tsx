/**
 * Home UI component module.
 */
import type { ReactNode } from "react";
import { FluentUI } from "~/components/home/shared/fluent";

const { Tooltip } = FluentUI;

type LabeledTooltipProps = {
  title: string;
  lines?: ReactNode[];
  className?: string;
  children: ReactNode;
};

export function LabeledTooltip(props: LabeledTooltipProps) {
  const { title, lines = [], className = "chat-tooltip-target", children } = props;

  return (
    <Tooltip
      relationship="description"
      showDelay={0}
      positioning="above-start"
      content={
        <div className="app-tooltip-content">
          <p className="app-tooltip-title">{title}</p>
          {lines.map((line, index) => (
            <p key={`${title}-${index}`} className="app-tooltip-line">
              {line}
            </p>
          ))}
        </div>
      }
    >
      <div className={className}>{children}</div>
    </Tooltip>
  );
}
