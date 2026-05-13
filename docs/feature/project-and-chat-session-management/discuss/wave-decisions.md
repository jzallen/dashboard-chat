# Wave Decisions — `project-and-chat-session-management` (J-002)

> **Wave**: DISCUSS
> **Date**: 2026-05-13
> **Author**: Luna (nw-product-owner) on the `prospector` crew workspace
> **Branch**: `discuss/project-and-chat-session-management`

This document captures the entry-point decisions, scope-management
strategy, and prior-wave consultation results that frame the DISCUSS
artifacts for **J-002 — project + chat session management**. It is not
a story — it is the audit trail explaining why this feature entered
at DISCUSS (skipping DISCOVER and DIVERGE), why specific scope
boundaries were drawn, and which prior ADRs constrain the downstream
DESIGN wave.

J-002 is the **second** flow promoted from the catalog at
`docs/product/journeys/_inventory.md` — the first was J-001
(`login-and-org-setup`), which shipped 2026-05-12 through the full
DISCUSS → DELIVER cycle (archived at
`docs/evolution/2026-05-12-user-flow-state-machines/`). The
substrate cost — `ui-state/` Hono tier (ADR-027), XState v5 actor
model (ADR-028), `active_scope` propagation contract (ADR-029),
single-replica topology (ADR-030) — is **fully amortized**. J-002
adds exactly one new machine to a substrate built to accept N.

---

## D1 — Feature type

**User-facing.** J-002 controls how Maya (and every other returning
user) reaches her chat surface after authenticating. The behavior
changes the route shape (cold deep-links resolve scope before paint),
the chat-shell composition (project chip + session list + welcome
state), and the per-turn agent contract (every chat-agent invocation
carries `active_scope.project_id` from the same source the FE shell
reads). Both end-users and developers writing acceptance tests
observe the change.

## D2 — Entry-point wave

**DISCUSS** (skipping DISCOVER and DIVERGE).

This codebase is brownfield (CLAUDE.md routes new features to DISCUSS
unless multiple solution paths are viable) and the architectural
substrate for J-002 is already ratified by ADRs 027–030. There is no
solution-space uncertainty at the framework level — Remix +
`ui-state/` Hono tier + XState v5 + `active_scope` is the established
host. The only open product-space questions are:

1. What states does the J-002 machine carry? (DISCUSS answers.)
2. Does the chat surface get its own machine? (D8 below answers.)
3. Does org-switching belong here? (D9 below answers.)

A DIVERGE pass would not surface a meaningfully different option set
inside the bounds the existing ADRs impose. **DIVERGE is therefore
skipped, but flagged as a noted risk (R1).**

## D3 — Walking-skeleton vs brownfield-extension

**Brownfield extension.** The substrate exists; J-001 ships the
walking-skeleton-shaped instance of the pattern (`anonymous →
authenticating → authenticated_no_org → creating_org → ready` with
`expired_token` + `error_recoverable` side-states). J-002 is the
second machine plugged into the orchestrator (`ui-state/index.ts:29-60`).

The "first slice of value" for J-002 is therefore not "stand up the
state-machine surface" — it is the smallest carpaccio that
**materializes `active_scope.project_id` after sign-in**:

* A returning user with one or more projects lands on a
  `project_selected` state with the project chip painted.
* Cold deep-link `/projects/{projectId}` resolves `active_scope` from
  the URL before the page body renders.

The downstream slices (session list / resume / new session / project
switching / dataset context switching / cross-machine freeze) layer
on top of that foundation.

## D4 — UX research depth

**Comprehensive.** Full emotional arcs, target affect per scene, and
recovery design at every cross-state boundary.

This depth is appropriate because:

* J-002 is the gateway flow for every downstream J-NNN — its emotional
  arc is the foundation every later flow inherits. A returning user
  whose first impression after sign-in is "where are my projects?"
  carries that disorientation into J-003 (upload), J-005 (transforms),
  etc. The cost of an under-designed J-002 amortizes negatively
  across six other flows.
* The "ChatView project-context race" named at
  `docs/decisions/adr-027-flow-state-tier-and-framework.md:14` is
  precisely the kind of state J-002 retires; designing the recovery
  paths is high-leverage.
* J-002 is the first flow where multi-tenant scope chains
  (`org_id → project_id → optional resource_id`) actually have to
  flow — J-001 only **produces** `org_id`. The emotional design must
  handle the deep-link case where the URL says project A but the
  user has lost access OR the URL is stale.

