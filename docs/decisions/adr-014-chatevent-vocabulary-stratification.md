# ADR-014: ChatEvent Vocabulary Stratification — Two Parallel Unions in `shared/chat/`

**Status:** Ratified
**Date:** 2026-04-29
**Originating wave:** Phase 0 DIVERGE — D-1
**Ratification trail:** Mail `dc-wisp-z02g` (mayor approval — "approved as written. No changes."), `dc-wisp-n6ar` (caveat dropped), `dc-66o` ("ADR-014 OQ #3 closing as RESOLVED inline is the right call").

## Context

The chat event vocabulary at `shared/chat/events.ts` (post-F2 SSOT promotion in commit `5eafffa`, bead `dc-bj2.2`) is a single Zod discriminated union. It mixes two semantically different classes of records:

- **Domain events** — outcomes of actions taken against backend state. Examples: `transform_applied`, `row_added`, `column_renamed`, `tool_call_failed`, `turn_done`. Every domain event is a fact about a state change a downstream consumer may want to react to, persist, or replay.
- **UI directives** — instructions to the FE renderer that have no backend correlate. Examples: `sort_directive`, `filter_directive`, `filters_cleared`. Every UI directive is ephemeral and exists only to drive TanStack table render state via `applyDirective` (`frontend/src/core/chat/dispatcher.ts`).

Phase 1 Epic D (api-driven-user-flow-tests) needs a Python harness that asserts on the SSE stream. A headless consumer wants to filter "domain events only" — directives that don't change backend state are uninteresting noise to a state-assertion test. With the current single-union shape there is no schema-level signal distinguishing the two classes; the consumer would need a hand-maintained allowlist of variant types.

This decision picks the structural shape that lets headless consumers (Python pytest harnesses, future SDKs, future replay tooling) filter domain events from UI directives at the schema level rather than at the call site.

## Decision drivers

- AC2.1 (exhaustive event handling at the FE) must remain trivially preserved. Every variant in the wire union must still be exhaustively handled by `eventHandler.ts`.
- F2's `shared/chat/` promotion is now SSOT for the wire schema. The decision must compose with that placement (not propose a different home).
- Phase 1 Epic D needs codegen viability — the chosen shape must round-trip Zod → JSON Schema → Pydantic without degrading to runtime-only filtering.
- Cross-decision composition with ADR-015 (`UiDirective` log) — the directive log endpoint reuses the same schema; whichever shape we pick here defines what the log payload looks like.

## Considered options

1. **Single union (status quo).** Keep the existing `ChatEvent = z.discriminatedUnion("type", [...11 variants])`. Headless consumers filter at the call site via an allowlist.
2. **Two parallel unions, re-unioned at the type level.** Split into `DomainEventSchema = z.discriminatedUnion("type", [...8 domain variants])` and `UiDirectiveSchema = z.discriminatedUnion("type", [...3 directive variants])`. Re-union as `ChatEventSchema = z.union([DomainEventSchema, UiDirectiveSchema])`. Headless consumers import only `DomainEventSchema` and get schema-level rejection of UI directives.
3. **Single union + `kind` tag.** Keep one union but add a `kind: "domain" | "ui"` field per variant. Filtering is still runtime, but explicit.
4. **Brand types (compile-time only).** Use TypeScript brand types (`type DomainEvent = ChatEvent & { __brand: "domain" }`) without splitting the runtime schema. Pure compile-time discipline; codegen target loses the distinction.
5. **Two completely separate streams (no re-union).** Emit domain events on `/chat/domain` and UI directives on `/chat/ui` as two separate SSE channels. Cleanest at the protocol level, biggest blast radius downstream.

## Decision outcome

**Option 2 — Two parallel unions in `shared/chat/`, re-unioned at the type level as `ChatEventSchema`.**

Concretely:

```ts
// shared/chat/events.ts
export const DomainEventSchema = z.discriminatedUnion("type", [
  TransformAppliedSchema,
  RowAddedSchema,
  RowRemovedSchema,
  ColumnAddedSchema,
  ColumnRemovedSchema,
  ColumnRenamedSchema,
  ToolCallFailedSchema,
  TurnDoneSchema,
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const UiDirectiveSchema = z.discriminatedUnion("type", [
  SortDirectiveSchema,
  FilterDirectiveSchema,
  FiltersClearedSchema,
]);
export type UiDirective = z.infer<typeof UiDirectiveSchema>;

export const ChatEventSchema = z.union([DomainEventSchema, UiDirectiveSchema]);
export type ChatEvent = DomainEvent | UiDirective;
```

The wire format is unchanged. SSE consumers that decode `ChatEventSchema` see the same union they see today; the variant set is identical. The change is structural — the wire union is now a union of two unions instead of a flat union. Existing consumers that accept `ChatEvent` continue to work without modification. Headless consumers who only want domain events import `DomainEventSchema` directly and get `ValidationError` on UI directives — exactly the property Phase 1 Epic D's Python harness wants.

`eventHandler.ts` continues to switch over `event.type` exhaustively; AC2.1's exhaustiveness invariant is trivially preserved because the variant set is unchanged.

### Why this shape

- **Lowest blast radius.** No call-site changes for FE consumers. The wire format is byte-identical to the status quo.
- **Schema-level filtering.** Headless Python (and any future non-TS) consumer gets domain-only narrowing for free, without an allowlist that drifts.
- **Cross-decision composition.** ADR-015's directive log endpoint returns `UIDirective[]` — that's exactly `z.infer<typeof UiDirectiveSchema>[]`. ADR-014 and ADR-015 share one type definition, two streams.
- **Reversible.** If the parallel-unions structure proves wrong, collapsing back to a single union is a one-line refactor (`z.discriminatedUnion("type", [...DomainEventSchema.options, ...UiDirectiveSchema.options])`).

