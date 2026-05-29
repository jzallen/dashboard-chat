// Unit tests for the ChatAppSnapshotStore adapter. The Redis tier
// needs a live server, so these exercise the noop adapter — which mirrors the
// Redis tier's JSON round-trip in-process (save serializes, load deserializes),
// so the same serialization seam is covered without a Redis dep.

import { describe, expect, it } from "vitest";

import {
  createNoopChatAppSnapshotStore,
  selectChatAppSnapshotStore,
  snapshotKey,
} from "./chatapp-snapshot-store.ts";

const PRINCIPAL = "dev-user-001";

describe("ChatAppSnapshotStore round-trip (noop adapter)", () => {
  it("round-trips a structured snapshot through save → load (deep, not by reference)", async () => {
    const store = createNoopChatAppSnapshotStore();
    const snapshot = {
      status: "active",
      value: { lifecycle: { engaged: "chat" }, connectivity: "live" },
      context: { principal_id: PRINCIPAL, held_events: [] },
      children: { "project-context": { snapshot: { value: "project_selected" } } },
    };

    await store.save(PRINCIPAL, snapshot);
    const loaded = await store.load(PRINCIPAL);

    // Deep-equal AND a fresh object — proves the JSON round-trip ran (the noop
    // stores the serialized string, not the live reference).
    expect(loaded).toEqual(snapshot);
    expect(loaded).not.toBe(snapshot);
  });

  it("returns null when no snapshot is stored for the principal", async () => {
    const store = createNoopChatAppSnapshotStore();
    expect(await store.load("nobody")).toBeNull();
  });

  it("overwrites the prior snapshot (ONE record per principal)", async () => {
    const store = createNoopChatAppSnapshotStore();
    await store.save(PRINCIPAL, { v: 1 });
    await store.save(PRINCIPAL, { v: 2 });
    expect(await store.load(PRINCIPAL)).toEqual({ v: 2 });
  });

  it("reset drops the principal's snapshot", async () => {
    const store = createNoopChatAppSnapshotStore();
    await store.save(PRINCIPAL, { v: 1 });
    await store.reset(PRINCIPAL);
    expect(await store.load(PRINCIPAL)).toBeNull();
  });

  it("isolates principals (per-principal keying)", async () => {
    const store = createNoopChatAppSnapshotStore();
    await store.save("alice", { who: "alice" });
    await store.save("bob", { who: "bob" });
    expect(await store.load("alice")).toEqual({ who: "alice" });
    expect(await store.load("bob")).toEqual({ who: "bob" });
  });

  it("probe is a no-op for the noop tier and close clears the store", async () => {
    const store = createNoopChatAppSnapshotStore();
    await expect(store.probe()).resolves.toBeUndefined();
    await store.save(PRINCIPAL, { v: 1 });
    await store.close();
    expect(await store.load(PRINCIPAL)).toBeNull();
  });
});

describe("snapshotKey + capability-presence dispatch", () => {
  it("keys ONE record per principal under the chatapp prefix (distinct from event-log keys)", () => {
    expect(snapshotKey(PRINCIPAL)).toBe("ui-state:chatapp:dev-user-001:snapshot");
    // Must NOT collide with the per-flow event-log keyspace
    // (`ui-state:{machine}:{principal}:events`).
    expect(snapshotKey(PRINCIPAL)).not.toContain(":events");
  });

  it("selects the noop tier when REDIS_URL is absent", async () => {
    const store = selectChatAppSnapshotStore(undefined);
    await store.save(PRINCIPAL, { tier: "noop" });
    expect(await store.load(PRINCIPAL)).toEqual({ tier: "noop" });
  });

  it("selects the noop tier for an empty REDIS_URL", () => {
    // A defined-but-empty url still falls back to noop (matches selectFlowEventLog).
    expect(() => selectChatAppSnapshotStore("")).not.toThrow();
  });
});
