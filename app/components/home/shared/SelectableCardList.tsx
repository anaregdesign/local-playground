/**
 * Home UI component module.
 */
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
  } = props;

  if (items.length === 0) {
    return <p className="field-hint">{emptyHint}</p>;
  }

  return (
    <div className="selectable-card-list" role="list" aria-label={listAriaLabel}>
      {items.map((item) => (
        <article
          key={item.id}
          role="listitem"
          className={`selectable-card-item${item.isSelected ? " is-selected" : ""}${
            item.isAvailable ? "" : " is-unavailable"
          }`}
        >
          <div className="selectable-card-item-top-row">
            <div className="selectable-card-item-title-row">
              <p className="selectable-card-name">{item.name}</p>
              {item.badge ? <span className="selectable-card-badge">{item.badge}</span> : null}
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
          <p className="selectable-card-description">{item.description}</p>
          <p className="selectable-card-detail">{item.detail}</p>
        </article>
      ))}
    </div>
  );
}
