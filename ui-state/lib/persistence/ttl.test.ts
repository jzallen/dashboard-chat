// Sliding-TTL behaviour of the Redis persistence tiers (slice B). Exercises the
// REAL Redis adapters against an injected ioredis-mock client, so the EXPIRE/EX
// calls — which the noop tier has no concept of — are covered without a live
// server.
import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { FlowEvent } from "../domain/flow-event.ts";
import { createRedisChatAppSnapshotStore } from "./chatapp-snapshot-store.ts";
import { createRedisFlowEventLog } from "./redis.ts";

const TTL = 1800;

function mockClient(): Redis {
  return new RedisMock() as unknown as Redis;
}

// ioredis-mock shares one in-memory keyspace across all instances created
// without distinct options — flush it before each test so keys don't leak.
beforeEach(async () => {
  await mockClient().flushall();
});

function anEvent(): FlowEvent {
  return FlowEvent.create("onboarding", "u1", {
    type: "org_not_found",
    payload: {},
    request_id: "R1",
  });
}

describe("FlowEventLog sliding TTL (Redis tier)", () => {
  it("append sets a bounded TTL on the stream key", async () => {
    const client = mockClient();
    const log = createRedisFlowEventLog("redis://ignored", { ttlSeconds: TTL, client });

    await log.append("onboarding:u1", anEvent());

    const pttl = await client.pttl("ui-state:onboarding:u1:events");
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(TTL * 1000);
  });

  it("touch refreshes the TTL without appending an event", async () => {
    const client = mockClient();
    const log = createRedisFlowEventLog("redis://ignored", { ttlSeconds: TTL, client });
    await log.append("onboarding:u1", anEvent());

    // Strip the TTL (persist → no expiry), then confirm touch re-establishes it.
    await client.persist("ui-state:onboarding:u1:events");
    expect(await client.pttl("ui-state:onboarding:u1:events")).toBe(-1);
    await log.touch("onboarding:u1");

    expect(await client.pttl("ui-state:onboarding:u1:events")).toBeGreaterThan(1000);
    // Touch wrote nothing — the event count is unchanged.
    expect(await log.read("onboarding:u1")).toHaveLength(1);
  });

  it("touch on an absent/expired key is a no-op (never resurrects it)", async () => {
    const client = mockClient();
    const log = createRedisFlowEventLog("redis://ignored", { ttlSeconds: TTL, client });

    await log.touch("onboarding:absent");

    expect(await client.exists("ui-state:onboarding:absent:events")).toBe(0);
  });
});

describe("ChatAppSnapshotStore sliding TTL (Redis tier)", () => {
  it("save sets a bounded TTL on the snapshot key and round-trips the value", async () => {
    const client = mockClient();
    const store = createRedisChatAppSnapshotStore("redis://ignored", {
      ttlSeconds: TTL,
      client,
    });

    await store.save("u1", { value: "engaged" });

    const pttl = await client.pttl("ui-state:chatapp:u1:snapshot");
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(TTL * 1000);
    expect(await store.load("u1")).toEqual({ value: "engaged" });
  });

  it("touch refreshes the snapshot TTL; no-op when the key is absent", async () => {
    const client = mockClient();
    const store = createRedisChatAppSnapshotStore("redis://ignored", {
      ttlSeconds: TTL,
      client,
    });
    await store.save("u1", { value: "engaged" });

    await client.persist("ui-state:chatapp:u1:snapshot");
    expect(await client.pttl("ui-state:chatapp:u1:snapshot")).toBe(-1);
    await store.touch("u1");
    expect(await client.pttl("ui-state:chatapp:u1:snapshot")).toBeGreaterThan(1000);

    await store.touch("absent");
    expect(await client.exists("ui-state:chatapp:absent:snapshot")).toBe(0);
  });
});
