# Design note — `FlowId` value object; `FlowEvent` owns construction; `send` derives addressing + strategy from the event

**Status:** DESIGN recommendation (read-only pass — REVISION 2). Scoped to the ui-state flow-event send path.
**Base:** main @ a7e6123 (prior `/event` ACL cleanup landed: `/event` payload is a zod discriminated union; tag via `.refine(isUnderlyingCauseTag)`; empty `org_name` is a domain rule on `constructOrgName`).
**Consistency anchors:** ADR-028 (no machine-specific logic leaks into the shared orchestrator; machines own transitions, the log owns state), ADR-040 (FlowStrategy port + pump seam; LEAF-2 alias map; `flow_id` derived from verified identity), ADR-041 (session-onboarding realignment; LEAF-2 `login-and-org-setup` alias), D-E1 (ACL translation at the boundary).

> **Revision 2 corrects the prior conclusion.** Rev-1 derived `machine` via `machineOfFlow(flow_id)` =
> `flow_id.split(":")[0]`. That is primitive obsession: `flow_id` is a structured pair
> (`machine` + `principal_id`) masquerading as a string, and the string-split is the smell. The
> ratified direction (user, 2026-05-25): **model `FlowId` as a value object** `{ machine, principal_id }`
> with `.toKey()` / `.fromKey()`; `FlowEvent` carries its `FlowId`; `FlowEvent.getMachine()` returns
> `flowId.machine`; `send(event)` derives BOTH the actor-map key and the strategy from the event's
> `FlowId`. `machineOfFlow` is DELETED. `SendEventInput` and `translateWireEvent` are DELETED. `machine`
> drops off the `/event` wire. The rest of Rev-1 (FlowEvent.from construction, freeze buffer, caller
> map, risks) is carried forward and updated for the VO shape.

---

## 0. What was verified against the code at a7e6123

| Claim | Verified at |
|-------|-------------|
| `FlowEvent` = `{ ts, type, payload, request_id }`, no companion const | `projection.ts` 15-20 |
| `machineOfFlow(flow_id) = flow_id.split(":")[0]` — the smell | `orchestrator.ts` 72-74 |
| `parsePrincipal(flow_id) = flow_id.split(":")[1]` — a SECOND ad-hoc split | `orchestrator.ts` 1289-1292 |
| `SendEventInput = { machine, flow_id, type, payload, request_id }` | `orchestrator.ts` 332-338 |
| `send`/`sendCore` keyed by `input.flow_id`; `resolve(input.machine)` at 756 | `orchestrator.ts` 696-887 |
| Two `ts: new Date()...` in sendCore (frozen 727, normal 737) | `orchestrator.ts` 727, 737 |
| `FrozenFlowState.queued: Array<{ input: SendEventInput; seq }>` | `orchestrator.ts` 343-352 |
| actor map / `frozen` / `abandoned` / `priorState` ALL keyed by `string` | `orchestrator.ts` 386-395 |
| redis serialize/deserialize byte-contract = exactly `{ts,type,payload,request_id}`; key = `ui-state:${flow_id}:events` | `redis.ts` 36-64 |
| `projection.flow_id: string` (ADR-027 wire envelope) | `projection.ts` 22-30, 1024-1032 |
| begin mints `flow_id = ${input.machine}:${principal_id}` (3 begin paths) | `session-onboarding/strategy.ts` 260; `orchestrator.ts` 472; `project-context/strategy.ts` 98 |
| routers mint `flow_id = ${wireName}:${userId}` | onb router 285; pc router 177; sc router 129 |
| `resolve()` applies `MACHINE_NAME_ALIASES` (PROJECT_CONTEXT_WIRE_NAME→project-context; login-and-org-setup→session-onboarding) | `orchestrator.ts` 242-247, 270-277 |
| `applyEvent`/`settle` read `input.machine`/`.flow_id`/`.type`/`.payload`/`.request_id` | pc strat 242-273, 308-542; sc strat 444-478, 501-584; onb strat 94-171 |
| **Existing tests use the CANONICAL `session-onboarding` prefix, NOT the legacy `login-and-org-setup`** | `orchestrator.test.ts` 110-117 (and 8 more `send({machine:"session-onboarding",…})` sites) |

**Key finding (R1, sharpened):** there is NO existing test that drives a `login-and-org-setup:…` flow_id
through `send`. The LEAF-2 send-path alias is *uncharacterized*. This is the single highest-value
characterization gap and it does not change between Rev-1 and Rev-2 — but the VO makes it sharper: with
`FlowId.fromKey("login-and-org-setup:x")`, the canonicalization point becomes a deliberate design choice
(§3 LEAF-2), so pinning current behavior FIRST is mandatory (Iron Rule).

---

## 1. The three conflations being removed

1. **`flow_id`-as-string is a structured pair pretending to be a primitive.** `machineOfFlow` and
   `parsePrincipal` both `flow_id.split(":")` to recover the two fields. The "a flow_id is
   `machine:principal`" invariant is re-derived ad hoc at every reader. This is the primitive obsession
   the VO cures.

2. **Event construction is scattered.** Every emission site hand-builds a `FlowEvent` with
   `ts: new Date().toISOString()`. The "every event has a `ts`" invariant lives at ~30 call sites instead
   of on the model — the same shape `constructOrgName` already cured for the org-name rule.

3. **Addressing + strategy selection are conflated with the wire.** `SendEventInput` carries `machine`
   *redundantly* with `flow_id`; the routers pass `wireName` as `machine` AND build
   `flow_id = ${wireName}:${principal}`. `machine` is recoverable from the flow's own identity — and
   `input.machine` is a *legitimate strategy selector*, so the fix is not to string-split but to make
   the identity a typed pair whose `.machine` field IS the selector.

The target: `FlowId` VO owns the pair + its key form; `FlowEvent.from(...)` owns construction (defaulting
`ts`) and carries the `FlowId`; `send(event: FlowEvent)` derives the actor-map key (`event.flowId.toKey()`)
and the strategy (`resolve(event.getMachine())`) from the event itself; `machine` drops off the `/event`
wire and the send path.

---

## 2. The `FlowId` value object

### Shape, `.toKey()`, `.fromKey()`

```ts
// flow-id.ts — NEW module, sibling of projection.ts. (Rationale §2.3.)
//
// FlowId is the structured flow identity: which machine + which principal.
// `:` never appears in a principal_id (ADR-030 §SD3), so the key form is an
// unambiguous `${machine}:${principal_id}` — the same string the actor map,
// the Redis key prefix, the frozen/abandoned sets, and projection.flow_id all
// use today. FlowId is the ONE place that knows that encoding.

export interface FlowId {
  /** Wire/registry machine segment as MINTED (may be a legacy alias, e.g.
   *  "login-and-org-setup" or "project-and-chat-session-management"). NOT
   *  necessarily the canonical registry key — canonicalization stays at
   *  resolve() (see §3 LEAF-2). */
  readonly machine: string;
  readonly principal_id: string;
}

export const FlowId = {
  of(machine: string, principal_id: string): FlowId {
    return { machine, principal_id };
  },

  /** The Redis/actor-map string form: "${machine}:${principal_id}". This is
   *  the SINGLE definition of the encoding — every string-keyed context
   *  bridges through here. */
  toKey(id: FlowId): string {
    return `${id.machine}:${id.principal_id}`;
  },

  /** Parse a key string back into the pair. The principal_id may itself be
   *  empty (parity with today's `parsePrincipal` returning ""), and the
   *  machine is everything before the FIRST ":" (parity with
   *  `flow_id.split(":")[0]`). Principals never contain ":", so a plain
   *  split is exact; we keep the "first colon" contract explicit. */
  fromKey(key: string): FlowId {
    const idx = key.indexOf(":");
    if (idx < 0) return { machine: key, principal_id: "" };
    return { machine: key.slice(0, idx), principal_id: key.slice(idx + 1) };
  },
};
```

