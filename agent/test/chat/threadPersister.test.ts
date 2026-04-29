import { describe, expect, it } from "vitest";

import type { ChatEvent } from "../../lib/chat/events";
import {
  DOMAIN_EVENT_TYPES,
  isDomainEvent,
  noopThreadPersister,
  UI_DIRECTIVE_TYPES,
} from "../../lib/chat/threadPersister";

describe("threadPersister classifier", () => {
  it("isDomainEvent returns true for every domain event type", () => {
    const samples: ChatEvent[] = [
      { type: "transform_applied", transform_id: "t-1", dataset_id: "d-1", operation: "trim", column: "c" },
      { type: "row_added", dataset_id: "d-1", row_id: "r-1" },
      { type: "row_deleted", dataset_id: "d-1", row_id: "r-1" },
      { type: "column_renamed", dataset_id: "d-1", old_name: "a", new_name: "b" },
      { type: "transform_undone", transform_id: "t-1", dataset_id: "d-1", mode: "disable" },
      { type: "transform_re_enabled", transform_id: "t-1", dataset_id: "d-1" },
      { type: "error_occurred", phase: "backend_dispatch", message: "boom", retryable: false },
      { type: "turn_done", reason: "stop" },
    ];
    for (const sample of samples) {
      expect(isDomainEvent(sample)).toBe(true);
    }
  });

  it("isDomainEvent returns false for every UI directive type (ADR-014: directives are out of replay scope)", () => {
    const samples: ChatEvent[] = [
      { type: "sort_directive", column: "c", direction: "asc" },
      { type: "filter_directive", column: "c", filters: [] },
      { type: "filters_cleared" },
    ];
    for (const sample of samples) {
      expect(isDomainEvent(sample)).toBe(false);
    }
  });

  it("isDomainEvent returns false for assistant_text_delta (text streaming, not a state-change outcome)", () => {
    expect(isDomainEvent({ type: "assistant_text_delta", delta: "hi" })).toBe(false);
  });

  it("DOMAIN_EVENT_TYPES and UI_DIRECTIVE_TYPES are disjoint", () => {
    for (const t of DOMAIN_EVENT_TYPES) {
      expect(UI_DIRECTIVE_TYPES.has(t)).toBe(false);
    }
  });
});

describe("noopThreadPersister", () => {
  it("resolves without throwing for any input", async () => {
    await expect(
      noopThreadPersister.persist("channel-1", [
        { type: "row_added", dataset_id: "d-1", row_id: "r-1" },
      ]),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing for empty event list and missing channel id", async () => {
    await expect(noopThreadPersister.persist("", [])).resolves.toBeUndefined();
  });
});
