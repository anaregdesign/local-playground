import type { ComponentProps } from "react";
import { FluentUI } from "~/components/home/shared/fluent";
import { McpServersTab } from "~/components/home/config/mcp/McpServersTab";
import { SkillsTab } from "~/components/home/config/skills/SkillsTab";
import { SettingsTab } from "~/components/home/config/settings/SettingsTab";
import { ThreadsTab } from "~/components/home/config/threads/ThreadsTab";
import type { MainViewTab } from "~/lib/home/shared/view-types";
import { HOME_MAIN_VIEW_TAB_OPTIONS } from "~/lib/constants";

const { MessageBar, MessageBarBody, Tab, TabList } = FluentUI;

type ConfigPanelProps = {
  activeMainTab: MainViewTab;
  onMainTabChange: (nextTab: MainViewTab) => void;
  isChatLocked: boolean;
  settingsTabProps: Omit<ComponentProps<typeof SettingsTab>, "activeMainTab">;
  mcpServersTabProps: Omit<ComponentProps<typeof McpServersTab>, "activeMainTab">;
  skillsTabProps: Omit<ComponentProps<typeof SkillsTab>, "activeMainTab">;
  threadsTabProps: Omit<ComponentProps<typeof ThreadsTab>, "activeMainTab">;
};

export function ConfigPanel(props: ConfigPanelProps) {
  const {
    activeMainTab,
    onMainTabChange,
    isChatLocked,
    settingsTabProps,
    mcpServersTabProps,
    skillsTabProps,
    threadsTabProps,
  } = props;

  return (
    <aside className="side-shell main-panel" aria-label="Configuration panels">
      <div className="side-shell-header">
        <TabList
          className="main-tabs"
          aria-label="Side panels"
          appearance="subtle"
          size="small"
          title="Switch side panel content."
          selectedValue={activeMainTab}
          onTabSelect={(_, data) => {
            const nextTab = String(data.value);
            if (
              nextTab === "settings" ||
              nextTab === "mcp" ||
              nextTab === "skills" ||
              nextTab === "threads"
            ) {
              onMainTabChange(nextTab);
            }
          }}
        >
          {HOME_MAIN_VIEW_TAB_OPTIONS.map((tab) => (
            <Tab
              key={tab.id}
              value={tab.id}
              id={`tab-${tab.id}`}
              aria-controls={`panel-${tab.id}`}
              className="main-tab-btn"
              title={
                tab.id === "settings"
                  ? "Open Settings panel."
                  : tab.id === "skills"
                    ? "Open Skills panel."
                  : tab.id === "mcp"
                    ? "Open MCP Servers panel."
                    : "Open Threads panel."
              }
            >
              {tab.label}
            </Tab>
          ))}
        </TabList>
        {isChatLocked ? (
          <MessageBar intent="warning" className="tab-guidance-bar">
            <MessageBarBody>🔒 Playground is locked. Open Settings and sign in to Azure.</MessageBarBody>
          </MessageBar>
        ) : null}
      </div>
      <div className="side-shell-body">
        <div className="side-top-panel">
          <ThreadsTab activeMainTab={activeMainTab} {...threadsTabProps} />
          <McpServersTab activeMainTab={activeMainTab} {...mcpServersTabProps} />
          <SkillsTab activeMainTab={activeMainTab} {...skillsTabProps} />
          <SettingsTab activeMainTab={activeMainTab} {...settingsTabProps} />
        </div>
      </div>
    </aside>
  );
}
