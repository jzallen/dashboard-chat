<!-- markdownlint-disable MD024 -->

# User Stories — `user-flow-state-machines`

> **Wave**: DISCUSS
> **Date**: 2026-05-11
> **Persona (deep-dive)**: **Maya Chen** — new contributor to a data team, WorkOS-managed identity, no Dashboard Chat org yet. (Secondary: returning user encountering `expired_token`.)
> **JTBD reference**: JOB-002 (drafted in `wave-decisions.md`; primary). JOB-001 outcomes O3, O4, O5 are compositional beneficiaries.
> **Scope**: deep-dive column only (login + org setup). Other columns get stub stories in `story-map.md` and full DISCUSS passes later.

---

## System Constraints

Cross-cutting constraints that apply to every story in this file. Each
story's AC inherits these; they do not need to be re-stated per story.

1. **Auth-proxy is the sole ingress.** Per ADR-016, every backend +
   worker call from the FE OR the TS harness routes through
   auth-proxy. No story bypasses this.
2. **ChatEvent vocabulary is stratified.** Per ADR-014, state-machine
   transitions surface as `DomainEvent`s; UI projections derive from
   the machine's state. Mixing the two is out of scope.
3. **JWT carries the multi-tenant scoping.** `org_id` claim is the
   authoritative tenant boundary; no FE component decodes the JWT
   to read tenancy — it reads from machine state, which is in turn
   re-derived at JWT issue/rotation.
4. **The state-machine layer is server-owned.** Decisions about
   *where* the layer lives (worker vs new service vs co-located with
   backend) and *what* runs the machines (XState vs hand-rolled
   reducer vs Inertia-style projection) are DESIGN-wave
   responsibilities. Stories below describe the *user's experience
   of the pattern*, not its implementation.
5. **The TS harness is a first-class consumer.** Every state the FE
   can read, the harness can read from the same endpoint. No
   FE-internal-only state is acceptable in a story's AC.
6. **Scope chain is load-bearing** *(Round-2)*. Every flow except login
   itself operates inside a specific `active_scope = {org_id,
   project_id, resource_type?, resource_id?}`. The framework chosen in
   DESIGN must express scope inheritance cleanly (Inertia `shared
   props`, Remix `useRouteLoaderData`, Next.js `layout.tsx` all express
   this; vanilla SPA does not). The chat agent (per Round-2 D8) receives
   `org_id` + `project_id` on every turn from this single source. See
   `shared-artifacts-registry.md` §`active_scope` (HIGH risk) and
   `wave-decisions.md` §D9.
7. **The agent stays the chat brain** *(Round-2 D8)*. The `agent/` (Hono
   worker) is dedicated to SSE streaming via Groq + tool dispatch + the
   ADR-015 directive log. It is NOT a host for flow state machines.
   Stories below describe the user's experience of the pattern, not
   which container runs the machines.

---

## US-001: New user reaches welcome page with email pre-filled

### Problem

Maya Chen is a new contributor to her data team. Her IT admin has
provisioned her WorkOS identity, but Dashboard Chat has no org for
her yet. Today, when Maya signs in for the first time, she lands on
a CreateOrg page where her email is sometimes pre-filled, sometimes
not (depending on whether a separate `/api/users/me` fetch resolved
before render). The inconsistency makes Maya unsure whether the app
knows who she is — a needless source of anxiety on her first thirty
seconds with the product.

### Who

- **New contributor (Maya Chen)** | first-time WorkOS-authenticated user with no Dashboard Chat org | wants confidence the app already recognizes her identity from WorkOS

### Solution

Drive the auth round-trip through a server-owned state machine
(`login-and-org-setup`, states `anonymous → authenticating →
authenticated_no_org`). The FE renders the welcome page from the
machine's projection — `state.user.email` is guaranteed to be
populated by the time the welcome page is reachable, because the
transition into `authenticated_no_org` requires the email field to
exist. No race; no separate `/api/users/me` fetch.

### Elevator Pitch

- **Before**: Maya clicks Sign in → callback → welcome page renders
  with email field sometimes empty, sometimes "Loading..." — a
  separate `/api/users/me` race against component mount.
- **After**: Maya clicks Sign in → callback → welcome page at
  `/welcome` shows "Logged in as maya.chen@acme-data.example" in
  its header within 100ms of route resolution, with no spinner on
  the email field.
- **Decision enabled**: Maya decides whether to keep going (yes — the
  app knows me) or back out (rare — but if she does, she does so for
  product-fit reasons, not because the app feels broken).

### Domain Examples

#### 1: Happy Path — Maya Chen, first-time login

Maya opens the app, clicks Sign in, completes WorkOS, lands on
`/welcome`. The header reads "Logged in as
maya.chen@acme-data.example". She types "Acme Data" into the org
name field and clicks Create. (Org creation itself is US-002.)

#### 2: Edge — Cold-start callback (JWKS slow to warm)

Maya's auth round-trip takes 1.8 seconds because the backend JWKS
endpoint was cold. During those 1.8 seconds, she sees the
`authenticating` step UI: "Checking your identity..." with a
progress bar and "This usually takes about two seconds." copy. She
does NOT see a blank page or a raw error. When the JWKS warms and
the JWT verifies, the welcome page renders, email pre-filled.

#### 3: Boundary — WorkOS profile missing email

