import type { MainViewTab } from "~/lib/home/shared/view-types";
import {
  McpAddServerSection,
  type McpAddServerSectionProps,
} from "~/components/home/config/mcp/McpAddServerSection";
import {
  McpSavedConfigsSection,
  type McpSavedConfigsSectionProps,
} from "~/components/home/config/mcp/McpSavedConfigsSection";

type McpServersTabProps = {
  activeMainTab: MainViewTab;
} & McpSavedConfigsSectionProps &
  McpAddServerSectionProps;

export function McpServersTab(props: McpServersTabProps) {
  const {
    activeMainTab,
    selectedSavedMcpServerId,
    savedMcpServerOptions,
    isLoadingSavedMcpServers,
    savedMcpError,
    onSelectedSavedMcpServerIdChange,
    onConnectSelectedMcpServer,
    onReloadSavedMcpServers,
    isSending,
    mcpNameInput,
    onMcpNameInputChange,
    mcpTransport,
    onMcpTransportChange,
    mcpCommandInput,
    onMcpCommandInputChange,
    mcpArgsInput,
    onMcpArgsInputChange,
    mcpCwdInput,
    onMcpCwdInputChange,
    mcpEnvInput,
    onMcpEnvInputChange,
    mcpUrlInput,
    onMcpUrlInputChange,
    mcpHeadersInput,
    onMcpHeadersInputChange,
    mcpUseAzureAuthInput,
    onMcpUseAzureAuthInputChange,
    mcpAzureAuthScopeInput,
    onMcpAzureAuthScopeInputChange,
    mcpTimeoutSecondsInput,
    onMcpTimeoutSecondsInputChange,
    defaultMcpAzureAuthScope,
    defaultMcpTimeoutSeconds,
    minMcpTimeoutSeconds,
    maxMcpTimeoutSeconds,
    onAddMcpServer,
    isSavingMcpServer,
    mcpFormError,
    mcpFormWarning,
    onClearMcpFormWarning,
  } = props;

  return (
    <section
      className="mcp-shell"
      aria-label="MCP server settings"
      id="panel-mcp"
      role="tabpanel"
      aria-labelledby="tab-mcp"
      hidden={activeMainTab !== "mcp"}
    >
      <div className="mcp-content">
        <McpSavedConfigsSection
          selectedSavedMcpServerId={selectedSavedMcpServerId}
          savedMcpServerOptions={savedMcpServerOptions}
          isSending={isSending}
          isLoadingSavedMcpServers={isLoadingSavedMcpServers}
          savedMcpError={savedMcpError}
          onSelectedSavedMcpServerIdChange={onSelectedSavedMcpServerIdChange}
          onConnectSelectedMcpServer={onConnectSelectedMcpServer}
          onReloadSavedMcpServers={onReloadSavedMcpServers}
        />
        <McpAddServerSection
          isSending={isSending}
          mcpNameInput={mcpNameInput}
          onMcpNameInputChange={onMcpNameInputChange}
          mcpTransport={mcpTransport}
          onMcpTransportChange={onMcpTransportChange}
          mcpCommandInput={mcpCommandInput}
          onMcpCommandInputChange={onMcpCommandInputChange}
          mcpArgsInput={mcpArgsInput}
          onMcpArgsInputChange={onMcpArgsInputChange}
          mcpCwdInput={mcpCwdInput}
          onMcpCwdInputChange={onMcpCwdInputChange}
          mcpEnvInput={mcpEnvInput}
          onMcpEnvInputChange={onMcpEnvInputChange}
          mcpUrlInput={mcpUrlInput}
          onMcpUrlInputChange={onMcpUrlInputChange}
          mcpHeadersInput={mcpHeadersInput}
          onMcpHeadersInputChange={onMcpHeadersInputChange}
          mcpUseAzureAuthInput={mcpUseAzureAuthInput}
          onMcpUseAzureAuthInputChange={onMcpUseAzureAuthInputChange}
          mcpAzureAuthScopeInput={mcpAzureAuthScopeInput}
          onMcpAzureAuthScopeInputChange={onMcpAzureAuthScopeInputChange}
          mcpTimeoutSecondsInput={mcpTimeoutSecondsInput}
          onMcpTimeoutSecondsInputChange={onMcpTimeoutSecondsInputChange}
          defaultMcpAzureAuthScope={defaultMcpAzureAuthScope}
          defaultMcpTimeoutSeconds={defaultMcpTimeoutSeconds}
          minMcpTimeoutSeconds={minMcpTimeoutSeconds}
          maxMcpTimeoutSeconds={maxMcpTimeoutSeconds}
          onAddMcpServer={onAddMcpServer}
          isSavingMcpServer={isSavingMcpServer}
          mcpFormError={mcpFormError}
          mcpFormWarning={mcpFormWarning}
          onClearMcpFormWarning={onClearMcpFormWarning}
        />
      </div>
    </section>
  );
}
