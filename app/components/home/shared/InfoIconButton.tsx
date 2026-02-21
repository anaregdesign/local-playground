import type { MouseEventHandler } from "react";
import { SymbolIconButton } from "~/components/home/shared/SymbolIconButton";

type InfoIconButtonProps = {
  ariaLabel: string;
  title: string;
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

function buildClassName(...values: Array<string | undefined>): string {
  return values.filter((value) => value && value.trim().length > 0).join(" ");
}

export function InfoIconButton(props: InfoIconButtonProps) {
  const { ariaLabel, title, className, disabled = false, onClick } = props;

  return (
    <SymbolIconButton
      ariaLabel={ariaLabel}
      title={title}
      className={buildClassName("info-symbol-btn", className)}
      disabled={disabled}
      onClick={onClick}
      symbol="ⓘ"
    />
  );
}
