/**
 * Tests for RedisThreadPersister (Epic F.2 — ADR-017).
 *
 * Uses ioredis-mock so the suite has no docker dependency. The cross-language
 * compose-runnable smoke test in
 * `backend/tests/integration/test_session_event_replay_redis_live.py` exercises
 * the full TS-write → Python-read path against a real Redis.
 */

import IORedisMock from "ioredis-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChatEvent } from "../../lib/chat/events";
import { EVENT_FIELD, RedisThreadPersister, streamKey } from "../../lib/chat/redisThreadPersister";

let client: IORedisMock;
let persister: RedisThreadPersister;

beforeEach(async () => {
  client = new IORedisMock();
  // ioredis-mock backs all instances with a process-wide store, so flush
  // explicitly between tests to keep them order-independent.
  await client.flushall();
  // ioredis-mock's typing collides with `Redis` from "ioredis"; structural
  // compatibility holds at runtime — the persister only uses xadd.
  persister = new RedisThreadPersister(client as never);
});

afterEach(async () => {
  await client.flushall();
  await client.quit();
});

describe("streamKey", () => {
  it("uses session: namespace and matches Python convention", () => {
    expect(streamKey("abc-123")).toBe("session:events:abc-123");
  });
});

describe("RedisThreadPersister", () => {
  it("does nothing when there are no events", async () => {
    await persister.persist("c1", []);
    const entries = await client.xrange(streamKey("c1"), "-", "+");
    expect(entries).toEqual([]);
  });

  it("does nothing when channel id is empty", async () => {
    const events: ChatEvent[] = [{ type: "row_added", dataset_id: "d1", row_id: "r1" }];
    await persister.persist("", events);
    // No key was written. (Both empty-channel and empty-key paths skip.)
    const keys = await client.keys("session:events:*");
    expect(keys).toEqual([]);
  });

  it("writes one stream entry per event in order", async () => {
    const events: ChatEvent[] = [
      { type: "row_added", dataset_id: "d1", row_id: "r1" },
      { type: "row_added", dataset_id: "d1", row_id: "r2" },
      { type: "row_deleted", dataset_id: "d1", row_id: "r1" },
    ];

    await persister.persist("c1", events);

    const entries = await client.xrange(streamKey("c1"), "-", "+");
    expect(entries).toHaveLength(3);

    const decoded = entries.map(([, fields]) => {
      const map = new Map<string, string>();
      for (let i = 0; i < fields.length; i += 2) {
        map.set(fields[i] as string, fields[i + 1] as string);
      }
      return JSON.parse(map.get(EVENT_FIELD)!);
    });
    expect(decoded.map((e) => (e as { row_id?: string }).row_id)).toEqual(["r1", "r2", "r1"]);
    expect(decoded.map((e) => e.type)).toEqual(["row_added", "row_added", "row_deleted"]);
  });

  it("isolates events by channel id", async () => {
    await persister.persist("c1", [{ type: "row_added", dataset_id: "d", row_id: "r-c1" }]);
    await persister.persist("c2", [{ type: "row_added", dataset_id: "d", row_id: "r-c2" }]);

    const c1 = await client.xrange(streamKey("c1"), "-", "+");
    const c2 = await client.xrange(streamKey("c2"), "-", "+");

    expect(c1).toHaveLength(1);
    expect(c2).toHaveLength(1);
    expect(c1[0][1]).not.toEqual(c2[0][1]);
  });

  it("appends across calls (idempotent-write contract: retries duplicate, never corrupt)", async () => {
    await persister.persist("c1", [{ type: "row_added", dataset_id: "d", row_id: "r1" }]);
    await persister.persist("c1", [{ type: "row_added", dataset_id: "d", row_id: "r1" }]);

    const entries = await client.xrange(streamKey("c1"), "-", "+");
    expect(entries).toHaveLength(2);
  });

  it("accepts maxLen option without throwing on a single batch", async () => {
    // ioredis-mock has a known bug where MAXLEN-trimmed streams reject
    // subsequent XADDs with the next ms's id (the mock doesn't track
    // last-trimmed id correctly). The real Redis behavior is exercised by
    // the compose-runnable smoke test
    // (`backend/tests/integration/test_session_event_replay_redis_live.py`).
    // This assertion just ensures the persister doesn't blow up on a
    // single batch when maxLen is set.
    const capped = new RedisThreadPersister(client as never, { maxLen: 100 });
    const events: ChatEvent[] = [
      { type: "row_added", dataset_id: "d", row_id: "r1" },
      { type: "row_added", dataset_id: "d", row_id: "r2" },
    ];
    await expect(capped.persist("c1", events)).resolves.toBeUndefined();
  });
});
