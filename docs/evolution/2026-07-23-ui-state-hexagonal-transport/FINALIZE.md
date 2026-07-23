# Finalize — `ui-state-hexagonal-transport` (precursor, subsumed by ADR-044 + ADR-046)

> **Disposition**: **ARCHIVED AS A PRECURSOR.** ADR-040's six-LEAF hexagonal-transport
> migration was **partially delivered** (LEAF-1/2/3 landed 2026-05-16 → 05-18) and then
> **subsumed by a ratified architectural pivot** before LEAF-4/5/6 were ever built.
> [ADR-044](../../decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md)
> (ChatApp coordinator, ratified 2026-05-25) superseded the `FlowOrchestrator` coordination
> role and **deleted** the very artifacts LEAF-1/2/3 produced; then
> [ADR-046](../../decisions/adr-046-stateproxy-actor-surface.md) (StateProxy `/state`
> surface, 2026-05-29) realized LEAF-5's store-model exit and LEAF-6's alias/per-machine-surface
> removal under a cleaner model. This document records what the LEAF work durably
> contributed (conceptually), what the pivot reworked, and where the live truth now lives.
> It is **not** being finalized as a completed six-LEAF migration — that plan was deliberately
> abandoned mid-stream by the pivot, not left unfinished by oversight.
>
> **Delivered**: LEAF-1 (`4c33709`), LEAF-2 (`7a73cf4`), LEAF-3 (`11d817b` → `9ac0a55` → `97d1412`) — 2026-05-16 → 05-18.
> **Never delivered as ADR-040 LEAFs**: LEAF-4, LEAF-5, LEAF-6 (subsumed — see §3).
> **Wave path**: DESIGN (ADR-040, ratified 2026-05-16) → DISTILL (roadmap + 6 skip-marked specs + hard-swap handoff) → DELIVER (LEAF-1/2/3 only) → *(FINALIZE as precursor)*.
> **`main` HEAD at archive**: `b994b3a4`.
> **Archived artifacts**: this directory (`distill/`, `deliver/`) is the verbatim feature-workspace snapshot, moved here via `git mv` from `docs/feature/ui-state-hexagonal-transport/` so blame and rename history survive. There is no `design/` subtree — [ADR-040](../../decisions/adr-040-ui-state-hexagonal-transport.md) *is* the DESIGN artifact and stays in `docs/decisions/`.

---

## 1. Summary

`ui-state-hexagonal-transport` was a **brownfield refactor migration** ratified by
[ADR-040](../../decisions/adr-040-ui-state-hexagonal-transport.md): re-core the
`ui-state` flow transport from a machine-**parameterized** seam (`/flow/:machine/*` routes
forking on `machine === "…"` string conditionals in three inconsistent vocabularies, plus
a ~1939-line orchestrator carrying the matching per-machine fan-out) into a **deep
hexagonal** shape — a `FlowStrategy` port per machine, a thin generic pump, per-machine
sub-routers, and (the centerpiece) a hard swap of the driven read-port from Redis-Streams
event-log replay to a server-authoritative `SettledStateStore`. The re-core's purpose was
to dissolve the **emission-completeness bug class** (the orchestrator must emit a FlowEvent
for every settle or the rebuilt projection goes stale) that had recurred five times across
J-002's delivery — by putting `settle→emit` on a typed port member.

The work was decomposed into six strictly-sequential LEAFs
([`distill/handoff-distill-to-deliver.md`](distill/handoff-distill-to-deliver.md) §4):

| LEAF | Scope | Behavior | Outcome |
|---|---|---|---|
| **LEAF-1** | `FlowStrategy` port + registry keyed by canonical machine-name (D5 alias map) | neutral (A/B Δ=0) | **Delivered** `4c33709` |
| **LEAF-2** | `makeFlowRouter(strategy)` factory + per-machine `app.route` mounts + HTTP-level alias | neutral (A/B Δ=0) | **Delivered** `7a73cf4` |
| **LEAF-3** | Carve the orchestrator's per-machine branches into the three strategies; orchestrator → generic pump | neutral (A/B Δ=0) | **Delivered** `97d1412` |
| **LEAF-4** | Extract bounded intent buffer + FREEZE/THAW broadcaster as named driven adapters | neutral | **Subsumed** (§3) |
| **LEAF-5** | Hard swap event-log → `SettledStateStore`, behind the byte-equivalence gate | **behavior-changing** | **Subsumed** (§3) |
| **LEAF-6** | Remove the alias map once the FE consumes canonical paths | neutral | **Subsumed** (§3) |

LEAF-1/2/3 each landed with a controlled A/B behavior-neutrality proof (per-marker J-002
acceptance suite, FAILED-set Δ=0 on every marker — see the three
[`deliver/leaf-*-progress.md`](deliver/) records). The migration then stopped: a broader
pivot overtook the remaining plan.

## 2. What the LEAF work durably contributed

The *artifacts* LEAF-1/2/3 built are gone (§3 — the whole `FlowStrategy`/registry/pump
scaffold was deleted by ADR-044 Phase 4). What durably survives is **conceptual**, carried
forward into the successor ADRs:

