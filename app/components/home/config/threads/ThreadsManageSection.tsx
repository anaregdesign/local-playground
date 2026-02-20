import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";

const { Button, Field, Input, Select, Spinner } = FluentUI;

export type ThreadOption = {
  id: string;
  name: string;
  updatedAt: string;
  messageCount: number;
  mcpServerCount: number;
};

export type ThreadsManageSectionProps = {
  threadOptions: ThreadOption[];
  activeThreadId: string;
  newThreadNameInput: string;
  isSending: boolean;
  isLoadingThreads: boolean;
  isSwitchingThread: boolean;
  isCreatingThread: boolean;
  threadError: string | null;
  onActiveThreadChange: (threadId: string) => void;
  onNewThreadNameInputChange: (value: string) => void;
  onCreateThread: () => void | Promise<void>;
  onReloadThreads: () => void | Promise<void>;
};

export function ThreadsManageSection(props: ThreadsManageSectionProps) {
  const {
    threadOptions,
    activeThreadId,
    newThreadNameInput,
    isSending,
    isLoadingThreads,
    isSwitchingThread,
    isCreatingThread,
    threadError,
    onActiveThreadChange,
    onNewThreadNameInputChange,
    onCreateThread,
    onReloadThreads,
  } = props;

  const selectedThread =
    threadOptions.find((thread) => thread.id === activeThreadId) ?? null;

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
        <Select
          id="thread-active-id"
          title="Switch the active Playground thread."
          value={activeThreadId}
          onChange={(event) => {
            onActiveThreadChange(event.target.value);
          }}
          disabled={
            isLoadingThreads ||
            isSwitchingThread ||
            isSending ||
            threadOptions.length === 0
          }
        >
          {threadOptions.length === 0 ? <option value="">No threads</option> : null}
          {threadOptions.map((thread) => (
            <option key={thread.id} value={thread.id}>
              {formatThreadOptionLabel(thread)}
            </option>
          ))}
        </Select>
      </Field>
      {selectedThread ? (
        <p className="field-hint">
          Updated: {formatUpdatedAt(selectedThread.updatedAt)} | Messages: {selectedThread.messageCount} |
          Connected MCP Servers: {selectedThread.mcpServerCount}
        </p>
      ) : null}
      <Field label="New Thread Name (optional)">
        <Input
          id="thread-new-name"
          title="Optional name for a new thread."
          value={newThreadNameInput}
          onChange={(_, data) => {
            onNewThreadNameInputChange(data.value);
          }}
          placeholder="Thread name"
          disabled={isLoadingThreads || isSwitchingThread || isSending || isCreatingThread}
        />
      </Field>
      <div className="mcp-action-row">
        <Button
          type="button"
          appearance="primary"
          title="Create a new thread and switch to it."
          onClick={() => {
            void onCreateThread();
          }}
          disabled={isLoadingThreads || isSwitchingThread || isSending || isCreatingThread}
        >
          {isCreatingThread ? "🧵 Creating Thread..." : "🧵 Create Thread"}
        </Button>
        <Button
          type="button"
          appearance="subtle"
          size="small"
          className="mcp-refresh-btn"
          title="Reload threads from database."
          aria-label="Reload threads"
          onClick={() => {
            void onReloadThreads();
          }}
          disabled={isLoadingThreads || isSwitchingThread || isSending}
        >
          ↻
        </Button>
      </div>
      <StatusMessageList messages={[{ intent: "error", text: threadError }]} />
    </ConfigSection>
  );
}

function formatThreadOptionLabel(thread: ThreadOption): string {
  return `${thread.name} (${thread.messageCount} msgs, ${thread.mcpServerCount} MCP)`;
}

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}
