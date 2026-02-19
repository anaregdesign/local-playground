import type { MouseEventHandler } from "react";
import { FluentUI } from "~/components/home/shared/fluent";

const { Button } = FluentUI;

type CopyIconButtonProps = {
  ariaLabel: string;
  title: string;
  className?: string;
  disabled?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
};

function buildClassName(...values: Array<string | undefined>): string {
  return values.filter((value) => value && value.trim().length > 0).join(" ");
}

export function CopyIconButton(props: CopyIconButtonProps) {
  const { ariaLabel, title, className, disabled = false, onClick } = props;

  return (
    <Button
      type="button"
      appearance="subtle"
      size="small"
      className={buildClassName("copy-symbol-btn", className)}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      ⎘
    </Button>
  );
}
