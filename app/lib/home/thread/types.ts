/**
 * Home runtime support module.
 */
import type { ThreadMessage } from "~/lib/home/chat/messages";
import type { ThreadOperationLogEntry } from "~/lib/home/chat/stream";
import type { McpServerConfig } from "~/lib/home/mcp/profile";
import type { ReasoningEffort } from "~/lib/home/shared/view-types";
import type { ThreadSkillActivation } from "~/lib/home/skills/types";
import type { ThreadEnvironment } from "~/lib/home/thread/environment";

export type ThreadSnapshot = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  reasoningEffort: ReasoningEffort;
  webSearchEnabled: boolean;
  agentInstruction: string;
  threadEnvironment: ThreadEnvironment;
  messages: ThreadMessage[];
  mcpServers: McpServerConfig[];
  mcpRpcLogs: ThreadOperationLogEntry[];
  skillSelections: ThreadSkillActivation[];
};

export type ThreadSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  messageCount: number;
  mcpServerCount: number;
};