Vanishingly rare. Maya's WorkOS profile is corrupt and missing the
`email` field. The machine transitions to `error_recoverable`
instead of `authenticated_no_org`. Maya sees the recoverable-error
UI (covered in US-003) with the correlation id; she does not
silently land on a welcome page with a blank email field.

### UAT Scenarios (BDD)

#### Scenario: A new user lands on the welcome page with email pre-filled

```gherkin
Given Maya Chen visits Dashboard Chat for the first time
And her WorkOS profile has no Dashboard Chat org binding
When she clicks Sign in and completes the WorkOS round-trip
Then the welcome page renders within 100ms of callback resolution
And the header reads "Logged in as maya.chen@acme-data.example"
And no separate /api/users/me fetch is required for the email to render
```

#### Scenario: The authenticating step is visible during a slow round-trip

```gherkin
Given Maya has clicked Sign in
And the WorkOS round-trip plus JWT verification will take 1.8 seconds
When the callback URL renders
Then a "Checking your identity..." panel is visible within 100ms
And the panel displays "This usually takes about two seconds."
And no blank page or raw error message is shown at any point
```

#### Scenario: The TS harness can assert the state machine reached authenticated_no_org

```gherkin
Given the TS harness has initiated an auth attempt for Maya Chen
When the WorkOS round-trip resolves with a profile containing no org binding
Then the harness can read the machine projection
And the machine state is "authenticated_no_org"
And state.user.email equals "maya.chen@acme-data.example"
```

#### Scenario: Maya's email is the same value the harness sees and the welcome page shows

```gherkin
Given Maya has reached the welcome page
And the TS harness is concurrently watching the same machine
When the harness reads state.user.email
And the welcome page header is inspected
Then both values are identical
And both come from the machine projection (not from independent FE re-derivations)
```

### Acceptance Criteria

- [ ] Welcome page renders email from machine projection within 100ms of route resolution (no separate FE re-fetch)
- [ ] During the WorkOS round-trip the user sees an `authenticating`-step UI; no blank screen and no raw error appear at any point
- [ ] The TS harness reads the same `state.user.email` from the machine projection that the FE renders
- [ ] A WorkOS profile missing required fields transitions the machine to `error_recoverable`, not silently into `authenticated_no_org` with a blank email field
- [ ] `correlation_id` minted at entry to `authenticating` is present on every event emitted by the machine during this attempt

### Outcome KPIs

- **Who**: First-time WorkOS-authenticated users with no org
- **Does what**: Reaches the welcome page with email pre-filled and visible
- **By how much**: 100% of successful auth attempts (no race-condition empty header); time to email visible < 100ms after callback resolution at p95
- **Measured by**: FE instrumentation — `welcome_page_rendered` event with `email_present_at_first_paint` flag; `time_to_email_visible_ms`
- **Baseline**: Today, ~10% of first-time logins observe the empty-email race (based on developer recall — instrumentation does not yet exist); auth-round-trip ms is uninstrumented

### Technical Notes (constraints + dependencies)

- Depends on the state-machine framework existing (DESIGN deliverable). This story does not specify *how* the framework works, only what behavior the user observes.
- Depends on a machine projection endpoint readable by both FE and TS harness — likely an extension of ADR-015's pattern (reflect-only log → reflect-only state projection), with DESIGN owning the wire format.
- WorkOS callback contract is currently defined at `auth-proxy/src/auth/workos.ts`; no change to that contract is required by this story (the machine consumes its output).

### Story Size

- 5 UAT scenarios | 1 verifiable user behavior change | ~1.5 days of FE work + ~0.5 day of machine state seeding (once framework exists)

---

## US-002: New user creates an org and lands in the app shell with scope chips visible

> **Reframed in Round-2**: the "identity chips" are now **scope chips**
> (org + user, with project added once any project is active). The K2
> first-paint guarantee is extended to cover the project chip — the same
> "no flicker" promise applies once Maya has at least one project open.
> This makes US-002 load-bearing for the cross-cutting scope-chain
> contract that every downstream flow inherits (see
> `shared-artifacts-registry.md` §`active_scope`).

### Problem

After Maya types her org name and clicks Create, she watches a
spinner. Today, three things happen sequentially in three separate
FE state slices: (a) POST `/api/orgs`, (b) JWT re-issue with new
`org_id` claim, (c) navigation to the app shell which then fetches
`/api/orgs/me` and `/api/users/me` to populate the chrome. If any
of (b) or (c) races wrong, Maya can briefly see "Default Org" or
"loading..." in the chrome while the JWT she holds already carries
the correct claim. The flicker erodes confidence at the precise
moment Maya should feel her account is real.

The same flicker class recurs every time Maya later switches projects
— the project chip races against the route change and the FE's
re-derivation of `project_id`. The pattern that fixes the org chip
must fix the project chip too; both are projections of `active_scope`.

### Who

- **New contributor (Maya Chen)** | has just completed org setup | wants the app shell to confirm her identity AND her active scope instantly and consistently
- **Returning user** | switching between projects | wants the project chip to never lie about which project the rest of the UI is rendering against

### Solution

