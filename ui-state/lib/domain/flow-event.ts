// flow-event.ts — the flow-event domain model (FlowEvent) and the flow
// identity value object (FlowId) it owns. FlowId is FlowEvent's identity, not
// a distinct concept, so the two live together: every freshly-constructed
// event builds and carries the FlowId that addresses it.
//
// This is the DOMAIN CORE (hexagon innermost ring): FlowEvent is a rich model
// — it OWNS its construction (incl. its FlowId), its routing behavior, its
// cache serialization, and its rehydration. The plain serialized shape lives
// here only as a co-located DTO `type` (FlowEventRecord). The (de)serialization
// itself lives in the OUTBOUND adapter (`persistence/redis.ts`) — the domain
// never parses untrusted bytes. See the `domain-modeling` skill.
//
// References:
//   docs/decisions/adr-027-*.md  — persistence/wire record contract
//   docs/decisions/adr-028-*.md  — machines own transitions, the log owns state
//   docs/decisions/adr-030-*.md  — flow_id key form `<machine>:<principal_id>`
//   docs/decisions/adr-040-*.md  — legacy machine-name aliases
//   docs/decisions/adr-041-*.md  — session-onboarding domain realignment

/**
 * The plain serialized shape of a flow event — the EXACT Redis hash / wire
 * record (the persistence contract). A DTO `type`, no behavior: the
 * outbound adapter (`persistence/redis.ts`) is the only code that produces it
 * (via `FlowEvent.createCacheSerialization`) or consumes it (via
 * `FlowEvent.fromCache`). BYTE-STABLE — the field set IS the persisted-bytes
 * contract; do not add, remove, or rename fields.
 */
export type FlowEventRecord = {
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  request_id: string;
};

/**
 * FlowId — the structured flow-identity value object: which machine handles
 * the flow + which principal owns it. `:` never appears in a principal_id, so
 * the key form is an unambiguous `${machine}:${principal_id}` — the SAME string
 * the actor map, the Redis key prefix (`ui-state:{flow_id}:events`), the
 * frozen/abandoned sets, and `projection.flow_id` all use. FlowId is the ONE
 * place that knows that encoding; every string-keyed context bridges through
 * `toKey`/`fromKey`.
 *
 * `machine` carries the segment AS MINTED — possibly a legacy alias
 * (`login-and-org-setup`, `project-and-chat-session-management`) — so `toKey()`
 * reproduces the exact actor-map / Redis key. Alias canonicalization stays at
 * `FLOW_STRATEGY_REGISTRY.resolve()`, the single canonicalization point; FlowId
 * never canonicalizes.
 *
 * FlowId "doesn't exist apart from FlowEvent": FlowEvent constructs and owns
 * it, and callers reach a flow's identity through FlowEvent's surface
 * (`getFlowId()` / `flowKey` / `getMachine()`). The `of` / `fromKey` statics
 * serve the begin path + the broadcast loops, which key off a raw `flow_id`
 * string before any FlowEvent for that step exists.
 */
export class FlowId {
  constructor(
    /** Wire/registry machine segment AS MINTED (may be a legacy alias). NOT
     *  necessarily the canonical registry key — canonicalization stays at
     *  resolve(). */
    readonly machine: string,
    readonly principal_id: string,
  ) {}

  static of(machine: string, principal_id: string): FlowId {
    return new FlowId(machine, principal_id);
  }

  /** Parse a key string back into the pair. The machine is everything before
   *  the FIRST ":"; the principal_id is the remainder, preserving any embedded
   *  ":" (strictly safer than `split(":")[1]`, which would drop it). A key with
   *  no ":" yields an empty principal_id. Principals never contain ":" on real
   *  data, so both forms agree there. */
  static fromKey(key: string): FlowId {
    const idx = key.indexOf(":");
    if (idx < 0) return new FlowId(key, "");
    return new FlowId(key.slice(0, idx), key.slice(idx + 1));
  }

