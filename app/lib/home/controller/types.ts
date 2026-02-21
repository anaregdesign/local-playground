import type { InstructionLanguage } from "~/lib/home/instruction/helpers";

export type InstructionEnhanceComparison = {
  original: string;
  enhanced: string;
  extension: string;
  language: InstructionLanguage;
  diffPatch: string;
};

export type AzureActionApiResponse = {
  message?: string;
  error?: string;
};

export type AzureConnectionsApiResponse = {
  projects?: unknown;
  deployments?: unknown;
  principal?: unknown;
  tenantId?: unknown;
  principalId?: unknown;
  authRequired?: boolean;
  error?: string;
};

export type AzureSelectionApiResponse = {
  selection?: unknown;
  error?: string;
};

export type McpServersApiResponse = {
  profile?: unknown;
  profiles?: unknown;
  warning?: string;
  authRequired?: boolean;
  error?: string;
};

export type ThreadsApiResponse = {
  threads?: unknown;
  thread?: unknown;
  authRequired?: boolean;
  error?: string;
};

export type ThreadRequestState = {
  isSending: boolean;
  sendProgressMessages: string[];
  activeTurnId: string | null;
  lastErrorTurnId: string | null;
  error: string | null;
};
