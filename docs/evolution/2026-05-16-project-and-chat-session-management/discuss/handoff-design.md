# DISCUSS → DESIGN Handoff — `project-and-chat-session-management` (J-002)

> **Wave**: DISCUSS → DESIGN
> **Date**: 2026-05-13
> **From**: Luna (nw-product-owner)
> **To**: nw-solution-architect (DESIGN wave) — likely Atlas, the
> architect who landed J-001's ADR-027/028/029/030
> **Status**: DoR PASSED for all 10 stories; OQ-J002-1 and OQ-J002-6
> are blocking DESIGN deliverables before DELIVER can start on their
> dependent slices.

---

## TL;DR for the next architect

You inherit:

* A **deep-dive journey** (J-002 Project + Chat Session
  Management) fully specified — 12-state machine, 7 integration
  checkpoints, 7 failure modes, embedded Gherkin per state.
* **10 LeanUX stories** (US-201..US-210) with DoR-passing AC,
  sized 1.5-3 days each.
* **6 outcome KPIs** with baselines + measurement plans.
* **6 carpaccio slices** with per-slice briefs at `slices/*.md`.
* The **J-002 journey-yaml SSOT** at
  `docs/product/journeys/project-and-chat-session-management.yaml`
  (promoted by this wave from the catalog entry).
* The **JOB-002 inheritance** confirmed — J-002 is the second
  journey under the existing strategic JOB-002; no JOB-003 is
  bootstrapped.

You are responsible for **two blocking DESIGN decisions**
(OQ-J002-1 storage shape; OQ-J002-6 stale-intent filter) and
**four non-blocking DESIGN decisions** (OQ-J002-2 multi-tab
safety, OQ-J002-3 direct route vs projection, OQ-J002-4
partial-result resolution, OQ-J002-5 last-used read shape).

> **The substrate is already standing up.** ADR-027/028/029/030
> ratify the architecture; J-002 plugs into the orchestrator
> registered at `ui-state/index.ts:29-60` without modifying it.
> **DESIGN does NOT need to re-litigate framework choice.** Your
> work is at the J-002-internal level — machine state contracts,
> projection shape extensions, and the two blocking OQs.

---

## Hard constraints carried into DESIGN

1. **D8 (carried from J-001)**: The agent stays the chat brain.
   `agent/lib/chat/handleChat.ts` gains the X-Active-Scope
   middleware (per US-208) but no flow logic. The agent does NOT
   host the J-002 machine. The chat-turn streaming, the Groq SSE,
   the tool dispatch in `agent/lib/chat/dispatchers/index.ts` all
   stay agent-internal.

2. **D9 (this wave)**: J-002 owns chat-session multi-turn state
   including the `resolve_dataset` re-submission loop's state.
   The agent stays stateless per D8. See `wave-decisions.md` §D9
   for the rationale.

3. **D10 (this wave)**: Org-switching is deferred to a future
   J-NNN flow. J-002 does NOT include it. ADR-029 invariant 1
   already enforces JWT-claim parity; an `org_switched` signal
   (future) resets every machine via orchestrator broadcast.

4. **ADR-028:46-48**: No machine imports another machine. J-002's
   FREEZE handler reads only the orchestrator-broadcast event;
   it does not import the J-001 machine.

5. **ADR-029 §1 invariants 1-5**: ScopeResolver invariants are
   binding for every J-002 state that materializes `active_scope`.

---

## Artifacts produced (this wave)

### Feature-level (`docs/feature/project-and-chat-session-management/discuss/`)

* `wave-decisions.md` — entry-point rationale, scope-management
  strategy, D8-D12 decisions (D9 resolving research Open Q#2;
  D10 resolving Open Q#3; D11 storage-shape flagged; D12
  naming).
* `jtbd-job-stories.md` — 8 J-002-specific job stories (J002-Job-1
  through J002-Job-8); composes under JOB-002 strategic job; full
  bridge to user stories.
* `jtbd-four-forces.md` — push/pull/anxiety/habit per job story
  with in-repo evidence.
* `jtbd-opportunity-scores.md` — ODI-style scoring; 4
  under-served jobs (J002-Job-1, 2, 4, 6) shape Slice prioritization.
