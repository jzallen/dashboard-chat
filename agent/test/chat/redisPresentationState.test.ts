/**
 * Unit tests for RedisPresentationStateLog (Epic F.3 / ADR-015).
 *
 * Uses ioredis-mock so the suite has no docker dependency. The cross-replica
 * compose-runnable smoke test in `agent/test/multi-replica.test.ts` exercises
 * the cross-process path against a real Redis under
 * `docker compose --scale agent=2`.
 */

import IORedisMock from "ioredis-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  directivesKey,
  lastEventAtKey,
  RedisPresentationStateLog,
} from "../../lib/chat/redisPresentationState";

let client: IORedisMock;

beforeEach(async () => {
  client = new IORedisMock();
  // ioredis-mock backs all instances with a process-wide store; flush
  // explicitly between tests to keep them order-independent.
  await client.flushall();
});

afterEach(async () => {
  await client.flushall();
  await client.quit();
});

describe("key helpers", () => {
  it("uses presentation: namespace and matches the F.3 wiring contract", () => {
    expect(directivesKey("ch-1")).toBe("presentation:directives:ch-1");
    expect(lastEventAtKey("ch-1")).toBe("presentation:last-event-at:ch-1");
  });
});

describe("RedisPresentationStateLog", () => {
  it("appends directives in order and stamps last_event_at", async () => {
    const log = new RedisPresentationStateLog(client as never, {
      now: () => new Date("2026-04-29T05:00:00Z"),
    });

    await log.append("ch-1", { type: "sort_directive", column: "region", direction: "asc" });
    await log.append("ch-1", {
      type: "filter_directive",
      column: "amount",
      filters: [{ operator: "gt", value: 100 }],
    });
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
    const log = new RedisPresentationStateLog(client as never);
    await log.append("ch-a", { type: "sort_directive", column: "x", direction: "asc" });
    await log.append("ch-b", { type: "filters_cleared" });

    const a = await log.get("ch-a");
    const b = await log.get("ch-b");
    expect(a.directives.map((d) => d.type)).toEqual(["sort_directive"]);
    expect(b.directives.map((d) => d.type)).toEqual(["filters_cleared"]);
  });

  it("returns an empty entry for unknown channels", async () => {
    const log = new RedisPresentationStateLog(client as never);
    const entry = await log.get("never-touched");
    expect(entry).toEqual({
      channel_id: "never-touched",
      directives: [],
      last_event_at: "",
    });
  });

  it("skips append when channelId is empty (no anonymous bucket)", async () => {
    const log = new RedisPresentationStateLog(client as never);
    await log.append("", { type: "filters_cleared" });
    // No keys written.
    const keys = await client.keys("presentation:*");
    expect(keys).toEqual([]);
    const entry = await log.get("");
    expect(entry.directives).toEqual([]);
  });

  it("stamps a fresh last_event_at on each append", async () => {
    let now = new Date("2026-04-29T05:00:00Z");
    const log = new RedisPresentationStateLog(client as never, { now: () => now });

    await log.append("ch-1", { type: "sort_directive", column: "x", direction: "asc" });
    expect((await log.get("ch-1")).last_event_at).toBe("2026-04-29T05:00:00.000Z");

    now = new Date("2026-04-29T05:00:01Z");
    await log.append("ch-1", { type: "filters_cleared" });
    expect((await log.get("ch-1")).last_event_at).toBe("2026-04-29T05:00:01.000Z");
  });

  it("preserves order across separate append calls (idempotent retries duplicate, never reorder)", async () => {
    const log = new RedisPresentationStateLog(client as never);
    await log.append("ch-1", { type: "sort_directive", column: "x", direction: "asc" });
    await log.append("ch-1", { type: "sort_directive", column: "x", direction: "asc" });

    const entry = await log.get("ch-1");
    expect(entry.directives).toHaveLength(2);
    expect(entry.directives.map((d) => d.type)).toEqual(["sort_directive", "sort_directive"]);
  });

  it("caps the stored log at maxLen (most recent entries kept)", async () => {
    const log = new RedisPresentationStateLog(client as never, { maxLen: 3 });
    for (const col of ["a", "b", "c", "d", "e"]) {
      await log.append("ch-1", { type: "sort_directive", column: col, direction: "asc" });
    }

    const entry = await log.get("ch-1");
    expect(entry.directives.map((d) => (d as { column?: string }).column)).toEqual([
      "c",
      "d",
      "e",
    ]);
  });

  it("does not trim when maxLen is not set", async () => {
    const log = new RedisPresentationStateLog(client as never);
    for (const col of ["a", "b", "c", "d", "e"]) {
      await log.append("ch-1", { type: "sort_directive", column: col, direction: "asc" });
    }

    const entry = await log.get("ch-1");
    expect(entry.directives).toHaveLength(5);
  });

  it("treats maxLen=0 as 'disabled' rather than 'cap to zero'", async () => {
    // Zero is the operator's way to say "unbounded" — capping to zero would
    // truncate the log on the very first append, which is never useful.
    const log = new RedisPresentationStateLog(client as never, { maxLen: 0 });
    await log.append("ch-1", { type: "sort_directive", column: "x", direction: "asc" });
    const entry = await log.get("ch-1");
    expect(entry.directives).toHaveLength(1);
  });
});
