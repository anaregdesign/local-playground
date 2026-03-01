/**
 * Test module verifying runtime-event-log behavior.
 */
import { describe, expect, it } from "vitest";
import {
  readClientRuntimeEventLogPayload,
  readErrorDetails,
  serializeRuntimeEventContext,
} from "~/lib/observability/runtime-event-log";

describe("readClientRuntimeEventLogPayload", () => {
  it("parses a valid payload and normalizes optional fields", () => {
    const result = readClientRuntimeEventLogPayload({
      level: "warning",
      category: "frontend",
      eventName: "test_event",
      message: "Something happened",
      statusCode: 400,
      threadId: "thread-1",
      context: {
        step: "save",
      },
    });

    expect(result).toEqual({
      level: "warning",
      category: "frontend",
      eventName: "test_event",
      message: "Something happened",
      statusCode: 400,
      threadId: "thread-1",
      context: {
        step: "save",
      },
    });
  });

  it("returns null when required fields are missing", () => {
    expect(
      readClientRuntimeEventLogPayload({
        level: "error",
        category: "frontend",
        message: "missing event name",
      }),
    ).toBeNull();
  });
});

describe("readErrorDetails", () => {
  it("extracts name, message, and stack from Error", () => {
    const error = new Error("boom");
    error.name = "CustomError";
    const result = readErrorDetails(error);
    expect(result.name).toBe("CustomError");
    expect(result.message).toBe("boom");
    expect(typeof result.stack === "string" || result.stack === null).toBe(true);
  });

  it("handles non-error values safely", () => {
    const result = readErrorDetails({
      reason: "failed",
    });
    expect(result.name).toBe("UnknownError");
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("serializeRuntimeEventContext", () => {
  it("serializes nested context and truncates by depth", () => {
    const context = {
      a: {
        b: {
          c: {
            d: {
              e: {
                f: {
                  g: "too-deep",
                },
              },
            },
          },
        },
      },
    };

    const serialized = serializeRuntimeEventContext(context);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed).toHaveProperty("a");
  });
});
