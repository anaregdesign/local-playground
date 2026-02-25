/**
 * Test module verifying chat command parsing behavior.
 */
import { describe, expect, it } from "vitest";
import { readChatCommandMatchAtCursor, replaceChatCommandToken } from "~/lib/home/chat/commands";

describe("readChatCommandMatchAtCursor", () => {
  it("returns null when no trigger keyword exists", () => {
    expect(
      readChatCommandMatchAtCursor({
        value: "hello world",
        cursorIndex: 5,
        keywords: ["$", "/"],
      }),
    ).toBeNull();
  });

  it("returns a match for a token that starts with a trigger keyword", () => {
    expect(
      readChatCommandMatchAtCursor({
        value: "$local-playground-dev",
        cursorIndex: 20,
        keywords: ["$", "/"],
      }),
    ).toEqual({
      keyword: "$",
      query: "local-playground-dev",
      rangeStart: 0,
      rangeEnd: 21,
    });
  });

  it("matches when the caret is on the keyword character", () => {
    expect(
      readChatCommandMatchAtCursor({
        value: "$",
        cursorIndex: 0,
        keywords: ["$", "/"],
      }),
    ).toEqual({
      keyword: "$",
      query: "",
      rangeStart: 0,
      rangeEnd: 1,
    });
  });

  it("returns null when trigger character is not at token boundary", () => {
    expect(
      readChatCommandMatchAtCursor({
        value: "abc$skill",
        cursorIndex: 9,
        keywords: ["$", "/"],
      }),
    ).toBeNull();
  });

  it("supports multiple keywords through shared parsing", () => {
    expect(
      readChatCommandMatchAtCursor({
        value: "run /help now",
        cursorIndex: 9,
        keywords: ["$", "/"],
      }),
    ).toEqual({
      keyword: "/",
      query: "help",
      rangeStart: 4,
      rangeEnd: 9,
    });
  });
});

describe("replaceChatCommandToken", () => {
  it("removes the command token and keeps single spacing", () => {
    expect(
      replaceChatCommandToken({
        value: "run $skill now",
        rangeStart: 4,
        rangeEnd: 10,
        replacement: "",
      }),
    ).toEqual({
      value: "run now",
      cursorIndex: 4,
    });
  });

  it("replaces the token with arbitrary text", () => {
    expect(
      replaceChatCommandToken({
        value: "start /help",
        rangeStart: 6,
        rangeEnd: 11,
        replacement: "help",
      }),
    ).toEqual({
      value: "start help",
      cursorIndex: 10,
    });
  });
});
