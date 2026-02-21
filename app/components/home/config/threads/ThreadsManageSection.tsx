import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { LabeledTooltip } from "~/components/home/shared/LabeledTooltip";
import { SymbolIconButton } from "~/components/home/shared/SymbolIconButton";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";

const { Button, Spinner } = FluentUI;

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
  isDeletingThread: boolean;
  isRestoringThread: boolean;
  threadError: string | null;
  onActiveThreadChange: (threadId: string) => void;
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
    isDeletingThread,
    isRestoringThread,
    threadError,
    onActiveThreadChange,
    onThreadDelete,
    onThreadRestore,
  } = props;

  const isThreadSelectionDisabled =
    isLoadingThreads || isSwitchingThread || isDeletingThread || isRestoringThread;

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
      {activeThreadOptions.length === 0 ? (
        <p className="field-hint">No active threads</p>
      ) : (
        <div className="threads-active-list" role="list" aria-label="Playground threads">
          {activeThreadOptions.map((thread) => {
            const isActive = thread.id === activeThreadId;
            const isDeleteDisabled =
              isThreadSelectionDisabled || thread.isAwaitingResponse || thread.messageCount === 0;
            const deleteButtonTitle =
              thread.messageCount === 0
                ? `Cannot delete thread ${thread.name} because it has no messages`
                : `Delete thread ${thread.name}`;
            return (
              <div key={thread.id} className="threads-active-item-row" role="listitem">
                <LabeledTooltip
                  title={thread.name}
                  lines={buildThreadTooltipLines(thread)}
                  className="threads-active-item-tooltip-target"
                >
                  <Button
                    type="button"
                    appearance={isActive ? "secondary" : "subtle"}
                    className={`threads-active-item${isActive ? " is-active" : ""}`}
                    onClick={() => {
                      onActiveThreadChange(thread.id);
                    }}
                    disabled={isThreadSelectionDisabled}
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
                </LabeledTooltip>
                <SymbolIconButton
                  className="threads-delete-btn"
                  ariaLabel={`Delete thread ${thread.name}`}
                  title={deleteButtonTitle}
                  symbol="🗑"
                  disabled={isDeleteDisabled}
                  onClick={() => {
                    onThreadDelete(thread.id);
                  }}
                />
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
              const isRestoreDisabled = isThreadSelectionDisabled || thread.isAwaitingResponse;
              return (
                <div key={thread.id} className="threads-archived-item-row" role="listitem">
                  <LabeledTooltip
                    title={thread.name}
                    lines={buildArchivedThreadTooltipLines(thread)}
                    className="threads-active-item-tooltip-target"
                  >
                    <Button
                      type="button"
                      appearance={isActive ? "secondary" : "subtle"}
                      className={`threads-active-item threads-archived-item${isActive ? " is-active" : ""}`}
                      onClick={() => {
                        onActiveThreadChange(thread.id);
                      }}
                      disabled={isThreadSelectionDisabled}
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
                  </LabeledTooltip>
                  <SymbolIconButton
                    className="threads-restore-btn"
                    ariaLabel={`Restore thread ${thread.name}`}
                    title={`Restore thread ${thread.name}`}
                    symbol="↺"
                    disabled={isRestoreDisabled}
                    onClick={() => {
                      onThreadRestore(thread.id);
                    }}
                  />
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
