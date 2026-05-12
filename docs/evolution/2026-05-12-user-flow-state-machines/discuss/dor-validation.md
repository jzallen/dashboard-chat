# Definition-of-Ready Validation — `user-flow-state-machines`

> **Wave**: DISCUSS
> **Date**: 2026-05-11
> **Reviewer**: Luna (nw-product-owner, self-validation pass)

Per DoR hard gate: each story must pass all 9 items with evidence
before DESIGN-wave handoff.

---

## US-001: New user reaches welcome page with email pre-filled

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem statement clear, domain language | PASS | "Maya Chen is a new contributor... her email is sometimes pre-filled, sometimes not... a needless source of anxiety on her first thirty seconds with the product." |
| 2 | User/persona identified with specific characteristics | PASS | Maya Chen — first-time WorkOS-authenticated user with no Dashboard Chat org; specific characteristics in `wave-decisions.md` and journey-visual. |
| 3 | 3+ domain examples with real data | PASS | Three examples: happy path (Maya at `/welcome`), edge (JWKS slow to warm, 1.8s), boundary (WorkOS profile missing email). Real persona name, real email format, real timing. |
| 4 | UAT in Given/When/Then (3-7 scenarios) | PASS | 4 scenarios. |
| 5 | AC derived from UAT | PASS | 5 ACs, each traceable to a scenario. |
| 6 | Right-sized (1-3 days, 3-7 scenarios) | PASS | 4 scenarios, ~1.5 days FE + ~0.5 day harness — within window. |
| 7 | Technical notes (constraints/dependencies) | PASS | Three notes: framework dependency, projection endpoint dependency, WorkOS contract reference. |
| 8 | Dependencies resolved or tracked | PASS | One dependency: state-machine framework. Tracked as a DESIGN-wave deliverable noted in wave-decisions.md. |
| 9 | Outcome KPIs defined with measurable targets | PASS | K1 in `outcome-kpis.md` — Who/Does what/By how much/Baseline/Measured by all populated. |

### Elevator Pitch Test (Dimension 0)

* Presence: PASS — three lines (Before / After / Decision enabled).
* Real entry point: PASS — "callback → welcome page at `/welcome`" is user-invocable.
* Concrete output: PASS — "Logged in as maya.chen@acme-data.example" in header within 100ms is observable on-screen.
* Job connection: PASS — Maya decides whether to keep going.
* Slice-level: not infrastructure-only.

### DoR Status: PASSED

---

## US-002: New user creates an org and lands in the app shell with scope chips visible *(Round-2 reframe)*

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem statement clear, domain language | PASS | "Maya watches a spinner... three things happen sequentially in three separate FE state slices... the flicker erodes confidence." Round-2 extends with "the same flicker class recurs every time Maya switches projects — the project chip races against the route change." Both are concrete, domain-grounded. |
| 2 | User/persona identified | PASS | Maya Chen (first-time, identity-chip case) + Returning user (project-chip case). Both populated. |
| 3 | 3+ domain examples with real data | PASS | Four: happy path (Acme Data, 700ms), edge (JWT re-issue slow 1.4s), error (org row created but re-issue fails), Round-2 scope-continuity example (deep link `/org/acme-data/project/q4-analytics` cold load, three chips + body together). |
| 4 | UAT in Given/When/Then (3-7 scenarios) | PASS | 7 scenarios (was 5; Round-2 added project-chip-on-cold-load + agent-receives-scope). At the upper boundary; right-sized for now, splittable if implementation reveals more. |
| 5 | AC derived from UAT | PASS | 8 ACs, each traceable to a scenario (was 6; Round-2 added 2 — project chip on cold load + agent scope contract). |
| 6 | Right-sized | PASS (at boundary) | ~2.5 days FE+worker + 0.5 day harness; 7 scenarios. At the upper boundary. Story-size note explicitly identifies the clean split (US-002a identity chips + US-002b scope chips & agent contract) if implementation reveals it is larger than 3 days. |
| 7 | Technical notes | PASS | Original three notes preserved. Round-2 added two: scope inheritance must be expressed by chosen framework (Inertia/Remix/Next.js do; vanilla SPA does not without explicit middleware); agent scope-rejection contract. |
| 8 | Dependencies resolved or tracked | PASS | Depends on US-001 (in same wave, sequential). Round-2 adds an implicit dependency on the framework choice (OQ-1 Round-2 + OQ-8); the framework must express scope inheritance for the Round-2 ACs to be mechanically achievable. Tracked, not a blocker (DESIGN owns the framework decision). |
| 9 | Outcome KPIs defined | PASS | K2 — north-star KPI (extended in Round-2 to cover project-chip first-paint on deep-linked cold loads). |

