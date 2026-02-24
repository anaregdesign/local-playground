/**
 * Home UI component module.
 */
import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { AutoDismissStatusMessageList } from "~/components/home/shared/AutoDismissStatusMessageList";
import { InfoIconButton } from "~/components/home/shared/InfoIconButton";
import type { McpTransport } from "~/lib/home/shared/view-types";

const {
  Button,
  Checkbox,
  Field,
  Input,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Select,
  Textarea,
} = FluentUI;

export type McpAddServerSectionProps = {
  isSending: boolean;
  isEditingMcpServer: boolean;
  editingMcpServerName: string | null;
  mcpNameInput: string;
  onMcpNameInputChange: (value: string) => void;
  mcpTransport: McpTransport;
  onMcpTransportChange: (value: McpTransport) => void;
  mcpCommandInput: string;
  onMcpCommandInputChange: (value: string) => void;
  mcpArgsInput: string;
  onMcpArgsInputChange: (value: string) => void;
  mcpCwdInput: string;
  onMcpCwdInputChange: (value: string) => void;
  mcpEnvInput: string;
  onMcpEnvInputChange: (value: string) => void;
  mcpUrlInput: string;
  onMcpUrlInputChange: (value: string) => void;
  mcpHeadersInput: string;
  onMcpHeadersInputChange: (value: string) => void;
  mcpUseAzureAuthInput: boolean;
  onMcpUseAzureAuthInputChange: (checked: boolean) => void;
  mcpAzureAuthScopeInput: string;
  onMcpAzureAuthScopeInputChange: (value: string) => void;
  mcpTimeoutSecondsInput: string;
  onMcpTimeoutSecondsInputChange: (value: string) => void;
  defaultMcpAzureAuthScope: string;
  defaultMcpTimeoutSeconds: number;
  minMcpTimeoutSeconds: number;
  maxMcpTimeoutSeconds: number;
  onAddMcpServer: () => void | Promise<void>;
  onCancelMcpServerEdit: () => void;
  isSavingMcpServer: boolean;
  mcpFormError: string | null;
  mcpFormWarning: string | null;
  onClearMcpFormWarning: () => void;
};

