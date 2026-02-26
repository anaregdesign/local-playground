/**
 * Test module verifying thread environment parsing behavior.
 */
import { describe, expect, it } from "vitest";
import {
  parseThreadEnvironmentFromUnknown,
  readThreadEnvironmentFromUnknown,
} from "~/lib/home/thread/environment";

describe("parseThreadEnvironmentFromUnknown", () => {
  it("parses valid environment maps", () => {
    expect(
      parseThreadEnvironmentFromUnknown(
        {
          VIRTUAL_ENV: "/tmp/.venv",
          PATH: "/tmp/.venv/bin:${PATH}",
        },
        {
          strict: true,
          pathLabel: "threadEnvironment",
        },
      ),
    ).toEqual({
      ok: true,
      value: {
        VIRTUAL_ENV: "/tmp/.venv",
        PATH: "/tmp/.venv/bin:${PATH}",
      },
    });
  });

  it("rejects invalid payloads in strict mode", () => {
    expect(
      parseThreadEnvironmentFromUnknown(
        {
          "INVALID-KEY": "value",
        },
        {
          strict: true,
          pathLabel: "threadEnvironment",
        },
      ),
    ).toEqual({
      ok: false,
      error:
        '`threadEnvironment` includes an invalid key "INVALID-KEY". ' +
        "Keys must match /^[A-Za-z_][A-Za-z0-9_]*$/ and be 128 characters or fewer.",
    });
  });
});

describe("readThreadEnvironmentFromUnknown", () => {
  it("sanitizes invalid entries in non-strict mode", () => {
    expect(
      readThreadEnvironmentFromUnknown({
        VIRTUAL_ENV: "/tmp/.venv",
        "INVALID-KEY": "should-be-dropped",
        PATH: 123,
      }),
    ).toEqual({
      VIRTUAL_ENV: "/tmp/.venv",
    });
  });
});
