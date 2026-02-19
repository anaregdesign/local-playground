import { describe, expect, it } from "vitest";
import { validateContextWindowInput } from "./context-window";

describe("validateContextWindowInput", () => {
  it("rejects empty input", () => {
    expect(validateContextWindowInput("   ")).toEqual({
      isValid: false,
      value: null,
      message: "Enter an integer between 1 and 200.",
    });
  });

  it("rejects non-integer input", () => {
    expect(validateContextWindowInput("1.5")).toEqual({
      isValid: false,
      value: null,
      message: "Context window must be an integer.",
    });
  });

  it("rejects out-of-range input", () => {
    expect(validateContextWindowInput("0")).toEqual({
      isValid: false,
      value: null,
      message: "Context window must be between 1 and 200.",
    });

    expect(validateContextWindowInput("201")).toEqual({
      isValid: false,
      value: null,
      message: "Context window must be between 1 and 200.",
    });
  });

  it("accepts valid integer input", () => {
    expect(validateContextWindowInput(" 42 ")).toEqual({
      isValid: true,
      value: 42,
      message: null,
    });
  });
});
