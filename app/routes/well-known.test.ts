/**
 * Test module verifying /.well-known metadata probe route behavior.
 */
import { describe, expect, it, vi } from "vitest";

const {
  installGlobalServerErrorLoggingMock,
} = vi.hoisted(() => ({
  installGlobalServerErrorLoggingMock: vi.fn(),
}));

vi.mock("~/lib/server/observability/app-event-log", () => ({
  installGlobalServerErrorLogging: installGlobalServerErrorLoggingMock,
}));

import { action, loader } from "./well-known";

describe("well-known route", () => {
  it("returns 404 for metadata probe GET requests", async () => {
    const response = loader();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "OAuth metadata is not configured for this Local Playground endpoint.",
      authConfigured: false,
    });
  });

  it("returns 405 for non-GET requests", async () => {
    const response = action();
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      error: "Method not allowed.",
    });
  });
});
