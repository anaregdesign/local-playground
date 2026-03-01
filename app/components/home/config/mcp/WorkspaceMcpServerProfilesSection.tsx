/**
 * Home UI component module.
 */
import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";
import { SelectableCardList } from "~/components/home/shared/SelectableCardList";
import type { ContextActionMenuItem } from "~/components/home/shared/ContextActionMenu";
import type { WorkspaceMcpServerProfileOption } from "~/lib/home/mcp/workspace-mcp-server-profiles";

const { Button, Spinner } = FluentUI;

/**
 * Props for rendering saved MCP profiles that can be attached/detached from the active thread.
 */
export type WorkspaceMcpServerProfilesSectionProps = {
  workspaceMcpServerProfileOptions: WorkspaceMcpServerProfileOption[];
  selectedWorkspaceMcpServerProfileCount: number;
  isSending: boolean;
  isThreadReadOnly: boolean;
  isLoadingWorkspaceMcpServerProfiles: boolean;
  isMutatingWorkspaceMcpServerProfiles: boolean;
  workspaceMcpServerProfileError: string | null;
  onToggleWorkspaceMcpServerProfile: (id: string) => void;
  onEditWorkspaceMcpServerProfile: (id: string) => void;
  onDeleteWorkspaceMcpServerProfile: (id: string) => void;
  onReloadWorkspaceMcpServerProfiles: () => void;
};

/**
 * Section responsible for listing persisted MCP profiles and connecting them to the current thread.
 */
export function WorkspaceMcpServerProfilesSection(props: WorkspaceMcpServerProfilesSectionProps) {
  const {
    workspaceMcpServerProfileOptions,
    selectedWorkspaceMcpServerProfileCount,
    isSending,
    isThreadReadOnly,
    isLoadingWorkspaceMcpServerProfiles,
    isMutatingWorkspaceMcpServerProfiles,
    workspaceMcpServerProfileError,
    onToggleWorkspaceMcpServerProfile,
    onEditWorkspaceMcpServerProfile,
    onDeleteWorkspaceMcpServerProfile,
    onReloadWorkspaceMcpServerProfiles,
  } = props;

  return (
    <ConfigSection
      title="MCP Servers 🧩"
      description="Add saved MCP profiles to the current thread."
    >
      {isThreadReadOnly ? (
        <p className="field-hint">
          This thread is archived and read-only. Restore it from Archives to edit MCP servers.
        </p>
      ) : null}
      <div className="selectable-card-header-row">
        <p className="selectable-card-count">Added: {selectedWorkspaceMcpServerProfileCount}</p>
        <Button
          type="button"
          appearance="subtle"
          size="small"
          className="selectable-card-reload-btn"
          title="Reload saved MCP servers."
          aria-label="Reload saved MCP servers"
          onClick={onReloadWorkspaceMcpServerProfiles}
          disabled={isSending || isLoadingWorkspaceMcpServerProfiles || isMutatingWorkspaceMcpServerProfiles}
        >
          ↻ Reload
        </Button>
      </div>
      {isLoadingWorkspaceMcpServerProfiles ? (
        <div className="azure-loading-notice" role="status" aria-live="polite">
          <Spinner size="tiny" />
          Loading MCP Servers...
        </div>
      ) : null}
      <SelectableCardList
        items={workspaceMcpServerProfileOptions}
        listAriaLabel="Saved MCP Servers"
        emptyHint="No saved MCP servers."
        isActionDisabled={isSending || isThreadReadOnly || isMutatingWorkspaceMcpServerProfiles}
        onToggleItem={onToggleWorkspaceMcpServerProfile}
        buildContextMenuItems={(item) => {
          const itemName = item.name.trim() || "MCP server";
          const isContextActionDisabled =
            isSending || isThreadReadOnly || isMutatingWorkspaceMcpServerProfiles;
          const contextMenuItems: ContextActionMenuItem[] = [
            {
              id: "edit",
              label: "Edit",
              title: `Edit ${itemName}`,
              disabled: isContextActionDisabled,
              onSelect: () => {
                onEditWorkspaceMcpServerProfile(item.id);
              },
            },
            {
              id: "delete",
              label: "Delete",
              title: `Delete ${itemName}`,
              intent: "danger",
              disabled: isContextActionDisabled,
              onSelect: () => {
                onDeleteWorkspaceMcpServerProfile(item.id);
              },
            },
          ];
          return contextMenuItems;
        }}
      />
      <StatusMessageList messages={[{ intent: "error", text: workspaceMcpServerProfileError }]} />
    </ConfigSection>
  );
}
