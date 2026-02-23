/**
 * Home runtime support module.
 */
import type { ChatMessage } from "~/lib/home/chat/messages";
import type { McpRpcHistoryEntry } from "~/lib/home/chat/stream";
import type { McpServerConfig } from "~/lib/home/mcp/profile";
import type { ThreadSkillSelection } from "~/lib/home/skills/types";

export type ThreadSnapshot = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  agentInstruction: string;
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