  /** The Redis/actor-map string form: "${machine}:${principal_id}". The
   *  SINGLE definition of the encoding — every string-keyed context bridges
   *  through here. */
  toKey(): string {
    return `${this.machine}:${this.principal_id}`;
  }
}

/**
 * FlowEvent — the flow-event domain model. A rich (non-anemic) model: it owns
 * construction, routing behavior, cache serialization, and rehydration.
 *
 * The `#flowId` private field doubles as a NOMINAL BRAND: TypeScript type
 * position is structural, so without it a plain `FlowEventRecord` of the right
 * shape would impersonate a FlowEvent; the ECMAScript-private member makes the
 * class effectively nominal (only real instances type-check, and only they
 * carry the methods + identity).
 *
 * The four payload-bearing fields stay PUBLIC `readonly` so the projection
 * reducers and the orchestrator's `actor.send({ type, ...payload })` read them
 * directly (they are the wire record's fields). Identity is PRIVATE behind
 * getters because it carries behavior — the key encoding + the strategy
 * selector.
 */
export class FlowEvent {
  readonly #flowId: FlowId;

  private constructor(
    flowId: FlowId,
    readonly ts: string,
    readonly type: string,
    readonly payload: Record<string, unknown>,
    readonly request_id: string,
  ) {
    this.#flowId = flowId;
  }

  /**
   * Birth a fresh event from explicit identity parts — the router send path
   * (route machine-constant + verified principal). Builds the FlowId itself
   * and applies birth invariants: `ts` defaults to now() (the
   * deterministic-clock seam survives via the optional last arg), `payload`
   * defaults to {} (absorbing the routers' `?? {}`).
   */
  static create(
    machine: string,
    principal_id: string,
    fields: {
      type: string;
      payload?: Record<string, unknown>;
      request_id: string;
    },
    ts?: string,
  ): FlowEvent {
    return new FlowEvent(
      new FlowId(machine, principal_id),
      ts ?? new Date().toISOString(),
      fields.type,
      fields.payload ?? {},
      fields.request_id,
    );
  }

  /**
   * Birth a fresh event addressed to an EXISTING flow key — the strategy /
   * broadcast emission path, which holds the bridged `flow_id` string for the
   * flow it is appending to. Parses the key into the owned FlowId; same birth
   * invariants as `create`. (The owned FlowId is irrelevant to the persisted
   * record but keeps `getMachine()` / `getFlowId()` total on every instance.)
   */
  static createForFlow(
    flowKey: string,
    fields: {
      type: string;
      payload?: Record<string, unknown>;
      request_id: string;
    },
    ts?: string,
  ): FlowEvent {
    const id = FlowId.fromKey(flowKey);
    return FlowEvent.create(id.machine, id.principal_id, fields, ts);
  }

  /**
   * Rehydrate an event from a persisted record — the redis read adapter.
   * Trusts already-validated persisted state (no birth defaults). The flow
   * identity is reconstructed from the STREAM KEY the adapter read from, so
   * `getMachine()` / `getFlowId()` / `flowKey` are TOTAL on a read-back event
   * (they never throw — the persisted record carries no identity field by
   * design).
   */
  static fromCache(flowKey: string, record: FlowEventRecord): FlowEvent {
    return new FlowEvent(
      FlowId.fromKey(flowKey),
      record.ts,
      record.type,
      record.payload,
      record.request_id,
    );
  }

  /** The strategy selector + actor-map head segment, AS MINTED (legacy alias
   *  preserved verbatim — canonicalization stays at resolve()). */
  getMachine(): string {
    return this.#flowId.machine;
  }

  /** The owned flow-identity value object. */
  getFlowId(): FlowId {
    return this.#flowId;
  }

  /** The bridged actor-map / Redis / projection key string. */
  get flowKey(): string {
    return this.#flowId.toKey();
  }

  /** The plain serialized record — the SOLE event→bytes encoder. The redis
   *  adapter persists exactly this; nothing else serializes a FlowEvent. */
  createCacheSerialization(): FlowEventRecord {
    return {
      ts: this.ts,
      type: this.type,
      payload: this.payload,
      request_id: this.request_id,
    };
  }
}
