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
  onLoadSavedMcpServerToForm: () => void;
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
  } = props;

  return (
    <ConfigSection title="Saved Configs 💾">
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
      </div>
      <StatusMessageList messages={[{ intent: "error", text: savedMcpError }]} />
    </ConfigSection>
  );
}