The `creating_org` machine state owns both writes (org row +
JWT re-issue) and only transitions to `ready` when both are
visible. The app shell reads `org.name`, `user.display_name`, and
`active_scope.project_id → name` from the machine projection — not
from separate re-fetches. The scope chips are a single projection
of `active_scope`, populated by the server-side resolver chosen in
DESIGN (per OQ-8); the FE never re-derives scope from route params.

### Elevator Pitch

- **Before**: Maya submits org form → spinner → app shell paints
  with "Default Org" in the chip for 200-500ms, then resolves to
  "Acme Data" — a visible flicker. Later, when she opens a project,
  the project chip races the route change in a sibling flicker.
- **After**: Maya submits org form → "Creating..." UI → app shell
  paints with the **org chip** ("Acme Data") and the **user chip**
  ("Maya Chen") simultaneously; no flicker. When she later opens
  her first project, the **project chip** appears with the project
  name on the same first paint as the page body — also no flicker.
  Open any project URL directly and you see all three chips on
  first paint with the correct values.
- **Decision enabled**: Maya decides whether to start her first
  project right now (yes — everything feels real) instead of
  pausing because the app feels half-formed. Later: Maya trusts
  that the project chip names the project the rest of the UI is
  actually rendering against.

### Domain Examples

#### 1: Happy Path — Maya creates "Acme Data"

Maya types "Acme Data", clicks Create. UI shows "Creating..." for
~700ms. App shell paints with the org chip "Acme Data" and the
user chip "Maya Chen" simultaneously. No flicker.

#### 2: Edge — JWT re-issue is slow (separate from org creation)

Org row creates in 200ms; JWT re-issue takes 1.4 seconds. Maya
sees "Creating..." for the full ~1.6 seconds — the machine does
not transition to `ready` until BOTH writes are visible. No
intermediate state with "Default Org" in the chip is possible.

#### 3: Error — Org row created but JWT re-issue fails

Org row exists. JWT re-issue returns 500. The machine retries the
JWT re-issue idempotently (same `org_id`). On three failures it
transitions to `error_recoverable` with a "partial setup" copy
variant: "Your organization was created but we could not finish
issuing your access. Try again." The "Try again" button retries
the JWT re-issue, NOT the org creation.

#### 4: Scope continuity — Project chip on first paint *(Round-2)*

Two weeks later, Maya bookmarks the URL of her project
`/org/acme-data/project/q4-analytics` and opens it cold the next
morning. The page loads. The org chip reads "Acme Data", the project
chip reads "Q4 Analytics", and the body of the page (project
dashboard) renders, ALL on first paint — no chip flicker, no chip
saying the right thing while the body renders for the wrong project,
and no body rendering for the right project while the chip catches
up. The server-side scope resolver picks up the route params,
populates `active_scope`, and the shell + body render off the same
source.

### UAT Scenarios (BDD)

#### Scenario: Submitting valid org name reaches the app shell with identity consistent

```gherkin
Given Maya is in state authenticated_no_org
And her email is maya.chen@acme-data.example
When she submits "Acme Data" as her org name
Then the machine transitions through creating_org to ready
And the app shell paints with the org chip showing "Acme Data"
And the user chip showing "Maya Chen"
And both values appear on first paint (no flicker through a placeholder value)
```

#### Scenario: The JWT carries the new org's id when ready is reached

```gherkin
Given Maya has just transitioned to ready
When the TS harness inspects the JWT held by the FE
Then the org_id claim equals the org id from state.org.id
And no FE component decodes the JWT to derive tenancy (all reads go through machine state)
```

#### Scenario: A validation failure stays in authenticated_no_org with inline error

```gherkin
Given Maya is in state authenticated_no_org
And another user in her tenant has already taken "Acme Data"
When Maya submits "Acme Data"
Then the machine returns to authenticated_no_org
And the form shows "That name is already in use in your organization" inline beside the input
And no JWT re-issue is attempted
And no new org row is created
```

#### Scenario: Org row created but JWT re-issue failure retries idempotently

```gherkin
Given Maya is in creating_org
And the org row was created with id "org-acme-data-abc123"
But the JWT re-issue endpoint returns 500
When the machine retries the JWT re-issue
Then the retry sends the same org_id "org-acme-data-abc123"
And no duplicate org row is created
And after three failures the machine transitions to error_recoverable with a "partial setup" copy variant
```

#### Scenario: A first session is pre-created at ready entry

```gherkin
Given Maya has just reached ready
When she opens her first project
Then state.session.current is non-null
And the chat panel renders an empty-state prompt rather than a blank thread
```

#### Scenario: Project chip and page body paint together on a deep-linked project URL *(Round-2)*

```gherkin
Given Maya has at least one project "Q4 Analytics" in her "Acme Data" org
When she opens the deep link "/org/acme-data/project/q4-analytics" cold
Then the org chip reads "Acme Data" on first paint
And the project chip reads "Q4 Analytics" on first paint
And the page body renders project-scoped content on the same first paint
And no chip shows a placeholder ("Loading...", "Default Project", or empty) at any point
And active_scope.org_id and active_scope.project_id are populated from the server-side scope resolver, not from a separate FE re-derivation
```

#### Scenario: The chat agent receives org_id and project_id from active_scope, not a parallel fetch *(Round-2)*