export function McpAddServerSection(props: McpAddServerSectionProps) {
  const {
    isSending,
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
  const trimmedEditingName = editingMcpServerName ? editingMcpServerName.trim() : "";
  const sectionTitle = isEditingMcpServer ? "Edit MCP Server ✏️" : "Add MCP Server ➕";
  const sectionDescription = isEditingMcpServer
    ? `Update the saved MCP profile${trimmedEditingName ? ` "${trimmedEditingName}"` : ""} and keep thread connections in sync.`
    : "Configure a new MCP server, save it to the database, and connect it to the current thread.";
  const submitButtonLabel = isEditingMcpServer ? "💾 Save Changes" : "➕ Add Server";
  const submitButtonTitle = isEditingMcpServer
    ? "Save updates for this MCP profile."
    : "Save this MCP server to the database and connect it to the current Agent.";

  return (
    <ConfigSection
      title={sectionTitle}
      description={sectionDescription}
    >
      <Field label="🏷️ Server name (optional)">
        <Input
          id="mcp-server-name"
          placeholder="Server name (optional)"
          title="Optional display name for this MCP server."
          value={mcpNameInput}
          onChange={(_, data) => onMcpNameInputChange(data.value)}
          disabled={isSending}
        />
      </Field>
      <Field label="🚚 Transport">
        <Select
          id="mcp-transport"
          title="Select MCP transport type."
          value={mcpTransport}
          onChange={(event) => {
            onMcpTransportChange(event.target.value as McpTransport);
          }}
          disabled={isSending}
        >
          <option value="streamable_http">streamable_http</option>
          <option value="sse">sse</option>
          <option value="stdio">stdio</option>
        </Select>
      </Field>
      {mcpTransport === "stdio" ? (
        <>
          <Field label="⚙️ Command">
            <Input
              id="mcp-command"
              placeholder="Command (e.g. npx)"
              title="Command used to start the stdio MCP server."
              value={mcpCommandInput}
              onChange={(_, data) => onMcpCommandInputChange(data.value)}
              disabled={isSending}
            />
          </Field>
          <Field label="🧩 Arguments">
            <Input
              id="mcp-args"
              placeholder="Args (space-separated or JSON array)"
              title="Arguments passed to the MCP command."
              value={mcpArgsInput}
              onChange={(_, data) => onMcpArgsInputChange(data.value)}
              disabled={isSending}
            />
          </Field>
          <Field label="📂 Working directory (optional)">
            <Input
              id="mcp-cwd"
              placeholder="Working directory (optional)"
              title="Optional working directory for the command."
              value={mcpCwdInput}
              onChange={(_, data) => onMcpCwdInputChange(data.value)}
              disabled={isSending}
            />
          </Field>
          <Field label="🌿 Environment variables (optional)">
            <Textarea
              id="mcp-env"
              rows={3}
              placeholder={"Environment variables (optional)\nKEY=value"}
              title="Environment variables for stdio MCP (KEY=value)."
              value={mcpEnvInput}
              onChange={(_, data) => onMcpEnvInputChange(data.value)}
              disabled={isSending}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="🔗 Endpoint URL">
            <Input
              id="mcp-url"
              placeholder="https://example.com/mcp"
              title="HTTP/SSE endpoint URL for the MCP server."
              value={mcpUrlInput}
              onChange={(_, data) => onMcpUrlInputChange(data.value)}
              disabled={isSending}
            />
          </Field>
          <Field label="🧾 Additional HTTP headers (optional)">
            <Textarea
              id="mcp-headers"
              rows={3}
              placeholder={"Additional HTTP headers (optional)\nAuthorization=Bearer <token>\nX-Api-Key=<key>"}
              title="Additional HTTP headers (one per line: Name=Value)."
              value={mcpHeadersInput}
              onChange={(_, data) => onMcpHeadersInputChange(data.value)}
              disabled={isSending}
            />
          </Field>
          <Field label="🔐 Azure authentication">
            <div className="field-with-info">
              <Checkbox
                className="field-checkbox"
                title="Attach Azure Bearer token from the app's Azure credential."
                checked={mcpUseAzureAuthInput}
                onChange={(_, data) => {
                  onMcpUseAzureAuthInputChange(data.checked === true);
                }}
                disabled={isSending}
                label="Use Azure Bearer token from app credential"
              />
              <Popover withArrow positioning="below-end">
                <PopoverTrigger disableButtonEnhancement>
                  <InfoIconButton
                    className="setting-group-tooltip-icon field-info-btn"
                    ariaLabel="Show Azure authentication behavior details"
                    title="Show Azure authentication behavior details."
                  />
                </PopoverTrigger>
                <PopoverSurface className="field-info-popover">
                  <p className="field-info-title">Azure auth behavior</p>
                  <ul className="field-info-list">
                    <li>
                      Applies to HTTP MCP transports (<code>streamable_http</code> and <code>sse</code>).
                    </li>
                    <li>
                      <code>Content-Type: application/json</code> is always included.
                    </li>
                    <li>
                      At connect time, the app calls <code>InteractiveBrowserCredential.getToken(scope)</code>.
                    </li>
                    <li>
                      The resulting <code>Authorization: Bearer &lt;token&gt;</code> header is added after custom
                      headers and takes precedence.
                    </li>
                    <li>
                      Only <code>useAzureAuth</code> and <code>scope</code> are stored in config; token values are
                      never persisted.
                    </li>
                    <li>
                      If token acquisition fails, server connection fails and the error appears in MCP Operation
                      Log.
                    </li>
                  </ul>
                </PopoverSurface>
              </Popover>
            </div>
          </Field>
          {mcpUseAzureAuthInput ? (
            <Field label="🎯 Token scope">
              <Input
                id="mcp-azure-auth-scope"
                placeholder={defaultMcpAzureAuthScope}
                title="Azure token scope used to acquire Bearer token."
                value={mcpAzureAuthScopeInput}
                onChange={(_, data) => onMcpAzureAuthScopeInputChange(data.value)}
                disabled={isSending}
              />
            </Field>
          ) : null}
          <Field label="⏱️ Timeout (seconds)">
            <Input
              id="mcp-timeout-seconds"
              placeholder={String(defaultMcpTimeoutSeconds)}
              title="Request timeout in seconds (1-600)."
              value={mcpTimeoutSecondsInput}
              onChange={(_, data) => onMcpTimeoutSecondsInputChange(data.value)}
              disabled={isSending}
            />
          </Field>
          <p className="field-hint">
            Timeout (seconds): integer from {minMcpTimeoutSeconds} to {maxMcpTimeoutSeconds}.
          </p>
          <p className="field-hint">Content-Type: application/json is always included.</p>
        </>
      )}
      <div className="mcp-form-action-row">
        <Button
          type="button"
          appearance="primary"
          title={submitButtonTitle}
          onClick={() => {
            void onAddMcpServer();
          }}
          disabled={isSending || isSavingMcpServer}
        >
          {submitButtonLabel}
        </Button>
        {isEditingMcpServer ? (
          <Button
            type="button"
            appearance="secondary"
            title="Cancel editing and reset MCP server form."
            onClick={onCancelMcpServerEdit}
            disabled={isSending || isSavingMcpServer}
          >
            Cancel Edit
          </Button>
        ) : null}
      </div>
      <AutoDismissStatusMessageList
        messages={[
          { intent: "error", text: mcpFormError },
          {
            intent: "warning",
            text: mcpFormWarning,
            onClear: onClearMcpFormWarning,
          },
        ]}
      />
    </ConfigSection>
  );
}