Notes:
- **Method-bag, not class.** The codebase's value-objects-of-record (`constructOrgName`, the strategy
  registry) are plain object/closure shapes, not `class` instances. A `FlowId` carried on a `FlowEvent`
  must round-trip cleanly and must not accidentally land in a Redis hash as a class instance. A POJO
  interface + a companion `FlowId` object (the `from`/`toKey`/`fromKey` namespace, same companion-object
  pattern proposed for `FlowEvent`) keeps it a structurally-equal value with zero serialization surprise.
  (If the reviewer prefers methods-on-instances, the fallback is a frozen class with `toKey()`/static
  `fromKey()`; the design below is method-bag.)
- **`fromKey` is exact, not lossy.** `parsePrincipal` today does `split(":")[1]` which would *drop* a
  principal containing a colon; `indexOf`/`slice` preserves it. Principals never contain `:` (ADR-030),
  so both are equivalent on real data — but `fromKey` is the strictly-safer encoding and replaces BOTH
  `machineOfFlow` and `parsePrincipal`.
- **No canonicalization in `FlowId`.** `.machine` is the minted segment verbatim (legacy alias or
  canonical). See §3 — canonicalization stays at `resolve()`. This is the load-bearing LEAF-2 decision.

### 2.3 Where it lives — a new `flow-id.ts`, not projection.ts

