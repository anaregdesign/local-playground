import { describe, expect, it } from "vitest";
import { action, loader } from "./api.azure-logout";

describe("/api/azure-logout", () => {
  it("returns 405 from loader", async () => {
    const response = loader({} as never);
    expect(response.status).toBe(405);
  });

  it("returns 405 for non-POST action requests", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure-logout", { method: "GET" }),
    } as never);
    expect(response.status).toBe(405);
  });

  it("resets azure dependencies on POST and returns success message", async () => {
    const response = await action({
      request: new Request("http://localhost/api/azure-logout", { method: "POST" }),
    } as never);
    const payload = (await response.json()) as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("Azure logout completed. Sign in again when needed.");
  });
});
