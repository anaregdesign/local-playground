import { FluentUI } from "~/components/home/shared/fluent";

const { Button, Field, MessageBar, MessageBarBody, Select } = FluentUI;

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
  onLoadSavedMcpServerToForm: () => void;
  onReloadSavedMcpServers: () => void | Promise<void>;
};

export function McpSavedConfigsSection(props: McpSavedConfigsSectionProps) {
  const {
    selectedSavedMcpServerId,
    savedMcpServerOptions,
    isSending,
    isLoadingSavedMcpServers,
    savedMcpError,
    onSelectedSavedMcpServerIdChange,
    onLoadSavedMcpServerToForm,
    onReloadSavedMcpServers,
  } = props;

  return (
    <section className="setting-group">
      <div className="setting-group-header">
        <h3>Saved Configs 💾</h3>
      </div>
      <Field label="💾 Saved config">
        <Select
          id="mcp-saved-config"
          title="Choose a saved MCP server configuration."
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
          title="Load the selected saved MCP config into the form."
          onClick={onLoadSavedMcpServerToForm}
          disabled={
            isSending ||
            isLoadingSavedMcpServers ||
            savedMcpServerOptions.length === 0 ||
            !selectedSavedMcpServerId
          }
        >
          📥 Load Selected
        </Button>
        <Button
          type="button"
          appearance="secondary"
          title="Reload saved MCP configs from disk."
          onClick={() => {
            void onReloadSavedMcpServers();
          }}
          disabled={isSending || isLoadingSavedMcpServers}
        >
          {isLoadingSavedMcpServers ? "🔄 Loading..." : "🔄 Reload"}
        </Button>
      </div>
      {savedMcpError ? (
        <MessageBar intent="error" className="setting-message-bar">
          <MessageBarBody>{savedMcpError}</MessageBarBody>
        </MessageBar>
      ) : null}
    </section>
  );
}