`FlowId` is NOT a projection concern (the projection envelope's `flow_id` stays a `string` — §4). It is a
shared *domain identity*. Put it in its own `flow-id.ts` imported by `orchestrator.ts`, the three
strategies, and `projection.ts` (only `FlowEvent.from` references it; `buildProjection` keeps taking
`flow_id: string`). Co-locating with `FlowEvent` in projection.ts would imply the VO is part of the
projection contract, which it deliberately is not.

**ADR-028 check:** `FlowId` is machine-agnostic — it stores a machine *name* as data, branches on
nothing, enumerates no machine. A shared identity type for the shared key is the opposite of a
machine-specific leak. **No ADR-028 tension.**

---

## 3. LEAF-2 alias — canonicalization stays at `resolve()` (DECISION)

**Decision: `FlowId.machine` carries the minted segment verbatim (possibly a legacy alias); the
`MACHINE_NAME_ALIASES` canonicalization stays inside `FLOW_STRATEGY_REGISTRY.resolve()`. `FlowId`
construction does NOT canonicalize.**

Rationale:
- **Byte-stability of the key.** `FlowId.toKey()` must reproduce the EXACT string the flow was minted
  with — `login-and-org-setup:user-x`, not `session-onboarding:user-x`. The actor map, the frozen set,
  the Redis key, and `projection.flow_id` were all created with the legacy prefix; if `FlowId.of` or
  `fromKey` canonicalized `.machine`, `toKey()` would produce a DIFFERENT key and the actor lookup would
  miss. Canonicalization at construction would silently re-key the flow. **Forbidden.**
- **Single canonicalization point.** `resolve()` is already the sole alias applier (orchestrator.ts
  270-277). Keeping it there means `FlowId.machine` → `resolve(FlowId.machine)` flows the SAME alias
  string into the SAME `resolve()` that `input.machine` did today. Behavior is byte-identical.
- **Separation of concerns.** "What machine was this flow minted as" (identity / addressing — `FlowId`)
  is distinct from "which strategy handles that machine" (dispatch — `resolve`). The alias map is a
  dispatch concern.

So: `FlowEvent.getMachine()` returns the *minted* (possibly-legacy) segment; `send` calls
`resolve(event.getMachine())` and `resolve` canonicalizes. A `login-and-org-setup:user-x` flow yields
`getMachine() === "login-and-org-setup"`, `resolve("login-and-org-setup")` → `sessionOnboardingStrategy`.
Identical to today's `resolve(input.machine)` where `input.machine === "login-and-org-setup"`.

> This is why the begin path MUST keep minting `flow_id` from the wire/legacy machine name (it already
> does — §6). `FlowId` faithfully preserves whatever begin minted.

---

## 4. Persistence seam — DECISION: option (a), `FlowEvent` carries `flowId` but the serializer ignores it

The task frames two options:
- **(a)** `FlowEvent` carries `flowId`; the Redis serializer ignores it (transient routing property).
- **(b)** Keep the persisted `FlowEvent` clean; pass `send(flowId, event)` with `flowId` alongside.

**Decision: (a).** `FlowEvent` carries a non-enumerable-in-serialization `flowId`; the redis serializer
is UNCHANGED and continues to write exactly `{ts, type, payload, request_id}`. The projection envelope is
UNCHANGED.

### Why (a) over (b)

The user's stated model is `FlowEvent.getMachine()` → the event carries its `FlowId`. Option (b)
contradicts that model (it reverts to `send(flowId, event)` with two args, which is just Rev-1 with a VO
bolted on the first arg). The whole point of the correction is that the event is self-addressing. So (a)
is the design that honors the ratified shape.

The risk (a) must neutralize is **double-persistence**: if `flowId` leaked into the Redis hash or the
projection envelope, the ADR-027 byte contract breaks. It does not, because:

1. **`serialize()` is an explicit allow-list, not a spread.** `redis.ts` 40-51 enumerates the four fields
   by hand:
   ```ts
   function serialize(event: FlowEvent): string[] {
     return ["ts", event.ts, "type", event.type,
             "payload", JSON.stringify(event.payload),
             "request_id", event.request_id];
   }
   ```
   Adding `flowId` to the `FlowEvent` interface does NOT change this function — it never reads `flowId`.
   The persisted bytes are byte-identical. **No serializer change required.** (This is the decisive
   property: the seam is already an allow-list. If it had been `JSON.stringify(event)` the decision would
   flip to (b).)

2. **`deserialize()` reconstructs without `flowId`.** `redis.ts` 53-64 builds `{ts, type, payload,
   request_id}` from the hash. A `FlowEvent` read back from Redis has NO `flowId`. That is correct and
   safe: events are read back ONLY for projection replay (`buildProjection`, which ignores `flowId`) and
   for THAW replay re-dispatch — and the replay re-dispatch path re-derives the `FlowId` from the
   queue slot, not from the deserialized event (§7). So a `flowId`-less read-back event is never sent to
   `send`.

3. **`projection.flow_id` stays a string.** `buildProjection(flow_id: string, events)` is unchanged;
   the orchestrator passes `event.flowId.toKey()` (or the already-held key) as that string arg. The
   envelope is byte-stable.

### The interface change

```ts
// flow-id.ts / projection.ts — FlowEvent gains an OPTIONAL transient flowId.
export interface FlowEvent {
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  request_id: string;
  /** TRANSIENT routing property — present on freshly CONSTRUCTED events (via
   *  FlowEvent.from), ABSENT on events DESERIALIZED from Redis. Never
   *  persisted (serialize() is a 4-field allow-list) and never projected
   *  (buildProjection ignores it). `getMachine()` reads it. */
  readonly flowId?: FlowId;
}
```

`flowId` is **optional** precisely because a deserialized event lacks it. Code that calls `getMachine()`
is exactly the send/dispatch path, which only ever handles freshly-constructed-or-queued events (which DO
carry it). Read-back events go to the projection reducer, which never calls `getMachine()`.

> **Type-safety note for the planner:** because `flowId` is optional, `getMachine()` must handle absence.
> Make it a helper that THROWS on absence (a deserialized event reaching the dispatch path is a bug):
> ```ts
> export const FlowEvent = {
>   from(...): FlowEvent { ... },               // §5
>   getMachine(e: FlowEvent): string {
>     if (!e.flowId) throw new Error("FlowEvent.getMachine: event has no flowId (deserialized event reached the dispatch path)");
>     return e.flowId.machine;
>   },
> };
> ```
> This converts "silent wrong-machine dispatch" into a loud failure — strictly better than today's
> `split(":")[0]` which would happily mis-key.

---

## 5. `FlowEvent.from` design (carries the `FlowId`)

```ts
// projection.ts — companion object merged with the FlowEvent interface.
export const FlowEvent = {
  /**
   * Named constructor. Owns the "an event always has a ts" invariant (ts
   * defaulted to now() when absent, as constructOrgName owns the org-name
   * rule) AND attaches the routing FlowId. Machine-AGNOSTIC: encodes no
   * machine-specific knowledge — it just stores the FlowId it is handed.
   */
  from(
    flowId: FlowId,
    fields: { type: string; payload?: Record<string, unknown>; request_id: string },
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

  getMachine(e: FlowEvent): string { /* see §4 note */ },
};
```

Changes from Rev-1:
- `flowId` becomes the **first** positional arg (addressing leads), then the event fields, then optional
  `ts`. Reads as `FlowEvent.from(flowId, { type, payload, request_id })`.
- `payload` stays optional (defaults `{}`), absorbing the `?? {}` defaulting the routers do today.
- `ts` stays the optional last arg — the deterministic-clock seam survives.

**The strategy-internal emission sites** (the `pump.deps.eventLog.append(flow_id, { ts: new Date()…, … })`
calls in all three strategies) are a NUANCE under option (a): those events are constructed solely to be
*appended* (persisted), never *sent* through `send`. They do NOT need a `flowId` (the serializer ignores
it). Two consistent choices for the planner:

- **(5a, recommended) Route them through `FlowEvent.from` anyway**, passing the strategy's `flow_id`
  re-parsed via `FlowId.fromKey(flow_id)`. This keeps the "no `ts: new Date()` literal survives anywhere"
  invariant uniform, and the attached `flowId` is harmless (ignored on append). Cost: one `fromKey` per
  emission. Benefit: the ts-invariant is truly on the model everywhere.
- **(5b) Leave the append-only emissions as bare object literals** but delete the `ts:` literal by
  introducing a tiny `appendEvent(pump, flow_id, {type, payload, request_id})` helper that stamps `ts`.
  This avoids constructing a `FlowId` for events that don't route. Cost: a second constructor exists.

Recommend **5a** for one invariant home; **5b** is acceptable if the reviewer dislikes constructing a
`FlowId` purely to discard it. Either way the discriminating rule holds: **no `ts: new Date().toISOString()`
literal survives** (Risk R2 / R3 depend on this only for the send-path events, not the append-only ones).

---

## 6. Staged migration — construct vs bridge vs defer

This is the core of Rev-2. `FlowId` is introduced AT THE SEAM (FlowEvent + send + the freeze buffer), and
`.toKey()` BRIDGES every string-keyed context. We do NOT convert the dozens of `flow_id: string`
parameters across the orchestrator + 3 strategies + routers + redis. The string-keyed maps and the
persistence layer stay string-keyed.

### 6.1 CONSTRUCT (where a `FlowId` is born)

| Site | Construction | Notes |
|------|--------------|-------|
| onb router `/event` | `FlowId.of(SESSION_ONBOARDING_MACHINE, c.get("userId"))` | route machine-constant + verified principal |
| pc router `/event` | `FlowId.of(wireName, c.req.header("X-User-Id") ?? "")` | `wireName` = legacy `project-and-chat-session-management` |
| pc router `/open-deep-link` intent branch | `FlowId.of(wireName, principalId)` | the `send("open_deep_link")` arm |
| sc router `/event` | `FlowId.of(wireName, c.req.header("X-User-Id") ?? "")` | |
| THAW pass-2 replay | the queued slot's `flowId` (already a `FlowId` — §7) | not re-constructed; carried |

Every CONSTRUCT site is a router `/event` (or the deep-link `send` arm) — exactly the callers of `send`.
The machine is the route's own constant (legacy-aliased where applicable); the principal is the verified
identity header. This is the ADR-040 "addressed by verified identity" rule, now typed.

### 6.2 BRIDGE (where `.toKey()` produces the string a string-keyed context needs)

These contexts STAY string-keyed; `send` bridges once at entry and threads the string inward.

| String-keyed context | Bridge |
|----------------------|--------|
| actor map `this.actors.get(key)` / `.set` | `event.flowId.toKey()` once in `sendCore`; thread the resulting `flow_id: string` to the rest of the body (unchanged) |
| `frozen` map get/set/delete | uses the same bridged `flow_id` string |
| `abandoned` set add/has/delete | same bridged string |
| `priorState` map | same bridged string |
| `eventLog.append(flow_id, event)` / `read` / `reset` / `subscribe` | takes the bridged string (redis.ts UNCHANGED) |
| redis key `ui-state:${flow_id}:events` | UNCHANGED — receives the bridged string |
| `buildProjection(flow_id, events)` / `projectionFor(flow_id, …)` | UNCHANGED — receives the bridged string; `projection.flow_id` stays a string |
| `resolve(machine)` strategy lookup | `resolve(FlowEvent.getMachine(event))` = `resolve(event.flowId.machine)` |
| `parsePrincipal(flow_id)` (used for `maybeFireProjectReady`, `beginIfNotStarted` principal) | replace internal `split` with `FlowId.fromKey(flow_id).principal_id` OR (since we already hold the `FlowId` at send entry) read `event.flowId.principal_id` directly |

The pattern: `sendCore` computes `const flow_id = FlowId.toKey(event.flowId)` and a
`const machine = FlowEvent.getMachine(event)` ONCE at the top, then the existing body (which already uses
`flow_id: string` everywhere) is nearly unchanged — `input.flow_id` → `flow_id`, `input.machine` →
`machine`, `input.type` → `event.type`, etc.

### 6.3 CONVERT now

| Converted | To |
|-----------|-----|
| `SendEventInput` | **DELETED** |
| `translateWireEvent` (onb router) | **DELETED** — replaced by `FlowEvent.from` |
| `send(input)` / `sendCore(input)` signature | `send(event: FlowEvent)` / `sendCore(event: FlowEvent)` |
| `FrozenFlowState.queued` element | `{ flowId: FlowId; event: FlowEvent; seq }` (§8) |
| `machineOfFlow` | **DELETED** — replaced by `FlowEvent.getMachine` (send path) / `FlowId.fromKey(...).machine` (the two broadcast loops that read a string key) |
| `parsePrincipal` | **DELETED** — replaced by `FlowId.fromKey(...).principal_id` |
| FlowStrategy `applyEvent`/`settle` port shape | §6.5 |
| `eventRequestSchema` `machine` member | **DELETED** from each arm |

### 6.4 DEFER (explicitly NOT converted)

| Deferred | Why |
|----------|-----|
| `eventLog.append/read/reset/subscribe(flow_id: string, …)` | the persistence port is a string-keyed boundary; the VO is a routing concern, not a storage concern. Converting it would force redis.ts + the noop adapter + the SSE substrate to understand `FlowId` for zero benefit. |
| `buildProjection(flow_id: string, …)` + `projection.flow_id` | the ADR-027 wire envelope must stay byte-stable; `flow_id` is a string there forever (or until a separate ADR). |
| actor map / `frozen` / `abandoned` / `priorState` key type | string-keyed; bridged. A `Map<FlowId, …>` would break value-equality lookups (object identity) — a `Map` keyed by a POJO does NOT do structural equality. `toKey()` IS the canonical map key. **Converting these would be a bug.** |
| begin family (`BeginFlowInput.machine`/`principal_id`, `BeginIfNotStartedInput`, `beginIfNotStartedCore`) | begin has no `FlowId` yet — it MINTS the key. It could take a `FlowId` as a tidy-up, but it is not the send path; leave the `${machine}:${principal}` mint in place (it is what `FlowId.toKey` reproduces) and defer. **Flag as a coherent follow-up.** |
| `appendDeepLinkEvents` / `/open-deep-link` legacy branch (`AppendDeepLinkEventsInput.machine`/`flow_id`) | not the `send` path. Carries `machine` + `flow_id: string`; `resolve(input.machine)` validates. Deconflate in a sibling MR. **Deliberate non-change.** |
| the three `BeginStrategy.flow_id: string` readonly fields | begin-side identity; string is fine, bridged into the registry. |

### 6.5 FlowStrategy port shape (restated for the VO)

`SendEventInput` is consumed INSIDE the port by `applyEvent` and `settle`. Deleting it forces a port
change. The recommended shape passes `(event, flow_id, machine)`:

```ts
// orchestrator.ts — FlowStrategy
applyEvent?(
  pump: PumpContext, actor: AnyActorRef,
  event: FlowEvent, flow_id: string, machine: string,
): Promise<void>;

settle?(
  pump: PumpContext, actor: AnyActorRef,
  event: FlowEvent, flow_id: string, machine: string, ctx: SettleContext,
): Promise<SettleOutcome>;
```

Inside the strategies, the rewrites are mechanical and byte-behavior-identical:
- `input.machine` → `machine` (the machine-gates: `if (input.machine !== PROJECT_CONTEXT_WIRE_NAME)` →
  `if (machine !== PROJECT_CONTEXT_WIRE_NAME)`; sc `if (input.machine !== SESSION_CHAT_WIRE_NAME)`; onb
  `isSessionOnboarding(input.machine)`).
- `input.type` → `event.type`; `input.payload` → `event.payload`; `input.request_id` → `event.request_id`.
- `input.flow_id` → `flow_id`.

`sendCore` already computes `flow_id = FlowId.toKey(event.flowId)` and `machine = getMachine(event)` for
its own use (actor lookup + `resolve`), so threading them costs nothing extra.

Why pass the string `flow_id` AND `machine` rather than just the `event` (which carries `flowId`)? Two
reasons: (1) the strategies append to the event log keyed by the STRING (`pump.deps.eventLog.append(flow_id,
…)`) — handing them the already-bridged string avoids a `toKey()` per strategy and keeps the VO out of the
append call; (2) `machine` is the *canonicalized-or-not minted* segment the gate compares against the wire
constant — passing it explicitly keeps the gate readable and avoids re-reading `event.flowId.machine`
three times. (Alternative: pass only `event` + `flow_id` and let each strategy read `event.flowId.machine`
for the gate. Acceptable; the three-arg form is marginally clearer. Architect's call — O2.)

> **Unavoidable edit targets:** all three `strategy.ts` files (port signature + `input.X` →
> `event.X`/`flow_id`/`machine`), `orchestrator.ts`, all three `router.ts`, and `projection.ts`
> (`FlowEvent.from` + `getMachine`). `redis.ts` is UNTOUCHED. `flow-id.ts` is NEW. **Flag the strategy +
> router breadth for the planner** — the headline "send path" under-states it.

---

## 7. The freeze replay buffer — CONFIRMED `Array<{ flowId, event, seq }>`

The task asks to confirm the buffer shape now that the event carries its `FlowId`. **Confirmed: store
`{ flowId, event, seq }`.** The `event` already carries `flowId`, so storing it separately is technically
redundant — but it is the cleaner replay contract because:

- Pass-2 replay calls `sendCore(event)` and `send` re-derives the key from `event.flowId`. So in
  principle the slot could be `{ event, seq }` and replay would still key correctly.
- HOWEVER pass-1 (`broadcastThawCore`) ALSO needs the `flow_id` STRING per slot for its bookkeeping
  (`allDrained.push({ … flow_id })` at 1138; the per-flow harvest + stale-intent emission at 1150-1188).
  Carrying `flowId` (the VO) lets pass-2 compute `FlowId.toKey(slot.flowId)` once and avoids re-reading
  `event.flowId`. Keeping `flowId` explicit on the slot mirrors today's explicit `flow_id` on the
  `allDrained` element.

Recommended slot + state shape:

```ts
interface FrozenFlowState {
  frozenAt: number;
  origin: string;                                  // string key (bridged) — unchanged
  queued: Array<{ flowId: FlowId; event: FlowEvent; seq: number }>;
}
```

### Queue (sendCore, frozen branch)

```ts
const flow_id = FlowId.toKey(event.flowId);        // bridged once at sendCore top
const frozenState = this.frozen.get(flow_id);
if (frozenState) {
  const elapsed = Date.now() - frozenState.frozenAt;
  if (elapsed > FREEZE_WINDOW_MS) this.abandoned.add(flow_id);
  else if (frozenState.queued.length >= REPLAY_BUFFER_CAP) this.abandoned.add(flow_id);
  else frozenState.queued.push({ flowId: event.flowId, event, seq: this.replaySeq++ });
  await this.deps.eventLog.append(flow_id, event);  // event already has ts (FlowEvent.from)
  return this.projectionFor(flow_id, event.request_id);
}
```

The buffered `event` IS the appended `event` (ONE object, ONE `ts`) — same tightening Rev-1 flagged
(R3). The `flowId` on the slot is the same VO carried on the event.

### Replay (THAW pass-2, broadcastThawCore)

```ts
const allDrained: Array<{ flowId: FlowId; event: FlowEvent; seq: number; flow_id: string }> = [];
// pass-1 drains: for (const q of drained) allDrained.push({ ...q, flow_id });   // flow_id = bridged key
allDrained.sort((a, b) => a.seq - b.seq);
for (const { event, flow_id } of allDrained) {
  const actor = this.actors.get(flow_id);
  // ...harvest before-counter (FlowId.fromKey(flow_id).machine drives the J002 check)...
  await this.sendCore(event);                       // re-dispatch the SAME built event; key from event.flowId
  // ...stale-intent: input.type → event.type, input.payload → event.payload, input.request_id → event.request_id...
}
```

The abandoned path (1035-1039) maps drained intents:
`drained.map((d) => ({ type: d.input.type, payload: d.input.payload, request_id: d.input.request_id }))`
→ `drained.map((d) => ({ type: d.event.type, payload: d.event.payload, request_id: d.event.request_id }))`.

The two broadcast loops currently call `machineOfFlow(flow_id)` on a STRING key (951, 1013, 1152) — those
become `FlowId.fromKey(flow_id).machine`. (They hold a string, not a `FlowEvent`, so `getMachine` doesn't
apply; `fromKey` is the right bridge.)

**Replay semantics preserved:** `seq` cross-flow FIFO ordering unchanged; each slot carries a fully-built
`FlowEvent` whose `ts` is the ORIGINAL arrival time (not a replay re-stamp) — the R3 tightening.

---

## 8. `machine` keep/drop boundary (restated for the VO)

| Path | `machine` status | Why |
|------|------------------|-----|
| `/begin` (all 3 begin paths) | **STAYS** | No `FlowId` yet — begin MINTS `flow_id = ${machine}:${principal}` and `resolve(machine)`. `FlowId.toKey` reproduces exactly what begin minted (incl. legacy alias). |
| `beginIfNotStartedCore` | **STAYS** | builds `flow_id` from `input.machine + principal_id` (472), `resolve(input.machine)` (471) — begin-family. |
| `/event` wire DTO (`eventRequestSchema`) | **DROPS** | the optional `machine` member is removed from each arm; the flow is addressed by `FlowId.of(routeMachineConstant, verifiedPrincipal)`. |
| `send` / `sendCore` | **DROPS** | derived: `machine = FlowEvent.getMachine(event)`; `resolve(machine)` (alias applied in resolve, §3). |
| `FlowStrategy.applyEvent`/`settle` | **DROPS from a wrapper; arrives as threaded `machine` arg** | §6.5. |
| `appendDeepLinkEvents` / legacy `/open-deep-link` | **OUT OF SCOPE** | carries `machine` + `flow_id: string`; deliberate non-change (§6.4). |

The redundancy is specific to the post-begin `/event` send path. Begin keeps `machine` because begin is
where the `FlowId` is born.

---

## 9. Caller map — every `send` caller and how it adapts

| Caller | File / line | Today | After |
|--------|-------------|-------|-------|
| onb `/event` | `session-onboarding/router.ts` 314-316 | `send(translateWireEvent(event, flowId, requestId))` | `send(FlowEvent.from(FlowId.of(SESSION_ONBOARDING_MACHINE, c.get("userId")), { type: event.type, payload: event.payload, request_id: requestId }))` — `translateWireEvent` DELETED; `flowId` string local removed (the VO is the addressing) |
| pc `/event` | `project-context/router.ts` 217-223 | `send({ machine: wireName, flow_id, type, payload: body.payload ?? {}, request_id })` | `send(FlowEvent.from(FlowId.of(wireName, c.req.header("X-User-Id") ?? ""), { type: body.type, payload: body.payload, request_id }))` |
| pc `/open-deep-link` intent branch | `project-context/router.ts` 302-308 | `send({ machine: wireName, flow_id: flowId, type: "open_deep_link", payload, request_id })` | `send(FlowEvent.from(FlowId.of(wireName, principalId), { type: "open_deep_link", payload, request_id }))` |
| sc `/event` | `session-chat/router.ts` 168-174 | `send({ machine: wireName, flow_id, type, payload: body.payload ?? {}, request_id })` | `send(FlowEvent.from(FlowId.of(wireName, c.req.header("X-User-Id") ?? ""), { type: body.type, payload: body.payload, request_id }))` |
| THAW pass-2 replay | `orchestrator.ts` 1157 | `sendCore(input)` | `sendCore(event)` (from the drained slot's `event`, which carries `flowId`) |
| tests | `orchestrator.test.ts` 111/192/199/206/235/247/280/293/396; `orchestrator-switching-*.test.ts` | `send({ machine: "session-onboarding", flow_id, type, payload, request_id })` | `send(FlowEvent.from(FlowId.of("session-onboarding", principal), { type, payload, request_id }))` — mechanical sweep |

Every caller already has the route machine-constant + the verified principal. **No caller relies on a
`machine` that differs from `FlowId.of(routeMachine, principal).machine`** — every router builds
`flow_id = ${routeMachine}:${principal}` AND passed the SAME `routeMachine` as `machine` (R1). The VO
makes that single source explicit: ONE `FlowId.of(routeMachine, principal)` replaces the two redundant
constructions.

---

## 10. Behavior-change risks — characterization tests FIRST (Iron Rule)

**R1 — Does any path rely on `machine` differing from the flow's minted machine segment?**
*Finding: No — and the VO makes this an explicit invariant.* Every `send` caller passed `machine =
routeMachine` and `flow_id = ${routeMachine}:${principal}`. `FlowId.of(routeMachine, principal).toKey()`
== the old `flow_id`, and `.machine` == the old `input.machine`. For LEAF-2, a `login-and-org-setup:…`
flow yields `.machine === "login-and-org-setup"`, `resolve()` canonicalizes (§3) — identical to today.
**Characterization test required (HIGHEST VALUE — currently MISSING, see §0):** mint a flow whose flow_id
carries the legacy `login-and-org-setup` prefix, send an `/event`, assert it resolves to the
session-onboarding strategy and emits `org_created`. Pin on the CURRENT code (with `machine` still passed
+ `machineOfFlow`) so the post-refactor run is provably byte-equivalent. The existing tests use the
CANONICAL prefix, so this legacy-alias send-path is UNCHARACTERIZED today.

**R2 — Does defaulting `ts` in `from` / attaching `flowId` change ordering or serialization?**
*Finding: No.* Log order is Redis stream id (XADD `*` → `XRANGE - +` insertion order), never `ts`. `ts`
is a payload value the projection copies to `last_event_at`, never sorts by. The replay key is `seq`, not
`ts`. `serialize()` is a 4-field allow-list (§4) — attaching `flowId` to the in-memory event does NOT
reach the hash. The deserialized event lacks `flowId` (correct — §4). On-wire shape + projection envelope
byte-stable. **Caveat:** the `ts` VALUE shifts in the frozen-queue case — R3.

**R3 — Frozen-queue path: one `ts` instead of two.**
*Finding: a real, minor tightening (unchanged from Rev-1).* Today the frozen branch builds `queuedEvent`
with a fresh `ts` for the APPEND (727) AND THAW replay calls `sendCore(input)` building a SECOND event
with a SECOND fresh `ts` (737) at replay. After: the buffered `event` and the appended `event` share ONE
`ts` (arrival time); replay re-dispatches that SAME event (its `ts` fixed). The replayed event's `ts`
changes from "replay-time now()" to "arrival-time now()". Nothing sorts by `ts` (R2) → observably inert
for state/projection, but a value change in the log.
**Characterization test required:** freeze→queue→thaw→replay; assert post-replay projection state +
`sequence_id` unchanged. Do NOT assert exact `ts` values (nondeterministic before too). Any existing test
asserting a `ts` value/ordering on a replayed event is the canary — triage before changing code.
*Open question O1: confirm "two log entries with two timestamps" is the intended current behavior (so the
delta is ONLY ts-equality, not entry count). Check the US-210 freeze/thaw acceptance suite.*

**R4 — Does dropping `machine` from the wire affect anything beyond the routers + port?**
*Finding: No, beyond the FlowStrategy port (R/§6.5).* The wire `machine` was already optional and
canonicalized downstream; FE callers were migrated off constructing flow_id (c059189) and the
cross-principal guard was deleted (718d090). Removing the optional `machine` from `eventRequestSchema` is
safe — a stray client `machine` is stripped by the schema and ignored (same posture ADR-040 took for
stray `flow_id`). **No FE change required.** **Characterization test:** an `/event` POST with a leftover
`machine` field still succeeds (ignored); one without it succeeds identically.

**R5 — `settle` chain machine-gating.**
*Finding: thread `machine` to the unconditional settle chain (§6.5).* `sendCore` calls all three
strategies' `settle` unconditionally (833/862/880); each self-gates on `input.machine`. Post-change each
gates on the threaded `machine = FlowEvent.getMachine(event)`. Since begin mints the prefix from the wire
machine and `FlowId` preserves it, the gate fires for exactly the same flows. **Characterization test:**
per machine, send a representative `/event`, assert the SAME terminal FlowEvent(s) emit (existing
`orchestrator.test.ts` + `orchestrator-switching-*.test.ts` largely cover this — verify they exercise all
three machines' settle arms before refactoring).

**R6 — `getMachine` on a deserialized (flowId-less) event throws.**
*Finding: by design (§4), but verify no read-back event reaches the dispatch path.* Deserialized events
flow ONLY to `buildProjection` (no `getMachine`) and to THAW replay — and replay re-dispatches the
QUEUED in-memory event (which carries `flowId`), never a read-back. **Characterization test:** a
freeze→thaw→replay run completes without a `getMachine` throw (guards against a future refactor that
accidentally feeds a read-back event into `send`). Also a unit test: `FlowId.fromKey(FlowId.toKey(x)) ===
x` round-trip, and `fromKey("a:b:c")` → `{machine:"a", principal_id:"b:c"}` (the first-colon contract).

---

## 11. Before/after sketch

### `FlowId` (NEW, flow-id.ts)

```ts
export interface FlowId { readonly machine: string; readonly principal_id: string; }
export const FlowId = {
  of:    (machine: string, principal_id: string): FlowId => ({ machine, principal_id }),
  toKey: (id: FlowId): string => `${id.machine}:${id.principal_id}`,
  fromKey: (key: string): FlowId => {
    const i = key.indexOf(":");
    return i < 0 ? { machine: key, principal_id: "" }
                 : { machine: key.slice(0, i), principal_id: key.slice(i + 1) };
  },
};
```

### `FlowEvent.from` + `getMachine` (projection.ts)

```ts
export interface FlowEvent {
  ts: string; type: string; payload: Record<string, unknown>; request_id: string;
  readonly flowId?: FlowId;     // transient; never serialized (§4)
}
export const FlowEvent = {
  from(flowId: FlowId, fields: { type: string; payload?: Record<string, unknown>; request_id: string }, ts?: string): FlowEvent {
    return { ts: ts ?? new Date().toISOString(), type: fields.type, payload: fields.payload ?? {}, request_id: fields.request_id, flowId };
  },
  getMachine(e: FlowEvent): string {
    if (!e.flowId) throw new Error("FlowEvent.getMachine: event has no flowId");
    return e.flowId.machine;
  },
};
```

### `send` / `sendCore` (orchestrator.ts)

```ts
// BEFORE
async send(input: SendEventInput): Promise<Result<FlowProjection>> { ... sendCore(input) ... }
private async sendCore(input: SendEventInput) {
  const actor = this.actors.get(input.flow_id);
  ...
  const event: FlowEvent = { ts: new Date().toISOString(), type: input.type, payload: input.payload, request_id: input.request_id };
  await this.deps.eventLog.append(input.flow_id, event);
  actor.send({ type: input.type, ...input.payload } as never);
  const dispatchStrategy = FLOW_STRATEGY_REGISTRY.resolve(input.machine);
  if (dispatchStrategy.applyEvent) await dispatchStrategy.applyEvent(this, actor, input);
  ...
}

// AFTER
async send(event: FlowEvent): Promise<Result<FlowProjection>> {
  try { return ok(await this.sendCore(event)); } catch (e) { return toFlowError(e); }
}
private async sendCore(event: FlowEvent) {
  const flow_id = FlowId.toKey(event.flowId!);            // bridge once
  const machine = FlowEvent.getMachine(event);            // strategy selector (legacy alias preserved)
  const actor = this.actors.get(flow_id);
  if (!actor) throw new Error(`unknown flow_id: ${flow_id}`);
  const strategy = FLOW_STRATEGY_REGISTRY.resolve(machine);   // alias applied in resolve (§3)
  // frozen-queue branch: push { flowId: event.flowId, event, seq }; append(flow_id, event); return
  await this.deps.eventLog.append(flow_id, event);       // event arrives built — ts already set
  actor.send({ type: event.type, ...event.payload } as never);
  if (strategy.applyEvent) await strategy.applyEvent(this, actor, event, flow_id, machine);
  ... // settle chain: settle(this, actor, event, flow_id, machine, ctx)
  // principal for hooks: FlowId.fromKey(flow_id).principal_id  (or event.flowId.principal_id)
}
```

### Router `/event` tail (session-onboarding/router.ts)

```ts
// BEFORE
const result = await flowOrchestrator.send(translateWireEvent(event, flowId, requestId));

// AFTER  (parse → gate → FlowEvent.from(FlowId.of(...)) → send)
const parsed = eventRequestSchema.safeParse(rawBody);   // schema no longer has `machine`
if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
const event = parsed.data;
// ...__force_failure__ authorization gate unchanged...
const result = await flowOrchestrator.send(
  FlowEvent.from(
    FlowId.of(SESSION_ONBOARDING_MACHINE, c.get("userId")),
    { type: event.type, payload: event.payload, request_id: requestId },
  ),
);
return serializeResult(c, result, "event_failed");
```

`translateWireEvent` removed; `import { ..., SendEventInput }` removed from router.ts; the
`machine: z.string().optional()` member removed from each `eventRequestSchema` arm. The `flowId` string
local (`${SESSION_ONBOARDING_MACHINE}:${c.get("userId")}`) is gone — `FlowId.of(...)` is the addressing.

---

## 12. Consistency with ratified decisions

- **D-E1 (ACL translation at the boundary):** preserved. The `/event` zod discriminated union (the ACL)
  stays at the router; `FlowEvent.from` is the domain-event constructor the ACL calls AFTER narrowing.
  `FlowId.of(routeMachine, principal)` is identity construction, not ACL. The only ACL change is dropping
  the optional `machine` field (wire-alias plumbing, not a domain concern).
- **ADR-028 (nothing machine-specific in the shared core):** preserved + improved. `FlowId` and
  `FlowEvent.from` are machine-agnostic (store a name, branch on nothing). `send` derives `machine` from
  the event's own `FlowId` and delegates to `resolve()` + strategies — never branches on a machine
  literal. The machine-gates remain INSIDE the strategies, now fed the threaded `machine`.
- **ADR-040 (flow addressed by verified identity; pump/strategy seam):** reinforced. `FlowId.of(routeMachine,
  verifiedPrincipal)` makes "addressed by verified identity" a typed constructor. `machine` stops being a
  redundant second copy of `flow_id`'s head. The LEAF-2 alias map stays the single canonicalization point
  in `resolve()` (§3).
- **ADR-041 (session-onboarding realignment):** the legacy `login-and-org-setup` flow_id prefix still
  canonicalizes — `FlowId` preserves the minted segment verbatim, `resolve()` aliases it (§3, R1).

**No tension found.** The machine-specific bit stays the `/event` zod union at the router (D-E1); `FlowId`
+ `FlowEvent` are machine-agnostic shared domain models. The one thing the headline scope still
under-states is the FlowStrategy port ripple (§6.5) + the router breadth — flagged for the planner.

---

## 13. Open questions

- **O1 (R3):** Confirm the freeze path's current "two log entries with two timestamps" is intended, so
  the planner knows the refactor's `ts`-equality is the only delta (not entry count). Check the US-210
  freeze/thaw acceptance suite.
- **O2 (§6.5):** Port-method shape — three-arg `(event, flow_id, machine)` (recommended, marginally
  clearer gates + avoids per-strategy `toKey`) vs two-arg `(event, flow_id)` letting each strategy read
  `event.flowId.machine`. Architect's call.
- **O3 (§2 / §5):** `FlowId` + `FlowEvent` as companion-objects (interface + const merge) vs standalone
  `makeFlowId`/`makeFlowEvent` functions. Recommend companion objects for the `FlowId.of` / `FlowEvent.from`
  / `FlowEvent.getMachine` phrasing the ratified model uses.
- **O4 (§5):** Append-only strategy emissions — route through `FlowEvent.from(FlowId.fromKey(flow_id), …)`
  (5a, one ts-invariant home) vs a slim `appendEvent` helper that stamps `ts` without a `FlowId` (5b).
  Recommend 5a.
- **O5 (§6.4):** `appendDeepLinkEvents`/legacy `/open-deep-link` and the begin family still carry
  `machine` + `flow_id: string`. Left as deliberate non-changes (not the send path). Confirm they are
  out of scope for this MR or schedule a sibling deconflation (the begin family could take a `FlowId`
  cleanly as a tidy-up).
- **O6 (§4):** Confirm no code path JSON.stringify's a whole `FlowEvent` (which WOULD leak `flowId` into
  bytes). Verified: `serialize()` is a 4-field allow-list and is the only event→bytes path; the SSE
  substrate yields `FlowEvent` objects to the projection reducer, not raw. If a future logger does
  `JSON.stringify(event)`, `flowId` would appear in logs only (harmless) — flag for the crafter to keep
  `serialize()` the sole persistence encoder.

---

## §14 — `begin` alignment (review addendum)

`FlowOrchestrator.begin` reviewed against this model. **Verdict: the same semantics align, and `begin`
is the model's *primary* construction site — its `FlowId` construction should be INCLUDED, not deferred
(this resolves O5 in favor of inclusion).**

1. **`begin` is the birthplace of `flow_id`.** It is minted via the `` `${machine}:${principal_id}` ``
   template in TWO places: `SessionOnboardingBeginStrategy` ctor (`strategy.ts:260`) and
   `beginIfNotStartedCore` (`orchestrator.ts:472`) — the exact primitive-string template the send side
   replaces with `FlowId.of`. Deferring `begin` would leave TWO key-construction mechanisms for one
   identity (VO at `/event`, raw string at `begin`) — the primitive obsession the VO removes, reintroduced
   as an inconsistency. → Replace both sites with `FlowId.of(machine, principal_id)`; `FlowId.of` becomes
   the single key-format authority for both birth and use.

2. **`machine` at `begin` is the SOURCE, not a redundant primitive.** At `send`, machine is *recovered*
   via `event.getMachine()`. At `begin`, machine is the authoritative INPUT that *produces* the FlowId.
   Refine "machine stays in /begin": `begin` should CONSTRUCT `FlowId.of(machine, principal)` and then
   refer to `flowId.machine` / `resolve(flowId.machine)`, not re-thread `machine` beside a string
   `flow_id`. Cleanest end-state: the router constructs the `FlowId` VO once (route machine-constant +
   verified principal) and passes it into `BeginFlowInput`/`BeginIfNotStartedInput` (replacing their
   separate `machine` + `principal_id` fields) — making the router the single `FlowId` construction site
   for BOTH `begin` and `/event`.

3. **`BeginStrategy.flow_id: string` → `flowId: FlowId`.** `orchestrator.begin()` (`:1338`) uses
   `strategy.flow_id` for `recycleActor`/`resetFlowTracking`/`trackActor`/`projectionFor` — bridge via
   `.toKey()` (same pattern as the send path). `beginIfNotStartedCore` uses `flowId.toKey()` for the
   actor-map gets/sets + `eventLog.reset`.

4. **`FlowEvent.from` at `begin`.** `begin` drives mostly via `actor.send({…})` XState events (in-actor
   transitions — NOT `FlowEvent`s; leave as-is). But its PERSISTED `FlowEvent` construction (settleSpawn
   dispatch + deep-link drain, the `ts` sites ~1030/1044/1077) should route through `FlowEvent.from` for
   the same ts-on-construction invariant — this is the begin-side of O4 (5a).

5. **The operations legitimately differ — do NOT force symmetry.** `begin` = spawn + drive (via
   `BeginStrategy`) + project; `send` = forward one event to a live actor. The alignment is the SHARED
   domain models (`FlowId` VO + `FlowEvent.from`), not collapsing `begin` into a send-shaped signature.
   `BeginStrategy` stays; only its `flow_id`→`flowId` type and the ts-construction change.

**Recommendation:** include `begin`'s `FlowId` construction in this MR (contained: 2 template sites +
`BeginStrategy.flowId` + the 2 begin input types + `.toKey()` bridges) so `FlowId.of` is the one source
of truth; route `begin`'s persisted-event construction through `FlowEvent.from`. Keep the
`appendDeepLinkEvents` / legacy `/open-deep-link` `machine` deconfliation DEFERRED (separate concern).
Characterization: pin the `begin → projection` key identity and the cross-machine `auth_ready` /
`project_ready` dispatch (actor tracked by `flow_id`) green before/after.

---

## §15 — `sendCore` freeze-handling cleanup (FOLLOW-UP slice, lands AFTER this MR)

A separate, contained slice on top of the `send(event)` shape this MR produces. Goal: lift the freeze
arithmetic out of `sendCore` and dedupe the append/return.

**`FrozenState` becomes a class** (replaces the `FrozenFlowState` interface) owning `frozenAt`, `origin`,
`queued: Array<{ flowId, event, seq }>`, with a **computed getter** (NOT a construction-time field — both
inputs vary after construction):

```ts
get shouldAbandon(): boolean {
  return Date.now() - this.frozenAt > FREEZE_WINDOW_MS
      || this.queued.length >= REPLAY_BUFFER_CAP;
}
```

**Orchestrator gains** `abandonEvent(key)` (= `this.abandoned.add(key)`) and
`queueEvent(frozenState, event)` (= `frozenState.queued.push({ flowId: event.flowId, event, seq: this.replaySeq++ })`),
plus a private `dispatchAndSettle(actor, event)` extracting the current 746–884 body (actor.send +
applyEvent + waitForSettled + freeze/thaw broadcast + the 3-strategy settle chain + hooks). There are NO
early returns in 746–884, so extraction is clean.

**`sendCore` flattens to** (append hoisted ABOVE the branch — it must precede the settle chain's own
appends, so the inbound event stays first in the log; only the projection return drops to the bottom):

```ts
private async sendCore(event: FlowEvent): Promise<FlowProjection> {
  const key = event.flowId.toKey();
  const actor = this.actors.get(key);
  if (!actor) throw new Error(`unknown flow_id: ${key}`);

  await this.deps.eventLog.append(key, event);            // persisted regardless of freeze

  const frozenState = this.frozen.get(key);
  if (frozenState?.shouldAbandon)  this.abandonEvent(key);          // getter read once
  else if (frozenState)            this.queueEvent(frozenState, event);
  else                             await this.dispatchAndSettle(actor, event);

  return this.projectionFor(key, event.request_id);
}
```

`shouldAbandon` is read exactly once (first branch); the queue branch tests `frozenState` truthiness only
(no recompute, nothing to cache). Behavior is byte-identical to today — pure structural refactor; the
existing freeze/thaw (US-210) + abandon/queue tests must stay green unchanged.

## §16 — Ratified `lib/domain/` package layout (FOLLOW-UP slice, structural move)

A separate, contained slice landed AFTER the `FlowId`/`FlowEvent` refactor: the domain **types** are
collected under `ui-state/lib/domain/`. PURE structural move — same types, same logic, only file
locations + import paths change.

| New file | Contents | Source |
|---|---|---|
| `lib/domain/flow-event.ts` | `FlowEvent` (interface + `from`/`getMachine` companion) **AND `FlowId`** (interface + `of`/`toKey`/`fromKey` companion) | merged `lib/flow-id.ts` + the `FlowEvent` block from `lib/projection.ts`; `lib/flow-id.ts` deleted |
| `lib/domain/flow-projection.ts` | the `FlowProjection` interface | moved from `lib/projection.ts` |
| `lib/domain/flow-result.ts` | `Result`/`FlowError`/`ok`/`err`/`errorMessage` | moved whole from `lib/flow-result.ts`; old file deleted |
| `lib/domain/active-scope.ts` | `ActiveScope`/`ResourceType`/`RouteParams`/`JwtClaims`/`MachineContext`/`ScopeResolution` + `resolveActiveScope` + `ResolveActiveScope` | moved whole from `lib/active-scope.ts`; old file deleted |

**Rationale:** the domain TYPES move to `lib/domain/`; `FlowId` lives with `FlowEvent` (it is `FlowEvent`'s
identity, not a distinct concept); `buildProjection` stays in `lib/projection.ts` as the application FOLD
service. `projection.ts` now imports `FlowEvent`/`FlowProjection`/`ActiveScope`/`ResourceType` from
`lib/domain/` and keeps re-exporting `ResourceType` (now sourced from `lib/domain/active-scope.ts`) so
existing importers don't break.

## §17 — From anemic companion-objects to a real domain model + an adapter (de)serialization boundary (DELIVERED)

§1–§16 modelled `FlowEvent` / `FlowId` as **interface + companion `const`** (method-bag) with a
**transient optional `flowId`** field on the event, a **throwing** `FlowEvent.getMachine(event)`, and the
Redis hash (de)serialization baked into `redis.ts` against the raw interface. That is an **anemic** model:
behavior (`getMachine`, `FlowId.toKey`) lives off the data as free functions; the router builds the
`FlowId` then bolts it onto a `FlowEvent.from(...)`; a read-back event has *no* identity and
`getMachine()` *throws* if one reaches dispatch. §17 makes it a real domain model and pushes
(de)serialization to the driven adapter — following the `domain-modeling` skill (class for a model with
behavior; `type` for the plain serialized DTO; the outbound adapter owns (de)serialization and returns
domain objects).

### 17.1 `FlowEventRecord` — the plain serialized DTO (`type`)

`{ ts, type, payload, request_id }` — the EXACT Redis hash / wire shape, co-located with the class in
`lib/domain/flow-event.ts`. BYTE-STABLE: the field set IS the ADR-027 persistence contract. It is a `type`
(no behavior, erased at runtime); the adapter is the only code that produces or consumes it.

### 17.2 `FlowEvent` — the domain model (`class`)

A rich model that OWNS the four obligations the §1–§16 design scattered:

- **Construction (incl. its FlowId).** Two birth factories, both applying the birth invariants
  (`ts ?? now()`, `payload ?? {}`) and building the owned `FlowId` themselves:
  - `static create(machine, principal_id, { type, payload?, request_id }, ts?)` — the **router send
    path** (route machine-constant + verified principal). The router NO LONGER constructs a `FlowId` +
    `FlowEvent.from`; it calls `FlowEvent.create(...)` and the model builds the identity.
  - `static createForFlow(flowKey, { … }, ts?)` — the **strategy / orchestrator-broadcast emission
    path**, which holds the bridged `flow_id` STRING for the flow it appends to. Replaces every
    `FlowEvent.from(FlowId.fromKey(flow_id), …)` — these call sites no longer touch `FlowId` at all.
- **Behavior.** `getMachine()` (strategy selector, minted segment verbatim — alias canonicalization
  stays at `resolve()`), `getFlowId()`, and the `get flowKey()` getter (the bridged actor-map / Redis /
  projection key). `FlowId.toKey(event.flowId)` → `event.flowKey`.
- **Serialization on the model.** `createCacheSerialization(): FlowEventRecord` — the **SOLE** event→bytes
  encoder. Nothing else serializes a FlowEvent.
- **Rehydration (separate factory, trusts persisted state).**
  `static fromCache(flowKey, record): FlowEvent` reconstructs the instance AND its `FlowId` from the
  **stream key the adapter read from**. So `getMachine()` / `getFlowId()` / `flowKey` are **TOTAL** on a
  read-back event — **the transient-flowId / getMachine-throws design (§4) is REMOVED**. (R6 is no longer
  a "guard against a throw"; it is structurally impossible.)

The four payload-bearing fields stay **public `readonly`** (the projection reducers and the orchestrator's
`actor.send({ type, ...payload })` read them directly — zero churn in `projection.ts`). Identity is
**private** behind getters because it carries behavior. The `#flowId` ECMAScript-private field doubles as a
**nominal brand**: a plain `FlowEventRecord` cannot structurally impersonate a `FlowEvent` (TS type
position is structural). Runtime proof: `projection.test.ts` / `projection-property.test.ts` had to switch
from object literals to `FlowEvent.fromCache(...)` — a literal no longer type-checks as a `FlowEvent`.

### 17.3 `FlowId` — value object FlowEvent owns

Now a small `class` (was interface + companion `const`): `static of` / `static fromKey`, instance
`toKey()`. FlowEvent constructs and owns it; the public surface callers reach is FlowEvent's methods. The
`of` / `fromKey` statics remain for the two contexts that key off a raw string *before* any FlowEvent for
that step exists: the **begin path** (`BeginFlowInput.flowId` / `BeginStrategy.flowId` /
`beginIfNotStartedCore` / `maybeFireProjectReady` / the `auth_ready` hook) and the **broadcast loops**
(`FlowId.fromKey(flow_id).machine|principal_id`). `FlowId.toKey(x)` → `x.toKey()` at those sites.

### 17.4 `redis.ts` — the driven (outbound) adapter owns (de)serialization

The (de)serialization moved OUT of the domain to the adapter boundary (the domain never parses untrusted
bytes):

- **append/write:** persists `event.createCacheSerialization()` — `serialize(record)` keeps the 4-field
  hash encoding (`["ts", …, "type", …, "payload", JSON.stringify(payload), "request_id", …]`)
  **byte-identical**, so persisted bytes + the ADR-027 projection contract are unchanged.
- **read/subscribe:** decode the hash into a `FlowEventRecord`, then return DOMAIN objects via
  `FlowEvent.fromCache(flow_id, record)` — a repository returns domain objects, not DTOs. `flow_id` is the
  stream key the adapter read from (`ui-state:${flow_id}:events` / the `read(flow_id)` arg), so the
  rehydrated identity is correct and total.
- The **noop adapter** mirrors the same record round-trip in-process (append stores the
  `FlowEventRecord`, read rehydrates via `fromCache`), so the FULL existing orchestrator suite — which
  runs on the noop log — exercises the `createCacheSerialization` ↔ `fromCache` seam without a live Redis.
- The probe builds its synthetic record via `FlowEvent.create(...).createCacheSerialization()`.

### 17.5 Freeze replay buffer simplified to `{ event, seq }`

Since the event now OWNS its FlowId, the slot no longer stores a separate `flowId` (`FrozenState.queued`
and the THAW `allDrained` were `{ flowId, event, seq[, flow_id] }`; the `flowId` field was provably unused
in pass-2, which re-derives the key from the replayed `event`). Net redundancy removed; replay semantics
(cross-flow `seq` FIFO; the R3 one-`ts` arrival-time tightening) unchanged.

### 17.6 Discipline — behavior byte-identical (verified)

This is a structural/encapsulation change: same persisted `FlowEventRecord` shape, same projection output,
same dispatch behavior.

- **`createCacheSerialization()` is the sole encoder** — verified no `JSON.stringify(event)` /
  whole-`FlowEvent` spread reaches persistence or the wire. (The SSE `/projection/stream` handler ignores
  the subscribed event payload — `_event` — and re-reads the projection, so it never serializes a
  FlowEvent.)
- **No behavior test changed** — the orchestrator / projection / legacy-alias behavioral assertions are
  byte-identical; only the Arrange sections migrated mechanically to the new factories
  (`FlowEvent.from(FlowId.fromKey(x), …)` → `createForFlow(x, …)`; object literals → `fromCache`; the
  frozen-state slot helper to `{ event, seq }`). The FlowEvent / FlowId **unit** tests were rewritten to
  the new class API (the unit under refactor), preserving every encoding/round-trip assertion and ADDING
  the `createCacheSerialization` ↔ `fromCache` round-trip + `getMachine` totality.
- **Characterization seams:** (a) the adapter round-trip — new `lib/persistence/redis.test.ts` pins
  append→read field preservation + flow-identity-from-stream-key totality; (b) a rehydrated event through
  `buildProjection` — `projection*.test.ts` now feed `fromCache`-built events; (c) the legacy-alias
  dispatch — `orchestrator-legacy-alias.test.ts` unchanged in intent (`login-and-org-setup:` keys
  verbatim, resolves to session-onboarding, emits `org_created`).
- **Gate:** `ui-state` vitest 17 files / 186 tests green (was 16 / 181: +1 file redis.test.ts; +5 tests).
  `tsc --noEmit` adds ZERO new errors over the pre-existing baseline (17 errors, all in test files —
  mock-actor types + `as` casts — unrelated to this refactor; 4 in `projection-property.test.ts` only
  shifted line numbers as lines were added above them). The MQ gate (`test.sh --auto`) runs backend only;
  ui-state tsc/vitest are local.
