/**
 * Home UI component module.
 */
import type { MouseEventHandler, ReactNode } from "react";
import { FluentUI } from "~/components/home/shared/fluent";

const { Button } = FluentUI;

type SymbolIconButtonProps = {
  ariaLabel: string;
  title: string;
  symbol: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

function buildClassName(...values: Array<string | undefined>): string {
  return values.filter((value) => value && value.trim().length > 0).join(" ");
}

export function SymbolIconButton(props: SymbolIconButtonProps) {
  const {
    ariaLabel,
    title,
    symbol,
    className,
    disabled = false,
    onClick,
  } = props;

  return (
    <Button
      type="button"
      appearance="subtle"
      size="small"
      className={buildClassName("symbol-icon-btn", className)}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="symbol-icon-btn-glyph" aria-hidden="true">
        {symbol}
      </span>
    </Button>
  );
}
