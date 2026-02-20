import type { MainViewTab } from "~/components/home/shared/types";
import {
  ThreadsManageSection,
  type ThreadsManageSectionProps,
} from "~/components/home/config/threads/ThreadsManageSection";

type ThreadsTabProps = {
  activeMainTab: MainViewTab;
} & ThreadsManageSectionProps;

export function ThreadsTab(props: ThreadsTabProps) {
  const {
    activeMainTab,
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

  return (
    <section
      className="threads-shell"
      aria-label="Thread settings"
      id="panel-threads"
      role="tabpanel"
      aria-labelledby="tab-threads"
      hidden={activeMainTab !== "threads"}
    >
      <div className="threads-content">
        <ThreadsManageSection
          threadOptions={threadOptions}
          activeThreadId={activeThreadId}
          newThreadNameInput={newThreadNameInput}
          isSending={isSending}
          isLoadingThreads={isLoadingThreads}
          isSwitchingThread={isSwitchingThread}
          isCreatingThread={isCreatingThread}
          threadError={threadError}
          onActiveThreadChange={onActiveThreadChange}
          onNewThreadNameInputChange={onNewThreadNameInputChange}
          onCreateThread={onCreateThread}
          onReloadThreads={onReloadThreads}
        />
      </div>
    </section>
  );
}
