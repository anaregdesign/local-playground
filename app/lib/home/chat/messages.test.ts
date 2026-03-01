/**
 * Test module verifying messages behavior.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessage } from "./messages";

describe("createMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a message with deterministic prefix fields", () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    const message = createMessage("user", "hello", "turn-1");

    expect(message.role).toBe("user");
    expect(message.content).toBe("hello");
    expect(message.turnId).toBe("turn-1");
    expect(message.dialogueSkillSelections).toEqual([]);
    expect(message.id.startsWith("user-1700000000000-")).toBe(true);
  });
});