| Contribution | Origin | Where it lives now | Status on `main` |
|---|---|---|---|
| **Identity is header-derived, never transported** — `flow_id = ${machine}:${X-User-Id}` is a pure function of the route constant + the verified principal; the client sends no `flow_id` | [ADR-040 Amendment (2026-05-25)](../../decisions/adr-040-ui-state-hexagonal-transport.md) | ADR-046 §"Header-derived identity" preserves it verbatim ("no client `flow_id` (ADR-040 amendment)"); the `/state` surface carries identity only in the header auth-proxy already forwards | **Live** — the leaky-abstraction 403 guard it enabled deleting stays deleted |
| **Canonical machine-name as the dispatch key** (flow-id rejected as key; D5 alias `project-and-chat-session-management` → `project-context`) | ADR-040 D5 + ADR-039 | Folded into the ADR-039 vocabulary convergence; ADR-046's `/state` regions are named for the domain (`onboarding`/`projectContext`/`sessionChat`), the wire-machine aliases retired | **Live (as vocabulary)** — the registry object itself is deleted |
| **The store-model exit direction** — replace event-log replay with a server-authoritative settled state, gated by a mechanical byte-equivalence test rather than a dual-read parity window | ADR-040 D3 + LEAF-5 hard-swap posture | Realized under ADR-044/046 as `deriveStateDocument` + the migration-equivalence gate (`edbd9b5e`) over ONE `/state` document, not a per-machine `SettledStateStore` | **Live (as `deriveStateDocument`)** |

The one literal token that survives is a **doc reference** to
`FLOW_STRATEGY_REGISTRY.resolve()` in `ui-state/lib/domain/flow-event.ts:47` — a comment
describing the historical canonicalization point, not live code.

## 3. What ADR-044 + ADR-046 reworked (subsuming the remaining migration)

Two ratified pivots, both after LEAF-3 landed, absorbed the entire remaining scope:

**[ADR-044](../../decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md)
(ChatApp coordinator, 2026-05-25) deleted LEAF-1/2/3's own artifacts.** ADR-044 observed
that "three independent machines + a `FlowOrchestrator`" was a parent-coordinator pattern
hand-rolled as a class, and replaced it with a declarative `ChatApp` XState v5 parent
actor — the first faithful implementation of ADR-028. Its Phase 4 (`3d810121`,
*delete FlowOrchestrator + freeze/thaw scaffolding*) **deleted `orchestrator.ts`,
`orchestrator-harvester.ts`, `FlowActorRegistry`, `FrozenState`, and — named explicitly in
the ADR — "the strategies' settle/emission bodies."** That is precisely the LEAF-1/3
`FlowStrategy` scaffold. So the pump/strategy decomposition was transitional structure that
cleared the path and was then consumed; `ui-state/lib/machines/*/strategy.ts` and the
`FLOW_STRATEGY_REGISTRY` no longer exist.

**[ADR-046](../../decisions/adr-046-stateproxy-actor-surface.md) (StateProxy `/state`
surface, 2026-05-29) realized LEAF-5 and LEAF-6 differently.** ADR-046 records the
overseer decision that *"the FE is being rewritten around XState, and nothing is in
production"* — which removed the frozen-wire constraint that ADR-040's alias-dance,
zero-404 coexistence window, and dual-shape sniffer machinery existed to protect. With that
constraint gone:

- **LEAF-6 (alias + per-machine surface removal)** landed as ADR-046 MR-7 — git
  `a3cb2eb6` *retire per-machine /flow surface; /state is the sole read path (ADR-046 MR-7,
  **ADR-040 LEAF-6**)*. The per-machine `/flow` mounts, the `WIRE_TO_CHILD` alias map, and
  the `FlowProjection` envelope are deleted; a single `/state` surface (`GET /state` ·
  `POST /state/events` · `GET /state/stream`) replaces them.
- **LEAF-5 (store-model exit)** landed as `deriveStateDocument` + a migration-equivalence
  gate (git `edbd9b5e`) — the same "mechanical byte-equivalence instead of a parity
  window" idea ADR-040 D3 chose, but over ONE derived `/state` document rather than a
  per-machine `SettledStateStore` hash.
- **LEAF-4 (intent buffer + FREEZE/THAW adapters)** was dissolved rather than extracted:
  the freeze/`connectivity` region was **removed** per ADR-043 (recorded in the
  [chat-app-machine finalize](../2026-05-29-chat-app-machine/FINALIZE.md)), so there was no
  freeze/thaw broadcaster left to extract into a named adapter.

## 4. Verification at archive (2026-07-23)

Re-checked against `main` (`b994b3a4`):

- `ui-state/lib/orchestrator.ts` — **absent** (deleted `3d810121`, ADR-044 Phase 4).
- `ui-state/lib/machines/*/strategy.ts`, `FLOW_STRATEGY_REGISTRY`, `makeFlowRouter` — **absent**;
  the sole surviving mention is the historical doc comment at `ui-state/lib/domain/flow-event.ts:47`.
