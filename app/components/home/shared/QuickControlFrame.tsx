/**
 * Home UI component module.
 */
import type { ReactNode } from "react";

type QuickControlFrameProps = {
  className?: string;
  children: ReactNode;
};

function buildClassName(...values: Array<string | undefined>): string {
  return values.filter((value) => value && value.trim().length > 0).join(" ");
}

export function QuickControlFrame(props: QuickControlFrameProps) {
  const { className, children } = props;

  return <div className={buildClassName("quick-control-frame", className)}>{children}</div>;
}
