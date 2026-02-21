import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { LabeledTooltip } from "~/components/home/shared/LabeledTooltip";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";

const { Button, Spinner } = FluentUI;

export type ThreadOption = {
  id: string;
  name: string;
  updatedAt: string;
  messageCount: number;
  mcpServerCount: number;
  isAwaitingResponse: boolean;
};

export type ThreadsManageSectionProps = {
  threadOptions: ThreadOption[];
  activeThreadId: string;
  isLoadingThreads: boolean;
  isSwitchingThread: boolean;
  threadError: string | null;
  onActiveThreadChange: (threadId: string) => void;
};

export function ThreadsManageSection(props: ThreadsManageSectionProps) {
  const {
    threadOptions,
    activeThreadId,
    isLoadingThreads,
    isSwitchingThread,
    threadError,
    onActiveThreadChange,
  } = props;

  const isThreadSelectionDisabled = isLoadingThreads || isSwitchingThread;

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
      {threadOptions.length === 0 ? (
        <p className="field-hint">No threads</p>
      ) : (
        <div className="threads-active-list" role="list" aria-label="Playground threads">
          {threadOptions.map((thread) => {
            const isActive = thread.id === activeThreadId;
            return (
              <LabeledTooltip
                key={thread.id}
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
            );
          })}
        </div>
      )}
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
