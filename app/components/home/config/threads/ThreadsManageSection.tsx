import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";

const { Button, Field, Spinner } = FluentUI;

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

  const selectedThread =
    threadOptions.find((thread) => thread.id === activeThreadId) ?? null;
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
      <Field label="Active Thread">
        {threadOptions.length === 0 ? (
          <p className="field-hint">No threads</p>
        ) : (
          <div className="threads-active-list" role="list" aria-label="Playground threads">
            {threadOptions.map((thread) => {
              const isActive = thread.id === activeThreadId;
              return (
                <Button
                  key={thread.id}
                  type="button"
                  appearance={isActive ? "secondary" : "subtle"}
                  className={`threads-active-item${isActive ? " is-active" : ""}`}
                  title={`Switch to ${thread.name}`}
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
              );
            })}
          </div>
        )}
      </Field>
      {selectedThread ? (
        <p className="field-hint">
          Updated: {formatUpdatedAt(selectedThread.updatedAt)} | Messages: {selectedThread.messageCount} |
          Connected MCP Servers: {selectedThread.mcpServerCount}
        </p>
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
