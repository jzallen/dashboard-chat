# Finalize — `chat-app-machine`

> **Feature shipped**: 2026-05-29 (all four phases merged; FlowOrchestrator deleted)
> **Wave path**: DESIGN (interactive review) → SPIKE (R3) → DELIVER inside-out Phases 1–4 (via headless merge-queue workers) → FINALIZE
> **Final `main` HEAD at finalize**: `db52304` (record ADR-044 Phase 4 landing)
> **Companion decision**: [ADR-044 — ChatApp Coordinator Supersedes FlowOrchestrator](../../decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md) (+ its 2026-05-28 amendment)
> **Archived artifacts**: this directory (`design/`, `spikes/`) is the verbatim feature-workspace snapshot, moved here via `git mv` from `docs/feature/chat-app-machine/` so blame and rename history survive. The ADR stays in `docs/decisions/` (referenced, not moved).

> **Provenance note (no `deliver/execution-log.json`).** Delivered by **headless merge-queue workers**, not the standard `nw-execute` flow — there is no `deliver/execution-log.json` to gate on. Completeness is established from **git history on `main`** (the phased commit arc in §2), the **accepted ADR** (whose "what landed in this slice" sections were written commit-by-commit), and the design review. **All four phases are merged; the FlowOrchestrator is deleted; ADR-044 is complete.**

---

## 1. Summary