### Elevator Pitch Test

* Presence: PASS.
* Real entry point: PASS — `/` (app shell route) AND `/org/{org}/project/{project}` (deep link case, Round-2).
* Concrete output: PASS — "org chip 'Acme Data', user chip 'Maya Chen', AND project chip 'Q4 Analytics' simultaneously on cold load of the deep link, no flicker, page body renders on the same first paint" is observable.
* Job connection: PASS — Maya decides whether to start her first project; later, Maya trusts that the project chip names the project the rest of the UI is rendering against.
* Slice-level: not infrastructure-only.

### DoR Status: PASSED *(Round-2; at story-size boundary; clean split path documented)*

---

## US-003: A transient auth failure shows an honest, recoverable error with a correlation id

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem statement clear, domain language | PASS | "When the JWKS endpoint cold-starts or the WorkOS callback returns a malformed code, Maya sees a white screen, a raw 500, or (worst) the login page again with no explanation of why." — domain-grounded (real failure mode the team just hit). |
| 2 | User/persona identified | PASS | "Any user mid-auth" — both first-time (Maya) and returning. |
| 3 | 3+ domain examples with real data | PASS | Three: happy path (JWKS cold, retry succeeds with correlation_id R-7a4f-901c), edge (Safari third-party cookie blocked), boundary (three failed retries → error_terminal). |
| 4 | UAT in Given/When/Then | PASS | 5 scenarios. |
| 5 | AC derived from UAT | PASS | 5 ACs. |
| 6 | Right-sized | PASS | ~2 days FE + 0.5 day harness; 5 scenarios. |
| 7 | Technical notes | PASS | `X-Correlation-Id` already exists; machine becomes issuer; copy variants in one file. |
| 8 | Dependencies resolved or tracked | PASS | Depends on US-001. |
| 9 | Outcome KPIs defined | PASS | K3. |

### Elevator Pitch Test

* Presence: PASS.
* Real entry point: PASS — recoverable-error panel reachable via callback failure path.
* Concrete output: PASS — empathetic message + correlation id visible.
* Job connection: PASS — Maya decides whether to retry herself or share the id with support.
* Slice-level: not infrastructure-only.

### DoR Status: PASSED

---

## US-004: The TS harness can drive every J-001 transition end-to-end *(Round-2: extended with scope assertions)*

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem statement clear, domain language | PASS | "Today, exercising the auth + org-setup flow in tests requires either Python harness (happy path only) or Playwright (slow, brittle, parallel state)." Real concrete tradeoff. |
| 2 | User/persona identified | PASS | "Developer writing an acceptance test for a flow that depends on auth" — i.e., every flow other than J-001. Specific role + situation. |
| 3 | 3+ domain examples with real data | PASS | Three: happy (composing J-001 + J-005), edge (asserting transient-failure recovery), cross-boundary (token expiry mid-test). All Round-2-compatible — `active_scope` is implicit in the harness composition example. |
| 4 | UAT in Given/When/Then | PASS | 7 scenarios (was 5; Round-2 added scope-assertion-with-diff + agent-scope-missing diagnostic). |
| 5 | AC derived from UAT | PASS | 7 ACs (was 5; Round-2 added 2). |
| 6 | Right-sized | PASS (at boundary) | ~2.5 days; 7 scenarios. At the upper boundary; the scope-assertion diff formatter is half a day at most. Splittable if implementation reveals it is larger. |
| 7 | Technical notes | PASS | Original notes preserved. Round-2 added: harness does not own the resolver (it observes the projection); diff formatter shape mirrors `DatasetLayerHarness.assert_exactly_once_via_replay`. |
| 8 | Dependencies resolved or tracked | PASS | Depends on US-001 + US-002. Round-2 adds an implicit dependency on `active_scope` being in the projection — landing alongside US-002's Round-2 scope-chip ACs (same framework deliverable). |
| 9 | Outcome KPIs defined | PASS | K5 — developer-experience leading indicator (unchanged; the scope-assertion surface is part of "≤5 lines of code" experience). |

