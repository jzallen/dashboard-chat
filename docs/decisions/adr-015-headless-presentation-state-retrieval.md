# ADR-015: Headless Presentation-State Retrieval — Reflect-Only Directive Log

**Status:** Ratified
**Date:** 2026-04-29
**Originating wave:** Phase 0 DIVERGE — D-2
**Ratification trail:** Mail `dc-wisp-z02g` (mayor flagged naming-collision; deferred), `dc-wisp-dowv` (mayor + user ratified rename + event-log shape), `dc-wisp-8agq` (dave's update reply), `dc-wisp-n6ar` (mayor confirmed ratified).

## Context

The TanStack table on the FE renders sort, filter, and column-visibility state directly from local React state. UI directives emitted by the worker (`sort_directive`, `filter_directive`, `filters_cleared`) are applied via `applyDirective` (`frontend/src/core/chat/dispatcher.ts`) into that local state. There is currently no headless way to retrieve the current sort/filter/visibility configuration of a channel — a Python harness, a future SDK consumer, or a future replay tool has no entry point.

Phase 1 Epic D (api-driven-user-flow-tests) needs to assert on table presentation state in headless tests without driving a browser. Without a retrieval endpoint, those assertions either run against a Playwright-driven FE (heavy, slow, brittle) or are skipped entirely.

The decision is what shape — if any — to give a backend-side retrieval mechanism for the per-channel presentation state derived from chat-driven UI directives. The user's framing in `dc-wisp-dowv` was load-bearing: *"the list of events that tell the UI how to render the tanstack table."*

## Naming discipline

The user's domain taxonomy creates a hard naming constraint that this ADR honors verbatim:

| Layer | Meaning |
|---|---|
| **dataset** | source (S3/MinIO) + staging SQL query (which is effectively a SQL view) |
| **view** | intermediate dbt layer where joins happen |
| **report** | aggregation layer (sum/avg/rollups/window functions), intended for end-consumer dashboards |

"View" is therefore a domain-meaningful term referring to the dbt intermediate join layer. Naming the per-channel sort/filter/column-visibility cache "view-state" would mislead readers — they'd expect dbt-view DDL or join lineage from `GET /api/channels/{id}/view-state`, not table presentation state.

What this ADR's resource actually represents: per-channel **table presentation state** (sort + filter + columnVisibility), reflected by worker UI dispatchers as a side effect. Not a SQL/dbt construct.

The chosen term is **`presentation-state`** (selected over `table-state` and `display-state`). Reasoning captured for posterity:
- `table-state` overloads the TanStack term. Endpoint readers may expect TanStack-shaped state when they should expect a directive log.
- `display-state` is too generic — underspecifies the concern.
- `presentation-state` makes explicit that this is a UI-rendering concern distinct from the dbt-layer `view` and `report` taxonomy.

## Decision drivers

- J1 (headless retrieval) must turn from impossible → supported.
- J3 (zero-latency FE applying directives) must be preserved — the FE keeps its current `applyDirective` flow unchanged.
- The "no backend call" test invariant at `agent/test/chat/acceptance/worker-tool-dispatch.test.ts:502-550` guards `BackendClient.post` specifically. Whatever shape we pick must not violate that invariant.
- Phase 1 ships PR-0 unblock; commits no durable URL we'd later regret.
- Cross-decision composition with Epic C — Epic C's `DomainEvent` log and this directive log should share replay infrastructure (same Redis-or-in-process choice; same persistence model).

## Considered options

1. **Reflect-only directive log (recommended).** Worker UI dispatchers append the emitted `UIDirective` to a per-channel ephemeral log as a side effect of `emit`. New endpoint `GET /api/channels/{id}/presentation-state` returns the append-only `UIDirective[]` log. Headless consumers replay through their own `applyDirective` equivalent. FE unchanged.

2. **Server-side projection / snapshot endpoint.** Backend computes the projection (`{sort, filters, columnVisibility}`) by replaying directives server-side, returns the snapshot. Headless consumers receive a settled state object, not a log. Requires duplicating the FE's `applyDirective` reducer on the server.

3. **Backend-resource model.** First-class persisted resource with `POST /api/channels/{id}/presentation-state` (write), `GET /api/channels/{id}/presentation-state` (read), durable storage, full CRUD. Long-term shape if presentation-state becomes a durable user-visible concept (saved table layouts, etc.).

4. **Stay FE-only — document the gap.** Take no backend action. `api-driven-user-flow-tests` documents the headless gap as a product constraint and skips presentation-state assertions.

5. **Hybrid: durable per-user-per-dataset preferences + ephemeral channel state.** Two endpoints, two persistence stores. Combines elements of Options 1 and 3.

## Decision outcome

**Option 1 — Reflect-only directive log.**

Concretely:

- **Worker UI dispatchers** (`agent/lib/chat/dispatchers/ui.ts`) write to a per-channel cache as a side effect of `emit`. The cache stores an append-only sequence of `UIDirective` records. The dispatcher's existing emit call is preserved; the cache write is an additional side channel. The "no backend call" test invariant remains satisfied because the test guards `BackendClient.post` specifically, not arbitrary side effects.

- **New endpoint**: `GET /api/channels/{id}/presentation-state` → returns `{channel_id: string, directives: UIDirective[], last_event_at: string}`. Append-only. Same vocabulary as the SSE stream, just persisted ephemerally per channel.

- **Headless consumers** replay the directives through their own `applyDirective` equivalent to reconstruct TanStack table state:

  ```python
  state = initial_state()
  for d in response["directives"]:
      state = apply_directive(d, state)  # reference reducer in shared/chat/
  ```

- **`UIDirective`** is the type defined by ADR-014's `UiDirectiveSchema` (`shared/chat/events.ts`). One schema definition; two streams (SSE + this persisted log).

- **FE is unchanged**. The FE keeps applying directives in-process via the SSE stream and `applyDirective`. The persisted log is purely a backend-side observation channel for headless consumers.

- **Reference reducer**: a thin headless `applyDirective` is shipped in `shared/chat/` alongside the typed `UiDirective` schema. Headless TS/JS consumers import it directly; non-TS consumers (Python harness) reimplement it once against the `UiDirective` schema.

### Why log-not-snapshot

The user's framing was "the list of events that tell the UI how to render the tanstack table." Folded in verbatim as the load-bearing decision principle:

- Worker already produces directives; appending to a log is structurally cheaper than computing snapshot projections.
- Directive algebra lives in `frontend/src/core/chat/dispatcher.ts`'s `applyDirective`; replicating it server-side is duplicate-the-FE-reducer work without a clear consumer need today.
- An append-only log composes with **Epic C's SSE-replay infrastructure by design** — same shape, different stream.
- Server-side projections are additive; if a snapshot endpoint becomes warranted, layer it on top of the log without breaking the log endpoint. **Don't build it preemptively.**

### Why not Option 2 (snapshot)

Duplicates the FE reducer on the server with no current consumer that prefers it. Costs the FE-reducer code to be maintained in two languages once Phase 1 Epic D's Python harness lands. Log + headless reducer keeps the algebra in one place per host language.

### Why not Option 3 (backend resource)

Commits to a durable URL and persistence model before we have evidence presentation-state should be durable. Adds DB tables, migration cost. Reversible only by deprecation. Reflect-only log preserves option-value.

### Why not Option 4 (FE-only)

Closes J1. Phase 1 Epic D either skips presentation-state assertions entirely or runs Playwright-heavy tests. Both costs exceed the cost of building Option 1.

### Why not Option 5 (hybrid)

Premature complexity. If durable preferences become a real ask, ADR-016 supersedes this one and adds the resource later. PR-0 ships the smallest move that turns J1 from impossible → supported.

## Cross-decision composition (intentional)

- **ADR-015 ↔ ADR-014** — the directive log is `UIDirective[]` where `UIDirective` is `z.infer<typeof UiDirectiveSchema>`. ADR-014's parallel-unions stratification is what makes the log payload schema-clean: domain events stay out of the log, UI directives stay out of Epic C's domain-event log.
- **ADR-015 ↔ Epic C** — Epic C builds replay infrastructure for `DomainEvent` (persist outcomes on Stream.io thread; `GET /api/sessions/{id}/events?since=…` replay endpoint). ADR-015's directive log is the parallel concept on `UiDirective`. **The log infrastructure is intentionally shared by construction**: same persistence backend choice (Redis vs in-process — see OQ #4), same compaction policy, same TTL. Epic B PR-2 (B.2) and Epic C should align on the choice. Either-order sequencing for Phase 1 epics A–D is fine; the shape is shared.
- **ADR-015 ↔ ADR-016** — independent. ADR-016 is a test-stack composition decision.

## Consequences

**Positive**
- J1 (headless retrieval) supported with a smaller change than any other option.
- J3 (zero-latency FE) preserved — FE flow is unchanged.
- "No backend call" test invariant unaffected — cache writes are a non-`BackendClient.post` side channel.
- Schema reuse with ADR-014 — `UIDirective` is defined once.
- Composes with Epic C's replay infrastructure by construction.
- Reversible — if a snapshot endpoint becomes warranted, layer it on top; if presentation-state becomes durable, escalate to a backend resource (Option 3).

**Negative / accepted trade-offs**
- Every consumer needs an `applyDirective` equivalent. Mitigation: ship a thin reference reducer in `shared/chat/` alongside the typed `UiDirective` schema (TS consumers import directly; non-TS reimplement against the schema once).
- Log size unbounded within channel TTL. Mitigation: cap log length OR compact equivalent directives (e.g. successive `sort_directive` collapses to the last one). Not blocking PR-0; revisit if log size becomes loud.
- Backend now holds per-channel ephemeral state. Compose with whatever Epic C chooses (Redis vs in-process).

## Option sketch (Option 1, the chosen one)

**Worker side** (`agent/lib/chat/dispatchers/ui.ts`):

```ts
function makeSortTableDispatcher(...): ToolDispatcher {
  return {
    execute: async (args, ctx) => {
      const directive = { type: "sort_directive", column, direction };
      ctx.emit(directive);                              // SSE — unchanged
      await ctx.presentationState.append(channelId, directive);  // NEW — log side effect
      return { ok: true };
    },
  };
}
```

**Backend endpoint** (`backend/app/routers/channels.py`):

```python
@router.get("/api/channels/{channel_id}/presentation-state")
async def get_presentation_state(channel_id: str):
    log = await presentation_state_log.get(channel_id)
    return {
        "channel_id": channel_id,
        "directives": log.directives,
        "last_event_at": log.last_event_at,
    }
```

**Headless replay**:

```ts
// TS consumer
import { applyDirective } from "@dashboard-chat/shared-chat";
const state = directives.reduce((s, d) => applyDirective(d, s), initial);
```

```python
# Python consumer (Phase 1 Epic D harness)
state = initial_state()
for d in response["directives"]:
    state = apply_directive(d, state)  # reimplemented once against UiDirective schema
```

## Option 2 (later optionality, not preempted)

A server-side projection (snapshot) endpoint can be added later as a separate endpoint if/when payload-size or replay-complexity arguments make it worth it. The snapshot is an *additive layer over* the log, not a *replacement for* it — the log endpoint stays as the source of truth. Don't build it preemptively.

## Open questions

1. **Per-user-per-dataset vs per-channel scoping for the log.** PR-0 chooses **per-channel** for simplicity (matches the existing ChannelId routing). Per-user-per-dataset is the natural escalation if durable preferences become a real ask. Decided at Epic B PR-2 (B.2) implementation time.

2. **Does `View.materialization = "ephemeral"` already imply a place for table-state? — RESOLVED 2026-04-29** (per `dc-wisp-dowv`).

   No. "View" in this codebase is the dbt intermediate join layer. The presentation-state cache is its own resource family. The user's domain taxonomy (dataset / view / report) is captured verbatim in the Naming discipline section above.

3. **Is `columnVisibility` in scope?** Reflect what the FE produces — if the FE emits a `column_visibility_directive`, it goes into the log; if not, the log only carries sort and filter. Expanding the chat directive surface is a separate decision (would amend ADR-014's `UiDirectiveSchema`).

4. **Cache backend: in-process Map vs Redis.** Recommendation: align with whatever Epic C chooses for its `DomainEvent` log so the two streams share infrastructure. In-process Map is fine for dev / single-worker; Redis if the worker scales horizontally. Decided at Epic B PR-2 (B.2) and Epic C C.1 implementation time, jointly.

5. **Log compaction strategy.** Implementation-time decision, only if log size becomes a real problem in practice. Candidates: cap length (last N directives), collapse equivalent directives (last-`sort_directive` wins), TTL-based eviction.

6. **URL-state for J4 (shareability).** Out of scope for PR-0. Optional follow-up bead; not blocking.

7. **Reference reducer location.** Recommend shipping the headless `applyDirective` in `shared/chat/` alongside `UiDirective` schema so both TS and Python consumers have one canonical reducer to reimplement against. Decided at B.2 time.

## References

- User framing: *"the list of events that tell the UI how to render the tanstack table"* — `dc-wisp-dowv`.
- Wire schema: ADR-014 `UiDirectiveSchema` (`shared/chat/events.ts`).
- Existing FE applier: `frontend/src/core/chat/dispatcher.ts` :: `applyDirective`.
- Test invariant guarded: `agent/test/chat/acceptance/worker-tool-dispatch.test.ts:502-550` ("no backend call" — guards `BackendClient.post`).
- Phase 0 DIVERGE source: mail `dc-wisp-vp79` (mayor GO), `dc-wisp-ctyh` (dave's reply with the three ADRs).
- Ratification trail: `dc-wisp-z02g` (deferred for naming collision), `dc-wisp-dowv` (mayor + user ratified rename + event-log shape), `dc-wisp-8agq` (dave's update reply), `dc-wisp-n6ar` (mayor confirmed ratified).
