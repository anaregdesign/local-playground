/**
 * Home UI component module.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { LabeledTooltip } from "~/components/home/shared/LabeledTooltip";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "~/components/home/shared/ContextActionMenu";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";
import { HOME_THREAD_NAME_MAX_LENGTH } from "~/lib/constants";

const { Button, Input, Spinner } = FluentUI;

export type ThreadOption = {
  id: string;
  name: string;
  updatedAt: string;
  deletedAt: string | null;
  messageCount: number;
  mcpServerCount: number;
  isAwaitingResponse: boolean;
};

export type ThreadsManageSectionProps = {
  activeThreadOptions: ThreadOption[];
  archivedThreadOptions: ThreadOption[];
  activeThreadId: string;
  isLoadingThreads: boolean;
  isSwitchingThread: boolean;
  isCreatingThread: boolean;
  isDeletingThread: boolean;
  isRestoringThread: boolean;
  threadError: string | null;
  onActiveThreadChange: (threadId: string) => void;
  onCreateThread: () => void;
  onThreadRename: (threadId: string, nextName: string) => void;
  onThreadDelete: (threadId: string) => void;
  onThreadRestore: (threadId: string) => void;
};

export function ThreadsManageSection(props: ThreadsManageSectionProps) {
  const {
    activeThreadOptions,
    archivedThreadOptions,
    activeThreadId,
    isLoadingThreads,
    isSwitchingThread,
    isCreatingThread,
    isDeletingThread,
    isRestoringThread,
    threadError,
    onActiveThreadChange,
    onCreateThread,
    onThreadRename,
    onThreadDelete,
    onThreadRestore,
  } = props;

  const isThreadOperationBusy =
    isLoadingThreads || isSwitchingThread || isCreatingThread || isDeletingThread || isRestoringThread;

  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState("");
  const [renamingThreadName, setRenamingThreadName] = useState("");

  function clearThreadRenameState() {
    setRenamingThreadId("");
    setRenamingThreadName("");
  }

  function beginThreadRename(thread: ThreadOption) {
    setRenamingThreadId(thread.id);
    setRenamingThreadName(thread.name);
  }

  function submitThreadRename(thread: ThreadOption) {
    if (thread.id !== renamingThreadId) {
      return;
    }

    const nextName = renamingThreadName;
    clearThreadRenameState();
    onThreadRename(thread.id, nextName);
  }

  function handleRenameInputKeyDown(event: KeyboardEvent<HTMLInputElement>, thread: ThreadOption) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitThreadRename(thread);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      clearThreadRenameState();
    }
  }

  useEffect(() => {
    if (!renamingThreadId) {
      return;
    }

    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingThreadId]);

  useEffect(() => {
    if (!renamingThreadId) {
      return;
    }

    const targetExists = activeThreadOptions.some((thread) => thread.id === renamingThreadId);
    if (!targetExists) {
      clearThreadRenameState();
    }
  }, [activeThreadOptions, renamingThreadId]);

  useEffect(() => {
    if (!isThreadOperationBusy) {
      return;
    }

    clearThreadRenameState();
  }, [isThreadOperationBusy]);

  function handleRenameInputChange(value: string) {
    setRenamingThreadName(value.slice(0, HOME_THREAD_NAME_MAX_LENGTH));
  }

  return (
    <ConfigSection
      className="setting-group-threads-manage"
      title="Threads 🧵"
      description="Switch Playground context across conversation, MCP logs, instruction, and connected MCP Servers."
    >
      {isLoadingThreads ? (
        <p className="azure-loading-notice" role="status" aria-live="polite">
          <Spinner size="tiny" />
          Loading threads...
        </p>
      ) : null}
      <div className="threads-action-row">
        <Button
          type="button"
          appearance="secondary"
          size="small"
          className="threads-new-btn"
          onClick={onCreateThread}
          disabled={isThreadOperationBusy}
          title="Create a new thread and switch Playground to it."
        >
          {isCreatingThread ? "Creating..." : "+ New Thread"}
        </Button>
      </div>
      {activeThreadOptions.length === 0 ? (
        <p className="field-hint">No active threads</p>
      ) : (
        <div className="threads-active-list" role="list" aria-label="Playground threads">
          {activeThreadOptions.map((thread) => {
            const isActive = thread.id === activeThreadId;
            const isRenamingThread = renamingThreadId === thread.id;
            const isDeleteDisabled =
              isThreadOperationBusy || thread.isAwaitingResponse || thread.messageCount === 0;
            const deleteButtonTitle =
              thread.messageCount === 0
                ? `Cannot delete thread ${thread.name} because it has no messages`
                : `Delete thread ${thread.name}`;
            const isRenameDisabled = isThreadOperationBusy || thread.isAwaitingResponse;
            const activeThreadContextMenuItems: ContextActionMenuItem[] = [
              {
                id: "rename",
                label: "Rename",
                disabled: isRenameDisabled,
                title: `Rename thread ${thread.name}`,
                onSelect: () => {
                  beginThreadRename(thread);
                },
              },
              {
                id: "delete",
                label: "Delete",
                disabled: isDeleteDisabled,
                title: deleteButtonTitle,
                intent: "danger",
                onSelect: () => {
                  onThreadDelete(thread.id);
                },
              },
            ];
            return (
              <div key={thread.id} className="threads-active-item-row" role="listitem">
                {isRenamingThread ? (
                  <Input
                    ref={renameInputRef}
                    value={renamingThreadName}
                    className="threads-rename-input"
                    aria-label={`Rename thread ${thread.name}`}
                    title={`Rename thread ${thread.name}`}
                    disabled={isThreadOperationBusy}
                    onChange={(_, data) => {
                      handleRenameInputChange(data.value);
                    }}
                    onBlur={() => {
                      submitThreadRename(thread);
                    }}
                    onKeyDown={(event) => {
                      handleRenameInputKeyDown(event, thread);
                    }}
                  />
                ) : (
                  <LabeledTooltip
                    title={thread.name}
                    lines={buildThreadTooltipLines(thread)}
                    className="threads-active-item-tooltip-target"
                  >
                    <ContextActionMenu
                      menuLabel={`Thread actions for ${thread.name}`}
                      items={activeThreadContextMenuItems}
                    >
                      <Button
                        type="button"
                        appearance={isActive ? "secondary" : "subtle"}
                        className={`threads-active-item${isActive ? " is-active" : ""}`}
                        onClick={() => {
                          onActiveThreadChange(thread.id);
                        }}
                        disabled={isThreadOperationBusy}
                        aria-pressed={isActive}
                      >
                        <span className="threads-active-item-content">
                          <span className="threads-active-item-name">{thread.name}</span>
                          {thread.isAwaitingResponse ? (
                            <Spinner
                              size="tiny"
                              className="threads-active-item-pending-spinner"
                              aria-label="Awaiting response"
                            />
                          ) : null}
                        </span>
                      </Button>
                    </ContextActionMenu>
                  </LabeledTooltip>
                )}
              </div>
            );
          })}
        </div>
      )}
      {archivedThreadOptions.length > 0 ? (
        <details className="threads-archived-list">
          <summary className="threads-archived-summary">
            Archives ({archivedThreadOptions.length})
          </summary>
          <div className="threads-archived-items" role="list" aria-label="Archived Playground threads">
            {archivedThreadOptions.map((thread) => {
              const isActive = thread.id === activeThreadId;
              const isRestoreDisabled = isThreadOperationBusy || thread.isAwaitingResponse;
              const archivedThreadContextMenuItems: ContextActionMenuItem[] = [
                {
                  id: "restore",
                  label: "Restore",
                  disabled: isRestoreDisabled,
                  title: `Restore thread ${thread.name}`,
                  onSelect: () => {
                    onThreadRestore(thread.id);
                  },
                },
              ];
              return (
                <div key={thread.id} className="threads-archived-item-row" role="listitem">
                  <LabeledTooltip
                    title={thread.name}
                    lines={buildArchivedThreadTooltipLines(thread)}
                    className="threads-active-item-tooltip-target"
                  >
                    <ContextActionMenu
                      menuLabel={`Archive actions for ${thread.name}`}
                      items={archivedThreadContextMenuItems}
                    >
                      <Button
                        type="button"
                        appearance={isActive ? "secondary" : "subtle"}
                        className={`threads-active-item threads-archived-item${isActive ? " is-active" : ""}`}
                        onClick={() => {
                          onActiveThreadChange(thread.id);
                        }}
                        disabled={isThreadOperationBusy}
                        aria-pressed={isActive}
                      >
                        <span className="threads-active-item-content">
                          <span className="threads-active-item-name">{thread.name}</span>
                          {thread.isAwaitingResponse ? (
                            <Spinner
                              size="tiny"
                              className="threads-active-item-pending-spinner"
                              aria-label="Awaiting response"
                            />
                          ) : null}
                        </span>
                      </Button>
                    </ContextActionMenu>
                  </LabeledTooltip>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
      <StatusMessageList messages={[{ intent: "error", text: threadError }]} />
    </ConfigSection>
  );
}

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function buildThreadTooltipLines(thread: ThreadOption): string[] {
  return [
    `Updated: ${formatUpdatedAt(thread.updatedAt)}`,
    `Messages: ${thread.messageCount}`,
    `Connected MCP Servers: ${thread.mcpServerCount}`,
  ];
}

function buildArchivedThreadTooltipLines(thread: ThreadOption): string[] {
  return [
    `Archived: ${formatUpdatedAt(thread.deletedAt ?? thread.updatedAt)}`,
    `Updated: ${formatUpdatedAt(thread.updatedAt)}`,
    `Messages: ${thread.messageCount}`,
    `Connected MCP Servers: ${thread.mcpServerCount}`,
  ];
}
