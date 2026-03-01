/**
 * Home runtime support module.
 */
import type { ChatAttachment } from "~/lib/home/chat/attachments";
import type { ThreadSkillActivation } from "~/lib/home/skills/types";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  turnId: string;
  attachments: ChatAttachment[];
  dialogueSkillSelections: ThreadSkillActivation[];
};

export function createMessage(
  role: ChatRole,
  content: string,
  turnId: string,
  attachments: ChatAttachment[] = [],
  dialogueSkillSelections: ThreadSkillActivation[] = [],
): ChatMessage {
  const randomPart = Math.random().toString(36).slice(2);
  return {
    id: `${role}-${Date.now()}-${randomPart}`,
    role,
    content,
    turnId,
    attachments,
    dialogueSkillSelections: dialogueSkillSelections.map((selection) => ({ ...selection })),
  };
}