`chat-app-machine` replaced the imperative **`FlowOrchestrator`** with a declarative **`ChatApp` XState v5 parent coordinator** that drives the `onboarding → project_context → chat` lifecycle. The "three independent machines + an orchestrator" model was, on inspection, *a parent coordinator implemented imperatively in plain TS* ([chatapp-coordinator-review.md §1](design/chatapp-coordinator-review.md)): everything a parent statechart would own — child lifecycle/spawn, the auth→project and project→chat hand-offs, cross-machine freeze/thaw, the replay buffer, terminal emission, and projection resolution — was present in `FlowOrchestrator`, hand-rolled across ~1400 lines. The children were **healthy** (they pass [ADR-028](../../decisions/adr-028-xstate-v5-actor-model.md)'s discriminating test: context is internal handler state, contracts flow via `event.output`/projection, no child references another) and were **kept**. The orchestrator — the concentration of accidental complexity — was the thing to delete.

ADR-028 already mandated *"one root orchestrator actor per process; cross-machine signaling via the actor system,"* but the orchestrator was a **class, not an actor**, and signaling was a hand-rolled `for…of actors` loop. So the pivot was **not a departure from the ratified architecture — it was the first faithful implementation of ADR-028's stated intent**, closing a latent drift rather than opening a new decision ([ADR-044 relationship notes](../../decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md)).

The pivot also **fired [ADR-030](../../decisions/adr-030-flow-state-topology-and-scaling.md)'s 2026-05-16 "emission-completeness tripwire"** — the pre-committed trigger that *when hand-policing "every settle must emit a FlowEvent" justifies building compile-time enforcement, instead replace the event-sourced projection with a simpler store*. ChatApp reaches that boundary from the other direction: by making the **live actor the state-of-record**, the manufactured "forgot-to-emit" invariant ceases to be load-bearing for correctness.

## 2. The inside-out delivery arc (core first, boundaries last)

The hard sequencing constraint: the orchestrator is the **live coordinator** until ChatApp subsumes **all four** of its responsibilities, so it is **deleted LAST** (Phase 4). Phases 1–3 build the replacement *beside* it; nothing on the live path moves until Phase 4.

### Pre-work — SPIKE R3 (invoked-child snapshot rehydration)
**Artifact**: [`spikes/r3-invoked-child-rehydration.md`](spikes/r3-invoked-child-rehydration.md) (`ui-state/lib/machines/chat-app/spikes/r3-invoked-child-rehydration.spike.test.ts`, 4 passing experiments). The review flagged R3 **HIGH — SPIKE FIRST**, repeating the XState lore that *"`getPersistedSnapshot()` rehydrates invoked children BUT in-flight invoked promises are NOT resumed."* **The lore is FALSE on XState 5.31.1**: rehydrating a snapshot taken mid-invoke **re-fires the in-flight invoke automatically** and the flow self-heals once the fresh promise settles — through a real JSON round-trip, with no `reenter`/kick/recovery code. The hazard inverts: the invoke can run **twice** (once live, once on rehydrate). Mitigations: (1) **snapshot at settled control states only** (inherits the orchestrator's `waitForSettledState` discipline) makes the re-fire moot for the canonical path; (2) idempotency as defense-in-depth — only `createProject` and `createSessionEagerly` are non-idempotent, and (1) means they are never persisted mid-flight. **This single spike de-risked the whole persistence phase.**

### Phase 1 — ChatApp core in isolation, FAKE children (`78cde9a`, ADR `a937112`)
New machine at `ui-state/lib/machines/chat-app/` mirroring the `session-onboarding` layout. Two parallel regions — `lifecycle` (the forward cycle) and `connectivity` (the `live ⇄ frozen` freeze overlay) — with `onSnapshot` child-watching, `entry: sendTo` hand-offs, a parent-held replay buffer, and a multi-target `REAUTH_FAILED → live + rejected`. **Children dependency-injected** via `setup({ actors })` + `machine.provide({ actors })` (Phase 1 provides FAKES; Phase 2 the real machines). 16 pure statechart unit tests prove the choreography without network/Redis: happy cycle, hand-offs reach the right child, freeze/thaw (held-not-forwarded → replay-in-order), freeze orthogonality, project-switch re-forward + idempotency. Plus risk-free `lib/domain/` file moves (`active-scope`/`flow-event`/`flow-id` tests + `projection.ts` and its tests, co-located with their already-moved subjects).

### Phase 2 — Wire REAL children via DI (`d33c2a4`, tests `50b8646`)
Replaced the stub children with the real `session-onboarding`, `project-context`, `session-chat` machines through the `.provide({ actors })` seam — ChatApp's `index.ts` becomes the new composition root. In-process integration tests run the choreography against the real children with no orchestrator and no HTTP, surfacing any hand-off mismatch.

### Phase 3 — Reconcile persistence (the hybrid; `c4ef318`, `b494a39`, `986439d`, ADR `f2a3099`)
The §2 hybrid, additive and built on ChatApp in isolation (the live path untouched):
- **Derived-view projection mapper** (`projection/derive-projection.ts`): a **pure** `deriveProjection(snapshot, wireMachine, bookkeeping) → FlowProjection` that reproduces the per-machine [ADR-027](../../decisions/adr-027-flow-state-tier-and-framework.md) envelope from a ChatApp snapshot, **byte-identical** to the old `buildProjection` log fold. Picks the child slice by wire name (resolving the legacy aliases — R7), maps `child.value → state` via an explicit per-machine table, rebuilds `context` from `initialContext()` defaults, and reuses the SAME `deriveActiveScope` tier logic. `sequence_id`/`last_event_at`/`request_id` stay **log-sourced** (the log is retained for SSE/audit) — so there is no "forgot-to-emit" gap for *state* yet the envelope stays complete.
- **Onboarding-outcome retention** (`c4ef318`): the phase-scoped onboarding child is stopped on the advance to `engaged`/`rejected` and leaves the snapshot, but the FE reads `login-and-org-setup` every request — so the parent retains `onboarding_result` as that slice's state-of-record.
- **Snapshot restart recovery** (`986439d`): a `ChatAppSnapshotStore` port + Redis/noop adapters (one record per principal at `ui-state:chatapp:{principal}:snapshot`, distinct from the event-log keyspace), the recovery seam (`snapshot.ts`), and the R3 `isSettledForSnapshot` settled-states-only guard. Tests round-trip a real wired ChatApp through the store (JSON), rehydrate via `createActor({ snapshot })`, and confirm the in-flight invoke **self-heals** (R3 reproduced on the real machine).
- **R1 golden/contract tests** (`derive-projection.contract.test.ts`, 12 cases): drive the real wired ChatApp to each scenario and assert `deriveProjection === buildProjection(equivalent log)` field-by-field — pinning the auth-proxy KPI literals (`state ∈ {ready, error_recoverable}`, `context.underlying_cause_tag`) and the FE reads.

### Pre-Phase-4 grooming
`49e3ec5` (fold fake children into `machine.test.ts`), `2a89534`/`fd7923a`/`f6af22c`/`5378cac`/`de2be86` (split then re-collapse `ChatAppChildInput` into per-slot `SessionOnboardingInput` types + README), `6b91765` (relocate choreography-vs-integration coverage), `17e32d8` (rename ChatApp guards + lifecycle state to domain vocabulary).

### Phase 4 — the gap analysis, the freeze-region resolution, then the live wire-swap + deletion

Phase 4 did **not** land in one cut — it went through a deliberate analysis-and-stage step first, which is the most instructive part of this feature's history:

1. **Gap analysis + safety valve (`7b22d10`)** — [`design/phase4-gap-analysis.md`](design/phase4-gap-analysis.md). Step 0 inventoried what the live `ui-state` actually served (**session-onboarding only** — the project/chat wire paths were dormant, `index.old.ts` was dead) vs. what the FE+auth-proxy still read (all three machines' projections). It found the gaps **larger than the pre-flight list** — chiefly the full `/event` vocabulary forwarding (gap #9), a `REAUTH_FAILED` semantic divergence (#2), and freeze-during-in-flight-invoke (#10) — and that **the freeze/abandonment gaps were in tension with [ADR-043](../../decisions/adr-043-retire-ui-state-token-lifecycle-modeling.md)** (which retired ui-state's freeze/thaw subsystem). Decision: take the **PART H safety valve** — land the analysis additively (docs-only, zero live change) and stage the wire-swap + deletion, rather than ship a half-migrated app where some wire paths hit ChatApp and others 404/hit the orchestrator.
2. **Connectivity region REMOVED (`8e92b04`)** — the analysis's biggest risk was resolved not by *building* abandonment machinery but by **deleting the freeze region entirely**. [ADR-044's 2026-05-28 amendment](../../decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md#amendment-2026-05-28--5-open-question-2-resolved-remove-the-connectivity-region) resolved §5 OQ#2 **toward removal**, applying ADR-043's logic directly: auth-proxy owns the token lifecycle, ui-state is never a token-management participant, the speculative "future backend-401 boundary" never materialized, and an inert region is dead structure, not optionality. The `type: "parallel"` wrapper collapsed to a single `lifecycle` region; `held_events`/`holdIntent`/`replayHeldIntents`/`REAUTH_FAILED` and the freeze overlay in `derive-projection.ts` were deleted. The derived projection stays byte-identical for the non-frozen states (the only states ui-state ever reports per ADR-043). **This single decision removed the largest, riskiest gaps from the swap.**
3. **Live wire-swap (`eef47ab`)** — `buildChatAppApp` replaced `buildSessionOnboardingApp` in `ui-state/index.ts`: it builds `ChatAppDeps` (project-context + session-chat resolver actors), selects the `FlowEventLog` + `ChatAppSnapshotStore`, and mounts **one** router factory (`lib/machines/chat-app/router.ts`) under every wire path. **One ChatApp actor per principal** (in-memory registry — ui-state is single-replica per [ADR-030](../../decisions/adr-030-flow-state-topology-and-scaling.md) §SD2 — backed by the snapshot store for hot restart) serves all three machines' projections: cold-start bootstraps onboarding and the parent cascades to project-context + session-chat via ADR-028 `onSnapshot` hand-offs, so **the project/chat projection serving the old session-onboarding-only app had dropped is restored** from the single actor. Routers re-pointed: `/begin` (onboarding cold-start), `/event` (the closed onboarding ACL preserved verbatim + a generic `child_event` forward-to-active-child + `switching_project_intent → PROJECT_SWITCH`), intent-shaped `/open-deep-link`, `/projection` + `/projection/stream` all driven by `deriveProjection`. The `GET /flow/{machine}/projection` envelope stays **byte-stable** (the contract tests stay green); `flow_id` is synthesized `{wireMachine}:{principal}` verbatim; legacy alias names keep resolving. **Hybrid persistence is live**: `getPersistedSnapshot()` via the store is the state-of-record (settled-states-only saves, R3 self-heal); the append-only log is retained but demoted to SSE/audit + projection bookkeeping.
4. **Orchestrator deleted (`3d81012`)** — only after ChatApp provably subsumed its non-retired responsibilities: `lib/orchestrator.ts` (`FlowOrchestrator`, `BeginFlowOrchestrator`, `FlowActorRegistry`, `FrozenState`, `FLOW_STRATEGY_REGISTRY`), `orchestrator-harvester.ts`, `wait-for-settled-state.ts`, the three per-machine `strategy.ts` + `router.ts`, the six `orchestrator*.test.ts` characterization suites (re-covered by `integration.test.ts` + `derive-projection.contract.test.ts` + the rewired `index.test.ts`), the orchestrator-coupled `flow-router.ts` helpers (`mountUniformFlowRoutes`/`freezeThawHandler`/`resultToJson` — `requestIdMiddleware` kept), and the dead `index.old.ts`/`index.old.test.ts`. **Freeze/thaw retired end-to-end** (ADR-043): the `/freeze` + `/thaw` endpoints are gone and the children's `on.FREEZE`/`freeze`/`THAW`/`replay_abandoned` handlers were removed from `project-context` + `session-chat`. `last_live_state` is **retained** in session-chat — load-bearing for the interactive `retry_clicked` handler, independent of the retired freeze path.
5. **Phase 4 landing recorded (`db52304`)** — ADR-044's "Phase 4 — what landed in this slice" section.

---

## 3. Decision ratified by this feature

| Decision | Where it lives | Status |
|---|---|---|
| **[ADR-044 — ChatApp Coordinator Supersedes FlowOrchestrator; Persistence → Hybrid Snapshot + Audit-Log](../../decisions/adr-044-chatapp-coordinator-supersedes-orchestrator.md)** | `docs/decisions/` (not moved) | Accepted; **complete** (Phases 1–4 landed + the 2026-05-28 amendment) |

Relationship to prior ADRs (from the ADR): **fires [ADR-030](../../decisions/adr-030-flow-state-topology-and-scaling.md)'s 2026-05-16 tripwire** (§3 below); **first faithful implementation of [ADR-028](../../decisions/adr-028-xstate-v5-actor-model.md)** (a real root actor mediating parent-ignorant children — the children are kept); **preserves [ADR-027](../../decisions/adr-027-flow-state-tier-and-framework.md)** (the per-`flow_id` `FlowProjection` wire contract, byte-stable as a derived view); **reconciles with [ADR-043](../../decisions/adr-043-retire-ui-state-token-lifecycle-modeling.md)** (the freeze region was removed rather than wired). The full design rationale is the archived [`design/chatapp-coordinator-review.md`](design/chatapp-coordinator-review.md) (Hera, nw-ddd-architect, Propose mode) and [`design/phase4-gap-analysis.md`](design/phase4-gap-analysis.md).

## 4. Architecture deltas

- **`FlowOrchestrator` (class) → `ChatApp` (XState v5 parent actor)**: declarative choreography replaces the settle-chain threaded across three files. Hand-offs are parent transitions on child `onSnapshot` + `entry: sendTo(nextChild, …)`; children stay parent-ignorant (ADR-028). The invoke `id` is the parent's observability/sendTo/snapshot-identity handle (resolved via `snapshot.children[id]`), **not** child-to-child messaging. _(corrected 2026-05-29: originally credited `systemId` with this role; `systemId` only matters for cross-hierarchy `system.get(systemId)`, unused here, so the redundant declarations were removed.)_
- **Single-region lifecycle** (post-2026-05-28-amendment): `onboarding → project_context → chat (+ rejected)`. Project-context is invoked on the `engaged` ancestor of both `project_context` and `chat` (so it survives into chat to serve project switches); session-chat is invoked on `chat` only. The intent router is a top-level `on: { user_intent }` → `forwardIntentToActiveChild`.
- **Hybrid persistence**: the live actor's `getPersistedSnapshot()` is the state-of-record for hot restart (one record per principal, `ui-state:chatapp:{principal}:snapshot`); the append-only event log is **retained but demoted** to projection-source + audit + SSE substrate. A missed append only delays an SSE push — it no longer sticks the state.
- **Derived-view projection**: `GET /flow/{machine}/projection` derives the per-machine ADR-027 envelope from the ChatApp child slice, byte-stable, contract-tested against the old `buildProjection` oracle. The truly-unified single-projection wire remains a separate, optional FE+auth-proxy follow-on (ADR-044 §5 OQ#3).
- **One actor per principal**: an in-memory registry (ui-state single-replica, ADR-030 §SD2) backed by the snapshot store. The dormant project/chat projection serving is **restored** — the old live app was session-onboarding-only.
- **Freeze/thaw fully retired**: `/freeze` + `/thaw` endpoints and the children's freeze side-states deleted (ADR-043). `last_live_state` kept in session-chat for the interactive `retry_clicked` path.

## 5. ADR-030 tripwire — fired and recorded

ADR-030 (2026-05-16) pre-committed: *the proposal to enforce emission-completeness by construction is itself the signal to instead replace the event-sourced projection with a simpler server-authoritative store.* ChatApp reaches that boundary from the other direction — rather than building a compile-time guard that makes "settle without emitting" unrepresentable, it makes the **live actor the state-of-record**, so the invariant is no longer load-bearing. The hybrid substrate is the *less-aggressive* realization of the tripwire's pre-costed alternative (the log is kept for audit/SSE rather than deleted, but stops being the rebuild mechanism). ADR-030's purer **store model** (one settled-state record per `flow_id`) remains the documented fallback if the team later wants maximum log deletion (ADR-044 §5 OQ#1).

---

<a id="deferred-items"></a>
## 6. Deferred items / open follow-ons

Explicit **deferred follow-ons**, not blockers (ADR-044 §5 + the gap analysis §5).

### OQ#1 — Hybrid vs. full store model
Hybrid was chosen now (preserves SSE + audit, least FE churn). ADR-030's store model is the more aggressive fallback for maximum log deletion. **Owner**: a future ui-state persistence-simplification story, if appetite arises.

### OQ#3 — Unify the external projection wire
Collapsing the three per-machine projections into one ChatApp projection is a **separate, optional FE + auth-proxy ripple**, explicitly out of this pivot's scope. The per-machine derived view is the byte-stable bridge until then. **Owner**: a follow-on FE+auth-proxy story.

### Gaps retired with the freeze region (gap analysis #1/#2/#6/#10)
The freeze-window/buffer-cap/abandonment machinery, the `REAUTH_FAILED` divergence, the legacy route-shaped deep-link scope folding, and freeze-during-in-flight-invoke were **not built** — they were retired with the orchestrator's freeze family per ADR-043's logic (the 2026-05-28 amendment). If a real backend-401 boundary ever materializes it belongs in auth-proxy, not ui-state, and would arrive with its own ADR. **No action expected.**

### Living guard — the R3 spike test
[`spikes/r3-invoked-child-rehydration.md`](spikes/r3-invoked-child-rehydration.md) — the spike test is kept as a **living guard**: it will fail if an XState upgrade ever changes the auto-re-fire behavior the hybrid persistence design relies on. **Owner**: whoever bumps the XState version.

---

## 7. Outcome

- **The 1400-line imperative `FlowOrchestrator` is deleted**; ChatApp is the live ui-state coordinator. ADR-044 is complete (Phases 1–4 + the connectivity-region-removal amendment).
- **ADR-028 honored faithfully** — a real root actor mediating parent-ignorant children, closing the latent class-not-actor drift. The healthy child machines were kept untouched in their domain logic.
- **The forgot-to-emit failure class lost its teeth** — the live actor is the state-of-record; a missed log append only delays an SSE push (ADR-030 tripwire fired and recorded).
- **The ADR-027 wire contract never broke** — the per-machine `FlowProjection` survived the entire pivot as a byte-stable derived view, proven by the `derive-projection.contract.test.ts` golden oracle across every live-critical state.
- **R3 de-risked the persistence phase up front** — the "in-flight invokes don't resume" lore was empirically disproven on 5.31.1; snapshot-at-settled-states made the auto-re-fire moot for the canonical path.
- **The honest staging call paid off** — Phase 4 was split into an additive analysis landing + a freeze-region resolution + the risky cut, never leaving a half-migrated live app. The biggest gap (freeze/abandonment) was dissolved by ADR-043 alignment rather than built.
- **The dormant project/chat serving is restored** — the single per-principal ChatApp actor serves all three machines' projections, where the pre-pivot live app served only session-onboarding.
