/**
 * Test module verifying stdio-inputs behavior.
 */
import { describe, expect, it } from "vitest";
import {
  formatKeyValueLines,
  formatStdioArgsInput,
  parseStdioArgsInput,
  parseStdioEnvInput,
} from "./stdio-inputs";

describe("parseStdioArgsInput", () => {
  it("parses space-separated args", () => {
    expect(parseStdioArgsInput("--port 3000 --mode dev")).toEqual({
      ok: true,
      value: ["--port", "3000", "--mode", "dev"],
    });
  });

  it("parses JSON string array and trims empty entries", () => {
    expect(parseStdioArgsInput('[" --port ", "3000", " ", "--mode"]')).toEqual({
      ok: true,
      value: ["--port", "3000", "--mode"],
    });
  });

  it("rejects invalid args JSON", () => {
    expect(parseStdioArgsInput("[invalid")).toEqual({
      ok: false,
      error: "Args must be space-separated text or a JSON string array.",
    });

    expect(parseStdioArgsInput("[1,2,3]")).toEqual({
      ok: false,
      error: "Args JSON must be an array of strings.",
    });
  });
});

describe("parseStdioEnvInput", () => {
  it("parses KEY=value lines", () => {
    expect(parseStdioEnvInput("API_KEY=abc\nMODE=dev\n")).toEqual({
      ok: true,
      value: {
        API_KEY: "abc",
        MODE: "dev",
      },
    });
  });

  it("allows '=' in env value", () => {
    expect(parseStdioEnvInput("TOKEN=abc=def")).toEqual({
      ok: true,
      value: {
        TOKEN: "abc=def",
      },
    });
  });

  it("rejects invalid env line format and key", () => {
    expect(parseStdioEnvInput("INVALID")).toEqual({
      ok: false,
      error: "ENV line 1 must use KEY=value format.",
    });

    expect(parseStdioEnvInput("1KEY=value")).toEqual({
      ok: false,
      error: "ENV line 1 has invalid key.",
    });
  });
});

describe("stdio input formatters", () => {
  it("formats args as JSON array", () => {
    expect(formatStdioArgsInput([])).toBe("");
    expect(formatStdioArgsInput(["--port", "3000"])).toBe('["--port","3000"]');
  });

  it("formats key-value lines in sorted key order", () => {
    expect(
      formatKeyValueLines({
        Z_KEY: "z",
        A_KEY: "a",
      }),
    ).toBe("A_KEY=a\nZ_KEY=z");
  });
});
