# Story Map — `project-and-chat-session-management` (J-002)

> **Wave**: DISCUSS
> **Date**: 2026-05-13
> **Author**: Luna (nw-product-owner)

This map organizes the J-002 feature spatially: the **backbone** is
the user's path from sign-in through chat-turn dispatch; the **ribs**
are the user stories supporting each activity. The **walking
skeleton** is the thinnest end-to-end slice that proves J-002's
machine resolves `active_scope.project_id` and renders a coherent
project surface.

J-002 is the **second** journey deep-dived in this codebase (after
J-001's `login-and-org-setup`). The state-machine substrate (ADR-027,
028, 029, 030) is fully amortized; J-002 adds one new machine to a
substrate built to accept N.

---

## User

* **Primary**: **Maya Chen (returning)** — completed J-001
  yesterday; has one or more projects in her Acme Data org.
* **Secondary**: **Maya (first-time-in-org)** — just completed
  J-001 with a fresh org and zero projects.
* **Secondary**: **Maya (deep-link visitor)** — clicking a
  bookmark or shared link.

## Goal

**Every user-action inside J-002's territory operates inside a
coherent `(active_scope.project_id, state.session_id,
active_scope.resource_*)` tuple — populated server-side,
projected to the FE and the harness, and consumed by the agent
via the X-Active-Scope header.**

The bug class J-002 retires is the **ChatView project-context race**
named at `adr-027:14`: the FE re-deriving project_id from
useParams + TanStack Query + React Context, drifting under fast
navigation or token refresh.

---

## Backbone

The backbone runs left-to-right through the user's session, from
sign-in to chat-turn dispatch:

| Activity 1: Initial scope resolution | Activity 2: Session selection | Activity 3: Session activity | Activity 4: Context switching | Activity 5: Cross-machine integrity |
|---|---|---|---|---|
| Sign in (from J-001) | View session list | Resume a session | Switch project | Token expiry → FREEZE/THAW |
| Pre-select last-used project | Click a session OR + New Session | Send first message (new) | Switch dataset context | (no other cross-machine ties yet) |
| Open a deep link cold | (loading + empty state) | Chat turn carries scope to agent | (Resolve_dataset re-submission) | |
| (no-projects empty state) | | | | |

Each column maps to a slice (1-1; some columns produce 2 slices when
they have ≥2 stories of non-trivial weight). The walking skeleton
covers only Activity 1.

### Walking Skeleton

The minimum end-to-end slice that proves the J-002 pattern:

* **A1 — Initial scope resolution** — `WS-J002`: Server-owned J-002
  machine resolves `active_scope.project_id` after J-001 `ready`
  for a returning user. The Remix loader at `app/root.tsx` reads
  the projection; the project chip paints on first paint. The TS
  harness can assert `active_scope.project_id` matches the user's
  last-used project.

Why this is the smallest viable walking skeleton:

1. **The substrate is already standing up.** The orchestrator,
   the projection endpoints, the actor-model, the FREEZE/THAW
   contract — all from J-001 DELIVER. The walking skeleton's
   value is "J-002 plugs into the substrate without modifying it";
   not "J-002 plus the substrate."
2. **The visible payoff is the project chip.** Maya's first
   post-sign-in moment is the chip painting with her project's
   name. Everything after — sessions, datasets, chat turns —
   layers on top.
3. **Risk localization.** If the machine doesn't compose cleanly
   with J-001 (e.g., a FREEZE handler bug, a projection-shape
   mismatch), Slice 1 is the first place we find out, and only
   J-002's code is at fault — never the substrate.

---

## Release Slices

