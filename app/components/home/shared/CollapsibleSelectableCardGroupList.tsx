/**
 * Home UI component module.
 */
import { SelectableCardList, type SelectableCardItem } from "~/components/home/shared/SelectableCardList";

export type CollapsibleSelectableCardGroup = {
  id: string;
  label: string;
  description?: string;
  selectedCount: number;
  totalCount: number;
  items: SelectableCardItem[];
  listAriaLabel: string;
  emptyHint: string;
  defaultOpen?: boolean;
  addButtonLabel?: string;
  selectedButtonLabel?: string;
  onToggleItem: (id: string) => void;
};

type CollapsibleSelectableCardGroupListProps = {
  groups: CollapsibleSelectableCardGroup[];
  emptyHint: string;
  isActionDisabled: boolean;
};

export function CollapsibleSelectableCardGroupList(
  props: CollapsibleSelectableCardGroupListProps,
) {
  const { groups, emptyHint, isActionDisabled } = props;

  if (groups.length === 0) {
    return <p className="field-hint">{emptyHint}</p>;
  }

  return (
    <div className="collapsible-selectable-group-list">
      {groups.map((group) => (
        <details
          key={group.id}
          className="collapsible-selectable-group"
          open={group.defaultOpen === true}
        >
          <summary className="collapsible-selectable-group-summary">
            <span className="collapsible-selectable-group-title">{group.label}</span>
            <span className="collapsible-selectable-group-count">
              {group.selectedCount}/{group.totalCount}
            </span>
          </summary>
          {group.description ? (
            <p className="field-hint collapsible-selectable-group-description">
              {group.description}
            </p>
          ) : null}
          <div className="collapsible-selectable-group-content">
            <SelectableCardList
              items={group.items}
              listAriaLabel={group.listAriaLabel}
              emptyHint={group.emptyHint}
              isActionDisabled={isActionDisabled}
              onToggleItem={group.onToggleItem}
              addButtonLabel={group.addButtonLabel}
              selectedButtonLabel={group.selectedButtonLabel}
            />
          </div>
        </details>
      ))}
    </div>
  );
}
