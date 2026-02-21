import { describe, expect, it } from "vitest";
import {
  extractThreadAutoTitle,
  parseThreadTitleReasoningEffort,
} from "./api.thread-title";

describe("parseThreadTitleReasoningEffort", () => {
  it("defaults to high when omitted", () => {
    expect(parseThreadTitleReasoningEffort({})).toEqual({ ok: true, value: "high" });
    expect(parseThreadTitleReasoningEffort("invalid")).toEqual({ ok: true, value: "high" });
  });

  it("accepts valid values", () => {
    expect(parseThreadTitleReasoningEffort({ reasoningEffort: "none" })).toEqual({
      ok: true,
      value: "none",
    });
    expect(parseThreadTitleReasoningEffort({ reasoningEffort: "medium" })).toEqual({
      ok: true,
      value: "medium",
    });
  });

  it("rejects invalid values", () => {
    expect(parseThreadTitleReasoningEffort({ reasoningEffort: "fast" })).toEqual({
      ok: false,
      error: "`reasoningEffort` must be one of: none, low, medium, high.",
    });
    expect(parseThreadTitleReasoningEffort({ reasoningEffort: 1 })).toEqual({
      ok: false,
      error: "`reasoningEffort` must be a string.",
    });
  });
});

describe("extractThreadAutoTitle", () => {
  it("normalizes plain text title output", () => {
    expect(extractThreadAutoTitle('  "プロジェクト 計画" \nsecond line')).toBe(
      "プロジェクト 計画",
    );
  });

  it("supports JSON object output and truncates to 20 characters", () => {
    expect(extractThreadAutoTitle({ title: "12345678901234567890extra" })).toBe(
      "12345678901234567890",
    );
  });

  it("supports JSON string output", () => {
    expect(extractThreadAutoTitle('{"title":"初回リリース準備"}')).toBe("初回リリース準備");
  });

  it("throws when output is empty", () => {
    expect(() => extractThreadAutoTitle("   ")).toThrow("Thread title response is empty.");
  });
});