```gherkin
Given Maya is in a project session with active_scope.org_id = "org-acme-data-abc123" and active_scope.project_id = "proj-q4-analytics-def456"
When she sends a chat turn
Then the request to the chat agent carries both org_id and project_id
And both values are sourced from active_scope (the same source the FE shell renders from)
And the agent does not perform a separate fetch to derive scope
And no chat turn is accepted by the agent without both org_id and project_id present
```

### Acceptance Criteria

- [ ] App shell first paint shows `org.name`, `user.display_name`, AND (when a project is active) `project.name` from the machine projection (no placeholder or flicker on any chip)
- [ ] On a deep-linked project URL cold load, the project chip and the project-scoped page body paint together; the project chip never resolves AFTER the page body or vice versa *(Round-2)*
- [ ] The JWT held by the FE at `ready` entry carries an `org_id` claim equal to `state.org.id`; the harness can assert this via `assert_jwt_carries_org_claim()`
- [ ] Org name validation failures (duplicate, illegal chars) return the machine to `authenticated_no_org` with the form displaying the inline error; no JWT re-issue and no org row are attempted
- [ ] Idempotent retry of JWT re-issue uses the same `org_id` so no duplicate org rows are created
- [ ] After three exhausted JWT-re-issue retries, the machine transitions to `error_recoverable` with the "partial setup" copy variant (distinct from the "transient" variant in US-003)
- [ ] `state.session.current` is non-null when `ready` is reached (a first session has been pre-created)
- [ ] Every chat-agent invocation in any session carries `org_id` AND `project_id` from `active_scope`; the agent rejects invocations missing either *(Round-2)*

### Outcome KPIs

- **Who**: First-time users completing org setup AND returning users opening project URLs
- **Does what**: Sees the app shell with org chip, user chip, AND (when a project is active) project chip on first paint, with no flicker through a placeholder value
- **By how much**: 100% of successful org-creation transitions show both org and user chips on first paint at p99; 100% of deep-linked project URL cold loads show all three chips + project-scoped page body on the same first paint at p99 *(Round-2)*
- **Measured by**: FE instrumentation — `app_shell_first_paint` event with `org_chip_value`, `user_chip_value`, `project_chip_value`, and `flicker_observed` fields; assert all chips ≠ placeholder
- **Baseline**: Today, ~20-30% of first-time org creations observe a 200-500ms org-chip flicker (developer recall; not instrumented). Project-chip flicker on cold project URLs is anecdotally common (this is the "ChatView project-context race" the recent debugging session named).

### Technical Notes (constraints + dependencies)

- Depends on US-001 (the machine framework + projection consumer).
- Depends on the auth-proxy `/api/auth/reissue` (or equivalent — DESIGN names the endpoint) being callable idempotently with an `org_id`.
- Pre-creating a first session at `ready` entry depends on the backend `POST /api/projects/{id}/sessions` endpoint; the machine must handle that POST's failure modes (transient → retry; permanent → set `state.session.current = null` and let J-002 handle empty-state).
- *(Round-2)* The project-chip-on-first-paint AC requires the framework chosen in DESIGN to express scope inheritance at the route layer (Inertia `shared props` / Remix `useRouteLoaderData` / Next.js `layout.tsx` all express this; vanilla SPA + XState client-side cannot guarantee it without explicit middleware — see `handoff-design.md` Round-2 §"Scope-chain expressibility").
- *(Round-2)* The agent-receives-scope AC depends on the framework producing `active_scope` on every server-rendered route and passing it through to agent invocations as part of the request envelope. The agent contract (per Round-2 D8) does not change — it continues to be the chat brain — but it must reject invocations missing `org_id` or `project_id`.

### Story Size

- 7 UAT scenarios | 1 verifiable user behavior change (extended in Round-2 to cover scope chips and agent scope contract) | ~2.5 days of FE + worker work + ~0.5 day of harness assertion. Right at the upper boundary; if the Round-2 scope-chip AC turns out to require nontrivial framework integration, this story splits cleanly into "US-002a: org-creation + identity chips" and "US-002b: scope chips + agent scope contract."

---

## US-003: A transient auth failure shows an honest, recoverable error with a correlation id

### Problem

Today, when the JWKS endpoint cold-starts or the WorkOS callback
returns a malformed code, Maya sees a white screen, a raw 500, or
(worst) the login page again with no explanation of why. The exact
friction the team just lived through for an hour was a JWKS warm-up
race — the user-facing version of that bug looks like "the app just
doesn't work." There is no path forward visible to Maya and no
reference she can give support.

### Who

- **Any user mid-auth** (including Maya on first try, OR a returning user whose silent re-auth failed) | encountering a transient backend or IDP failure during the auth round-trip | wants to know what happened, why, and what to do — plus a reference they can show support if it persists

### Solution

The `error_recoverable` state owns the failed-but-retriable
scenario. The machine emits `auth_recoverable_error` carrying the
`correlation_id` (the one minted at entry to `authenticating`, NOT
a new one), plus an `underlying_cause_tag` so the FE can pick the
right copy variant ("transient", "cookie-blocked", "partial-setup",
etc.). The UI shows an empathetic message + the correlation id +
a "Try again" CTA that re-enters `authenticating` with the SAME
correlation id (so the retry-of-a-retry is threadable in logs).

### Elevator Pitch

- **Before**: Maya clicks Sign in → callback → white screen or raw
  500. No idea what happened; no reference for support.
