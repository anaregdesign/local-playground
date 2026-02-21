import {
  Fragment,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CopyIconButton } from "~/components/home/shared/CopyIconButton";
import { FluentUI } from "~/components/home/shared/fluent";
import { LabeledTooltip } from "~/components/home/shared/LabeledTooltip";
import { AutoDismissStatusMessageList } from "~/components/home/shared/AutoDismissStatusMessageList";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";
import type { ReasoningEffort } from "~/lib/home/shared/view-types";
import { formatChatAttachmentSize } from "~/lib/home/chat/attachments";

const {
  Button,
  Select,
  Spinner,
  Textarea,
} = FluentUI;
type ChatRole = "user" | "assistant";

type ChatMessageLike = {
  id: string;
  role: ChatRole;
  content: string;
  turnId: string;
};

type ChatAttachmentLike = {
  id: string;
  name: string;
  sizeBytes: number;
};

type AzureConnectionLike = {
  id: string;
  projectName: string;
};

type McpRpcHistoryEntryLike = {
  id: string;
};

type McpHttpServerLike = {
  id: string;
  name: string;
  transport: "streamable_http" | "sse";
  url: string;
  headers: Record<string, string>;
  useAzureAuth: boolean;
  azureAuthScope: string;
  timeoutSeconds: number;
};

type McpStdioServerLike = {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
};

type McpServerLike = McpHttpServerLike | McpStdioServerLike;

type PlaygroundPanelProps<
  TMessage extends ChatMessageLike,
  TMcpRpcHistoryEntry extends McpRpcHistoryEntryLike,
  TMcpServer extends McpServerLike,
