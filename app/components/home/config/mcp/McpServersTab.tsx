/**
 * Home UI component module.
 */
import type { MainViewTab } from "~/lib/home/shared/view-types";
import {
  McpAddServerSection,
  type McpAddServerSectionProps,
} from "~/components/home/config/mcp/McpAddServerSection";
import {
  WorkspaceMcpServerProfilesSection,
  type WorkspaceMcpServerProfilesSectionProps,
} from "~/components/home/config/mcp/WorkspaceMcpServerProfilesSection";

type McpServersTabProps = {
  activeMainTab: MainViewTab;
} & WorkspaceMcpServerProfilesSectionProps &
  McpAddServerSectionProps;

export function McpServersTab(props: McpServersTabProps) {
  const {
    activeMainTab,
    workspaceMcpServerProfileOptions,
    selectedWorkspaceMcpServerProfileCount,
    isLoadingWorkspaceMcpServerProfiles,
    isMutatingWorkspaceMcpServerProfiles,
    workspaceMcpServerProfileError,
    onToggleWorkspaceMcpServerProfile,
    onEditWorkspaceMcpServerProfile,
    onDeleteWorkspaceMcpServerProfile,
    onReloadWorkspaceMcpServerProfiles,
    isSending,
    isThreadReadOnly,
    isEditingMcpServer,
    editingMcpServerName,
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
    onCancelMcpServerEdit,
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
        <WorkspaceMcpServerProfilesSection
          workspaceMcpServerProfileOptions={workspaceMcpServerProfileOptions}
          selectedWorkspaceMcpServerProfileCount={selectedWorkspaceMcpServerProfileCount}
          isSending={isSending}
          isThreadReadOnly={isThreadReadOnly}
          isLoadingWorkspaceMcpServerProfiles={isLoadingWorkspaceMcpServerProfiles}
          isMutatingWorkspaceMcpServerProfiles={isMutatingWorkspaceMcpServerProfiles}
          workspaceMcpServerProfileError={workspaceMcpServerProfileError}
          onToggleWorkspaceMcpServerProfile={onToggleWorkspaceMcpServerProfile}
          onEditWorkspaceMcpServerProfile={onEditWorkspaceMcpServerProfile}
          onDeleteWorkspaceMcpServerProfile={onDeleteWorkspaceMcpServerProfile}
          onReloadWorkspaceMcpServerProfiles={onReloadWorkspaceMcpServerProfiles}
        />
        <McpAddServerSection
          isSending={isSending}
          isEditingMcpServer={isEditingMcpServer}
          editingMcpServerName={editingMcpServerName}
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
          onCancelMcpServerEdit={onCancelMcpServerEdit}
          isSavingMcpServer={isSavingMcpServer}
          mcpFormError={mcpFormError}
          mcpFormWarning={mcpFormWarning}
          onClearMcpFormWarning={onClearMcpFormWarning}
        />
      </div>
    </section>
  );
}
