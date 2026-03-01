/**
 * Home UI component module.
 */
import {
  Fragment,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { CopyIconButton } from "~/components/home/shared/CopyIconButton";
import { FluentUI } from "~/components/home/shared/fluent";
import { LabeledTooltip } from "~/components/home/shared/LabeledTooltip";
import { AutoDismissStatusMessageList } from "~/components/home/shared/AutoDismissStatusMessageList";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";
import { QuickControlFrame } from "~/components/home/shared/QuickControlFrame";
import type { ReasoningEffort } from "~/lib/home/shared/view-types";
import { formatChatAttachmentSize } from "~/lib/home/chat/attachments";

const {
  Button,
  Select,
  Spinner,
  Switch,
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

type ThreadSkillLike = {
  name: string;
  location: string;
};

type ChatCommandSuggestionLike = {
  id: string;
  label: string;
  description: string;
  detail: string;
  isSelected: boolean;
  isAvailable: boolean;
};

type ChatCommandMenuLike = {
  keyword: string;
  query: string;
  emptyHint: string;
  highlightedIndex: number;
  suggestions: ChatCommandSuggestionLike[];
};

type DesktopUpdaterStatusLike = {
  supported: boolean;
  checking: boolean;
  updateAvailable: boolean;
  updateDownloaded: boolean;
  currentVersion: string;
  availableVersion: string;
  errorMessage: string;
  lastCheckedAt: string;
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
  desktopUpdaterStatus: DesktopUpdaterStatusLike;
  isApplyingDesktopUpdate: boolean;
  onCheckDesktopUpdates: () => void;
  onApplyDesktopUpdate: () => void;
  activeThreadName: string;
  isThreadOperationBusy: boolean;
  isCreatingThread: boolean;
  renderMessageContent: (message: TMessage) => ReactNode;
  renderTurnMcpLog: (
    entries: TMcpRpcHistoryEntry[],
    isLive: boolean,
    onCopy: (text: string) => void,
  ) => ReactNode;
  onCreateThread: () => void;
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
  onInputSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  onOpenChatAttachmentPicker: () => void;
  onChatAttachmentFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveChatAttachment: (id: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  chatCommandMenu: ChatCommandMenuLike | null;
  onSelectChatCommandSuggestion: (id: string) => void;
  onHighlightChatCommandSuggestion: (index: number) => void;
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
  webSearchEnabled: boolean;
  onWebSearchEnabledChange: (value: boolean) => void;
  maxChatAttachmentFiles: number;
  canSendMessage: boolean;
  selectedThreadSkills: ThreadSkillLike[];
  selectedDialogueSkills: ThreadSkillLike[];
  onRemoveThreadSkill: (location: string) => void;
  onRemoveDialogueSkill: (location: string) => void;
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
    desktopUpdaterStatus,
    isApplyingDesktopUpdate,
    onCheckDesktopUpdates,
    onApplyDesktopUpdate,
    activeThreadName,
    isThreadOperationBusy,
    isCreatingThread,
    renderMessageContent,
    renderTurnMcpLog,
    onCreateThread,
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
    onInputSelect,
    onOpenChatAttachmentPicker,
    onChatAttachmentFileChange,
    onRemoveChatAttachment,
    onInputKeyDown,
    chatCommandMenu,
    onSelectChatCommandSuggestion,
    onHighlightChatCommandSuggestion,
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
    webSearchEnabled,
    onWebSearchEnabledChange,
    maxChatAttachmentFiles,
    canSendMessage,
    selectedThreadSkills,
    selectedDialogueSkills,
    onRemoveThreadSkill,
    onRemoveDialogueSkill,
    mcpServers,
    onRemoveMcpServer,
  } = props;
  const chatCommandListboxId = "chat-command-listbox";
  const activeChatCommandOptionId =
    chatCommandMenu && chatCommandMenu.suggestions.length > 0
      ? `chat-command-option-${chatCommandMenu.highlightedIndex}`
      : undefined;

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

  function renderAddedSkillAndMcpBubbles() {
    if (selectedThreadSkills.length === 0 && selectedDialogueSkills.length === 0 && mcpServers.length === 0) {
      return null;
    }

    return (
      <section className="chat-skill-strip-compact" aria-label="Added thread skills, dialogue skills, and thread MCP servers">
        <div className="chat-skill-bubbles chat-skill-bubbles-compact">
          {selectedDialogueSkills.map((skill) => (
            <div key={`dialogue:${skill.location}`} className="chat-skill-bubble-item">
              <LabeledTooltip
                title={skill.name}
                lines={[`Source: ${skill.location}`]}
              >
                <span className="chat-skill-bubble chat-skill-bubble-dialogue">
                  <span className="chat-skill-bubble-name">{skill.name}</span>
                  <Button
                    type="button"
                    appearance="subtle"
                    size="small"
                    className="chat-skill-bubble-remove"
                    onClick={() => onRemoveDialogueSkill(skill.location)}
                    disabled={isSending || isThreadReadOnly}
                    aria-label={`Remove dialogue skill ${skill.name}`}
                    title={`Remove dialogue skill ${skill.name}`}
                  >
                    ×
                  </Button>
                </span>
              </LabeledTooltip>
            </div>
          ))}
          {selectedThreadSkills.map((skill) => (
            <div key={`thread:${skill.location}`} className="chat-skill-bubble-item">
              <LabeledTooltip
                title={skill.name}
                lines={[`Source: ${skill.location}`]}
              >
                <span className="chat-skill-bubble chat-skill-bubble-thread">
                  <span className="chat-skill-bubble-name">{skill.name}</span>
                  <Button
                    type="button"
                    appearance="subtle"
                    size="small"
                    className="chat-skill-bubble-remove"
                    onClick={() => onRemoveThreadSkill(skill.location)}
                    disabled={isSending || isThreadReadOnly}
                    aria-label={`Remove thread skill ${skill.name}`}
                    title={`Remove thread skill ${skill.name}`}
                  >
                    ×
                  </Button>
                </span>
              </LabeledTooltip>
            </div>
          ))}
          {mcpServers.map((server) => (
            <div key={`mcp:${server.id}`} className="chat-skill-bubble-item">
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
                <span className="chat-skill-bubble chat-skill-bubble-mcp">
                  <span className="chat-skill-bubble-name">{server.name}</span>
                  <Button
                    type="button"
                    appearance="subtle"
                    size="small"
                    className="chat-skill-bubble-remove"
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

  function renderChatCommandMenu() {
    if (!chatCommandMenu) {
      return null;
    }

    if (chatCommandMenu.suggestions.length === 0) {
      return (
        <section className="chat-command-menu" aria-label={`Command suggestions for ${chatCommandMenu.keyword}`}>
          <p className="chat-command-empty" role="status">
            {chatCommandMenu.emptyHint}
          </p>
        </section>
      );
    }

    return (
      <section className="chat-command-menu" aria-label={`Command suggestions for ${chatCommandMenu.keyword}`}>
        <ul
          id={chatCommandListboxId}
          className="chat-command-list"
          role="listbox"
          aria-label={`Command suggestions for ${chatCommandMenu.keyword}`}
        >
          {chatCommandMenu.suggestions.map((suggestion, index) => {
            const isHighlighted = index === chatCommandMenu.highlightedIndex;
            const isUnavailable = !suggestion.isAvailable;
            return (
              <li
                key={`${chatCommandMenu.keyword}:${suggestion.id}`}
                id={`chat-command-option-${index}`}
                role="option"
                aria-selected={isHighlighted}
                className="chat-command-option"
              >
                <button
                  type="button"
                  className={`chat-command-item${isHighlighted ? " is-highlighted" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onMouseEnter={() => {
                    onHighlightChatCommandSuggestion(index);
                  }}
                  onClick={() => {
                    onSelectChatCommandSuggestion(suggestion.id);
                  }}
                  disabled={isUnavailable}
                >
                  <span className="chat-command-item-title-row">
                    <span className="chat-command-item-label">{suggestion.label}</span>
                    {suggestion.isSelected ? (
                      <span className="chat-command-item-state">Added</span>
                    ) : null}
                    {isUnavailable ? (
                      <span className="chat-command-item-state chat-command-item-state-unavailable">
                        Unavailable
                      </span>
                    ) : null}
                  </span>
                  <span className="chat-command-item-description">{suggestion.description}</span>
                  <span className="chat-command-item-detail">{suggestion.detail}</span>
                </button>
              </li>
            );
          })}
        </ul>
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
            <div className="chat-header-title-row">
              <div className="chat-header-title">
                <img className="chat-header-symbol" src="/foundry-symbol.svg" alt="" aria-hidden="true" />
                <h1>Local Playground</h1>
              </div>
              {desktopUpdaterStatus.supported ? (
                <Button
                  type="button"
                  appearance="subtle"
                  size="small"
                  className="chat-header-upgrade-btn"
                  aria-label="Check for updates"
                  title={
                    desktopUpdaterStatus.lastCheckedAt
                      ? `Check for updates. Last checked at ${desktopUpdaterStatus.lastCheckedAt}.`
                      : "Check for updates."
                  }
                  onClick={onCheckDesktopUpdates}
                  disabled={desktopUpdaterStatus.checking || isApplyingDesktopUpdate}
                >
                  {desktopUpdaterStatus.checking ? "Checking…" : "Check Updates"}
                </Button>
              ) : null}
              {desktopUpdaterStatus.updateDownloaded ? (
                <Button
                  type="button"
                  appearance="subtle"
                  size="small"
                  className="chat-header-upgrade-btn"
                  aria-label="Upgrade app"
                  title={
                    desktopUpdaterStatus.availableVersion
                      ? `Restart and apply version ${desktopUpdaterStatus.availableVersion}.`
                      : "Restart and apply the downloaded update."
                  }
                  onClick={onApplyDesktopUpdate}
                  disabled={isApplyingDesktopUpdate}
                >
                  {isApplyingDesktopUpdate ? "Upgrading…" : "Upgrade"}
                </Button>
              ) : null}
              <div className="chat-thread-header-controls">
                <span className="chat-thread-name-label" title={activeThreadName}>
                  {activeThreadName}
                </span>
                <Button
                  type="button"
                  appearance="subtle"
                  size="small"
                  className="chat-thread-new-btn"
                  aria-label="Create new thread"
                  title="Create a new thread and switch to Threads."
                  onClick={onCreateThread}
                  disabled={isThreadOperationBusy}
                >
                  {isCreatingThread ? "…" : "+"}
                </Button>
              </div>
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
              aria-haspopup={chatCommandMenu ? "listbox" : undefined}
              aria-expanded={chatCommandMenu ? true : undefined}
              aria-controls={chatCommandMenu ? chatCommandListboxId : undefined}
              aria-activedescendant={activeChatCommandOptionId}
              value={draft}
              onChange={(event, data) => {
                onDraftChange(event, data.value);
              }}
              onSelect={onInputSelect}
              onKeyDown={onInputKeyDown}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              disabled={isSending || isChatLocked || isThreadReadOnly}
            />
            {renderChatCommandMenu()}
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
                    <QuickControlFrame className="chat-quick-control-frame">
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
                    </QuickControlFrame>
                  </div>,
                )}
                {renderLabeledTooltip(
                  "Web Search",
                  ["Enable Azure web-search-preview tool for this thread."],
                  <div className="chat-quick-control">
                    <QuickControlFrame className="chat-quick-control-frame chat-quick-control-frame-switch">
                      <Switch
                        id="chat-web-search-preview"
                        className="chat-web-search-toggle"
                        aria-label="Web Search"
                        label="Web Search"
                        checked={webSearchEnabled}
                        onChange={(_, data) => {
                          onWebSearchEnabledChange(data.checked === true);
                        }}
                        disabled={isSending}
                      />
                    </QuickControlFrame>
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
        <div className="chat-footer-draft-meta">
          {renderDraftAttachmentBubbles()}
          {renderAddedSkillAndMcpBubbles()}
        </div>
      </footer>
    </section>
  );
}