- The `/state` surface (`deriveStateDocument`, `POST /state/events`) — **present**, per ADR-046.
- LEAF-1/2/3 commits (`4c33709`, `7a73cf4`, `97d1412`) — reachable in history; their
  behavior-neutrality A/B proofs are the snapshots in [`deliver/`](deliver/), not re-run
  here (the code they exercised has since been deleted).

The `distill/roadmap.json` `deliver_status` fields are a point-in-time snapshot (LEAF-1/2
`delivered`; LEAF-3..6 unset) — **git is the source of truth**: LEAF-3 landed; LEAF-4/5/6
were subsumed, not delivered as ADR-040 LEAFs.

## 5. Deferred / carried-forward items

- **The DISTILL hard-swap handoff is now moot.** [`distill/handoff-distill-to-deliver.md`](distill/handoff-distill-to-deliver.md)
  §1 re-confirmed, in writing (per ADR-040's reviewer-mandated prerequisite), the binding
  "LEAF-5 is a single hard swap, do not decompose into 5a/5b/5c" posture. That instruction
  never reached a DELIVER crafter — the store-model exit was realized under ADR-046's
  `deriveStateDocument` instead. Recorded honestly as superseded, not violated.
- **The exhaustive LEAF-5 equivalence catalogue** (DWD-5: `STATE_HISTORIES` covering every
  J-002 state-history + every error arm) was DISTILL's highest-value output and was never
  authored as production code. Its *intent* — a mechanical, exhaustive, byte-exact
  equivalence gate over the settled-state read path — carried into ADR-046's
  migration-equivalence gate; a future audit that the `/state` document is byte-equivalent
  across every state-history should reuse this catalogue as its checklist.
- **D-MR5-02** (pre-existing full-suite shared-`dev-user-001` ordering fragility) was
  declared out of scope here and remains unfixed on `main`; unchanged by this archive.

## 6. Lessons

- **A behavior-neutral refactor mid-flight is hostage to the strategy above it.** LEAF-1/2/3
  were textbook brownfield discipline — characterization-pinned, per-marker A/B-proven Δ=0,
  strictly sequenced. They were also, ten days later, deleted wholesale, because a
  higher-level pivot (imperative orchestrator → declarative ChatApp actor) changed the
  substrate they were re-shaping. The carve wasn't wasted (it clarified the strategy
  boundaries ADR-044 then absorbed), but the episode is a caution: a long sequential
  migration through untested-at-the-seam legacy should confirm the *substrate itself* is
  settled before spending LEAFs polishing its internal structure.
- **A pivot can make elaborate safety machinery obsolete, not just unfinished.** ADR-040's
  alias dance, zero-404 window, dual-shape sniffer, and hard-swap equivalence gate were all
  load-bearing *because a frozen wire contract had real consumers*. The moment ADR-046
  recorded "nothing is in production, the FE is being rewritten," that entire apparatus
  became dead weight — the cheaper clean cutover was suddenly correct. Re-validate the
  constraints a plan is built to protect before resuming it.
- **Conceptual contributions outlive their artifacts.** Nothing LEAF-1/2/3 *built* survives,
  yet three of ADR-040's *ideas* do — header-derived identity (verbatim in ADR-046),
  canonical-name dispatch (folded into ADR-039), and the store-model exit (realized as
  `deriveStateDocument`). Finalizing the mechanism as "subsumed" while naming the surviving
  ideas keeps the record honest without overclaiming.

## 7. References

- Successors: [ADR-044](../../decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md)
  (ChatApp coordinator — deletes the FlowOrchestrator + strategies; finalized at
  [`2026-05-29-chat-app-machine/`](../2026-05-29-chat-app-machine/FINALIZE.md)) and
  [ADR-046](../../decisions/adr-046-stateproxy-actor-surface.md) (StateProxy `/state`
  surface — realizes LEAF-5/6).
- This feature's binding spec: [ADR-040](../../decisions/adr-040-ui-state-hexagonal-transport.md)
  (incl. the 2026-05-25 header-derived-identity amendment).
- Empirical origin: [`2026-05-16-project-and-chat-session-management/`](../2026-05-16-project-and-chat-session-management/FINALIZE.md)
  (J-002 — its five emission-completeness recurrences drove the ADR-030 tripwire and then
  ADR-040; its FINALIZE already names ADR-040 as the "deferred LEAF journey").
- This feature's artifacts: [`distill/`](distill/) (roadmap, wave-decisions, hard-swap
  handoff), [`deliver/`](deliver/) (the three LEAF progress records with A/B proofs).
- Key `main` commits: `4c33709` (LEAF-1), `7a73cf4` (LEAF-2), `11d817b`/`9ac0a55`/`97d1412`
  (LEAF-3); subsumed by `3d810121` (ADR-044 Phase 4 delete), `edbd9b5e` (LEAF-5 intent),
  `a3cb2eb6` (LEAF-6).