### Why not Option 1 (status quo)

Forces every headless consumer to maintain a hand-curated allowlist that must be kept in sync with the variant set. New domain events silently drop off the allowlist; new directives silently slip onto it. Hidden coupling.

### Why not Option 3 (`kind` tag)

The `kind` field would be redundant with the variant set — every variant is statically domain or directive. Two sources of truth for the same fact invite drift. Also: pure runtime filtering, no compile-time narrowing in TS or generated Python.

### Why not Option 4 (brand types)

Brand types vanish in codegen. Python harness gets a single union with no domain/directive distinction at the type level. Loses the property we are buying.

### Why not Option 5 (two SSE channels)

Doubles the protocol surface. FE clients must subscribe to two streams and merge them ordered. Harness clients duplicate connection handling. Net cost is large; gain is duplicated by Option 2 at the type level for free.

## Consequences

**Positive**
- Headless consumers (Phase 1 Epic D pytest, any future SDK) get schema-level domain/directive separation without an allowlist.
- AC2.1 exhaustiveness preserved trivially — variant set is unchanged.
- Cross-decision composition with ADR-015 and Epic C is structurally clean: `UIDirective[]` log + `DomainEvent[]` log + shared replay infra (Epic C builds it; ADR-015 reuses).
- Reversible to status quo with a one-line edit.

**Negative / accepted trade-offs**
- One additional type export and a small re-organization of `events.ts` (~50–100L diff).
- TS codegen output gains two top-level types (`DomainEvent`, `UiDirective`) plus the existing `ChatEvent`.
- Pydantic codegen produces three classes/RootModels instead of one. Spike (OQ #3, see below) verified this is clean.

## Open questions

1. **Per-variant Zod naming metadata.** Should we add `.describe(...)` or `.brand("…")` per variant so `zod-to-json-schema` propagates a `title` and Pydantic codegen produces semantic class names (`TransformAppliedEvent`) instead of numeric (`DomainEvent1`)? **Decision: defer to Epic B PR-1 (B.1) implementation time.** The numeric class names work correctly; only readability of `mypy` errors / stack traces is affected. If B.1 ships codegen, naming should follow.

2. **Per-channel scoping vs per-user-per-dataset scoping for the directive log.** Phase 1 PR-0 chooses per-channel for simplicity. ADR-015 owns this decision; cross-referenced here only because the log payload schema lives in this ADR.

3. **Codegen viability for `z.union(z.discriminatedUnion, z.discriminatedUnion)` to Python via `zod-to-json-schema` + `datamodel-code-generator` — clean or degraded? — RESOLVED 2026-04-29** (½-day spike per mayor's offer in `dc-wisp-z02g`).

   Verified end-to-end: `zod@3.25.76` + `zod-to-json-schema@3.x` → `datamodel-code-generator@0.56` produces clean Pydantic v2 BaseModels:

   - 143L Pydantic file for the domain-only schema (8 variants), 187L for the full `ChatEvent` (11 variants).
   - `extra='forbid'`, `Literal["..."]` discriminators per variant, proper `StrEnum` for each enum field.
   - Functional validation: three sample domain events (`transform_applied` / `row_added` / `turn_done`) parsed correctly to typed variant classes; a UI directive (`sort_directive`) was correctly **rejected** by the domain-only Pydantic model — exactly the property Phase 1 Epic D's pytest harness wants.

   Two cosmetic caveats, neither blocking:

   - Auto-generated class names are numeric (`DomainEvent1`...`DomainEvent8`) instead of semantic. Fixable via Zod `.describe(...)` metadata at B.1 time (see OQ #1).
   - `from __future__ import annotations` + `RootModel` requires a one-line `Model.model_rebuild()` at module load. Standard Pydantic v2 boilerplate.

   **Fallback to brand-types-only (Option 4) NOT needed.** Phase 1 Epic B PR-1 (B.1) ships with Option 2 as decided.

## Cross-decision composition (intentional)

- **ADR-014 ↔ ADR-015** — `UiDirectiveSchema` defined here is the type of records appended to the presentation-state directive log defined in ADR-015. One schema definition, two streams (SSE + persisted log).
- **ADR-014 ↔ Epic C** — Epic C persists `DomainEvent` outcomes onto the Stream.io thread for SSE replay. The same `DomainEventSchema` defined here is the type of records Epic C persists and replays. UI directives are explicitly out of replay scope (ephemeral by definition).
- **ADR-014 ↔ ADR-016** — independent. ADR-016 is a test-stack composition decision, not a wire-schema decision.

## References

- Wire schema home: `shared/chat/events.ts` (post-F2; commit `5eafffa`, bead `dc-bj2.2`).
- FE exhaustive switch: `frontend/src/core/chat/eventHandler.ts`.
- Directive applier: `frontend/src/core/chat/dispatcher.ts` :: `applyDirective`.
- Cross-schema sync test removed by F2: `frontend/src/core/chat/__tests__/acceptance/fe-event-vocabulary.test.tsx:112-134` (pre-F2 form).
- Codegen spike scratch workspace (not committed): `/tmp/codegen-spike/` on dave's prior session.
- Phase 0 DIVERGE source: mail `dc-wisp-vp79` (mayor GO), `dc-wisp-ctyh` (dave's reply with the three ADRs).
- Ratification trail: `dc-wisp-z02g` ("RATIFIED ✓ Selected option (two parallel unions in shared/chat) is approved as written. No changes."), `dc-wisp-n6ar` (caveat dropped), `dc-66o` (OQ #3 closing inline approved).
