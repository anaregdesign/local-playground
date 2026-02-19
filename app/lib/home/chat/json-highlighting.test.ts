import { describe, expect, it } from "vitest";
import {
  formatJsonForDisplay,
  isJsonCodeClassName,
  parseJsonMessageTokens,
  tokenizeJson,
} from "./json-highlighting";

describe("formatJsonForDisplay", () => {
  it("pretty-prints object and JSON string inputs", () => {
    expect(formatJsonForDisplay({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatJsonForDisplay('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it("keeps non-JSON string as a JSON string literal", () => {
    expect(formatJsonForDisplay("plain-text")).toBe('"plain-text"');
  });
});

describe("parseJsonMessageTokens", () => {
  it("returns null for non-JSON input", () => {
    expect(parseJsonMessageTokens("hello")).toBeNull();
    expect(parseJsonMessageTokens("{invalid}")).toBeNull();
  });

  it("returns typed tokens for valid JSON", () => {
    const tokens = parseJsonMessageTokens('{"name":"hiro","count":2,"ok":true,"empty":null}');

    expect(tokens).not.toBeNull();
    const types = new Set((tokens ?? []).map((token) => token.type));
    expect(types.has("key")).toBe(true);
    expect(types.has("string")).toBe(true);
    expect(types.has("number")).toBe(true);
    expect(types.has("boolean")).toBe(true);
    expect(types.has("null")).toBe(true);
    expect(types.has("punctuation")).toBe(true);
  });
});

describe("isJsonCodeClassName", () => {
  it("detects json/jsonc code block class names", () => {
    expect(isJsonCodeClassName("language-json")).toBe(true);
    expect(isJsonCodeClassName("lang language-jsonc line-numbers")).toBe(true);
    expect(isJsonCodeClassName("language-js")).toBe(false);
    expect(isJsonCodeClassName(undefined)).toBe(false);
  });
});

describe("tokenizeJson", () => {
  it("classifies keys and string values", () => {
    const tokens = tokenizeJson('{"key":"value"}');

    expect(tokens).toContainEqual({ value: "\"key\"", type: "key" });
    expect(tokens).toContainEqual({ value: "\"value\"", type: "string" });
  });
});
