import { describe, expect, it } from "vitest";
import { hasThreadInteraction } from "~/lib/home/thread/snapshot-state";

describe("hasThreadInteraction", () => {
  it("returns false for threads without messages", () => {
    expect(hasThreadInteraction({ messages: [] })).toBe(false);
  });

  it("returns true for threads with messages", () => {
    expect(
      hasThreadInteraction({
        messages: [
          {
            id: "message-1",
            role: "user",
            content: "Hello",
            turnId: "turn-1",
            attachments: [],
          },
        ],
      }),
    ).toBe(true);
  });
});