## D5 — JTBD applicability

**Yes — at the journey level, not the strategic level.**

The strategic job for this feature family is already ratified as
**JOB-002** in `docs/product/jobs.yaml`:

> Drive every user flow through a server-owned state machine that UI
> and tests share.

J-002 inherits JOB-002 verbatim. **No JOB-003 is bootstrapped by this
wave.** What this wave produces is a *journey-level* JTBD analysis:
the discrete jobs Maya is trying to accomplish *inside* J-002's scope
— "resume my work," "switch projects without losing context,"
"deep-link to a project," etc. These compose under JOB-002's
strategic shape; they are not strategic jobs in their own right.

The JTBD artifacts (`jtbd-job-stories.md`, `jtbd-four-forces.md`,
`jtbd-opportunity-scores.md`) ground the user stories in concrete
motivations. Every user story (US-201..US-209) cites at least one
job story from `jtbd-job-stories.md`.

## D6 — Scope-management strategy

J-002's scope is **bounded by what already exists** in the catalog at
`docs/evolution/2026-05-12-user-flow-state-machines/discuss/journey-inventory.md:68-94`
and **extended by the recent research at
`docs/research/user-flow-inventory-and-gaps.md` §3 + §4 Candidate 3**.

### IN scope

* Project selection (returning user lands in last-used; cold
  deep-link resolves from URL).
* Session list visibility, sorting (most-recent-first per
  `features/chat-first-ui.feature:60`), and session resumption.
* New session creation lifecycle (lazy creation on first message;
  title set from first message per
  `features/chat-first-ui.feature:142-145`).
* Welcome state with suggestion chips (`Upload CSV`, `Browse
  Projects`) when no session is active per
  `features/chat-first-ui.feature:71-76`.
* Dataset-context switching **within a session** via direct
  selection OR via the agent's `resolve_dataset` tool-return path
  (`agent/lib/chat/tools.ts:13-22`). This updates
  `active_scope.resource_type=dataset / resource_id`.
