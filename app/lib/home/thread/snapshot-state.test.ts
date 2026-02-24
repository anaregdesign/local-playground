/**
 * Test module verifying snapshot-state behavior.
 */
import { describe, expect, it } from "vitest";
import {
  hasThreadPersistableState,
  hasThreadInteraction,
  isThreadArchivedById,
  isThreadSnapshotArchived,
} from "~/lib/home/thread/snapshot-state";

describe("hasThreadInteraction", () => {
  it("returns false for threads without messages", () => {
    expect(hasThreadInteraction({ messages: [] })).toBe(false);
  });

  it("returns true for threads with selected skills", () => {
    expect(
      hasThreadInteraction({
        messages: [],
        skillSelections: [
          {
            name: "local-playground-dev",
            location: "/repo/skills/local-playground-dev/SKILL.md",
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns true for threads with messages", () => {
    expect(
      hasThreadInteraction({
        messages: [
          {
            id: "message-1",
            role: "user",
            content: "Hello",
            turnId: "turn-1",
            attachments: [],
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("hasThreadPersistableState", () => {
  it("returns false when only default thread settings are present", () => {
    expect(
      hasThreadPersistableState({
        messages: [],
        reasoningEffort: "none",
        webSearchEnabled: false,
      }),
    ).toBe(false);
  });

  it("returns true when reasoning effort differs from default", () => {
    expect(
      hasThreadPersistableState({
        messages: [],
        reasoningEffort: "medium",
        webSearchEnabled: false,
      }),
    ).toBe(true);
  });

  it("returns true when web search is enabled", () => {
    expect(
      hasThreadPersistableState({
        messages: [],
        reasoningEffort: "none",
        webSearchEnabled: true,
      }),
    ).toBe(true);
  });
});

describe("isThreadSnapshotArchived", () => {
  it("returns false when the snapshot is missing", () => {
    expect(isThreadSnapshotArchived(null)).toBe(false);
    expect(isThreadSnapshotArchived(undefined)).toBe(false);
  });

  it("returns false when deletedAt is null", () => {
    expect(isThreadSnapshotArchived({ deletedAt: null })).toBe(false);
  });

  it("returns true when deletedAt is set", () => {
    expect(isThreadSnapshotArchived({ deletedAt: "2026-02-20T00:00:00.000Z" })).toBe(true);
  });
});

describe("isThreadArchivedById", () => {
  const snapshots = [
    { id: "thread-active", deletedAt: null },
    { id: "thread-archived", deletedAt: "2026-02-20T00:00:00.000Z" },
  ];

  it("returns false when the id is empty or unknown", () => {
    expect(isThreadArchivedById(snapshots, "")).toBe(false);
    expect(isThreadArchivedById(snapshots, "thread-missing")).toBe(false);
  });

  it("returns false for active thread ids", () => {
    expect(isThreadArchivedById(snapshots, "thread-active")).toBe(false);
  });

  it("returns true for archived thread ids", () => {
    expect(isThreadArchivedById(snapshots, "thread-archived")).toBe(true);
  });
});
