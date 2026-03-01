/**
 * Home runtime support module.
 */
import type { ChatAttachment } from "~/lib/home/chat/attachments";
import type { ThreadSkillActivation } from "~/lib/home/skills/types";

export type ThreadMessageRole = "user" | "assistant";

export type ThreadMessage = {
  id: string;
  role: ThreadMessageRole;
  content: string;
  createdAt: string;
  turnId: string;
  attachments: ChatAttachment[];
  skillActivations: ThreadSkillActivation[];
};

export function createThreadMessage(
  role: ThreadMessageRole,
  content: string,
  turnId: string,
  attachments: ChatAttachment[] = [],
  skillActivations: ThreadSkillActivation[] = [],
  createdAt: string = new Date().toISOString(),
): ThreadMessage {
  const randomPart = Math.random().toString(36).slice(2);
  const normalizedCreatedAt = typeof createdAt === "string" && createdAt.trim()
    ? createdAt.trim()
    : new Date().toISOString();
  return {
    id: `${role}-${Date.now()}-${randomPart}`,
    role,
    content,
    createdAt: normalizedCreatedAt,
    turnId,
    attachments,
    skillActivations: skillActivations.map((selection) => ({ ...selection })),
  };
}
