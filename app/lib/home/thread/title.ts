import { THREAD_AUTO_TITLE_MAX_LENGTH } from "~/lib/constants";
import type { ChatMessage } from "~/lib/home/chat/messages";

const threadAutoTitleContextMaxCharacters = 3_000;
const threadAutoTitleContextMessageLimit = 8;

export function buildThreadAutoTitlePlaygroundContent(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return "";
  }

  const lines = messages
    .slice(-threadAutoTitleContextMessageLimit)
    .map((message) => {
      const content = message.content.replace(/\s+/g, " ").trim();
      if (!content) {
        return "";
      }

      return `${message.role === "user" ? "User" : "Assistant"}: ${content}`;
    })
    .filter((line) => line.length > 0);

  return truncateByCharacters(lines.join("\n"), threadAutoTitleContextMaxCharacters).trim();
}

export function buildThreadAutoTitleRequestMessage(options: {
  playgroundContent: string;
  instruction: string;
}): string {
  const payload = {
    objective: "Generate a concise thread title.",
    constraints: {
      maxCharacters: THREAD_AUTO_TITLE_MAX_LENGTH,
      useInstruction: true,
      output: "single plain-text title only",
    },
    playgroundContent: options.playgroundContent.trim(),
    instruction: options.instruction.trim(),
  };

  return [
    "Create a thread title from the payload.",
    "Use both playgroundContent and instruction.",
    "Return only the title text.",
    JSON.stringify(payload),
  ].join("\n");
}

export function normalizeThreadAutoTitle(value: string): string {
  const firstLine = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return "";
  }

  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  const unquoted = collapsed.replace(/^[`"'「『]+|[`"'」』]+$/g, "").trim();
  if (!unquoted) {
    return "";
  }

  return truncateByCharacters(unquoted, THREAD_AUTO_TITLE_MAX_LENGTH).trim();
}

function truncateByCharacters(value: string, maxCharacters: number): string {
  return Array.from(value).slice(0, maxCharacters).join("");
}
