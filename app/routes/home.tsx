import type { CSSProperties } from "react";
import { ConfigPanel } from "~/components/home/config/ConfigPanel";
import { PlaygroundPanel } from "~/components/home/playground/PlaygroundPanel";
import {
  renderMessageContent,
  renderTurnMcpLog,
} from "~/components/home/playground/PlaygroundRenderers";
import { useWorkspaceController } from "~/lib/home/controller/use-workspace-controller";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Local Playground" },
    { name: "description", content: "Local desktop playground with OpenAI backend." },
  ];
}

export default function Home() {
  const {
    layoutRef,
    rightPaneWidth,
    isMainSplitterResizing,
    onMainSplitterPointerDown,
    configPanelProps,
    playgroundPanelProps,
  } = useWorkspaceController();

  return (
    <main className="chat-page">
      <div
        className="chat-layout workspace-layout"
        ref={layoutRef}
        style={
          {
            "--right-pane-width": `${rightPaneWidth}px`,
          } as CSSProperties
        }
      >
        <PlaygroundPanel
          {...playgroundPanelProps}
          renderMessageContent={renderMessageContent}
          renderTurnMcpLog={renderTurnMcpLog}
        />

        <div
          className={`layout-splitter main-splitter ${isMainSplitterResizing ? "resizing" : ""}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          title="Drag to resize Playground and side panels."
          onPointerDown={onMainSplitterPointerDown}
        />

        <ConfigPanel {...configPanelProps} />
      </div>
    </main>
  );
}
