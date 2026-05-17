# Definition-of-Ready Validation — `project-and-chat-session-management` (J-002)

> **Wave**: DISCUSS
> **Date**: 2026-05-13
> **Reviewer**: Luna (nw-product-owner, self-validation pass)

Per DoR hard gate (from `nw-discuss` Phase 3 step 5): each story
must pass all 9 items with evidence before DESIGN-wave handoff.

The 9 DoR items (inherited from J-001's pattern):

1. Problem statement clear, domain language
2. User/persona identified with specific characteristics
3. 3+ domain examples with real data
4. UAT in Given/When/Then (3-7 scenarios)
5. AC derived from UAT
6. Right-sized (1-3 days, 3-7 scenarios)
7. Technical notes (constraints/dependencies)
8. Dependencies resolved or tracked
9. Outcome KPIs defined with measurable targets

PLUS Elevator Pitch Dimension-0 test (3-line block with real entry
point + concrete output + job connection).

---

## US-201: First-time-in-org user lands in no-projects empty state

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem clear | PASS | "Maya just completed J-001... the FE app shell renders with a blank main pane and no clear next step." Concrete; domain-grounded. |
| 2 | Persona identified | PASS | Maya (first-time-in-org) — fresh JWT, zero projects, completed J-001 in the last minute. |
| 3 | 3+ domain examples | PASS | Three: happy (create "Q4 Analytics"), edge (backend 503 transient), boundary (empty-name validation). Real persona, real backend endpoints. |
| 4 | UAT G/W/T | PASS | 5 scenarios. |
| 5 | AC derived from UAT | PASS | 7 ACs, each traceable. |
| 6 | Right-sized | PASS | ~2 days; 5 scenarios. Within window. |
| 7 | Technical notes | PASS | Depends on J-001 ready + J-002 registration + existing `list_projects`/`create_project`. |
| 8 | Dependencies tracked | PASS | J-001 DELIVER complete (in place); no external dependency. |
| 9 | Outcome KPIs defined | PASS | Inherits K-J002-1 (degraded path for zero projects); has its own conversion-rate KPI in the story. |

**Elevator Pitch Test**: PASS — Before/After/Decision-enabled lines present; "Welcome to Acme Data, Maya! Let's get started by creating your first project." is a concrete observable output.

**DoR Status: PASSED**

---

## US-202: Returning user lands in last-used project on sign-in

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem clear | PASS | "Maya has been using Dashboard Chat for a week... 3-4 clicks of 'the app forgot where I was yesterday.'" |
| 2 | Persona identified | PASS | Maya (returning) — one or more projects; opens a fresh tab. |
| 3 | 3+ domain examples | PASS | Five examples: happy, edge (no sessions in any project), edge (tie-broken timestamps), boundary (transient `list_sessions` failure), with real project names. |
| 4 | UAT G/W/T | PASS | 5 scenarios. |
| 5 | AC derived from UAT | PASS | 7 ACs. |
| 6 | Right-sized | PASS | ~3 days; 5 scenarios. At upper boundary. |
| 7 | Technical notes | PASS | Resolution algorithm depends on `list_projects` + per-project `list_sessions(limit=1)`; tie-broken by lexicographic id; partial-result degradation flagged. |
| 8 | Dependencies tracked | PASS | Substrate in place; OQ-J002-5 (read shape) tracked for DESIGN. |
| 9 | Outcome KPIs defined | PASS | K-J002-1 (project chip first-paint ≤800ms p95). |

**Elevator Pitch Test**: PASS.

**DoR Status: PASSED**

---

## US-203: Session list renders sorted by recency on project entry

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem clear | PASS | The chat-first-ui.feature requirements (lines 60, 64-68) are scattered across FE/Python harness/Context; J-002 consolidates. |
| 2 | Persona identified | PASS | Maya (returning, in a project with sessions) + Maya (in a project with zero sessions). |
| 3 | 3+ domain examples | PASS | Four: happy (Q4 with 4 sessions), edge (zero sessions), edge (50+ sessions), boundary (cross-tab session creation). |
| 4 | UAT G/W/T | PASS | 6 scenarios. |
| 5 | AC derived from UAT | PASS | 7 ACs. |
| 6 | Right-sized | PASS | ~2.5 days; 6 scenarios. At upper boundary. |
| 7 | Technical notes | PASS | Depends on `list_sessions` (exists) + projection stream from ADR-027 §1. |
| 8 | Dependencies tracked | PASS | OQ-J002-3 (direct route vs J-002 projection for /sessions listing) flagged in handoff. |
| 9 | Outcome KPIs defined | PASS | First-paint together with project chip at p99; cross-tab refresh ≤1s p95. |

**Elevator Pitch Test**: PASS.

**DoR Status: PASSED**

---

## US-204: Cold deep-link resolves active_scope before paint (and named-diagnostic for stale/cross-tenant)

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem clear | PASS | Deep links today land on a blank shell → fetch → re-render; stale/cross-tenant landing is unpredictable. |
| 2 | Persona identified | PASS | Maya (deep-link visitor) + Maya (cross-tenant accident — clicking a Slack link). |
| 3 | 3+ domain examples | PASS | Five: happy, cross-tenant Slack link, stale (project deleted), access-revoked, deep link with intent_resource_id. |
| 4 | UAT G/W/T | PASS | 6 scenarios. |
| 5 | AC derived from UAT | PASS | 8 ACs. |
| 6 | Right-sized | PASS (at boundary) | ~3 days; 6 scenarios. At upper boundary; story-size note flags US-204a (happy) + US-204b (failure) clean split if needed. |
| 7 | Technical notes | PASS | Depends on Remix loader pattern (ADR-029 §2 Option D) + ScopeResolver invariant 4 (per ADR-029). |
| 8 | Dependencies tracked | PASS | Substrate in place. |
| 9 | Outcome KPIs defined | PASS | K-J002-2 (deep-link resolution outcomes ≤300ms p95; 100% named-diagnostic on invalid). |

**Elevator Pitch Test**: PASS.

**DoR Status: PASSED** *(at boundary)*

---

## US-205: Resuming a session restores transcript and dataset context

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem clear | PASS | `features/chat-first-ui.feature:109-113` is documented; `update_session.py:50-52` shows it's unimplemented. The user's failure mode (re-typing "the patients table") is concrete. |
| 2 | Persona identified | PASS | Maya (returning, resuming a specific session). |
| 3 | 3+ domain examples | PASS | Five: happy, edge (no stored dataset), edge (deleted dataset graceful), edge (cross-project anomaly), cross-flow (token expiry — covered by US-210). |
| 4 | UAT G/W/T | PASS | 5 scenarios. |
| 5 | AC derived from UAT | PASS | 8 ACs. |
| 6 | Right-sized | PASS (at boundary) | ~3 days; 5 scenarios. At upper boundary; story-size note flags US-205a/b split if needed. |
| 7 | Technical notes | PASS | Depends on US-203 + OQ-J002-1 (D11 storage shape resolved by DESIGN before DELIVER). |
| 8 | Dependencies tracked | PASS | OQ-J002-1 explicitly flagged; Slice 2 brief enumerates options A/B/C. |
| 9 | Outcome KPIs defined | PASS | K-J002-3 (transcript + dataset chip together at p95 ≥95%). |

**Elevator Pitch Test**: PASS.

**DoR Status: PASSED** *(at boundary; gated on OQ-J002-1 resolution)*

---

## US-206: New session lifecycle (lazy create + title from first message)

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem clear | PASS | Eager-create produces ghost rows; lazy-create-with-title-from-first-message reconciles `features/chat-first-ui.feature:36-41` with `features/chat-first-ui.feature:142-145`. |
| 2 | Persona identified | PASS | Maya (starting a fresh conversation). |
| 3 | 3+ domain examples | PASS | Five: happy, edge (navigate away without typing), edge (click an existing session from `session_active_no_messages`), boundary (transient `create_session` failure), edge (single-character first message). |
| 4 | UAT G/W/T | PASS | 6 scenarios. |
| 5 | AC derived from UAT | PASS | 8 ACs. |
| 6 | Right-sized | PASS | ~2 days; 6 scenarios. |
| 7 | Technical notes | PASS | Depends on US-203; uses existing `create_session` + `update_session`. |
| 8 | Dependencies tracked | PASS | No external dependencies. |
| 9 | Outcome KPIs defined | PASS | Welcome-paint ≤150ms p95; 0 ghost session rows (a contract, not a metric to optimize). |

**Elevator Pitch Test**: PASS.

**DoR Status: PASSED**

---

## US-207: User switches projects atomically — scope retargets

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem clear | PASS | The canonical ChatView project-context race (`adr-027:14`) — Maya clicks Q3 and the chip + list disagree briefly. Documented; daily-observed. |
| 2 | Persona identified | PASS | Maya (in `session_active`, switching). |
| 3 | 3+ domain examples | PASS | Five: happy (nav click), happy (deep-link mid-session), edge (chat-turn in flight at switch), edge (switch to scope_mismatch_terminal), cross-flow (token expiry during switch — US-210). |
| 4 | UAT G/W/T | PASS | 5 scenarios. |
| 5 | AC derived from UAT | PASS | 7 ACs. |
| 6 | Right-sized | PASS | ~2.5 days; 5 scenarios. |
| 7 | Technical notes | PASS | SSE cancellation contract specified; depends on Slice 1 (project_selected). |
| 8 | Dependencies tracked | PASS | OQ-J002-6 (stale-intent filter after THAW) flagged. |
| 9 | Outcome KPIs defined | PASS | K-J002-4 NORTH STAR (atomic switching at p99; 0 cross-project chat-turns). |

**Elevator Pitch Test**: PASS.

**DoR Status: PASSED**

---

## US-208: Chat-agent invocation carries active_scope; agent rejects missing scope

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem clear | PASS | `agent/lib/chat/handleChat.ts:75` reads `project_id` from body without validation — cross-tenant data-leak surface. ADR-029 §4 specifies the fix; J-002 ships it. |
| 2 | Persona identified | PASS | Maya (any user sending a chat turn) + developer writing tests + security-minded operator. |
| 3 | 3+ domain examples | PASS | Six: happy, dataset-attached, missing header, missing project_id, mismatched org_id (403), backwards-compat migration window. |
| 4 | UAT G/W/T | PASS | 6 scenarios. |
| 5 | AC derived from UAT | PASS | 7 ACs. |
| 6 | Right-sized | PASS (at boundary) | ~2.25 days; 6 scenarios. Story-size note flags US-208a/b split if migration logic is heavier. |
| 7 | Technical notes | PASS | Depends on Slice 1 (Remix loader pattern); affects agent middleware; migration-window flag detailed. |
| 8 | Dependencies tracked | PASS | Migration-tracking dataset (`tests/acceptance/**/`) flagged in SPIKE. |
| 9 | Outcome KPIs defined | PASS | K-J002-5 (100% scope-carrying turns; 0 cross-tenant). |

**Elevator Pitch Test**: PASS — entry point is the existing `POST
/chat`; concrete output is the 400/403 response bodies AND the
`X-Active-Scope` header presence.

**DoR Status: PASSED**

---

## US-209: Dataset context switching via agent's resolve_dataset OR direct selection

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem clear | PASS | The FE state for "currently resolved dataset" is scattered across TanStack Query, route param, React Context — the canonical drift surface. |
| 2 | Persona identified | PASS | Maya (in `session_active`, no dataset attached) + Maya (in `session_active`, switching datasets). |
| 3 | 3+ domain examples | PASS | Six: happy (agent path), happy (direct path), failure (cross-tenant), failure (cross-project), edge (concurrent picks), cross-flow (token expiry — US-210). |
| 4 | UAT G/W/T | PASS | 6 scenarios. |
| 5 | AC derived from UAT | PASS | 6 ACs. |
| 6 | Right-sized | PASS (at boundary) | ~2.5 days; 6 scenarios. |
| 7 | Technical notes | PASS | Depends on US-205 (D11 storage) + US-208 (X-Active-Scope contract); FE wire-up is one event-emission. |
| 8 | Dependencies tracked | PASS | OQ-J002-1 from Slice 2 cascades here. |
| 9 | Outcome KPIs defined | PASS | 100% resolution persistence at p99; 100% cross-tenant rejection at p99. |

**Elevator Pitch Test**: PASS.

**DoR Status: PASSED**

---

## US-210: J-002 honors FREEZE/THAW from J-001's expired_token

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem clear | PASS | Without FREEZE participation, J-002 mid-mutation expiries surface as 401 errors. The architectural payoff from ADR-028 §94 ("5-line `system.get(...).send(...)` loop") is what this story validates. |
| 2 | Persona identified | PASS | Maya (in any active J-002 state, JWT expires mid-mutation). |
| 3 | 3+ domain examples | PASS | Five: happy (token expiry during session resume), happy (during project switch), edge (silent re-auth fails), edge (multiple intents queued), edge (FREEZE during non-mutating state). |
| 4 | UAT G/W/T | PASS | 6 scenarios. |
| 5 | AC derived from UAT | PASS | 8 ACs. |
| 6 | Right-sized | PASS (at boundary) | ~2.5 days; 6 scenarios. |
| 7 | Technical notes | PASS | Depends on US-201..US-209; substrate from J-001's DELIVER is in place; OQ-J002-6 (stale-intent filter) flagged. |
| 8 | Dependencies tracked | PASS | OQ-J002-6 is the load-bearing DESIGN decision. |
| 9 | Outcome KPIs defined | PASS | K-J002-6 ≥95% silent recovery; 0 re-clicks. |

**Elevator Pitch Test**: PASS.

**DoR Status: PASSED** *(at boundary; gated on OQ-J002-6 resolution before Slice 6 starts DELIVER)*

---

## Overall DoR Status

**ALL 10 STORIES: PASSED**

* 10/10 stories have all 9 DoR items passing.
* 10/10 stories pass the Elevator Pitch Dimension-0 test.
* 0/10 slices are `@infrastructure`-only — every slice has at least
  one user-facing story OR a developer-facing harness/contract
  story.

### Boundary cases (right-sized at upper boundary)

The following stories are AT the upper boundary of right-sized
(7 scenarios OR ~3 days), with clean splits documented in their
story-size notes:

* **US-202** (~3 days; 5 scenarios) — splits cleanly into
  US-202a (last-used resolution) + US-202b (degraded
  partial-result resolution) if implementation reveals the
  algorithm is heavier than expected.
* **US-203** (~2.5 days; 6 scenarios).
* **US-204** (~3 days; 6 scenarios) — splits cleanly into
  US-204a (happy) + US-204b (failure) per the story-size note.
* **US-205** (~3 days; 5 scenarios; gated on OQ-J002-1).
* **US-208** (~2.25 days; 6 scenarios; splits into 208a/b for
  migration-window logic if heavier).
* **US-209** (~2.5 days; 6 scenarios).
* **US-210** (~2.5 days; 6 scenarios; gated on OQ-J002-6).

### DESIGN-deferred items that must resolve before DELIVER

These OQs are flagged in `handoff-design.md` and MUST land in the
DESIGN-wave ADR/architecture-doc before their dependent slice can
start DELIVER:

* **OQ-J002-1** (session-metadata storage shape) → Slice 2 + Slice 5.
* **OQ-J002-6** (stale-intent filter rule) → Slice 6.

Other OQs (J002-2 multi-tab safety, J002-3 direct route vs
projection for /sessions, J002-4 last-used partial-result, J002-5
projection read shape for most-recent-session-per-project) are
non-blocking — DESIGN owns them but they don't gate any slice.

### OQ-J002-5 — CLOSURE (2026-05-17, reconciliation pass; ratified)

OQ-J002-5 ("projection read shape for most-recent-session-per-project",
flagged non-blocking above) is **RESOLVED**.

RESOLUTION: DESIGN chose **projection-carries** (not
orchestrator-queries). `context.most_recent_session_per_project` is an
IN-CONTRACT field of the `project-context` projection, "Populated when
`resolving_initial_scope` exit", functional consumer US-202 last-used
resolution (`design/application-architecture.md:1078`). Per
ADR-027 §"TS harness symmetry" and ADR-029 §"TS harness assertion
surface", a field in the projection context table is read by the
harness and the FE identically — it is in-contract, not
instrumentation-only.

PINNED SHAPE (residual sub-shape, pinned here so the contract is
unambiguous for TDD): a map **keyed by `project_id`** (ids are stable
per `US-202.md` Technical notes; names are not), value =
`{ session_id: string, last_active_at: string }` — the descriptor the
US-202 last-used resolution and the FE Projects grid sort hint consume.
US-202's narrative example is name-keyed for readability only and is
NOT the wire shape.

EFFECT: the
`test_us202…test_resolution_picks_project_carrying_most_recent_session`
read-shape assertion (`q4_id in
context.most_recent_session_per_project`) is IN-CONTRACT →
GENUINE-UNIMPLEMENTED, not DEFERRED. Ratified by the overseer
2026-05-17 (proposal:
`docs/feature/j002-d6-oq5-reconciliation/discuss/reconciliation-proposal.md`).

### Ready for peer review and DESIGN handoff

This document closes out the DoR gate. The next step is
`nw-product-owner-reviewer` (Eclipse) running on these artifacts;
their feedback informs the final version saved at
`review-by-product-owner.md`.

After reviewer approval, the artifacts hand off to:

* **DESIGN** (nw-solution-architect) — receives the full artifact
  set. Resolves OQ-J002-1, OQ-J002-2, OQ-J002-3, OQ-J002-4,
  OQ-J002-5, OQ-J002-6 before DISTILL.
* **DEVOPS** (nw-platform-architect) — receives `outcome-kpis.md`
  for instrumentation planning.

`handoff-design.md` is the handoff package.
