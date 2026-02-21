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
    savedMcpServerOptions,
    selectedSavedMcpServerCount,
    isLoadingSavedMcpServers,
    savedMcpError,
    onToggleSavedMcpServer,
    onReloadSavedMcpServers,
    isSending,
    isThreadReadOnly,
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
          savedMcpServerOptions={savedMcpServerOptions}
          selectedSavedMcpServerCount={selectedSavedMcpServerCount}
          isSending={isSending}
          isThreadReadOnly={isThreadReadOnly}
          isLoadingSavedMcpServers={isLoadingSavedMcpServers}
          savedMcpError={savedMcpError}
          onToggleSavedMcpServer={onToggleSavedMcpServer}
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