- **After**: Maya clicks Sign in → callback → recoverable-error
  panel: "We could not verify your identity right now. This is
  usually a brief network issue and resolves with a retry." with
  the correlation id "R-7a4f-901c" visible at the bottom and a
  "Try again" button.
- **Decision enabled**: Maya decides whether to retry herself (yes,
  most of the time the retry works) or share the correlation id
  with her admin (rare; the admin uses it to find the failure in
  logs across auth-proxy + backend + worker — same id in all three).

### Domain Examples

#### 1: Happy Path — JWKS cold-start, retry succeeds

Maya signs in. JWKS is cold; verification fails. Machine transitions
to `error_recoverable` with `underlying_cause_tag = "transient"` and
`correlation_id = "R-7a4f-901c"`. UI shows the recoverable-error
panel. Maya clicks "Try again". Machine re-enters `authenticating`
with the SAME correlation id. JWKS is warm now; verification
succeeds; Maya lands on `/welcome`.

#### 2: Edge — Third-party cookie blocked

Maya is using Safari with strict tracking protection. Cookie
round-trip fails. Machine transitions to `error_recoverable` with
`underlying_cause_tag = "cookie-blocked"`. UI shows a specific copy
variant: "Your browser blocked the sign-in cookie. Try allowing
cookies for dashboard-chat.app, or try a different browser." with
the same correlation-id format.

#### 3: Boundary — Three failed retries

Maya retries three times; each fails. On the third failure the
machine transitions to `error_terminal`. UI shows "Sign-in
unavailable. Please share this reference with support: R-7a4f-901c"
with a "Contact support" CTA. The "Try again" button is replaced;
no retry loop.

### UAT Scenarios (BDD)

#### Scenario: A transient JWKS failure shows the recoverable-error panel with the correlation id

```gherkin
Given Maya has clicked Sign in
And the backend JWKS endpoint returns 503 during JWT verification
When the machine transitions to error_recoverable
Then the user sees a panel with the heading "We could not verify your identity right now"
And the panel displays "This is usually a brief network issue and resolves with a retry"
And a "Try again" button is the primary call to action
And the correlation_id (e.g., "R-7a4f-901c") is visibly displayed for support reference
And no raw 503 or stack trace is shown
```

#### Scenario: "Try again" re-enters authenticating with the same correlation id

```gherkin
Given Maya is in error_recoverable with correlation_id "R-7a4f-901c"
When she clicks "Try again"
Then the machine transitions to authenticating
And the new attempt's emitted events carry correlation_id "R-7a4f-901c"
And the auth-proxy and backend logs for this retry are findable by that same id
```

#### Scenario: A cookie-blocked failure shows a different copy variant

```gherkin
Given the WorkOS callback returned a code
But the FE detects no session cookie after the round-trip (third-party cookies blocked)
When the machine transitions to error_recoverable
Then the underlying_cause_tag is "cookie-blocked"
And the panel copy is "Your browser blocked the sign-in cookie..."
And the same correlation_id format is displayed
```

#### Scenario: Three failed retries escalate to error_terminal

```gherkin
Given Maya is in error_recoverable and has retried twice already
When her third retry fails
Then the machine transitions to error_terminal
And the "Try again" button is replaced with a "Contact support" CTA
And the correlation_id remains visible
And no further retry is offered from the UI
```

#### Scenario: The TS harness can force a transient failure of a given tag

```gherkin
Given the TS harness has initiated an auth attempt
When the harness calls force_transient_failure("jwks_not_warm")
Then the machine transitions to error_recoverable with underlying_cause_tag "transient"
And the harness can read the same correlation_id the FE would display
```

### Acceptance Criteria

- [ ] On any transient auth failure, the user sees an empathetic, jargon-free message + a path forward (retry) + a correlation id; no raw status codes or stack traces appear
- [ ] "Try again" re-enters `authenticating` with the same `correlation_id`; the id threads across auth-proxy, backend, worker, and FE logs for that attempt
- [ ] Copy variants are keyed by `underlying_cause_tag` (at minimum: `transient`, `cookie-blocked`, `partial-setup`); a new tag without a copy variant fails compilation (closed-vocabulary discriminated union)
- [ ] Three failed retries transition to `error_terminal` with a "Contact support" CTA; no further retries are offered
- [ ] The TS harness can force any `underlying_cause_tag` via a flagged surface and read the same `correlation_id` the FE would display

### Outcome KPIs

- **Who**: Users encountering a transient auth failure
- **Does what**: Recovers via retry, without bouncing to support, while having a correlation id to share if they do
- **By how much**: ≥90% of transient failures are recovered by user-initiated retry within 60 seconds; 100% of recoverable-error views display a correlation id
- **Measured by**: FE instrumentation — `auth_recoverable_error_shown` + `auth_retry_clicked` + `auth_succeeded_after_retry`; correlation between `auth_recoverable_error_shown` and same-session `ready_reached`
- **Baseline**: Today: 0% of failures show a correlation id (no instrumentation; no UI). Self-recovery rate is unknown; the team's intuition is "users mostly refresh the tab."

### Technical Notes (constraints + dependencies)

- Depends on US-001 (machine + projection).
- The correlation-id format is the same one the backend and worker already log under `X-Correlation-Id`; the machine becomes the issuer rather than a passive carrier.
- Copy variants live in a single source file (e.g., `reverse-proxy/src/auth/copy.ts`) keyed by `underlying_cause_tag`; adding a new tag without copy is a TS compile error.

