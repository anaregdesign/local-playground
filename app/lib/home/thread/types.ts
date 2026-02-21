import type { ChatMessage } from "~/lib/home/chat/messages";
import type { McpRpcHistoryEntry } from "~/lib/home/chat/stream";
import type { McpServerConfig } from "~/lib/home/mcp/profile";

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