* Project switching within an org (updates `active_scope.project_id`;
  prior project's session list is NOT carried).
* The per-turn agent contract: every chat-agent invocation carries
  `active_scope.{org_id, project_id}` (and optionally
  `resource_id[]`) from the SAME projection the FE shell reads, per
  ADR-029 §4.
* Cross-machine `FREEZE` / `THAW` participation from J-001's
  `expired_token` side-state (ADR-028 §"Decision outcome").

### OUT of scope

* **Multi-org / org-switching.** Deferred to a future J-NNN flow
  per D9 below.
* **Project create / delete / rename** as flows. These are
  single-step CRUD per §4 Anti-pattern 1 of the research and stay
  use-case-direct (`backend/app/use_cases/project/{create,delete,update}_project.py`).
  J-002 *observes* their completion via the projection — e.g., on
  successful `create_project`, J-002 transitions to the new
  project's `project_selected` state — but J-002 does NOT carry
  validation, naming, or deletion-confirmation state internally.
* **The agent's `resolve_dataset` tool-call shape itself.** Per D8
  below, the agent stays the chat brain; the tool-call mechanism in
  `agent/lib/chat/tools.ts` is unchanged. J-002 OWNS the
  resulting state transition (`session_active →
  switching_dataset_context → session_active`) but not the
  upstream LLM tool-selection logic.
* **Chat-turn streaming, SSE multiplexing, tool dispatch.** Stay
  agent-internal per ADR-027 D8.
* **Dataset upload, table preview, transforms, view/report compose,
  dbt export** — those are J-003 through J-007, each with its own
  future DISCUSS pass.
* **Project memory / context-window persistence** (per Anti-pattern 2
  of the research). It's read-model data feeding the J-002
  projection, not a separate state.
* **`sql-access` / `query-engine` flows.** These are Open Q#1 from the
  research and OUT of J-002's scope per the command-args ("Open
  Q#1 ... is NOT J-002's concern — defer to a future research /
  DISCUSS wave").

The boundary is drawn at the **flow-shape vs single-step-CRUD
discriminator** from research §6 Anti-Pattern 1 — if a behavior has
no in-flight state worth preserving across `FREEZE`, it does not need
to be in J-002's machine.

## D7 — Phase 2.5 carpaccio scope

J-002 ships in **6 carpaccio slices, 9 stories total** (see
`story-map.md`). Each slice is end-to-end demonstrable in ≤1 day
*against the existing substrate* and carries a named learning
hypothesis (per the `nw-distill` elephant-carpaccio discipline).

The walking-skeleton slice (`Slice 1 — Active scope resolves to a
project`) materializes `active_scope.project_id` for a returning user
and a cold deep-link. Subsequent slices layer session list, session
resume, new-session lifecycle, project switching, dataset-context
switching, and cross-machine `FREEZE`/`THAW` in that order.

The riskiest carpaccio (`Slice 6 — Cross-machine FREEZE/THAW`) is
**deliberately last**. Justification (mirroring J-001's
slice-priority rationale at
`docs/evolution/2026-05-12-user-flow-state-machines/discuss/story-map.md:204-214`):

* Slice 6 presupposes the J-002 machine actually has live mutations
  to freeze (i.e., Slices 1–5 must be in).
* The cross-machine signal infrastructure itself (orchestrator
  enumerated broadcast, replay buffer) already exists from J-001
  (`ui-state/index.ts` + ADR-028 §"Decision outcome"). Slice 6
  validates J-002's participation, not the substrate.

---

## D8 — Hard constraint: the agent stays the chat brain *(carried forward from J-001 Round-2)*

The user's verbatim directive from J-001's wave is binding for J-002:

> "I want agent to remain dedicated to chat brain interface."

ADR-027:17-18 codifies this as Round-2 D8. Effect on J-002:

* The `agent/` Hono worker keeps its current scope: SSE streaming
  via Groq + tool dispatch + ADR-015's narrow per-channel UI
  directive log. It is **not** a host for J-002 state. (`agent/index.ts`
  + `agent/lib/chat/handleChat.ts` are unchanged by J-002 except for
  the **scope-contract enforcement middleware** specified by ADR-029
  §4 — which validates `active_scope.{org_id, project_id}` presence
  on every chat turn. That middleware lands during J-002 DELIVER but
  carries no flow logic.)
* `agent/lib/chat/tools.ts:13-22` exposes `resolve_dataset` as a
  conversational tool that returns a `data-agent-request` typed part
  to the FE (per `agent/lib/chat/handleChat.ts:99-104`). The FE
  re-submits the chat turn with the resolved dataset. **The
  multi-turn state of that resolution loop lives in J-002**, not in
  the agent: J-002's `session_active` state transitions to
  `switching_dataset_context` on a `dataset_resolved_by_agent` event
  (emitted by the FE in response to the agent's tool-return), updates
  `active_scope.resource_*`, then transitions back to `session_active`
  on re-submission. The agent treats each turn statelessly; J-002
  owns the multi-turn shape.

## D9 — Resolution of research Open Q#2 (chat-machine composition) — J-002 owns chat-session multi-turn state; agent stays stateless

**The research §7 Open Q#2 asks**: "Does the chat surface (ChatView +
agent SSE stream) compose with J-002, or does it need its own
machine?"

**Decision**: **J-002 composes with the chat surface. No separate
chat-machine.** The chat surface's multi-turn state — welcome-state
suggestion chips, the `resolve_dataset` re-submission loop, the
dataset-context restoration on session resume, the per-turn
agent-scope contract — all live in J-002. The agent stays stateless
per D8.

### Rationale

* **D8 binds.** Promoting chat state to its own machine would either
  (a) put that machine inside the agent (violates D8), or (b) create
  a sibling machine that has to coordinate with J-002 via the
  orchestrator on every turn (oversizes the actor tree for no
  reciprocal benefit — there is no behavior in the chat-surface that
  is independent of J-002's `active_scope`).
* **The `resolve_dataset` loop is a single-turn tool dispatch, not
  multi-turn state.** Per `agent/lib/chat/handleChat.ts:99-104`,
  `pipeChatStream` intercepts the tool-input-available chunk and
  emits a `data-agent-request` typed part. The FE consumes that
  part. **That is one transition** in J-002's machine
  (`session_active → switching_dataset_context → session_active`),
  not an independent flow.
* **The welcome-state suggestion chips are an empty-state UI for one
  J-002 sub-state.** `Upload CSV` triggers J-003 (a future machine).
  `Browse Projects` is a route navigation. Neither carries
  multi-step state that J-002 doesn't already own.
* **Session-bound dataset context is already J-002's job per
  ADR-029.** `active_scope.resource_type=dataset / resource_id` is
  the cross-cutting contract; J-002 is the machine that resolves it
  for session-scoped surfaces.

### How `active_scope.project_id` reaches the agent

Per ADR-029 §4 (verbatim): every chat-agent invocation carries
`active_scope.{org_id, project_id}` (and optionally
`resource_id[]`) in an `X-Active-Scope` request header. The
header is set by the Remix loader (via the shared `uiStateClient`
helper) on outgoing fetch calls — NOT by chat-view components
individually. Auth-proxy forwards the header to the agent; the
agent reads it via `c.req.header("X-Active-Scope")` and rejects
with 400 + `agent invocation missing scope: missing org_id or
project_id` when either is absent.

**The agent does not derive scope. It receives it.**

The same projection that the FE renders from is the source the
loader reads to set the header — there is no parallel fetch. J-002's
machine context (`active_scope.project_id`, optional `resource_id`)
is the single source of truth for what scope a chat turn carries.

This decision is **load-bearing for US-208** ("Chat-agent
invocation carries `active_scope` from J-002's projection") and
**implements the agent-contract half of ADR-029 §4** end-to-end for
the first time (ADR-029 specified it; J-001 didn't ship it because
J-001 has no chat surface in its `ready` state).

## D10 — Resolution of research Open Q#3 (org-switching) — defer to a future J-NNN flow

**The research §7 Open Q#3 asks**: "Should multi-tenant org switching
be a flow or a property of the `active_scope` contract?"

**Decision**: **Defer to a future J-NNN flow. J-002 does NOT include
org-switching.**

### Rationale

* **Product surface for org-switching does not exist yet.**
  `backend/app/use_cases/organization/` has `create_organization` and
  `get_organization`, but **no list-orgs-for-user, no
  set-active-org**, no invite/membership use cases. The frontend has
  no org-picker UI; `frontend/app/routes.ts` carries no route for it.
  Building a flow for a UI that doesn't exist would be designing in a
  vacuum.
* **WorkOS JWTs in this codebase carry a single `org_id` claim.**
  Multi-tenant JWTs (where a single user can switch active org
  without re-authenticating) are a non-trivial backend extension
  involving WorkOS multi-tenancy configuration, JWT re-issue at
  org-switch time (parallel to J-001's `creating_org → ready`
  re-issue), and a session-isolation contract (do session events
  from org A leak into org B's projection during the switch
  window?). None of that is in scope for J-002.
* **The cross-cutting constraint is already declared.** The catalog
  at `journey-inventory.md:253-259` says "Org switching. Future
  feature. When it lands, every journey machine resets. The
  state-machine layer must expose a 'reset all machines' signal."
  J-002 honors this by NOT carrying org-id-as-mutable-state — it
  reads `active_scope.org_id` from the J-001 projection on every
  transition and treats a change as a top-level reset (out of scope
  for this wave; not implementable until the org-switching surface
  exists).
* **The `active_scope` contract already accommodates the future
  flow.** ADR-029's invariant 1 (`active_scope.org_id` always equals
  the verified JWT's `org_id` claim) makes org-switching a property
  of JWT re-issue, not of J-002. When the future J-NNN ships, it
  will reset all machines via an orchestrator broadcast, just as
  `FREEZE` does today.

J-002 inherits the cross-cutting expectation that an
`org_switched` signal (whenever that future signal exists) resets
J-002 to its initial state. That's one transition target, not a new
machine.

## D11 — Sub-decision: session metadata schema needs a dataset-context column

**Decision**: J-002 surfaces a NEW shared artifact —
`session.active_dataset_id` (and optionally
`session.active_resource_type` if view/report contexts are
session-bound). DESIGN owns the storage shape; J-002's contract is
that **dataset context survives a session resume**.

### Rationale

* `features/chat-first-ui.feature:109-113` says "Resume existing
  session: the dataset context (if any) is restored from session
  metadata." This is binding product behavior.
* `backend/app/use_cases/session/update_session.py:50-52` currently
  allows updates to only `title` and `last_active_at`. A new
  `active_dataset_id` field is therefore a **schema delta** —
  either a new column on the session row, a side-log of
  dataset-context changes per session, or a denormalization from
  the session's event stream. DISCUSS does not choose; DESIGN does.
* The user-facing AC (US-205 "User resumes a prior session — dataset
  context restored") is what J-002 commits to. The how is DESIGN's
  call.

Documented as **OQ-J002-1** in `handoff-design.md` for DESIGN to
resolve.

## D12 — Naming: J-002 is `project-and-chat-session-management`

The catalog ID `J-002` resolves to the slug
`project-and-chat-session-management`. The branch is
`discuss/project-and-chat-session-management`. The feature SSOT
directory is
`docs/feature/project-and-chat-session-management/`. The journey
YAML promoted to SSOT is
`docs/product/journeys/project-and-chat-session-management.yaml`.

This matches J-001's pattern (`login-and-org-setup` =
slug-of-journey-name; lower-kebab-case).

---

## Prior-wave consultation results

### `docs/product/jobs.yaml`

* **JOB-002 is the strategic job.** J-002 inherits it verbatim
  (`job_references: - id: JOB-002 / relationship: "primary"` in the
  journey YAML).
* **JOB-001 is compositional.** O3 (effort to keep tests valid when
  chat protocol changes), O4 (reuse of validation logic between
  in-app TS harness and Python integration suite), O5 (marginal cost
  of next user-flow test) — all directly benefit from J-002 because
  J-002 is the first machine to validate that the actor-model
  substrate scales to a second flow.
* **No JOB-003 added** by this wave.

### `docs/product/journeys/_inventory.md`

* J-002 is listed at line 29 as "catalog: future DISCUSS pass: dive
  after `user-flow-state-machines` DESIGN settles the machine
  framework." DESIGN has settled (ADR-027/028/029/030 ratified
  2026-05-11; J-001 DELIVER complete 2026-05-12).
* This DISCUSS pass promotes J-002 from `catalog` to `active`.

### `docs/research/user-flow-inventory-and-gaps.md` (CANONICAL prior input)

* **§3 J-002 row**: state-machine seed catalog is the starting
  point (`project_chosen → loading_sessions → session_list_visible →
  session_selected` + `creating_new_session` and
  `no_sessions_empty_state` side-states). J-002's journey YAML
  expands this seed to include `switching_project`,
  `switching_dataset_context`, `session_active_no_messages`, and a
  `no_projects_empty_state` entry-state for first-time-in-org users.
* **§5 Prioritization rationale**: J-002 is ranked #1 with R/X/P
  High and C Highest because every flow downstream of it requires
  `active_scope.project_id`.
* **§7 Open Question #2** (chat-machine composition): resolved in D9
  above.
* **§7 Open Question #3** (org-switching): resolved in D10 above.
* **§7 Open Question #1** (sql-access / query-engine flow): out of
  J-002's scope; not resolved here.

### ADR consultation

| ADR | Constraint | How J-002 honors it |
|---|---|---|
| ADR-014 (ChatEvent stratification) | Machine transitions emit `DomainEvent`s; UI projections derived | J-002's transitions emit `DomainEvent`s (`project_selected`, `session_resumed`, `dataset_resolved_by_agent`, etc.). The chat UI's directives (ADR-015 log) remain agent-emitted and unchanged. |
| ADR-015 (presentation-state log) | Per-channel reflect-only directive log | J-002 reads project / session / dataset selection from its own projection; the agent's per-channel log is untouched. The two logs coexist in Redis with distinct key prefixes (`ui-state:project-session-mgmt:*` vs the agent's existing `presentation-state:*`). |
| ADR-016 (auth-proxy ingress) | The `ui-state/` tier is reachable only through auth-proxy | J-002's machine and its projection endpoints are accessed through `/api/flows/project-session-mgmt/*`, routed by auth-proxy. No test-only backdoor. |
| ADR-018 (capability-presence dispatch) | Redis-or-noop for event logs | J-002's flow-event log uses the same dispatch (`selectFlowEventStore`); same Redis container, new key prefix per ADR-027 §3 amendment. |
| ADR-027 (ui-state tier + Remix) | The ui-state Node service hosts machines; Remix loader pattern propagates scope | J-002's machine lives at `ui-state/lib/machines/project-and-chat-session-management.ts` (DELIVER); its projection is wired into Remix loaders at `app/routes/projects.tsx`, `app/routes/project-detail.tsx`, `app/routes/chat.tsx`, etc. |
| ADR-028 (XState v5 actor model) | No machine imports another machine; cross-machine signals via orchestrator | J-002's machine declares `FREEZE` / `THAW` handlers; the orchestrator broadcasts on J-001's `expired_token`. J-002 does NOT import the J-001 machine. |
| ADR-029 (`active_scope` propagation) | Single-source-of-truth for `{org_id, project_id, resource_type?, resource_id?}` | J-002 *produces* `project_id` and optionally `resource_id`; the ScopeResolver mediates URL params vs machine context per ADR-029 §1 invariant 5 (stale-link reconciliation). |
| ADR-030 (single-replica topology) | Per-flow-id keyed log with `flow_id = <machine-name>:<principal_id>` | J-002 uses `flow_id = "project-and-chat-session-management:<user_id>"`. Honors the multi-tenant-safety invariant. |

---

## Risks

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| R1 | DIVERGE was skipped — DESIGN may surface options requiring a re-frame | Low | Low | The substrate is ratified; the only options open are at the machine-states level. DESIGN should not need to re-frame J-002's shape, only refine internals. |
| R2 | Session-metadata schema for dataset-context is a NEW shape (D11 / OQ-J002-1) | Medium | Low | DESIGN owns the storage decision. The behavior contract (US-205) is binding regardless of storage shape. |
| R3 | Agent contract enforcement (ADR-029 §4) lands for the FIRST time in J-002 — middleware regressions could break J-001 | Low | High | The middleware is purely additive at the agent layer (`agent/lib/chat/handleChat.ts`); J-001 has no chat-turn surface in its current states, so a J-001 regression is impossible. J-003+ would inherit the same contract; if the middleware fails, every downstream flow fails uniformly, which is detectable. |
| R4 | Cold deep-link cases where the URL's `projectId` is stale or cross-tenant must hit ADR-029 invariant 4 (403 with named diagnostic), not silently render the wrong project | Medium | High | US-204 (combined happy + failure path) explicitly covers cross-tenant deep-link rejection; the ScopeResolver invariant 4 is its mechanical implementation. Acceptance test at `tests/acceptance/project-and-chat-session-management/test_scope_reconciliation.py` (DISTILL) will be the gate. |
| R5 | Session events (`backend/app/use_cases/session/list_session_events.py`) currently use a noop reader — dataset-context restoration on resume might be unobservable until a real Stream.io adapter is wired | Medium | Medium | If dataset-context lives in the session row (D11 option A), Stream.io is not required for US-205. If it lives in the session-event stream (D11 option B/C), DESIGN must sequence the Stream.io adapter ahead of J-002's DELIVER. Tracked in `handoff-design.md` OQ-J002-1. |
| R6 | The `resolve_dataset` re-submission loop currently lives entirely in the FE (consuming `data-agent-request` typed parts) — moving its multi-turn shape into J-002 requires the FE to emit a `dataset_resolved_by_agent` event to the J-002 machine on every successful resolve | Low | Medium | The contract is documented in US-209; the FE change is one event-emission in the chat-view's `data-agent-request` handler. The agent's tool-call shape is unchanged. |
| R7 | Multi-tab safety: a user with two browser tabs open in different projects could see active_scope drift if the J-002 machine identity is `(flow_id, principal_id)` and not `(flow_id, principal_id, tab_id)` | Low | Medium | Out of J-002's scope; flagged for DESIGN as OQ-J002-2. Today's product has no multi-tab affordance; if it emerges, the orchestrator's principal-id keying (ADR-027 §3 amendment) needs a tab-id extension. |

---

## DISCUSS-wave decisions that bind subsequent waves

1. **D6**: Project create/delete/rename are NOT flows; J-002 observes their completion but does not encode their state.
2. **D8 (carried)**: Agent stays the chat brain; chat-turn streaming is untouched by J-002.
3. **D9**: J-002 owns chat-session multi-turn state (including the `resolve_dataset` re-submission loop's state). The agent stays stateless.
4. **D10**: Org-switching is deferred to a future J-NNN flow; J-002 does NOT include it.
5. **D11**: Dataset-context survives session resume. Storage shape is a DESIGN decision (OQ-J002-1) but the user-observable behavior is committed.
6. **D12**: Slug = `project-and-chat-session-management`.

These decisions are quotable inputs to DESIGN, DISTILL, and DELIVER.
