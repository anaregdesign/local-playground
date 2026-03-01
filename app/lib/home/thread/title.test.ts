/**
 * Test module verifying title behavior.
 */
import { describe, expect, it } from "vitest";
import {
  buildThreadAutoTitlePlaygroundContent,
  buildThreadAutoTitleRequestMessage,
  normalizeThreadAutoTitle,
} from "~/lib/home/thread/title";

describe("normalizeThreadAutoTitle", () => {
  it("normalizes whitespace and keeps only the first non-empty line", () => {
    expect(normalizeThreadAutoTitle('  "Playground  plan"  \nsecond line')).toBe("Playground plan");
  });

  it("truncates to 20 characters", () => {
    expect(normalizeThreadAutoTitle("12345678901234567890xyz")).toBe("12345678901234567890");
  });
});

describe("buildThreadAutoTitlePlaygroundContent", () => {
  it("includes recent messages with role labels", () => {
    const content = buildThreadAutoTitlePlaygroundContent([
      {
        id: "m-1",
        role: "user",
        content: "Draft a rollout plan",
        turnId: "t-1",
        attachments: [],
        dialogueSkillSelections: [],
      },
      {
        id: "m-2",
        role: "assistant",
        content: "I can help with milestones.",
        turnId: "t-1",
        attachments: [],
        dialogueSkillSelections: [],
      },
    ]);

    expect(content).toBe("User: Draft a rollout plan\nAssistant: I can help with milestones.");
  });
});

describe("buildThreadAutoTitleRequestMessage", () => {
  it("embeds both playground content and instruction", () => {
    const message = buildThreadAutoTitleRequestMessage({
      playgroundContent: "User: Build release checklist",
      instruction: "Answer in Japanese.",
    });

    expect(message).toContain("User: Build release checklist");
    expect(message).toContain("Answer in Japanese.");
    expect(message).toContain('"useInstruction":true');
  });
});