### Elevator Pitch Test (developer-facing story)

* Presence: PASS.
* Real entry point: PASS — `harness.user_flow.begin_auth("maya")` + `harness.user_flow.assert_scope({...})` are developer-invocable surfaces (the test code IS the entry point).
* Concrete output: PASS — three lines of code reach `ready`; one line asserts scope with named-column diff on mismatch. Developer-observable.
* Job connection: PASS — developer decides whether to write the test in TS (now mechanical, with scope drift surfaced as a named test failure) or Python.
* Slice-level: this is the "harness" story of slice 2. Slice 2 has a user-facing story (US-003) AND this developer-facing story; the slice is not infrastructure-only.

### DoR Status: PASSED *(Round-2; at story-size boundary)*

---

## US-005: A token expiring mid-request replays the in-flight request after silent re-auth

| # | DoR Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | Problem statement clear, domain language | PASS | "Maya types a question into chat, waits, sees nothing happen, and re-types it... small per occurrence but constant — JWTs expire on a clock; this isn't an edge case, it's a recurring event." |
| 2 | User/persona identified | PASS | Returning user with in-flight request; concrete frequency estimate (1-3 events/user-day for active analysts). |
| 3 | 3+ domain examples with real data | PASS | Three: happy (silent re-auth succeeds, 700ms), edge (WorkOS session itself expired), cross-flow (two in-flight requests during one expiry). |
| 4 | UAT in Given/When/Then | PASS | 4 scenarios (note: also includes the silent-re-auth-failure scenario, which rolls in what was provisionally US-006 in the story map). |
| 5 | AC derived from UAT | PASS | 5 ACs. |
| 6 | Right-sized | PASS | ~3 days total; 4 scenarios. Right at the upper end — the cross-machine freeze coordination is the lump. If DESIGN finds this larger than 3 days, this story splits into "single-flow expiry replay" + "cross-flow freeze coordination" cleanly. |
| 7 | Technical notes | PASS | Notes: freeze semantics is cross-cutting (DESIGN owns the signal); replay buffer is bounded; preserve user's chat draft as a draft if replay is abandoned. |
| 8 | Dependencies resolved or tracked | PASS | Depends on US-001 + US-002 + US-003. |
| 9 | Outcome KPIs defined | PASS | K4. |

### Elevator Pitch Test

* Presence: PASS.
* Real entry point: PASS — chat compose box (recurring real surface).
* Concrete output: PASS — "response streams as if nothing happened" + "banner clears within 100ms of replay starting" are observable.
* Job connection: PASS — Maya never re-types; trust preserved.
* Slice-level: not infrastructure-only.

### DoR Status: PASSED

---

## Overall DoR Status

**ALL 5 STORIES: PASSED** *(re-validated after Round-2 iteration)*

* 5/5 stories have all 9 DoR items passing
* 5/5 stories pass the Elevator Pitch Dimension-0 test
* 0/5 slices are infrastructure-only (slice 2 has both a user-facing and a developer-facing story; slices 1 and 3 are user-facing)

**Round-2 caveat**: US-002 and US-004 are right-sized but **at the
upper boundary** (7 scenarios each, ~2.5 days). Both stories include
explicit story-size notes describing the clean split path (US-002 →
US-002a identity chips + US-002b scope chips & agent contract; US-004
→ split scope-assertion surface into a sibling sub-story) if DELIVER
estimation reveals they have grown larger than 3 days. No DoR item
fails as a result of the Round-2 additions.

Ready for peer review (`po-review.yaml`) and DESIGN-wave handoff.