### Story Size

- 5 UAT scenarios | 1 verifiable user behavior change | ~2 days of FE work (panel UI + copy variants) + ~0.5 day of harness force-failure surface

---

## US-004: The TS harness can drive every J-001 transition end-to-end

### Problem

Today, exercising the auth + org-setup flow in tests requires either
(a) the Python `DatasetLayerHarness.fetch_dev_user_jwt` + manual API
choreography (works only for the happy path; cannot force JWKS
warm-up or org-validation failures), or (b) Playwright in a real
browser (slow, brittle, owns its own re-implementation of the flow's
state machine in test setup). Neither composes with the new
server-owned machine; both will drift the moment the machine's
transitions change.

### Who

- **Developer writing an acceptance test for a flow that depends on auth** (i.e., every flow other than J-001) | wants to set the auth + org state in N lines, then exercise their flow's machine | wants the harness to drive THE SAME machine the FE drives, not a parallel reimplementation

### Solution

The TS harness exposes one composable surface per machine. For
J-001 it offers: `begin_auth(persona)`, `assert_state(expected)`,
`submit_org(name)`, `force_transient_failure(tag)`,
`assert_jwt_carries_org_claim()`, `expire_token()`, and
*(Round-2)* `assert_scope({org_id, project_id?, resource_type?,
resource_id?})`. Every call reads from / writes to the same
machine projection that the FE consumes. No parallel state.
Scope assertions emit named-column diff output when the asserted
scope diverges from the actual scope — so a test failure tells the
developer exactly which scope dimension drifted.

### Elevator Pitch

- **Before**: A test for a transform flow has to either (a) bypass
  auth entirely with a dev-token shortcut that diverges from prod
  semantics, or (b) re-implement the auth state machine in test
  setup. Both are technical debt.
- **After**: A test for a transform flow opens with `harness =
  await UserFlowHarness.begin_auth("maya")` and the
  `login-and-org-setup` machine is in `ready` in three lines of
  code, exercising the SAME code path Maya would.
- **Decision enabled**: Developer decides whether to write the
  acceptance test for their flow in TS (now mechanically possible,
  composing one harness with another) or Python (still possible for
  backend-shaped contracts; both layers coexist per JOB-001 + JOB-002).

### Domain Examples

#### 1: Happy Path — Composing J-001 + J-005 harness

A developer is writing an acceptance test for the transforms flow.
They open with `await harness.user_flow.begin_auth("maya")` →
machine reaches `authenticated_no_org` → `await
harness.user_flow.submit_org("Acme Data")` → machine reaches
`ready` → developer's test continues against the transforms harness
which inherits the same auth context.

#### 2: Edge — Asserting transient-failure recovery

A developer is writing a test for the recoverable-error UI. They
open `await harness.user_flow.begin_auth("maya")` → `await
harness.user_flow.force_transient_failure("jwks_not_warm")` → assert
machine is in `error_recoverable` with the correlation id readable.

#### 3: Cross-boundary — Token expiry mid-test

A developer is testing how a long-running transform handles JWT
expiry. They reach `ready`, start a transform turn, then `await
harness.user_flow.expire_token()` and assert that the in-flight
transform replays with the new JWT after silent re-auth, just like
US-005 specifies for the user.

### UAT Scenarios (BDD)

#### Scenario: begin_auth("maya") reaches ready in one call

```gherkin
Given the TS harness is initialized for the test environment
When the developer calls await harness.user_flow.begin_auth("maya")
Then the machine transitions through anonymous → authenticating → authenticated_no_org
And state.user.email equals "maya.chen@acme-data.example"
And the call returns when state is authenticated_no_org (not ready — org setup is a separate step)
```

#### Scenario: assert_state reads from the same projection the FE consumes

```gherkin
Given the harness has driven the machine to authenticated_no_org
When the developer calls assert_state("authenticated_no_org")
Then the assertion reads from the machine projection endpoint
And succeeds if and only if the FE would render the welcome page
```

#### Scenario: force_transient_failure drives error_recoverable with a chosen tag

```gherkin
Given the harness has called begin_auth and the machine is in authenticating
When the developer calls force_transient_failure("jwks_not_warm")
Then the machine transitions to error_recoverable
And state.underlying_cause_tag equals "transient"
And state.correlation_id is the one minted at the original authenticating entry (not a new one)
```

#### Scenario: assert_jwt_carries_org_claim verifies IC-2 + IC-4

```gherkin
Given the harness has reached ready via begin_auth + submit_org
When the developer calls assert_jwt_carries_org_claim()
Then the assertion succeeds if and only if the JWT held by the harness carries an org_id claim equal to state.org.id
And the assertion fails with a clear message if the claim is missing or diverges
```

#### Scenario: The harness composes with other flow harnesses

```gherkin
Given a test exercises the transforms flow
When the test opens with harness.user_flow.begin_auth("maya") + harness.user_flow.submit_org("Acme Data")
Then subsequent calls into harness.transforms operate against the same authenticated machine state
And no separate auth bypass or re-implementation is needed
```

#### Scenario: assert_scope verifies active_scope at every state and diffs mismatches *(Round-2)*

