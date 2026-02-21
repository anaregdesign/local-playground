import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";
import { SelectableCardList } from "~/components/home/shared/SelectableCardList";

const { Button, Spinner } = FluentUI;

export type SavedMcpServerOption = {
  id: string;
  name: string;
  badge?: string;
  description: string;
  detail: string;
  isSelected: boolean;
  isAvailable: boolean;
};

export type McpSavedConfigsSectionProps = {
  savedMcpServerOptions: SavedMcpServerOption[];
  selectedSavedMcpServerCount: number;
  isSending: boolean;
  isThreadReadOnly: boolean;
  isLoadingSavedMcpServers: boolean;
  savedMcpError: string | null;
  onToggleSavedMcpServer: (id: string) => void;
  onReloadSavedMcpServers: () => void;
};

export function McpSavedConfigsSection(props: McpSavedConfigsSectionProps) {
  const {
    savedMcpServerOptions,
    selectedSavedMcpServerCount,
    isSending,
    isThreadReadOnly,
    isLoadingSavedMcpServers,
    savedMcpError,
    onToggleSavedMcpServer,
    onReloadSavedMcpServers,
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
        <p className="selectable-card-count">Added: {selectedSavedMcpServerCount}</p>
        <Button
          type="button"
          appearance="subtle"
          size="small"
          className="selectable-card-reload-btn"
          title="Reload saved MCP servers."
          aria-label="Reload saved MCP servers"
          onClick={onReloadSavedMcpServers}
          disabled={isSending || isLoadingSavedMcpServers}
        >
          ↻ Reload
        </Button>
      </div>
      {isLoadingSavedMcpServers ? (
        <p className="azure-loading-notice" role="status" aria-live="polite">
          <Spinner size="tiny" />
          Loading MCP Servers...
        </p>
      ) : null}
      <SelectableCardList
        items={savedMcpServerOptions}
        listAriaLabel="Saved MCP Servers"
        emptyHint="No saved MCP servers."
        isActionDisabled={isSending || isThreadReadOnly}
        onToggleItem={onToggleSavedMcpServer}
      />
      <StatusMessageList messages={[{ intent: "error", text: savedMcpError }]} />
    </ConfigSection>
  );
}
