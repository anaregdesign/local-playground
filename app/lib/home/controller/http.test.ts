/**
 * Test module verifying http behavior.
 */
import { describe, expect, it } from "vitest";
import { readJsonPayload } from "~/lib/home/controller/http";

describe("readJsonPayload", () => {
  it("parses valid JSON payloads", async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(readJsonPayload<{ ok: boolean }>(response, "test payload")).resolves.toEqual({
      ok: true,
    });
  });

  it("returns empty object for blank payloads", async () => {
    const response = new Response("   ", { status: 200 });

    await expect(
      readJsonPayload<{ empty?: boolean }>(response, "empty payload"),
    ).resolves.toEqual({});
  });

  it("returns authRequired marker for invalid 401 payloads", async () => {
    const response = new Response("<html>Unauthorized</html>", { status: 401 });

    await expect(
      readJsonPayload<{ authRequired?: boolean }>(response, "login"),
    ).resolves.toEqual({ authRequired: true });
  });

  it("throws preview error for invalid non-401 payloads", async () => {
    const response = new Response("<html>Unexpected Server Error</html>", { status: 500 });

    await expect(readJsonPayload(response, "saved MCP servers")).rejects.toThrow(
      "Failed to parse saved MCP servers response (status 500): <html>Unexpected Server Error</html>",
    );
  });
});
