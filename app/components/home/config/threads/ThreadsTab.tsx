import type { ComponentProps } from "react";
import { InstructionSection } from "~/components/home/config/threads/InstructionSection";
import {
  ThreadsManageSection,
  type ThreadsManageSectionProps,
} from "~/components/home/config/threads/ThreadsManageSection";
import type { MainViewTab } from "~/lib/home/shared/view-types";

type ThreadsTabProps = {
  activeMainTab: MainViewTab;
  instructionSectionProps: ComponentProps<typeof InstructionSection>;
} & ThreadsManageSectionProps;

export function ThreadsTab(props: ThreadsTabProps) {
  const {
    activeMainTab,
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
    instructionSectionProps,
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
        <InstructionSection {...instructionSectionProps} />
        <ThreadsManageSection
          activeThreadOptions={activeThreadOptions}
          archivedThreadOptions={archivedThreadOptions}
          activeThreadId={activeThreadId}
          isLoadingThreads={isLoadingThreads}
          isSwitchingThread={isSwitchingThread}
          isDeletingThread={isDeletingThread}
          isRestoringThread={isRestoringThread}
          threadError={threadError}
          onActiveThreadChange={onActiveThreadChange}
          onThreadDelete={onThreadDelete}
          onThreadRestore={onThreadRestore}
        />
      </div>
    </section>
  );
}
