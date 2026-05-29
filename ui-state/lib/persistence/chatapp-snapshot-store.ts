// ChatAppSnapshotStore — the restart-recovery persistence port for the ChatApp
// coordinator: the live actor's getPersistedSnapshot() is the internal
// state-of-record for hot restart. Mirrors the FlowEventLog tier pattern in
// redis.ts: a port + a Redis adapter + a noop in-memory fallback, selected by
// capability-presence (REDIS_URL present → Redis; absent → noop).
//
// Persistence UNIT: ONE record per principal — `ui-state:chatapp:{principal}:snapshot`.
// This is distinct from the per-`flow_id` event-log keyspace
// (`ui-state:{machine}:{principal}:events`) used for SSE + audit. The snapshot
// store never reads or writes the event-log keys.
//
// The stored value is the OPAQUE XState persisted-snapshot structure
// (getPersistedSnapshot() → parent + invoked children). The store treats it as
// a JSON blob — it never inspects its shape. The FE projection is NEVER derived
// from raw snapshot internals; it is derived through the contract-tested mapper
// (derive-projection.ts). The snapshot is for actor rehydration only.
//
// Rehydrating a snapshot taken mid-invoke RE-FIRES the in-flight invoke
// (self-heals) and survives a JSON round-trip, so this store's
// JSON.stringify → bytes → JSON.parse path is safe for hot restart provided the
// caller snapshots at SETTLED control states (snapshot.ts isSettledForSnapshot).
//
// References:
//   docs/decisions/adr-018-*.md  — capability-presence dispatch
//   docs/decisions/adr-044-*.md  — hybrid snapshot/log persistence, derived projection

import { Redis } from "ioredis";

/** The opaque, JSON-serializable persisted snapshot. We do NOT model its shape
 *  (it is XState-internal + machine-definition-coupled); the store round-trips
 *  it as JSON and the actor layer (createActor({ snapshot })) interprets it. */
export type PersistedChatAppSnapshot = unknown;

export interface ChatAppSnapshotStore {
  /** Persist the principal's latest ChatApp snapshot (overwrites the prior one
   *  — ONE record per principal). Call at SETTLED states only (R3). */
  save(principal_id: string, snapshot: PersistedChatAppSnapshot): Promise<void>;
  /** Load the principal's snapshot for rehydration, or null if none is stored. */
  load(principal_id: string): Promise<PersistedChatAppSnapshot | null>;
  /** Drop the principal's snapshot (e.g. a fresh `begin force_restart`). */
  reset(principal_id: string): Promise<void>;
  /** Health-check the backing store (round-trip on a probe key). HARD-fails at
   *  startup if the Redis tier is unreachable; a no-op for the noop tier. */
  probe(): Promise<void>;
  close(): Promise<void>;
}

/** The single-record key for a principal's ChatApp snapshot. Distinct prefix
 *  segment (`chatapp`) from the per-flow event-log keys so the two keyspaces
 *  never collide. */
export function snapshotKey(principal_id: string): string {
  return `ui-state:chatapp:${principal_id}:snapshot`;
}

export function createRedisChatAppSnapshotStore(
  redisUrl: string,
): ChatAppSnapshotStore {
  const client = new Redis(redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });

  return {
    async save(principal_id, snapshot) {
      // (de)serialization lives HERE at the driven-adapter boundary, mirroring
      // redis.ts. A SET (string), not a stream XADD: the snapshot is a single
      // overwriting record, not an append-only history.
      await client.set(snapshotKey(principal_id), JSON.stringify(snapshot));
    },

    async load(principal_id) {
      const raw = await client.get(snapshotKey(principal_id));
      return raw === null ? null : (JSON.parse(raw) as PersistedChatAppSnapshot);
    },

    async reset(principal_id) {
      await client.del(snapshotKey(principal_id));
    },

    async probe() {
      const probeKey = `ui-state:chatapp:__probe__:${Date.now()}`;
      const payload = JSON.stringify({ probe: true });
      await client.set(probeKey, payload);
      const read = await client.get(probeKey);
      if (read !== payload) {
        throw new Error(
          `chatapp snapshot probe failed: expected round-trip, got ${read}`,
        );
      }
      await client.del(probeKey);
    },

    async close() {
      await client.quit();
    },
  };
}

export function createNoopChatAppSnapshotStore(): ChatAppSnapshotStore {
  // In-memory map for single-process testing/dev when REDIS_URL is absent.
  // Stores the JSON STRING (not the live object) so the same serialization
  // round-trip the Redis tier exercises is exercised in-process — a snapshot
  // that survives this noop store provably survives a real JSON→Redis→JSON hop.
  const store = new Map<string, string>();

  return {
    async save(principal_id, snapshot) {
      store.set(snapshotKey(principal_id), JSON.stringify(snapshot));
    },

    async load(principal_id) {
      const raw = store.get(snapshotKey(principal_id));
      return raw === undefined
        ? null
        : (JSON.parse(raw) as PersistedChatAppSnapshot);
    },

    async reset(principal_id) {
      store.delete(snapshotKey(principal_id));
    },

    async probe() {
      // Noop has no external dependency to probe.
    },

    async close() {
      store.clear();
    },
  };
}

/**
 * Capability-presence dispatch (mirroring selectFlowEventLog): REDIS_URL
 * present → Redis tier; absent → noop fallback.
 */
export function selectChatAppSnapshotStore(
  redisUrl: string | undefined,
): ChatAppSnapshotStore {
  if (redisUrl && redisUrl.length > 0) {
    return createRedisChatAppSnapshotStore(redisUrl);
  }
  return createNoopChatAppSnapshotStore();
}
