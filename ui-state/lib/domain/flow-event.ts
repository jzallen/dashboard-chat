// flow-event.ts — the flow identity value object (FlowId) and the flow event
// model (FlowEvent) that rides on it. FlowId is FlowEvent's identity, not a
// distinct concept, so the two live together: every freshly-constructed event
// carries the FlowId that addresses it.
//
// A flow is addressed by which machine handles it + which principal owns it.
// `:` never appears in a principal_id (ADR-030 §SD3), so the key form is an
// unambiguous `${machine}:${principal_id}` — the SAME string the actor map,
// the Redis key prefix (`ui-state:{flow_id}:events`), the frozen/abandoned
// sets, and `projection.flow_id` all use. `FlowId` is the ONE place that knows
// that encoding; every string-keyed context bridges through `toKey`/`fromKey`.
//
// It REPLACES the two ad-hoc `flow_id.split(":")` readers the orchestrator
// carried (`machineOfFlow` → `.machine`; `parsePrincipal` → `.principal_id`).
//
// LEAF-2 (ADR-040/041): `machine` carries the segment as MINTED — possibly a
// legacy alias (`login-and-org-setup`, `project-and-chat-session-management`)
// — so `toKey()` reproduces the exact actor-map / Redis key. Alias
// canonicalization stays at `FLOW_STRATEGY_REGISTRY.resolve()`, the single
// canonicalization point; `FlowId` never canonicalizes.
//
// Method-bag, not a class: a POJO interface + a companion object keeps it a
// structurally-equal value with no serialization surprise (it rides on a
// transient `FlowEvent.flowId` field that must round-trip cleanly and never
// land in a Redis hash as a class instance).

export interface FlowId {
  /** Wire/registry machine segment AS MINTED (may be a legacy alias). NOT
   *  necessarily the canonical registry key — canonicalization stays at
   *  resolve(). */
  readonly machine: string;
  readonly principal_id: string;
}

export const FlowId = {
  of(machine: string, principal_id: string): FlowId {
    return { machine, principal_id };
  },

  /** The Redis/actor-map string form: "${machine}:${principal_id}". The
   *  SINGLE definition of the encoding — every string-keyed context bridges
   *  through here. */
  toKey(id: FlowId): string {
    return `${id.machine}:${id.principal_id}`;
  },

  /** Parse a key string back into the pair. The machine is everything before
   *  the FIRST ":" (parity with the old `flow_id.split(":")[0]`); the
   *  principal_id is the remainder, preserving any embedded ":" (strictly
   *  safer than the old `split(":")[1]`, which would have dropped it).
   *  Principals never contain ":" on real data (ADR-030), so both are
   *  equivalent there. A key with no ":" yields an empty principal_id (parity
   *  with the old `parsePrincipal` returning ""). */
  fromKey(key: string): FlowId {
    const idx = key.indexOf(":");
    if (idx < 0) return { machine: key, principal_id: "" };
    return { machine: key.slice(0, idx), principal_id: key.slice(idx + 1) };
  },
};

export interface FlowEvent {
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  request_id: string;
  /** TRANSIENT routing property — present on freshly CONSTRUCTED events (via
   *  FlowEvent.from), ABSENT on events DESERIALIZED from Redis. Never
   *  persisted (redis serialize() is a 4-field allow-list) and never projected
   *  (buildProjection ignores it). FlowEvent.getMachine() reads it. */
  readonly flowId?: FlowId;
}

/**
 * Companion object merged with the FlowEvent interface (the same
 * interface+const pattern as FlowId). Owns event construction so the "an
 * event always has a ts" invariant lives on the model — not at ~40 call
 * sites — and so every freshly-built event carries its routing FlowId.
 * Machine-AGNOSTIC: it stores the FlowId it is handed and branches on
 * nothing.
 */
export const FlowEvent = {
  /** Named constructor. `ts` defaults to now() when absent (the
   *  deterministic-clock seam survives via the optional last arg); `payload`
   *  defaults to {} (absorbing the routers' `?? {}`). The FlowId leads —
   *  addressing first. */
  from(
    flowId: FlowId,
    fields: {
      type: string;
      payload?: Record<string, unknown>;
      request_id: string;
    },
    ts?: string,
  ): FlowEvent {
    return {
      ts: ts ?? new Date().toISOString(),
      type: fields.type,
      payload: fields.payload ?? {},
      request_id: fields.request_id,
      flowId,
    };
  },

  /** The routing machine segment carried by a freshly-constructed event.
   *  THROWS on a deserialized (flowId-less) event reaching the dispatch path
   *  — a loud failure beats a silent wrong-machine dispatch (strictly better
   *  than the old `flow_id.split(":")[0]`, which would happily mis-key). */
  getMachine(event: FlowEvent): string {
    if (!event.flowId) {
      throw new Error(
        "FlowEvent.getMachine: event has no flowId (deserialized event reached the dispatch path)",
      );
    }
    return event.flowId.machine;
  },
};