```gherkin
Given the harness has driven the machine to ready
And then drove project + session mgmt to project_chosen with project_id "proj-q4-analytics-def456"
When the developer calls assert_scope({org_id: "org-acme-data-abc123", project_id: "proj-q4-analytics-def456"})
Then the assertion reads active_scope from the same projection the FE consumes
And succeeds if and only if every named dimension matches
And on mismatch the failure output names each diverged dimension in a column-formatted diff
  (e.g., "org_id   expected: org-acme-data-abc123   actual: org-other-xyz789")
And callers may omit dimensions to match partial scope (e.g., {org_id: ...} alone is fine when no project is active)
```

#### Scenario: A scope mismatch in the agent contract is a test failure with a named diagnostic *(Round-2)*

```gherkin
Given the harness has reached ready and selected a project
When a downstream test exercises a chat turn
And the chat-agent invocation reaches the agent without org_id or project_id
Then the harness surfaces a test failure with diagnostic "agent invocation missing scope: missing org_id" (or project_id)
And the failure points at the scope contract from `wave-decisions.md` §D9, not at the agent's internal state
```

### Acceptance Criteria

- [ ] `begin_auth(persona)`, `submit_org(name)`, `assert_state(expected)`, `force_transient_failure(tag)`, `assert_jwt_carries_org_claim()`, `expire_token()`, AND `assert_scope({...})` are the public surface for J-001 in the TS harness
- [ ] Every harness call reads/writes the SAME machine projection the FE reads/writes (no parallel state)
- [ ] The harness uses the same auth-proxy ingress path as production (per ADR-016); no test-only backdoor
- [ ] Personas (initially `"maya"` for new contributor, with at least one more for the returning-user case) are seeded in test fixtures so a developer can compose them by name; adding a new persona is a one-file change
- [ ] Composing the J-001 harness with a sibling flow harness (e.g., J-005 transforms) requires zero re-implementation of auth in the sibling's test setup
- [ ] *(Round-2)* `assert_scope({...})` reads `active_scope` from the same projection the FE consumes; partial scope is supported (omit unknown dimensions); on mismatch the failure output is a named-column diff naming each diverged dimension
- [ ] *(Round-2)* The harness surfaces missing-scope diagnostics on the agent contract: any chat-agent invocation missing `org_id` or `project_id` produces a named test failure pointing at the scope contract

### Outcome KPIs

- **Who**: Developers writing acceptance tests for any user-facing flow
- **Does what**: Sets up the J-001 (auth + org) precondition for their test in ≤5 lines of code, exercising the same code paths the user would
- **By how much**: ≥90% of new acceptance tests use the harness for J-001 precondition (vs ad-hoc dev-token bypass); time-to-write-first-passing-acceptance-test-for-a-new-flow ≤2 hours
- **Measured by**: code-review survey + grep for legacy bypass patterns in `tests/acceptance/`; time-tracked via cycle-time on the first acceptance test of any new flow
- **Baseline**: Today, the Python harness is used by ~3 active acceptance suites; no TS harness exists; new-flow first-test time is ~1 day

### Technical Notes (constraints + dependencies)

- Depends on US-001 + US-002 (machine framework + projection consumer).
- Wire format for the projection endpoint is a DESIGN deliverable; the harness will use whatever wire shape DESIGN picks.
- Should not duplicate the Python `DatasetLayerHarness`'s coverage of `chat_turn` / `transforms` / `validate_after` — those stay as the backend-and-agent contract guard (JOB-001). The TS harness is the user-flow surface (JOB-002).
- *(Round-2)* `assert_scope` reads from `active_scope` (cross-cutting shared artifact; see `shared-artifacts-registry.md`). The harness does not own the resolver — it observes the projection that the framework's scope resolver produces. The named-column diff format is the same shape `DatasetLayerHarness.assert_exactly_once_via_replay` uses for transform-log diffs; reuse the formatter helper.

### Story Size

- 7 UAT scenarios | 1 verifiable developer-experience change (extended in Round-2 with scope-assertion surface) | ~2.5 days of TS harness work (assumes the machine projection endpoint already exists from US-001/US-002 and `active_scope` is in the projection). Right at the upper boundary; the scope-assertion diff formatter is a half-day at most.

---

## US-005: A token expiring mid-chat-turn replays the in-flight request after silent re-auth

### Problem

Today, when a user's JWT expires while a chat turn is in flight,
the chat turn fails with a 401 and the FE either shows a generic
"network error" or silently drops the request. Maya types a
question into chat, waits, sees nothing happen, and re-types it.
The friction is small per occurrence but constant — JWTs expire on
a clock; this isn't an edge case, it's a recurring event.

### Who

- **Returning user with an in-flight request whose token expires** (Maya after a few hours, or any returning user) | wants the app to handle the expiry transparently — not lose the request, not surprise them

### Solution

The `expired_token` state is a side-state reachable from any
working state. On entry it: (a) freezes mutations across all flow
machines, (b) attempts silent re-auth exactly once, (c) on success
replays any in-flight request with the new JWT, (d) on failure
transitions to `error_recoverable` carrying the ORIGINAL request's
correlation id.

### Elevator Pitch

- **Before**: Maya asks chat "what's the average rev by region" →
  401 → FE shows "network error" or silently drops the request →
  Maya re-types her question. Confidence erodes a notch each time.
