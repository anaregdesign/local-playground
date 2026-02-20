import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";

const { Field, Select, Spinner } = FluentUI;

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
