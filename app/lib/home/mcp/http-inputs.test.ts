/**
 * Test module verifying http-inputs behavior.
 */
import { describe, expect, it } from "vitest";
import {
  parseAzureAuthScopeInput,
  parseHttpHeadersInput,
  parseMcpTimeoutSecondsInput,
} from "./http-inputs";

describe("parseHttpHeadersInput", () => {
  it("parses valid KEY=value lines", () => {
    expect(parseHttpHeadersInput("Authorization=Bearer abc\nX-Trace-Id=trace-1")).toEqual({
      ok: true,
      value: {
        Authorization: "Bearer abc",
        "X-Trace-Id": "trace-1",
      },
    });
  });

  it("rejects overriding Content-Type", () => {
    expect(parseHttpHeadersInput("Content-Type=text/plain")).toEqual({
      ok: false,
      error: 'Header line cannot override "Content-Type". It is fixed to "application/json".',
    });
  });
});

describe("parseAzureAuthScopeInput", () => {
  it("uses default scope when empty", () => {
    expect(parseAzureAuthScopeInput("")).toEqual({
      ok: true,
      value: "https://cognitiveservices.azure.com/.default",
    });
  });

  it("rejects scope with whitespace", () => {
    expect(parseAzureAuthScopeInput("scope with space")).toEqual({
      ok: false,
      error: "Azure auth scope must not include spaces.",
    });
  });
});

describe("parseMcpTimeoutSecondsInput", () => {
  it("uses default when empty", () => {
    expect(parseMcpTimeoutSecondsInput("")).toEqual({
      ok: true,
      value: 30,
    });
  });

  it("rejects non-integer values", () => {
    expect(parseMcpTimeoutSecondsInput("3.5")).toEqual({
      ok: false,
      error: "MCP timeout must be an integer number of seconds.",
    });
  });

  it("rejects out-of-range values", () => {
    expect(parseMcpTimeoutSecondsInput("0")).toEqual({
      ok: false,
      error: "MCP timeout must be between 1 and 600 seconds.",
    });
  });
});
