/**
 * Home UI component module.
 */
import type { ReactElement } from "react";
import { FluentUI } from "~/components/home/shared/fluent";

const { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } = FluentUI;

export type ContextActionMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  title?: string;
  intent?: "default" | "danger";
  onSelect: () => void;
};

type ContextActionMenuProps = {
  menuLabel: string;
  items: ContextActionMenuItem[];
  children: ReactElement;
};

export function ContextActionMenu(props: ContextActionMenuProps) {
  const { menuLabel, items, children } = props;
  const visibleItems = items.filter((item) => item.label.trim().length > 0);

  if (visibleItems.length === 0) {
    return children;
  }

  return (
    <Menu openOnContext>
      <MenuTrigger disableButtonEnhancement>
        {children}
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={menuLabel}>
          {visibleItems.map((item) => (
            <MenuItem
              key={item.id}
              disabled={item.disabled}
              title={item.title}
              className={item.intent === "danger" ? "context-action-item-danger" : undefined}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                item.onSelect();
              }}
            >
              {item.label}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
