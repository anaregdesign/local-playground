import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";

const { Button, Field, Select } = FluentUI;

export type SavedMcpServerOption = {
  id: string;
  label: string;
};

export type McpSavedConfigsSectionProps = {
  selectedSavedMcpServerId: string;
  savedMcpServerOptions: SavedMcpServerOption[];
  isSending: boolean;
  isLoadingSavedMcpServers: boolean;
  savedMcpError: string | null;
  onSelectedSavedMcpServerIdChange: (value: string) => void;
  onConnectSelectedMcpServer: () => void;
  onReloadSavedMcpServers: () => void;
};

export function McpSavedConfigsSection(props: McpSavedConfigsSectionProps) {
  const {
    selectedSavedMcpServerId,
    savedMcpServerOptions,
    isSending,
    isLoadingSavedMcpServers,
    savedMcpError,
    onSelectedSavedMcpServerIdChange,
    onConnectSelectedMcpServer,
    onReloadSavedMcpServers,
  } = props;

  return (
    <ConfigSection
      title="MCP Servers 🧩"
      description="Select a saved MCP profile and connect it to the current thread."
    >
      <Field label="🧩 Saved MCP server">
        <Select
          id="mcp-saved-config"
          title="Choose a saved MCP server to connect to the current Agent."
          value={selectedSavedMcpServerId}
          onChange={(event) => {
            onSelectedSavedMcpServerIdChange(event.target.value);
          }}
          disabled={isSending || isLoadingSavedMcpServers || savedMcpServerOptions.length === 0}
        >
          {savedMcpServerOptions.length === 0 ? <option value="">No saved MCP servers</option> : null}
          {savedMcpServerOptions.map((server) => (
            <option key={server.id} value={server.id}>
              {server.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="mcp-action-row">
        <Button
          type="button"
          appearance="secondary"
          title="Connect the selected saved MCP server to the current Agent."
          onClick={onConnectSelectedMcpServer}
          disabled={
            isSending ||
            isLoadingSavedMcpServers ||
            savedMcpServerOptions.length === 0 ||
            !selectedSavedMcpServerId
          }
        >
          🔌 Connect Selected
        </Button>
        <Button
          type="button"
          appearance="subtle"
          size="small"
          className="mcp-refresh-btn"
          title="Reload saved MCP servers."
          aria-label="Reload saved MCP servers"
          onClick={onReloadSavedMcpServers}
          disabled={isSending || isLoadingSavedMcpServers}
        >
          ↻
        </Button>
      </div>
      <StatusMessageList messages={[{ intent: "error", text: savedMcpError }]} />
    </ConfigSection>
  );
}
