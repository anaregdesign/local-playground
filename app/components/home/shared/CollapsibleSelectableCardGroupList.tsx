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
  externalHref?: string;
  externalLabel?: string;
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
      {visibleGroups.map((group) => {
        const externalHref = readHttpUrl(group.externalHref);

        return (
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
              <span className="collapsible-selectable-group-summary-actions">
                {externalHref ? (
                  <a
                    className="collapsible-selectable-group-link symbol-icon-btn"
                    href={externalHref}
                    target="_blank"
                    rel="noreferrer"
                    title={group.externalLabel ?? `Open ${group.label} registry`}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <span className="symbol-icon-btn-glyph" aria-hidden="true">
                      ↗
                    </span>
                  </a>
                ) : null}
                <span className="collapsible-selectable-group-caret symbol-icon-btn" aria-hidden="true">
                  <span className="symbol-icon-btn-glyph">▸</span>
                </span>
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
        );
      })}
    </div>
  );
}

function readHttpUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim();
  if (!/^https?:\/\//.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}
