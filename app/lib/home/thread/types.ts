/**
 * Home runtime support module.
 */
import type { ChatMessage } from "~/lib/home/chat/messages";
import type { McpRpcHistoryEntry } from "~/lib/home/chat/stream";
import type { McpServerConfig } from "~/lib/home/mcp/profile";
import type { ReasoningEffort } from "~/lib/home/shared/view-types";
import type { ThreadSkillSelection } from "~/lib/home/skills/types";
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
  messages: ChatMessage[];
  mcpServers: McpServerConfig[];
  mcpRpcHistory: McpRpcHistoryEntry[];
  skillSelections: ThreadSkillSelection[];
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