- **After**: Maya asks chat "what's the average rev by region" →
  worker returns 401 → non-blocking "Refreshing your session..."
  banner appears → silent re-auth completes in ~700ms → chat
  request replays with new JWT → response streams as if nothing
  happened.
- **Decision enabled**: Maya never re-types the question; her trust
  that "the chat works" is preserved across all-day sessions.

### Domain Examples

#### 1: Happy Path — Silent re-auth succeeds

Maya types "what's the average rev by region". Worker returns 401
because JWT expired 30 seconds ago. Machine transitions to
`expired_token`. Non-blocking banner appears. Silent re-auth runs
in ~700ms. Banner clears. Chat request replays with the new JWT.
Response streams normally. Maya sees no interruption.

#### 2: Edge — Silent re-auth fails

Same scenario but silent re-auth fails (WorkOS session itself
expired, not just the JWT). Machine transitions to
`error_recoverable` carrying the correlation id of Maya's ORIGINAL
chat request (so the support trace is keyed by what Maya asked,
not by what auth retry attempted). UI shows the recoverable-error
panel with a "Sign in again" CTA (variant of "Try again" tuned for
this case).

#### 3: Cross-flow — Two in-flight requests when expiry hits

Maya has both a chat turn AND a backend dataset preview in flight
when her JWT expires. Both receive 401s. Machine transitions to
`expired_token` once (not twice). After silent re-auth, both
in-flight requests replay with the new JWT. Maya sees no
interruption to either.

### UAT Scenarios (BDD)

#### Scenario: Silent re-auth replays the in-flight chat turn

```gherkin
Given Maya is in state ready
And she has just sent a chat turn "what's the average rev by region"
And her JWT expires before the worker can respond
When the worker returns 401 with a token-expired signal
Then the machine transitions to expired_token
And a non-blocking "Refreshing your session..." banner appears within 100ms
And silent re-auth completes within 2 seconds at p95
And the chat turn replays with the new JWT
And the streaming response reaches Maya as if the expiry had not occurred
And the banner clears once the response begins streaming
```

#### Scenario: Silent re-auth failure surfaces the original request's correlation id

```gherkin
Given Maya is in expired_token after a chat turn with correlation_id "R-chat-9b2a"
And silent re-auth fails (WorkOS session itself expired)
When the machine transitions to error_recoverable
Then the correlation_id displayed in the recoverable-error panel is "R-chat-9b2a"
And not the correlation id of the failed silent re-auth attempt
```

#### Scenario: Two in-flight requests replay together

```gherkin
Given Maya has both a chat turn and a dataset preview request in flight
And her JWT expires before either responds
When both requests return 401
Then the machine transitions to expired_token exactly once
And after silent re-auth both in-flight requests replay with the new JWT
And both responses reach Maya
```

#### Scenario: All other flow machines freeze their mutations during expired_token

```gherkin
Given Maya is in state ready
And she clicks an "apply transform" button at the moment her JWT expires
When the machine is in expired_token
Then the apply-transform action does not send to the backend until expired_token resolves
And the FE button is disabled with a "Refreshing your session..." tooltip
And no transform is duplicated across the re-auth boundary
```

### Acceptance Criteria

- [ ] Token expiry mid-in-flight does not require the user to re-submit; the request replays after silent re-auth at p95 ≤2 seconds
- [ ] All other flow machines freeze their mutations during `expired_token`; no duplicate writes across the re-auth boundary
- [ ] On silent-re-auth failure, the surfaced recoverable-error panel carries the ORIGINAL request's `correlation_id`, not the auth attempt's
- [ ] The banner is non-blocking (does not block keyboard input or close any open panels); it appears within 100ms of the 401 and clears within 100ms of replay starting
- [ ] Concurrent 401s (two in-flight requests, single expiry event) result in exactly one `expired_token` transition and exactly two replays

### Outcome KPIs

- **Who**: Returning users with mid-session token expiries
- **Does what**: Stays in flow; does not re-submit; does not see error UI unless silent re-auth fails
- **By how much**: ≥95% of expiry events are recovered by silent re-auth (only ~5% require user-visible "Sign in again"); zero re-typed requests in instrumented sessions
- **Measured by**: FE + worker instrumentation — `token_expired_event`, `silent_reauth_ok`, `silent_reauth_failed`; "duplicate request" detector
- **Baseline**: Today, every expiry surfaces as a generic network error and the request is dropped; the user must re-submit. Estimated frequency: ~1-3 events per user-day for active analysts.

### Technical Notes (constraints + dependencies)

- Depends on US-001 + US-002 + US-003 (the machine + error_recoverable surface for failure case).
- The "freeze all other machines" semantics is a cross-cutting concern; DESIGN must define the framework-level pause/resume signal.
- Silent re-auth itself is an auth-proxy responsibility; the machine drives it via a (probably existing) endpoint and observes the result.
- The request-replay buffer must be bounded and time-limited; if silent re-auth takes longer than ~5 seconds, replay is abandoned and the request surfaces as a fresh request to the user (preserving their original input as a draft in the chat composer for chat-turn cases).

### Story Size

- 5 UAT scenarios | 1 verifiable user behavior change | ~2 days of FE + worker work + ~0.5 day of cross-machine freeze coordination + ~0.5 day of harness `expire_token` surface
