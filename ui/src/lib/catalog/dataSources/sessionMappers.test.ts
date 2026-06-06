import { describe, expect, it } from "vitest";

import type { BackendSession } from "./sessionMappers";
import { formatWhen, toChatHistoryItem } from "./sessionMappers";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const session = (over: Partial<BackendSession> = {}): BackendSession => ({
  id: "s1",
  title: "Clean the customers table",
  active_dataset_id: "d1",
  created_at: "2026-06-01T00:00:00Z",
  last_active_at: "2026-06-05T00:00:00Z",
  ...over,
});

describe("formatWhen", () => {
  const now = Date.parse("2026-06-06T12:00:00Z");

  it("formats minutes ago", () => {
    expect(formatWhen(new Date(now - 5 * MINUTE).toISOString(), now)).toBe(
      "5m ago",
    );
  });

  it("formats days ago", () => {
    expect(formatWhen(new Date(now - 3 * DAY).toISOString(), now)).toBe(
      "3d ago",
    );
  });
});

describe("toChatHistoryItem", () => {
  const now = Date.parse("2026-06-06T12:00:00Z");

  it("maps the session title", () => {
    expect(toChatHistoryItem(session({ title: "My chat" }), now).title).toBe(
      "My chat",
    );
  });

  it("maps nodeId from active_dataset_id when present", () => {
    expect(toChatHistoryItem(session({ active_dataset_id: "d7" }), now).nodeId).toBe(
      "d7",
    );
  });

  it("maps nodeId to null when active_dataset_id is absent", () => {
    expect(
      toChatHistoryItem(session({ active_dataset_id: null }), now).nodeId,
    ).toBeNull();
  });

  it("derives `when` from last_active_at via formatWhen", () => {
    const last = new Date(now - 2 * MINUTE).toISOString();
    expect(toChatHistoryItem(session({ last_active_at: last }), now).when).toBe(
      "2m ago",
    );
  });

  it("falls back to created_at when last_active_at is null", () => {
    const created = new Date(now - 4 * DAY).toISOString();
    expect(
      toChatHistoryItem(
        session({ last_active_at: null, created_at: created }),
        now,
      ).when,
    ).toBe("4d ago");
  });

  it("leaves snippet undefined (backend sessions carry none)", () => {
    expect(toChatHistoryItem(session(), now).snippet).toBeUndefined();
  });
});
