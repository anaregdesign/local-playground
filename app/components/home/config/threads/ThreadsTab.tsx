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
    threadOptions,
    activeThreadId,
    isLoadingThreads,
    isSwitchingThread,
    threadError,
    onActiveThreadChange,
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
          threadOptions={threadOptions}
          activeThreadId={activeThreadId}
          isLoadingThreads={isLoadingThreads}
          isSwitchingThread={isSwitchingThread}
          threadError={threadError}
          onActiveThreadChange={onActiveThreadChange}
        />
      </div>
    </section>
  );
}
