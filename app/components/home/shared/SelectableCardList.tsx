/**
 * Home UI component module.
 */
import { InfoIconButton } from "~/components/home/shared/InfoIconButton";
import { LabeledTooltip } from "~/components/home/shared/LabeledTooltip";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "~/components/home/shared/ContextActionMenu";
import { FluentUI } from "~/components/home/shared/fluent";

const { Button } = FluentUI;

export type SelectableCardItem = {
  id: string;
  name: string;
  badge?: string;
  description: string;
  detail: string;
  isSelected: boolean;
  isAvailable: boolean;
};

type SelectableCardListProps = {
  items: SelectableCardItem[];
  listAriaLabel: string;
  emptyHint: string;
  isActionDisabled: boolean;
  onToggleItem: (id: string) => void;
  addButtonLabel?: string;
  selectedButtonLabel?: string;
  buildContextMenuItems?: (item: SelectableCardItem) => ContextActionMenuItem[];
};

export function SelectableCardList(props: SelectableCardListProps) {
  const {
    items,
    listAriaLabel,
    emptyHint,
    isActionDisabled,
    onToggleItem,
    addButtonLabel = "Add",
    selectedButtonLabel = "Added",
    buildContextMenuItems,
  } = props;

  if (items.length === 0) {
    return <p className="field-hint">{emptyHint}</p>;
  }

  return (
    <div className="selectable-card-list" role="list" aria-label={listAriaLabel}>
      {items.map((item) => {
        const description = item.description.trim();
        const detail = item.detail.trim();
        const tooltipLines = [description, detail].filter((line) => line.length > 0);
        const contextMenuItems = buildContextMenuItems ? buildContextMenuItems(item) : [];

        const renderCardContent = (key?: string) => (
          <article
            key={key}
            role="listitem"
            className={`selectable-card-item${item.isSelected ? " is-selected" : ""}${
              item.isAvailable ? "" : " is-unavailable"
            }`}
          >
            <div className="selectable-card-item-top-row">
              <div className="selectable-card-item-title-row">
                <p className="selectable-card-name">{item.name}</p>
                {item.badge ? <span className="selectable-card-badge">{item.badge}</span> : null}
                {tooltipLines.length > 0 ? (
                  <LabeledTooltip
                    title={`${item.name} Details`}
                    lines={tooltipLines}
                    className="selectable-card-tooltip-target"
                  >
                    <InfoIconButton
                      className="selectable-card-tooltip-icon"
                      ariaLabel={`${item.name} details`}
                      title={`${item.name} details`}
                    />
                  </LabeledTooltip>
                ) : null}
              </div>
              <Button
                type="button"
                appearance={item.isSelected ? "subtle" : "secondary"}
                size="small"
                className={`selectable-card-add-btn${item.isSelected ? " is-selected" : ""}`}
                onClick={() => {
                  onToggleItem(item.id);
                }}
                disabled={isActionDisabled || (!item.isAvailable && !item.isSelected)}
                title={item.isSelected ? `Remove ${item.name}` : `Add ${item.name}`}
              >
                {item.isSelected ? selectedButtonLabel : addButtonLabel}
              </Button>
            </div>
          </article>
        );

        if (contextMenuItems.length > 0) {
          return (
            <ContextActionMenu
              key={item.id}
              menuLabel={`Actions for ${item.name}`}
              items={contextMenuItems}
            >
              {renderCardContent()}
            </ContextActionMenu>
          );
        }

        return renderCardContent(item.id);
      })}
    </div>
  );
}
