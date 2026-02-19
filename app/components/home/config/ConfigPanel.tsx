import type { ComponentProps } from "react";
import { FluentUI } from "~/components/home/shared/fluent";
import { McpServersTab } from "~/components/home/config/mcp/McpServersTab";
import { SettingsTab } from "~/components/home/config/settings/SettingsTab";
import type { MainViewTab } from "~/components/home/shared/types";

const { MessageBar, MessageBarBody, Tab, TabList } = FluentUI;

const MAIN_VIEW_TAB_OPTIONS: Array<{ id: MainViewTab; label: string }> = [
  { id: "settings", label: "⚙️ Settings" },
  { id: "mcp", label: "🧩 MCP Servers" },
];

type ConfigPanelProps = {
  activeMainTab: MainViewTab;
  onMainTabChange: (nextTab: MainViewTab) => void;
  isChatLocked: boolean;
  settingsTabProps: Omit<ComponentProps<typeof SettingsTab>, "activeMainTab">;
  mcpServersTabProps: Omit<ComponentProps<typeof McpServersTab>, "activeMainTab">;
};

export function ConfigPanel(props: ConfigPanelProps) {
  const { activeMainTab, onMainTabChange, isChatLocked, settingsTabProps, mcpServersTabProps } = props;

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
            if (nextTab === "settings" || nextTab === "mcp") {
              onMainTabChange(nextTab);
            }
          }}
        >
          {MAIN_VIEW_TAB_OPTIONS.map((tab) => (
            <Tab
              key={tab.id}
              value={tab.id}
              id={`tab-${tab.id}`}
              aria-controls={`panel-${tab.id}`}
              className="main-tab-btn"
              title={tab.id === "settings" ? "Open Settings panel." : "Open MCP Servers panel."}
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
          <SettingsTab activeMainTab={activeMainTab} {...settingsTabProps} />
          <McpServersTab activeMainTab={activeMainTab} {...mcpServersTabProps} />
        </div>
      </div>
    </aside>
  );
}