> = {
  messages: TMessage[];
  mcpHistoryByTurnId: Map<string, TMcpRpcHistoryEntry[]>;
  isSending: boolean;
  isThreadReadOnly: boolean;
  renderMessageContent: (message: TMessage) => ReactNode;
  renderTurnMcpLog: (
    entries: TMcpRpcHistoryEntry[],
    isLive: boolean,
    onCopy: (text: string) => void,
  ) => ReactNode;
  onCopyMessage: (content: string) => void;
  onCopyMcpLog: (content: string) => void;
  sendProgressMessages: string[];
  activeTurnMcpHistory: TMcpRpcHistoryEntry[];
  errorTurnMcpHistory: TMcpRpcHistoryEntry[];
  endOfMessagesRef: RefObject<HTMLDivElement | null>;
  systemNotice: string | null;
  onClearSystemNotice: () => void;
  error: string | null;
  azureLoginError: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  chatAttachmentInputRef: RefObject<HTMLInputElement | null>;
  chatAttachmentAccept: string;
  chatAttachmentFormatHint: string;
  draft: string;
  chatAttachments: ChatAttachmentLike[];
  chatAttachmentError: string | null;
  onDraftChange: (event: ChangeEvent<HTMLTextAreaElement>, value: string) => void;
  onOpenChatAttachmentPicker: () => void;
  onChatAttachmentFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveChatAttachment: (id: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  isChatLocked: boolean;
  isLoadingAzureConnections: boolean;
  isLoadingAzureDeployments: boolean;
  isAzureAuthRequired: boolean;
  isStartingAzureLogin: boolean;
  isStartingAzureLogout: boolean;
  onChatAzureSelectorAction: (target: "project" | "deployment") => void;
  azureConnections: AzureConnectionLike[];
  activeAzureConnectionId: string;
  onProjectChange: (projectId: string) => void;
  selectedAzureDeploymentName: string;
  azureDeployments: string[];
  onDeploymentChange: (deploymentName: string) => void;
  reasoningEffort: ReasoningEffort;
  reasoningEffortOptions: ReasoningEffort[];
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  maxChatAttachmentFiles: number;
  canSendMessage: boolean;
  mcpServers: TMcpServer[];
  onRemoveMcpServer: (id: string) => void;
};

export function PlaygroundPanel<
  TMessage extends ChatMessageLike,
  TMcpRpcHistoryEntry extends McpRpcHistoryEntryLike,
  TMcpServer extends McpServerLike,
>(props: PlaygroundPanelProps<TMessage, TMcpRpcHistoryEntry, TMcpServer>) {
  const {
    messages,
    mcpHistoryByTurnId,
    isSending,
    isThreadReadOnly,
    renderMessageContent,
    renderTurnMcpLog,
    onCopyMessage,
    onCopyMcpLog,
    sendProgressMessages,
    activeTurnMcpHistory,
    errorTurnMcpHistory,
    endOfMessagesRef,
    systemNotice,
    onClearSystemNotice,
    error,
    azureLoginError,
    onSubmit,
    chatInputRef,
    chatAttachmentInputRef,
    chatAttachmentAccept,
    chatAttachmentFormatHint,
    draft,
    chatAttachments,
    chatAttachmentError,
    onDraftChange,
    onOpenChatAttachmentPicker,
    onChatAttachmentFileChange,
    onRemoveChatAttachment,
    onInputKeyDown,
    onCompositionStart,
    onCompositionEnd,
    isChatLocked,
    isLoadingAzureConnections,
    isLoadingAzureDeployments,
    isAzureAuthRequired,
    isStartingAzureLogin,
    isStartingAzureLogout,
    onChatAzureSelectorAction,
    azureConnections,
    activeAzureConnectionId,
    onProjectChange,
    selectedAzureDeploymentName,
    azureDeployments,
    onDeploymentChange,
    reasoningEffort,
    reasoningEffortOptions,
    onReasoningEffortChange,
    maxChatAttachmentFiles,
    canSendMessage,
    mcpServers,
    onRemoveMcpServer,
  } = props;

  function renderLabeledTooltip(
    title: string,
    lines: ReactNode[],
    child: ReactNode,
    className = "chat-tooltip-target",
  ) {
    return (
      <LabeledTooltip title={title} lines={lines} className={className}>
        {child}
      </LabeledTooltip>
    );
  }

  function handleChatAzureSelectorActionKeyDown(
    event: KeyboardEvent<HTMLSelectElement>,
    target: "project" | "deployment",
  ) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onChatAzureSelectorAction(target);
  }

  function renderChatAzureActionSelect(
    target: "project" | "deployment",
    label: string,
    text: string,
    title: string,
  ) {
    const elementId =
      target === "project" ? "chat-azure-project-action" : "chat-azure-deployment-action";

    return (
      <Select
        id={elementId}
        aria-label={label}
        value=""
        onMouseDown={(event) => {
          event.preventDefault();
          onChatAzureSelectorAction(target);
        }}
        onClick={(event) => {
          event.preventDefault();
          onChatAzureSelectorAction(target);
        }}
        onKeyDown={(event) => {
          handleChatAzureSelectorActionKeyDown(event, target);
        }}
        disabled={isSending || isStartingAzureLogin || isStartingAzureLogout}
        title={title}
      >
        <option value="">{text}</option>
      </Select>
    );
  }

  function renderAddedMcpServersBubbles() {
    if (mcpServers.length === 0) {
      return null;
    }

    return (
      <section className="chat-mcp-strip" aria-label="Added MCP Servers">
        <div className="chat-mcp-bubbles">
          {mcpServers.map((server) => (
            <div key={server.id} className="chat-mcp-bubble-item">
              <LabeledTooltip
                title={server.name}
                lines={
                  server.transport === "stdio"
                    ? [
                        "Transport: stdio",
                        `Command: ${server.command}${server.args.length > 0 ? ` ${server.args.join(" ")}` : ""}`,
                        ...(server.cwd ? [`Working directory: ${server.cwd}`] : []),
                        `Environment variables: ${Object.keys(server.env).length}`,
                      ]
                    : [
                        `Transport: ${server.transport}`,
                        `URL: ${server.url}`,
                        `Custom headers: ${Object.keys(server.headers).length}`,
                        `Timeout: ${server.timeoutSeconds}s`,
                        `Azure auth: ${server.useAzureAuth ? `enabled (${server.azureAuthScope})` : "disabled"}`,
                      ]
                }
              >
                <span className="chat-mcp-bubble">
                  <span className="chat-mcp-bubble-name">{server.name}</span>
                  <Button
                    type="button"
                    appearance="subtle"
                    size="small"
                    className="chat-mcp-bubble-remove"
                    onClick={() => onRemoveMcpServer(server.id)}
                    disabled={isSending || isThreadReadOnly}
                    aria-label={`Remove MCP server ${server.name}`}
                    title={`Remove ${server.name}`}
                  >
                    ×
                  </Button>
                </span>
              </LabeledTooltip>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderDraftAttachmentBubbles() {
    if (chatAttachments.length === 0) {
      return null;
    }

    return (
      <section className="chat-attachment-strip" aria-label="Attached files">
        <div className="chat-attachment-bubbles">
          {chatAttachments.map((attachment) => (
            <div key={attachment.id} className="chat-attachment-bubble-item">
              <span className="chat-attachment-bubble">
                <span className="chat-attachment-bubble-name">{attachment.name}</span>
                <span className="chat-attachment-bubble-size">
                  {formatChatAttachmentSize(attachment.sizeBytes)}
                </span>
                <Button
                  type="button"
                  appearance="subtle"
                  size="small"
                  className="chat-attachment-bubble-remove"
                  onClick={() => onRemoveChatAttachment(attachment.id)}
                  disabled={isSending || isThreadReadOnly}
                  aria-label={`Remove attachment ${attachment.name}`}
                  title={`Remove ${attachment.name}`}
                >
                  ×
                </Button>
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="chat-shell main-panel" aria-label="Playground">
      <header className="chat-header">
        <div className="chat-header-row">
          <div className="chat-header-main">
            <div className="chat-header-title">
              <img className="chat-header-symbol" src="/foundry-symbol.svg" alt="" aria-hidden="true" />
              <h1>Local Playground</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="chat-log" aria-live="polite">
        {messages.map((message) => {
          const turnMcpHistory = mcpHistoryByTurnId.get(message.turnId) ?? [];
          const shouldRenderTurnMcpLog = message.role === "assistant" && turnMcpHistory.length > 0;

          return (
            <Fragment key={message.id}>
              <article className={`message-row ${message.role === "user" ? "user" : "assistant"}`}>
                <div className="message-content">{renderMessageContent(message)}</div>
                <CopyIconButton
                  className="message-copy-btn"
                  ariaLabel="Copy message"
                  title="Copy this message."
                  onClick={() => {
                    onCopyMessage(message.content);
                  }}
                />
              </article>
              {shouldRenderTurnMcpLog ? (
                <article className="mcp-turn-log-row">
                  {renderTurnMcpLog(turnMcpHistory, false, (text) => {
                    onCopyMcpLog(text);
                  })}
                </article>
              ) : null}
            </Fragment>
          );
        })}

        {isSending ? (
          <article className="message-row assistant progress-row">
            <div className="typing-progress" role="status" aria-live="polite">
              {sendProgressMessages.length > 0 ? (
                <ul className="typing-progress-list">
                  {sendProgressMessages.map((status, index) => (
                    <li key={`${index}-${status}`} className={index === sendProgressMessages.length - 1 ? "active" : ""}>
                      {status}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="typing">Thinking...</p>
              )}
            </div>
          </article>
        ) : null}
        {isSending && activeTurnMcpHistory.length > 0 ? (
          <article className="mcp-turn-log-row">
            {renderTurnMcpLog(activeTurnMcpHistory, true, (text) => {
              onCopyMcpLog(text);
            })}
          </article>
        ) : null}
        {!isSending && errorTurnMcpHistory.length > 0 ? (
          <article className="mcp-turn-log-row">
            {renderTurnMcpLog(errorTurnMcpHistory, false, (text) => {
              onCopyMcpLog(text);
            })}
          </article>
        ) : null}
        <div ref={endOfMessagesRef} />
      </div>

      <footer className="chat-footer">
        <AutoDismissStatusMessageList
          className="chat-error-stack"
          messages={[
            {
              intent: "success",
              title: "System",
              text: systemNotice,
              onClear: onClearSystemNotice,
            },
          ]}
        />
        {error || azureLoginError || chatAttachmentError || isThreadReadOnly ? (
          <StatusMessageList
            className="chat-error-stack"
            messages={[
              {
                intent: "warning",
                title: "Archive",
                text: isThreadReadOnly
                  ? "This thread is archived and read-only. Restore it from Archives to edit or send messages."
                  : null,
              },
              { intent: "error", title: "Request failed", text: error },
              { intent: "error", text: azureLoginError },
              { intent: "error", title: "Attachment", text: chatAttachmentError },
            ]}
          />
        ) : null}
        <form className="chat-form" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="chat-input">
            Message
          </label>
          <input
            ref={chatAttachmentInputRef}
            id="chat-attachment-input"
            className="file-input-hidden"
            type="file"
            accept={chatAttachmentAccept}
            multiple
            onChange={onChatAttachmentFileChange}
            disabled={isSending || isChatLocked || isThreadReadOnly}
          />
          <div className="chat-composer">
            <Textarea
              id="chat-input"
              name="message"
              rows={2}
              resize="none"
              ref={chatInputRef}
              className="chat-composer-input"
              placeholder="Type a message..."
              title="Message input. Enter sends, Shift+Enter inserts a new line."
              value={draft}
              onChange={(event, data) => {
                onDraftChange(event, data.value);
              }}
              onKeyDown={onInputKeyDown}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              disabled={isSending || isChatLocked || isThreadReadOnly}
            />
            <div className="chat-composer-actions">
              <div className="chat-quick-controls">
                {renderLabeledTooltip(
                  "Attach Files",
                  [
                    `Attach local files for this turn (up to ${maxChatAttachmentFiles}).`,
                    `Supported format: ${chatAttachmentFormatHint}.`,
                    "Attachments are sent together with the current message.",
                  ],
                  <div className="chat-quick-control">
                    <Button
                      type="button"
                      appearance="subtle"
                      className="chat-attach-btn"
                      aria-label="Attach files"
                      title="Attach files"
                      onClick={onOpenChatAttachmentPicker}
                      disabled={isSending || isChatLocked || isThreadReadOnly}
                    >
                      📎
                    </Button>
                  </div>,
                )}
                {renderLabeledTooltip(
                  "Project",
                  [
                    isLoadingAzureConnections
                      ? "Loading project names from Azure..."
                      : isAzureAuthRequired
                        ? "Click the selector to start Azure login."
                        : azureConnections.length === 0
                          ? "No projects loaded. Click the selector to reload."
                          : "Used for this chat request.",
                  ],
                  <div className="chat-quick-control">
                    {isLoadingAzureConnections ? (
                      <span className="chat-control-loader chat-control-loader-project" role="status" aria-live="polite">
                        <Spinner size="tiny" />
                        Loading projects...
                      </span>
                    ) : isAzureAuthRequired || azureConnections.length === 0 ? (
                      renderChatAzureActionSelect(
                        "project",
                        "Project",
                        isAzureAuthRequired ? "Project" : "Reload projects",
                        isAzureAuthRequired
                          ? "Click to sign in with Azure and load projects."
                          : "Click to reload Azure projects.",
                      )
                    ) : (
                      <Select
                        id="chat-azure-project"
                        aria-label="Project"
                        title="Azure project used for this chat."
                        value={activeAzureConnectionId}
                        onChange={(event) => {
                          onProjectChange(event.target.value);
                        }}
                        disabled={isSending}
                      >
                        <optgroup label="Project name">
                          {azureConnections.map((connection) => (
                            <option key={connection.id} value={connection.id}>
                              {connection.projectName}
                            </option>
                          ))}
                        </optgroup>
                      </Select>
                    )}
                  </div>,
                )}
                {renderLabeledTooltip(
                  "Deployment",
                  [
                    isLoadingAzureConnections || isLoadingAzureDeployments
                      ? "Loading deployment names for the selected project..."
                      : isAzureAuthRequired
                        ? "Click the selector to start Azure login."
                        : !activeAzureConnectionId || azureDeployments.length === 0
                          ? "No deployments loaded. Click the selector to reload."
                          : "Used to run the model.",
                  ],
                  <div className="chat-quick-control">
                    {isLoadingAzureConnections || isLoadingAzureDeployments ? (
                      <span className="chat-control-loader chat-control-loader-deployment" role="status" aria-live="polite">
                        <Spinner size="tiny" />
                        Loading deployments...
                      </span>
                    ) : isAzureAuthRequired || !activeAzureConnectionId || azureDeployments.length === 0 ? (
                      renderChatAzureActionSelect(
                        "deployment",
                        "Deployment",
                        isAzureAuthRequired ? "Deployment" : "Reload deployments",
                        isAzureAuthRequired
                          ? "Click to sign in with Azure and load deployments."
                          : "Click to reload deployments for the selected project.",
                      )
                    ) : (
                      <Select
                        id="chat-azure-deployment"
                        aria-label="Deployment"
                        title="Azure deployment used to run the model."
                        value={selectedAzureDeploymentName}
                        onChange={(event) => {
                          onDeploymentChange(event.target.value);
                        }}
                        disabled={isSending}
                      >
                        <optgroup label="Deployment name">
                          {azureDeployments.map((deployment) => (
                            <option key={deployment} value={deployment}>
                              {deployment}
                            </option>
                          ))}
                        </optgroup>
                      </Select>
                    )}
                  </div>,
                )}
                {renderLabeledTooltip(
                  "Reasoning Effort",
                  ["Controls how much internal reasoning the model uses."],
                  <div className="chat-quick-control">
                    <Select
                      id="chat-reasoning-effort"
                      aria-label="Reasoning Effort"
                      title="Reasoning effort level for the model."
                      value={reasoningEffort}
                      onChange={(event) => onReasoningEffortChange(event.target.value as ReasoningEffort)}
                      disabled={isSending}
                    >
                      <optgroup label="Reasoning effort">
                        {reasoningEffortOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </optgroup>
                    </Select>
                  </div>,
                )}
              </div>
              {renderLabeledTooltip(
                "Send",
                isThreadReadOnly
                  ? ["Archived thread is read-only. Restore it from Archives to send messages."]
                  : ["Send current message."],
                <Button
                  type="submit"
                  appearance="subtle"
                  className="chat-send-btn"
                  aria-label="Send message"
                  title="Send current message."
                  disabled={!canSendMessage}
                >
                  ↑
                </Button>,
                "chat-tooltip-target chat-send-tooltip-target",
              )}
            </div>
          </div>
        </form>
        {renderDraftAttachmentBubbles()}
        {renderAddedMcpServersBubbles()}
      </footer>
    </section>
  );
}