* `journey-inventory.md` — J-002 deep-dive entry; carries the
  J-001 catalog as unchanged context; updates the scope-dependency
  table.
* `journey-project-and-chat-session-management.yaml` — the journey
  contract (states, transitions, shared artifacts, integration
  checkpoints, failure modes, testing surface).
* `journey-project-and-chat-session-management-visual.md` — TUI
  scenes + emotional arc + state-map ASCII.
* `journey-project-and-chat-session-management.feature` —
  embedded Gherkin scenarios for the journey (the acceptance-test
  seed for DISTILL).
* `shared-artifacts-registry.md` — J-002 deltas (project_id,
  resource_*, session.id, session.list, session.title,
  session.active_dataset_id, project.name, project.list); cross-cutting
  consumed-not-redeclared artifacts referenced.
* `story-map.md` — backbone + 6 carpaccio slices + walking
  skeleton.
* `slices/slice-{01..06}-*.md` — per-slice briefs (≤100 lines
  each).
* `stories/US-{201..210}.md` — 10 user stories with embedded AC +
  Elevator Pitch + UAT scenarios + outcome KPIs + technical notes.
* `outcome-kpis.md` — 6 KPIs (K-J002-1..6); north-star K-J002-4;
  instrumentation handoff to DEVOPS.
* `prioritization.md` — per-slice ordering rationale.
* `dor-validation.md` — 9-item DoR per story; ALL PASSED.
* `handoff-design.md` — this file.

### SSOT updates (committed to product SSOT roots)

* `docs/product/journeys/project-and-chat-session-management.yaml`
  — the journey contract promoted from feature SSOT.
* `docs/product/journeys/_inventory.md` — J-002 row promoted from
  `catalog` to `active`.
* `docs/product/jobs.yaml` — **NO CHANGE**. J-002 inherits JOB-002
  verbatim; no JOB-003 added by this wave. The journey YAML's
  `job_references` cites JOB-002 as primary and JOB-001 as
  compositional.

---

## What's solid (you can build directly on this)

* The **state-machine contract** at
  `journey-project-and-chat-session-management.yaml` is the
  architectural skeleton J-002 implements. 12 states + 1
  side-state + 2 exit transitions; each transition's `on` event
  and `to` state are explicit.
* The **integration checkpoints IC-J002-1 through IC-J002-7** are
  the cross-state invariants — they're the test surface for the
  machine. The TS harness should expose these as assertions.
* The **shared artifacts registry** declares every `${variable}`
  in scope with a single source of truth. If a J-002 transition
  doesn't update one of these per the registry, it's a contract
  violation.
* The **outcome-kpis.md instrumentation list** is ready for
  DEVOPS to scope into a sub-wave spike.

## What's open (DESIGN must answer)

### OQ-J002-1: Session-metadata storage shape for `active_dataset_id` *(BLOCKING for Slice 2 + Slice 5 DELIVER)*

**Cutover deadline**: DESIGN must close OQ-J002-1 **before Slice 2
DELIVER begins**. If Option B or Option C is chosen, the schema
migration (Option B) or Stream.io adapter wire-up (Option C) is on
the critical path for Slice 2 AND blocks Slice 5 (which depends on
the same storage shape for the write path).

Three options:

* **Option A**: New `active_dataset_id` column on the session row.
  Simplest. Requires Alembic migration. Reads via existing
  `get_session(session_id)`; writes via extension of
  `update_session(session_id, {active_dataset_id: <id>})`.
* **Option B**: Side-log table `session_dataset_attachments`
  with `(session_id, dataset_id, attached_at)` rows. More
  auditable; supports history; bigger schema delta.
* **Option C**: Denormalization from session-event stream
  (Stream.io-backed). Requires the Stream.io reader from
  `backend/app/use_cases/session/event_replay.py` to be wired
  beyond noop. Highest conceptual purity; biggest infra
  dependency (gates DELIVER on Stream.io adapter availability).

