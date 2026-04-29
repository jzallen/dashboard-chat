/**
 * Unit tests for the per-channel reflect-only directive log
 * (ADR-015 / dc-x3y.2.2). Covers append-order preservation, last_event_at
 * stamping, channel isolation, no-op on empty channelId, and the route's
 * JSON shape.
 */

import { describe, expect, it } from "vitest";

import {
  InProcessPresentationStateLog,
  noopPresentationStateLog,
} from "../../lib/chat/presentationState";
import { createPresentationStateRoutes } from "../../lib/chat/presentationStateRoutes";

describe("InProcessPresentationStateLog", () => {
  it("appends directives in order and stamps last_event_at", async () => {
    const log = new InProcessPresentationStateLog(
      () => new Date("2026-04-29T05:00:00Z"),
    );

    await log.append("ch-1", { type: "sort_directive", column: "region", direction: "asc" });
    await log.append("ch-1", { type: "filter_directive", column: "amount", filters: [{ operator: "gt", value: 100 }] });
    await log.append("ch-1", { type: "filters_cleared" });

    const entry = await log.get("ch-1");
    expect(entry.channel_id).toBe("ch-1");
    expect(entry.last_event_at).toBe("2026-04-29T05:00:00.000Z");
    expect(entry.directives).toEqual([
      { type: "sort_directive", column: "region", direction: "asc" },
      { type: "filter_directive", column: "amount", filters: [{ operator: "gt", value: 100 }] },
      { type: "filters_cleared" },
    ]);
  });

  it("isolates channels", async () => {
    const log = new InProcessPresentationStateLog();
    await log.append("ch-a", { type: "sort_directive", column: "x", direction: "asc" });
    await log.append("ch-b", { type: "filters_cleared" });

    const a = await log.get("ch-a");
    const b = await log.get("ch-b");
    expect(a.directives.map((d) => d.type)).toEqual(["sort_directive"]);
    expect(b.directives.map((d) => d.type)).toEqual(["filters_cleared"]);
  });

  it("returns an empty entry for unknown channels", async () => {
    const log = new InProcessPresentationStateLog();
    const entry = await log.get("never-touched");
    expect(entry).toEqual({
      channel_id: "never-touched",
      directives: [],
      last_event_at: "",
    });
  });

  it("skips append when channelId is empty (no anonymous bucket)", async () => {
    const log = new InProcessPresentationStateLog();
    await log.append("", { type: "filters_cleared" });
    const entry = await log.get("");
    expect(entry.directives).toEqual([]);
  });

  it("returns a defensive copy of directives so callers can't mutate the store", async () => {
    const log = new InProcessPresentationStateLog();
    await log.append("ch-1", { type: "sort_directive", column: "x", direction: "asc" });
    const entry = await log.get("ch-1");
    entry.directives.push({ type: "filters_cleared" });

    const fresh = await log.get("ch-1");
    expect(fresh.directives).toHaveLength(1);
  });

  it("stamps a fresh last_event_at on each append", async () => {
    let now = new Date("2026-04-29T05:00:00Z");
    const log = new InProcessPresentationStateLog(() => now);

    await log.append("ch-1", { type: "sort_directive", column: "x", direction: "asc" });
    expect((await log.get("ch-1")).last_event_at).toBe("2026-04-29T05:00:00.000Z");

    now = new Date("2026-04-29T05:00:01Z");
    await log.append("ch-1", { type: "filters_cleared" });
    expect((await log.get("ch-1")).last_event_at).toBe("2026-04-29T05:00:01.000Z");
  });
});

describe("noopPresentationStateLog", () => {
  it("is callable but stores nothing", async () => {
    await noopPresentationStateLog.append("ch-1", { type: "filters_cleared" });
    expect(await noopPresentationStateLog.get("ch-1")).toEqual({
      channel_id: "ch-1",
      directives: [],
      last_event_at: "",
    });
  });
});

describe("GET /api/channels/:channelId/presentation-state", () => {
  it("returns the log entry for the channel", async () => {
    const log = new InProcessPresentationStateLog(
      () => new Date("2026-04-29T05:00:00Z"),
    );
    await log.append("ch-1", { type: "sort_directive", column: "region", direction: "desc" });

    const app = createPresentationStateRoutes(log);
    const res = await app.fetch(
      new Request("http://test/api/channels/ch-1/presentation-state"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      channel_id: "ch-1",
      directives: [{ type: "sort_directive", column: "region", direction: "desc" }],
      last_event_at: "2026-04-29T05:00:00.000Z",
    });
  });

  it("returns an empty entry for unknown channels (200, not 404)", async () => {
    const log = new InProcessPresentationStateLog();
    const app = createPresentationStateRoutes(log);

    const res = await app.fetch(
      new Request("http://test/api/channels/never-seen/presentation-state"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      channel_id: "never-seen",
      directives: [],
      last_event_at: "",
    });
  });
});
