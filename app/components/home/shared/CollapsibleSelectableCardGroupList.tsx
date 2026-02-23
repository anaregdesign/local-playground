/**
 * Home UI component module.
 */
import { InfoIconButton } from "~/components/home/shared/InfoIconButton";
import { LabeledTooltip } from "~/components/home/shared/LabeledTooltip";
import { SelectableCardList, type SelectableCardItem } from "~/components/home/shared/SelectableCardList";

export type CollapsibleSelectableCardGroup = {
  id: string;
  label: string;
  description?: string;
  items: SelectableCardItem[];
  listAriaLabel: string;
  emptyHint: string;
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
  const visibleGroups = groups.filter((group) => group.items.length > 0);

  if (visibleGroups.length === 0) {
    return <p className="field-hint">{emptyHint}</p>;
  }

  return (
    <div className="collapsible-selectable-group-list">
      {visibleGroups.map((group) => (
        <details key={group.id} className="collapsible-selectable-group">
          <summary className="collapsible-selectable-group-summary">
            <span className="collapsible-selectable-group-folder symbol-icon-btn" aria-hidden="true">
              <span className="collapsible-selectable-group-folder-body" />
            </span>
            <span className="collapsible-selectable-group-title">
              {group.label}
              {group.description ? (
                <LabeledTooltip
                  title={`${group.label} Description`}
                  lines={[group.description]}
                  className="setting-group-tooltip-target"
                >
                  <InfoIconButton
                    className="setting-group-tooltip-icon"
                    ariaLabel={`${group.label} description`}
                    title={`${group.label} description`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  />
                </LabeledTooltip>
              ) : null}
            </span>
          </summary>
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