**Recommended posture** (PO's read): **Option A** for PR-0. It's
the smallest schema delta + the easiest acceptance-test mock.
The history-aware option B is a future-extensible shape if
session-dataset history becomes a feature; option C is a Stream.io
infrastructure project, not a J-002 deliverable.

### OQ-J002-6: Stale-intent filter rule after THAW *(BLOCKING for Slice 6 DELIVER)*

When the orchestrator replays queued intents on THAW, J-002 may
no longer be in the state where those intents made sense (e.g.,
a `session_clicked` for a session in a project the user switched
away from during the freeze window). Three sub-questions:

1. **Which intents are "stale" after a THAW?** — Recommended
   algorithm (carry into the application-architecture doc):

   > An intent is stale if its target id is not resolvable in
   > J-002's post-THAW state. Specifically:
   > - For `session_clicked` events: the session_id is checked
   >   against the current project's session list. If absent
   >   (session deleted, OR session belongs to a project the user
   >   switched away from during the freeze), the intent is stale.
   > - For `switching_project_intent` events: the new project_id
   >   is checked against the user's project list. If absent
   >   (project deleted OR access revoked), the intent is stale
   >   AND transitions to `scope_mismatch_terminal` (the same
   >   path as US-204b cross-tenant).
   > - For `dataset_resolved_by_agent` and
   >   `dataset_picked_directly` events: the resource_id is checked
   >   against ScopeResolver invariant 4. If 403, the intent is
   >   stale.
   > - For `new_session_clicked` events: never stale; the intent
   >   only requires the current project context which is
   >   guaranteed by the post-THAW state.
   > - For `first_message_sent` events: stale if `state.session_id`
   >   is no longer null AND the prior session_active state was
   >   replaced during the freeze (e.g., user resumed a different
   >   session via another intent).

2. **Replay order**: FIFO, unordered, or "last-write-wins per
   intent type"? — Recommended: **FIFO with stale-filter applied
   per intent at replay time**. Last-write-wins semantics emerge
   naturally: if two `session_clicked` intents arrive for sessions
   A and B in that order, both replay; J-002 settles on B's
   `session_active` state because A's transition is overwritten by
   B's.

3. **User-visible behavior of a stale-intent-drop**: silent
   observability, toast, or error_recoverable transition? —
   Recommended: **silent observability** via
   `stale_intent_dropped_after_thaw` event. UX is "the user's
   click that no longer makes sense is dropped without ceremony,
   matching the muscle-memory shape of clicking-during-network-blip."

   **Falsifiability**: the TS harness gains
   `harness.j002.assert_stale_intent_dropped(event_type,
   target_id)` for explicit assertion; the
   `stale_intent_dropped_after_thaw` event is the observability
   surface.

### Non-blocking DESIGN OQs

| OQ | Question | Why it matters | Recommended posture |
|----|----------|----------------|---------------------|
| OQ-J002-2 | **Multi-tab safety**: should J-002's flow_id extend from `(machine, principal_id)` to `(machine, principal_id, tab_id)`? | Two tabs in different projects could see `active_scope` drift on the orchestrator side | Today's product has no multi-tab affordance; flag for future. The orchestrator's principal-id keying (ADR-027 §3 amendment) is correct for single-tab. |
| OQ-J002-3 | **Direct route vs J-002 projection** for `/projects` and `/sessions` listing pages | The Projects grid + Chats page can read directly from `list_projects` / `list_sessions`, OR through J-002's projection. Direct read is simpler but bypasses J-002's scope coherence guarantees | Recommend: J-002 projection for routes inside the app-shell layout (always-consistent scope); direct read for the top-level Chats page (org-wide list, no project context). |
| OQ-J002-4 | **Partial-result last-used resolution**: when `list_sessions` for one project fails 503, fall back to remaining projects' most-recent, OR transition to `error_recoverable`? | US-202's Example 4 commits to partial-result with `last_used_resolution_degraded` event | Recommend: partial-result (no blocking on transient backend failures); the algorithm is "max(successful)" — a single failure doesn't poison the resolution. |
| OQ-J002-5 | **Most-recent-session-per-project read shape**: should J-002's projection eagerly compute `most_recent_session_per_project` for the user's projects, or compute lazily at last-used resolution time? | Eager: projection is larger but resolution is O(1). Lazy: projection is small but resolution does N `list_sessions(limit=1)` calls | Recommend: lazy (N is bounded by the user's project count, typically <10; eager precomputation is overengineered for PR-0). |

---

## Constraints inherited from the architecture brief and prior ADRs

| ADR | Constraint | How J-002 respects it |
|-----|-----------|------------------------|
| ADR-014 | ChatEvent vocabulary stratified into DomainEvent/UiDirective | J-002 machine transitions emit `DomainEvent`s (`project_selected`, `session_resumed`, `dataset_resolved_by_agent`, `switching_project`, etc.); the agent's directive log is unchanged. |
| ADR-015 | Per-channel reflect-only directive log | J-002 has its own flow-event log; the agent's per-channel log is untouched. Two distinct Redis key prefixes. |
| ADR-016 | Auth-proxy as sole ingress | J-002's projection endpoints `/api/flows/project-session-mgmt:*` are routed by auth-proxy; no test-only backdoor. |
| ADR-018 | Capability-presence dispatch | J-002's flow-event log uses `selectFlowEventStore` (same dispatch as J-001). |
| ADR-027 | UI-state tier + Remix | J-002 lives at `ui-state/lib/machines/project-and-chat-session-management.ts`; route loaders read its projection. |
| ADR-028 | XState v5 actor model | J-002 declares actors per the v5 pattern; orchestrator broadcasts FREEZE/THAW; J-002 does NOT import J-001. |
| ADR-029 | `active_scope` contract | J-002 produces `project_id` + `resource_*`; honors invariants 1-5. |
| ADR-030 | Single-replica topology | J-002 uses `flow_id = "project-and-chat-session-management:<user_id>"` per the per-user keying. |

---

## Test surface inherited

* **Python `DatasetLayerHarness`** stays as the backend+agent
  contract guard (JOB-001). It is NOT extended by J-002 except for
  one new method `chat_turn_with_scope_header(scope, message)`
  used by US-208's acceptance test (validates the agent's
  X-Active-Scope reading).
* **TS `UserFlowHarness`** (live from J-001) gains J-002-specific
  operations in a new `harness.j002` namespace (see the journey
  YAML's `testing_surface.ts_harness.operations` list). Composes
  with `harness.user_flow` for J-001+J-002 end-to-end tests.

---

## DEVOPS handoff (platform-architect)

See `outcome-kpis.md` for instrumentation specs. Specifically:

* **9 FE events** + **2 agent events** + **5 ui-state events** to
  instrument.
* **3 real-time dashboards** (K-J002-4 north star, K-J002-5
  guardrail, K-J002-6 substrate amortization).
* **3 paging alerts** (cross-project chat-turn rate > 0; K-J002-5
  missing-scope rejection > 1% post-migration; K-J002-4
  atomic-switching < 99%).
* **Baseline gap**: all K-J002-* have no current instrumentation;
  budget a one-day spike to land instrumentation BEFORE the
  agent-contract slice (Slice 4) so before/after measurement is
  possible.

---

## DISTILL handoff (acceptance-designer)

The acceptance-designer (Quinn in J-001's wave) gets:

* `journey-project-and-chat-session-management.yaml` — embedded
  Gherkin per state is the acceptance-test seed.
* `journey-project-and-chat-session-management.feature` — 25+
  Gherkin scenarios for the full journey; ready for translation
  into pytest-bdd acceptance tests.
* 10 stories with 5-6 UAT scenarios each = ~55 Gherkin scenarios
  ready for property-shaped + happy-path coverage.
* 7 integration checkpoints (IC-J002-1..7) — property-shaped
  invariants; should land as `@property`-tagged scenarios.
* `outcome-kpis.md` — used by DISTILL to assert the measurement
  contract is achievable from inside acceptance tests where
  applicable (e.g., K-J002-2's "≤300ms" is testable end-to-end).

---

## Risks (carried forward to DESIGN)

| # | Risk | DESIGN owns |
|---|------|-------------|
| R1 (carried) | DIVERGE skipped — DESIGN may surface options requiring re-frame | The substrate is ratified; DESIGN's scope is J-002-internal. Re-frame is unlikely; if it surfaces, escalate. |
| R2 (this wave) | Session-metadata storage shape (D11) is a NEW schema decision | OQ-J002-1; recommend Option A. |
| R3 (this wave) | Agent contract enforcement lands FIRST TIME in J-002 — middleware regressions could break J-001 | The middleware is purely additive; J-001 has no chat-turn surface, so a J-001 regression is impossible. J-002 acceptance tests are the gate. |
| R4 (this wave) | Stale or cross-tenant deep-links must hit ScopeResolver invariant 4 (403 + named diagnostic), not blank page | US-204 + scope_mismatch_terminal contract. Acceptance test at `tests/acceptance/.../test_scope_reconciliation.py` will gate. |
| R5 (this wave) | Stream.io reader is noop today — dataset-context restoration may need it depending on OQ-J002-1 choice | OQ-J002-1 Option A avoids; Options B/C require Stream.io adapter ahead of DELIVER. |
| R6 (this wave) | `resolve_dataset` re-submission loop's multi-turn shape moves from FE to J-002 — requires one event-emission change in the FE | One-line change; documented in US-209. Bounded risk. |
| R7 (this wave) | Multi-tab drift on `active_scope` if two tabs open in different projects | OQ-J002-2; flag for future; current product has no multi-tab affordance. |
| R8 (this wave; surfaced by reviewer) | Backwards-compat fallback in US-208 (one release reading `project_id` from body) could mask scope violations from unmaintained clients (e.g., legacy Jupyter notebooks, ad-hoc curl scripts) — they never upgrade and the fallback stays active indefinitely | Mitigation: (a) instrument `scope_header_fallback_used` as a paging alert with a per-client-identifier rollup; (b) make the migration window a hard deadline — the fallback flag has a sunset date tied to a specific release version, and `agent/lib/chat/handleChat.ts` includes a compile-time check that fails if the sunset date has passed (forces the flag-removal change to land on time); (c) proactively audit `tests/acceptance/**/` AND known headless callers before the sunset date. |
| R9 (this wave; surfaced by reviewer) | Session-list pagination cache invalidation on project-switch is implicit (TanStack Query cache keyed by project_id; cache must clear BEFORE the new project's `loading_session_list` fires) — if not explicit, a race window exists | US-207 should add an AC: "Before `loading_session_list` fires for the new project, the FE's TanStack Query cache for `list_sessions(old_project_id)` is invalidated (or refetched on stale)." Tracked here for DESIGN consideration in the application-architecture doc. |

---

## Open questions for the user (if any surface during DESIGN)

* **OQ-J002-1 (storage shape)** is the user's call if DESIGN's
  recommendation (Option A) is suboptimal for an unstated
  history-tracking requirement. Surface immediately if so.
* **OQ-J002-6 (stale-intent filter)** is bounded; DESIGN should
  pick the recommended posture and proceed unless a stronger
  signal emerges.
* Other OQs are non-blocking; DESIGN owns the calls.

---

## Suggested DESIGN deliverables

1. **J-002 application-architecture doc** at
   `docs/feature/project-and-chat-session-management/design/application-architecture.md`,
   mirroring J-001's pattern. Covers:
   - Resolution of OQ-J002-1 (the load-bearing one).
   - Resolution of OQ-J002-6.
   - Sketch of the XState v5 machine in TypeScript (using the
     same `setup({...}).createMachine(...)` pattern as J-001 at
     `ui-state/lib/machines/login-and-org-setup.ts`).
   - Projection-shape extensions (J-002 fields layered on the
     `FlowProjection` envelope from ADR-027:111-121).
   - Reuse of existing ScopeResolver vs new ScopeResolver
     additions.

2. **C4 Component diagram** updated to show J-002 alongside J-001
   in the orchestrator's actor tree; how `active_scope.project_id`
   flows from J-002 → projection → Remix loader → FE shell + agent.

3. **Domain model deltas** — if D11 picks Option A, the new
   `active_dataset_id` column on the session row; if Option B,
   the new `session_dataset_attachments` table.

4. **Alembic migration plan** (if D11 picks Option A or B) — the
   schema delta is bounded; one migration per
   `backend/migrations/versions/`.

5. **No new ADR needed** by default — J-002 fits inside the
   existing ADR-027/028/029/030 envelope. An ADR would be
   warranted if D11 picks Option C (Stream.io adapter wire-up is
   architecturally consequential).

After DESIGN's application-architecture.md lands, DISTILL can
start writing the acceptance tests.