Each slice delivers a verifiable user behavior change AND moves an
outcome KPI. Slices ship in order; each is independently
demonstrable in a single session. Each slice carries a **named
learning hypothesis** (per the elephant-carpaccio discipline in
`/nw-discuss`'s Phase 2.5 step 4): what it would disprove if it
fails.

### Slice 1 — *Walking skeleton* — `Active scope resolves to a project`

**Target outcomes (JOB-002)**:
* O2 (UI/harness divergence — first-paint project chip is the same
  in FE shell and TS harness)
* O3 (one-place transition rule change — J-002's
  `resolving_initial_scope → project_selected` is one file)

**Learning hypothesis**: If a returning user lands in
`project_selected` with the wrong project (>1% misresolution rate)
OR experiences flicker (>5% of paints show project chip after page
body), the last-used resolution algorithm is wrong. **If it passes,
the J-002 machine has shown it can produce a single-source-of-truth
projection that both FE and harness consume.**

**Stories**:

* **US-201**: A first-time-in-org user with zero projects lands in
  `no_projects_empty_state` with a Create-your-first-project CTA.
* **US-202**: A returning user with one or more projects lands in
  their last-used project's `session_list_visible` with the project
  chip painted on first paint.
* **US-204**: A cold deep-link to `/projects/{projectId}` resolves
  `active_scope.project_id` before page paint AND surfaces a
  named-diagnostic for cross-tenant / stale URLs.

**Walking-skeleton-go-green criterion**: A TS harness test that
drives J-001 → J-002 end-to-end for Maya, asserting `active_scope.project_id`
matches the last-used project AND the FE app shell paints the project
chip on the same first paint as the org chip.

**Demo**: 5 minutes, in browser. Maya signs in, lands on Q4
Analytics with the project chip painted. Cold deep-link `/projects/strategic`
(cross-tenant) lands on the named-diagnostic panel. Same paths
replayed by the TS harness in test output.

**Production data check**: The "Q4 Analytics" / "Strategic" projects
are seeded against the dev backend's project table — not synthetic
fixtures invented for the slice.

**Dogfood moment**: A developer cold-loads a deep link to her own
project after sign-in; observes the chip + body paint together.

**IN scope**: `resolving_initial_scope`, `no_projects_empty_state`,
`creating_project`, `project_selected`, `scope_mismatch_terminal`,
the ScopeResolver invariants 1+4, last-used resolution algorithm.

**OUT of scope**: Session list, session resume, new session
lifecycle, project switching, dataset context, agent contract,
FREEZE/THAW.

**Carpaccio taste tests** (per the discipline):
* "ship 4+ new components"? No — J-002 is one new machine +
  empty-state UI + loading shim.
* "depends on a new abstraction"? No — substrate is in place.
* "disproves any pre-commitment"? Yes — disproves that the
  last-used resolution algorithm is correct OR that the
  ScopeResolver returns the right diagnostic on cross-tenant.
* "synthetic data only"? No — real projects from the dev backend.
* "merge-with-another-slice candidate"? No — Slice 1's
  end-to-end value is uniquely "scope resolves to a project."

Estimated effort: 1 day (3 stories × ~0.3 days under the existing
substrate).

---

### Slice 2 — `Session list + resume`

**Target outcomes (JOB-002)**:
* O2 (UI/harness divergence — transcript + dataset chip match
  across FE and harness)
* O3 (one-place transition rule for session resume)

**Learning hypothesis**: If session-metadata's `active_dataset_id`
cannot durably store the dataset chip's value across reloads
(>1 reload in 100 shows the wrong dataset chip), the D11 storage
shape is wrong. **If it passes, J-002 has shown that session
metadata can carry per-session UX state, retiring the
"session-bound state is FE-only" pattern.**

**Stories**:

* **US-203**: Project's session list renders sorted by recency on
  project entry (with `no_sessions_empty_state` sub-shape).
* **US-205**: Resuming a session restores the transcript AND the
  dataset chip from session metadata.

**Demo**: 5 minutes, in browser. Maya picks "chat-9b2a" from her
nav rail; the transcript loads with the dataset chip
("sales_2026") restored; she types a follow-up; the agent
responds against the right dataset.

**Production data check**: Real sessions from the dev backend's
session table, with `active_dataset_id` populated by Slice 2's
dataset-attachment scenarios (or seeded manually).

**Dogfood moment**: A developer creates a session in dataset-X,
reloads the tab, sees the dataset chip restored.

**IN scope**: `loading_session_list`, `session_list_visible`,
`no_sessions_empty_state`, `resuming_session`, `session_active`
(read-only paint), session-metadata `active_dataset_id` (DESIGN
storage shape resolved per OQ-J002-1).

**OUT of scope**: New session lifecycle, project switching,
agent contract, FREEZE/THAW.

Estimated effort: 1.5 days (2 stories × ~0.75 days).

---

### Slice 3 — `New session lifecycle`

**Target outcomes**:
* O3 (one-place lazy-create vs eager-create rule)

**Learning hypothesis**: If lazy creation (creating session row
only on first-message-sent) produces ghost session rows under any
observable code path (e.g., a queued intent in the replay buffer
that doesn't get cleared correctly on a navigate-away), the lazy
shape is wrong and we revert to eager. **If it passes, J-002
has shown that lazy creation is the right ergonomic — users
experiment without committing.**

**Stories**:

* **US-206**: New session lifecycle (lazy create on first message;
  title from first message).

**Demo**: 3 minutes, in browser. Maya clicks "+ New Session";
welcome chips visible; she navigates away without typing; no
session row in the list. Maya clicks "+ New Session" again, types
a first message, presses Enter; session row appears in the nav
with title set from the message.

**Production data check**: The backend's `create_session` and
`update_session` use cases are exercised end-to-end.

**Dogfood moment**: A developer makes 5 New-Session clicks
without typing, navigates away each time, then verifies no ghost
rows.

**IN scope**: `session_active_no_messages`, `session_active`
(write path for first-message-sent), lazy `create_session` call,
title-from-first-message contract.

**OUT of scope**: Project switching, dataset context, agent
contract, FREEZE/THAW, dataset-restoration-on-resume (Slice 2's
territory).

Estimated effort: 1 day.

---

### Slice 4 — `Project switching + agent scope contract`

**Target outcomes**:
* O2 (UI/harness divergence — the agent's per-turn scope matches
  the FE chrome)
* O4 (time-to-recovery — atomic switching means no half-bad-state
  to recover from)

**Learning hypothesis**: If a chat turn EVER lands at the agent
during a project switch carrying mismatched `project_id` /
`session_id`, the SSE cancellation contract is broken. **If it
passes, the cross-tenant data-leak surface from
`agent/lib/chat/handleChat.ts:75` is mechanically closed AND the
canonical ChatView project-context race is retired for the first
time.**

**Stories**:

* **US-207**: User switches projects within an org — scope
  atomically retargets; chat-turn-in-flight is cancelled cleanly.
* **US-208**: Chat-agent invocation carries `active_scope` from
  J-002's projection; agent rejects missing scope with 400.

**Demo**: 5 minutes, in browser. Maya types a long chat turn in Q4;
mid-stream, she clicks Q3 Sales; the Q4 stream cancels; Q3
session list loads. The acceptance test asserts no agent request
log shows a turn with Q4 session_id AND Q3 project_id mixed.

**Production data check**: Real backend session list for Q3
Sales; real chat-turn dispatched to the agent (or mocked at the
SSE boundary with assertions on the outgoing X-Active-Scope).

**Dogfood moment**: A developer rapidly clicks between projects
while typing in chat; no orphan request lands at the agent.

**IN scope**: `switching_project`, FE SSE cancellation contract,
agent middleware enforcement (US-208), agent backwards-compat
migration window.

**OUT of scope**: Dataset context switching (Slice 5),
FREEZE/THAW (Slice 6).

Estimated effort: 2 days (2 stories × ~1 day).

---

### Slice 5 — `Dataset context switching`

**Target outcomes**:
* O3 (one-place rule for "where does dataset-resolution-state
  live")

**Learning hypothesis**: If the FE-emitted
`dataset_resolved_by_agent` event ever drifts from the agent's
`resolve_dataset` tool-call payload (e.g., the FE picks "dataset
A" but emits "dataset B" to J-002), the contract between agent and
J-002 is wrong. **If it passes, J-002 has shown it can own the
multi-turn shape of a tool-call-driven flow while the agent stays
stateless.**

**Stories**:

* **US-209**: Dataset context switching via agent's
  `resolve_dataset` OR direct selection.

**Demo**: 5 minutes, in browser. Maya types "filter rows where age
> 30" without a dataset; the agent surfaces the inline list; she
picks; the filter applies. She closes the tab, re-opens, resumes
the session; the dataset chip is restored (composes with Slice 2).

**Production data check**: Real agent stream with real
`resolve_dataset` tool-call; real backend dataset list.

**Dogfood moment**: A developer changes datasets mid-session and
verifies the agent's next turn dispatches to the new one.

**IN scope**: `switching_dataset_context`,
`dataset_resolved_by_agent` event handler, `dataset_picked_directly`
event handler, session.active_dataset_id write path.

**OUT of scope**: FREEZE/THAW.

Estimated effort: 1.5 days.

---

### Slice 6 — `Cross-machine FREEZE/THAW`

**Target outcomes (JOB-002)**:
* O4 (time-to-recovery — token expiry mid-mutation is invisible)
* O1 (time to add a new flow's freeze handler — proves the
  substrate amortizes across flows)

**Learning hypothesis**: If a FREEZE during any J-002 in-flight
state produces a stale intent on THAW that the user can observe
(e.g., a session click for a session that no longer exists in the
post-freeze project context), the stale-intent filter rule is
wrong. **If it passes, the architectural payoff from ADR-028 §94
("cross-machine freeze is a 5-line `system.get(...).send(...)`
loop") is realized end-to-end for the first time.**

**Stories**:

* **US-210**: J-002 honors FREEZE/THAW from J-001's
  `expired_token`.

**Demo**: 7 minutes, in browser. Maya clicks a session; mid-load,
token expires; "Refreshing session..." banner; silent re-auth;
session loads with no re-click. Same path replayed by the TS
harness via `harness.j002.freeze()` + `harness.j002.thaw()`.

**Production data check**: Real J-001 `expired_token` fixture
(from J-001's deliver suite); real orchestrator broadcast.

**Dogfood moment**: A developer triggers J-001 token expiry mid
J-002 mutation via the harness knob from J-001; observes silent
recovery.

**IN scope**: J-002 `freeze` side-state, FREEZE handler from every
non-terminal state, THAW history-target transition, stale-intent
filter (OQ-J002-6).

**OUT of scope**: New cross-machine signals beyond FREEZE/THAW.

Estimated effort: 1.5 days (1 story × 1.5 days; the riskiest
carpaccio).

---

## Release-slice priority rationale

Slice priority is outcome-driven and dependency-aware:

| Order | Slice | Why this order |
|-------|-------|----------------|
| 1 | Slice 1 — Active scope resolves | Walking skeleton. Proves the substrate accepts a second machine cleanly. Every subsequent slice depends on `active_scope.project_id` being live. |
| 2 | Slice 2 — Session list + resume | The most-visible user-value layer after Slice 1. Session list + transcript + dataset chip restoration is the daily user experience. |
| 3 | Slice 3 — New session lifecycle | Simpler than Slice 4; ships the lazy-creation pattern that the chat-first-ui.feature has been waiting for. |
| 4 | Slice 4 — Project switching + agent scope contract | Retires the canonical ChatView project-context race (the highest-impact JOB-002 outcome). Sequenced after Slices 1-3 because it requires `session_active` to be a real state with real chat-turn dispatch. |
| 5 | Slice 5 — Dataset context switching | Layers on top of Slice 4's agent contract; needs `switching_dataset_context` to land after `switching_project` for the FREEZE story to cover both. |
| 6 | Slice 6 — Cross-machine FREEZE/THAW | Architectural payoff. Last because it requires Slices 1-5 to have live mutations to freeze. **Riskiest carpaccio**; deliberately last per J-001's slice-priority rationale (mirror of J-001 §"Riskiest-assumption-first ordering"). |

**Riskiest-assumption-first ordering would have promoted Slice 6 to
slice 1.** We did not, because:

* Slice 6 presupposes J-002 has live mutations to freeze (Slices
  1-5 must be in).
* The substrate cost of FREEZE/THAW is already paid by J-001
  (ADR-027 §5 replay buffer; orchestrator broadcast in
  `ui-state/index.ts`). The novelty in Slice 6 is J-002's
  PARTICIPATION, not the cross-machine plumbing itself.
* The architectural payoff is multiplicative — one machine
  honoring FREEZE doesn't prove the pattern; the second machine
  honoring it does. Slice 6's value is "the substrate amortizes,"
  which can only be measured AFTER multiple flow-shapes exist.

---

## Scope assessment: PASS

* 10 stories in 6 carpaccio slices for the J-002 deep-dive
* 1-2 stories per slice (within the 1-3 sweet spot)
* Estimated effort: 8-9 days total (1+1.5+1+2+1.5+1.5)
* Each slice is independently demonstrable in <10 minutes
* Each slice has a named learning hypothesis (per `nw-distill`
  elephant-carpaccio discipline) and passes the taste tests
  (none ships 4+ new components; none depends on a new
  abstraction; none uses synthetic-only data; none is identical
  to another at scale)
* Walking skeleton is one-column-deep (mirror of J-001's strategy)
* Other journeys (J-003..J-007) are deliberately deferred — each
  gets its own DISCUSS pass per the established cadence
* The carpaccio sequencing puts the architectural payoff (Slice
  6) last, validating the substrate amortization promise from
  ADR-028 §94

---

## Slice briefs

Each slice has a dedicated brief in `slices/slice-NN-*.md` with
its goal, IN/OUT scope, learning hypothesis, acceptance criteria,
dependencies, effort estimate, and pre-slice SPIKE (where
applicable). The briefs are ≤100 lines each.

* `slices/slice-01-walking-skeleton.md`
* `slices/slice-02-session-list-and-resume.md`
* `slices/slice-03-new-session-lifecycle.md`
* `slices/slice-04-project-switching-and-agent-contract.md`
* `slices/slice-05-dataset-context-switching.md`
* `slices/slice-06-cross-machine-freeze.md`
