export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  turnId: string;
};

export function createMessage(role: ChatRole, content: string, turnId: string): ChatMessage {
  const randomPart = Math.random().toString(36).slice(2);
  return {
    id: `${role}-${Date.now()}-${randomPart}`,
    role,
    content,
    turnId,
  };
}
