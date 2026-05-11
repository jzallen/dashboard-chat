# Shared Artifacts Registry — `user-flow-state-machines`

> **Wave**: DISCUSS
> **Scope**: All shared artifacts surfaced by the deep-dive journey
> `login-and-org-setup`, plus cross-cutting artifacts that other
> journeys (catalogued only in this wave) will inherit.

This registry is the integration-validation root. Every `${variable}`
that appears in this feature's TUI mockups or Gherkin scenarios has
exactly one source of truth listed here. Untracked artifacts are the
primary cause of horizontal integration failures — the entire point
of the server-owned state-machine pattern is to make this table
fall out of the design, not be hand-maintained.

---

## Artifacts (deep-dive journey)

### `${user.email}`

* **Source of truth**: machine state `state.user.email` (populated
  at the `authenticating → authenticated_no_org` transition from
  the WorkOS callback profile)
* **Consumers**:
  - J-001 step 3a — welcome page header ("Logged in as ...")
  - J-002 (catalog) — session metadata may surface email in
    activity log
  - any future invitation flow
* **Owner**: J-001 (login-and-org-setup machine)
* **Integration risk**: **MEDIUM** — currently re-fetched in
  multiple FE slices via TanStack Query; consolidating into one
  source removes a drift risk but not a security one.
* **Validation**: in any rendered state where the user is past
  `authenticating`, `state.user.email` must equal the WorkOS
  callback profile's email and must equal any other place email is
  displayed in this session.

### `${user.display_name}`

* **Source of truth**: machine state `state.user.display_name`
  (populated alongside email)
* **Consumers**:
  - J-001 step 4 — app shell user chip
  - J-001 step 6 — app shell user chip (during token refresh)
  - every other journey's app shell
  - future audit/comment attribution
* **Owner**: J-001
* **Integration risk**: **HIGH** — the consumer set is "every
  journey's app shell." Today's FE re-derives this in multiple
  places; the goal of the state-machine layer is exactly one
  source. Mismatches feel cosmetic but erode the user's confidence
  that the system knows who they are.
* **Validation**: `state.user.display_name` is read by exactly one
  FE component (the app shell user chip); every other consumer
  reads through that.

### `${org.name}`

* **Source of truth**: machine state `state.org.name` (populated at
  the `creating_org → ready` transition, OR at the
  `authenticating → ready` transition if the user already has an
  org binding from WorkOS)
* **Consumers**:
  - J-001 step 4 — app shell org chip
  - J-001 step 6 — app shell org chip during token refresh
  - J-002 (catalog) — project tree heading
  - every multi-tenant scoped query's UI surface
* **Owner**: J-001
* **Integration risk**: **HIGH** — multi-tenant identity surface;
  mismatch is a confidence-eroding bug class (Maya sees "Acme Data"
  in the chip but the project tree says "Default Org"). Today
  this is FE-derived from a JWT decode + a separate `/api/orgs/me`
  fetch, with race conditions.
* **Validation**: every FE component displaying an org name reads
  from `state.org.name`. No `/api/orgs/me` lookup in component
  code.

### `${org.id}`

* **Source of truth**: JWT `org_id` claim, derived from machine
  state at JWT-issue time
* **Consumers**:
  - every backend write (multi-tenant scoping enforced via JWT)
  - machine state (internal, but never separately fetched)
  - TS harness (asserts the claim matches machine state for IC-2 and IC-4)
* **Owner**: J-001
* **Integration risk**: **HIGH** — multi-tenant scoping
  enforcement. Any divergence between the JWT claim and machine
  state is a failed transition (the machine does not enter `ready`
  with mismatched identity).
* **Validation**: at every transition into `ready`, the JWT held
  by the FE is decoded once and `claim.org_id ===
  state.org.id`. The harness asserts this via
  `assert_jwt_carries_org_claim()`.

### `${correlation_id}`

* **Source of truth**: machine state `state.correlation_id`
  (minted at entry to `authenticating`; carried forward through
  every transition in this attempt, including into
  `error_recoverable`; carried forward separately into
  `expired_token` FROM THE ORIGINATING REQUEST, not from a new
  auth attempt)
* **Consumers**:
  - log threading across backend, worker, auth-proxy, FE
  - J-001 step 5 — visible reference in `error_recoverable`
  - TS harness — assertion target
* **Owner**: J-001 (but the *pattern* — that every flow's machine
  mints a correlation id at every nontrivial transition — is a
  cross-cutting expectation for the state-machine framework
  itself)
* **Integration risk**: **MEDIUM** — wrong correlation id makes
  support harder, not impossible. The high-impact case is the
  `expired_token` path where the original request's correlation
  id must be carried through, not overwritten by an auth retry.
* **Validation**: `auth_started` event emitted at
  `anonymous → authenticating` carries `correlation_id`; every
  subsequent emitted event during this attempt carries the same
  value; `expired_token` carries the correlation id of the
  failed request, NOT a new value.

### `${session.current}`

* **Source of truth**: machine state `state.session.current`
  (set at `ready` entry, by side-effect of pre-creating a first
  session via backend POST `/api/projects/{id}/sessions` — note:
  the project picker may make this null if Maya hasn't created a
  project yet; J-002 handles that)
* **Consumers**:
  - J-002 (catalog) — entry contract for project + session mgmt
* **Owner**: J-001
* **Integration risk**: **MEDIUM** — if null when J-002 expects
  a value, J-002 must handle empty-state cleanly. The risk is
  hidden behavior coupling between two machines.
* **Validation**: J-002's entry transition explicitly reads from
  J-001's `state.session.current` and handles null by entering
  its own empty-state.

---

## Cross-cutting artifacts (apply to every flow's machine)

### `${active_scope}` *(Round-2 addition — load-bearing for every flow except login)*

* **Shape**: `active_scope = { org_id, project_id, resource_type?, resource_id? }`
  where `resource_type ∈ {dataset, view, report, null}` and `resource_id`
  is the id of the active dataset/view/report when one is selected.
* **Source of truth**: server-resolved at the route boundary of every
  request. The framework chosen in DESIGN determines the resolver site
  (Inertia: shared-prop middleware; Remix: route loader for
  `/org/:org/project/:project`; Next.js: `layout.tsx` for the
  `/org/[org]/project/[project]` segment; vanilla SPA: a scope-resolver
  hook — DRIFT-PRONE, see Round-2 §"scope-chain expressibility" in
  `handoff-design.md`).
* **Consumers** (everywhere except login):
  - **FE app shell**: org chip + project chip (always visible); resource
    chip (when `resource_type ≠ null`) — see US-002 reframe.
  - **FE every page**: page content scoped to `active_scope` (project tree,
    dataset list, transform settings, SQL preview, etc.).
  - **Chat agent (worker)**: every chat turn carries `org_id` + `project_id`
    + optionally `dataset_id[]` from the SAME `active_scope`, not from a
    parallel fetch. Per Round-2 D8, the agent does not derive scope; it
    receives it.
  - **Every backend write**: `org_id` from `active_scope` matches the JWT
    `org_id` claim (multi-tenant invariant); `project_id` matches the
    request's resource binding (cross-tenant project access is rejected).
  - **TS harness**: `harness.user_flow.assert_scope(...)` reads
    `active_scope` from the same projection the FE consumes — see US-004
    extension.
* **Owner**: cross-cutting; no single journey owns it. J-001
  (login-and-org-setup) is the journey that *establishes* `org_id` and
  hands it off to subsequent navigation; every subsequent journey
  *consumes* the chain in its entry contract.
* **Integration risk**: **HIGH** — this is the artifact whose drift
  produces the canonical bug class the user named in their Round-2
  directive ("the ChatView project-context race"). Today's FE
  re-derives scope from a mixture of route params, TanStack Query
  caches, and component-local state. Consolidating into one
  server-resolved source removes an entire class of bugs.
* **Validation**:
  - At every transition into a state where `active_scope.project_id` is
    non-null, the JWT held by the FE/harness carries a matching `org_id`
    claim (per ADR-016 + ADR-014).
  - Every chat-agent invocation carries `org_id` + `project_id` from
    `active_scope`; the agent rejects requests without them.
  - No FE component reads `org_id` or `project_id` from anywhere other
    than `active_scope` (route params and direct API responses are
    intermediate inputs, not consumer surfaces).
  - Mismatched scope (e.g., URL says project A but `active_scope` resolved
    to project B because of a stale link) is a transition to an explicit
    error state, never a silent inconsistency.
* **DESIGN responsibility**:
  - Name the resolver mechanism in the framework ADR (per OQ-8).
  - Name the propagation contract to the chat agent.
  - Specify the harness assertion API
    (`assert_scope({org_id, project_id, resource_type?, resource_id?})`
    with diff output when mismatched).

### `${product.name}` (out-of-scope-but-noted)

* **Source of truth**: `package.json` `name` field — currently
  inconsistent across header, login page, browser title, and email
  templates.
* **Integration risk**: **LOW** — cosmetic, but illustrates the
  exact class of drift the state-machine pattern removes.
* **Recommendation**: separate hotspot pass. Not in this feature's
  scope.

### `${idp.display_name}`

* **Source of truth**: `AUTH_MODE` config (currently hardcoded
  "WorkOS" in FE login page).
* **Consumers**: login page subtitle.
* **Integration risk**: **LOW**.
* **Recommendation**: source from config; not in this feature's
  scope.

---

## Validation Checks (DISCUSS-time)

These are validation questions Luna verified for this wave:

* [x] Every `${variable}` in TUI mockups has a documented source.
* [x] Every shared artifact has at least one named consumer.
* [x] Every cross-step variable (e.g., `correlation_id` from step 2
  to step 5; `org.name` from step 4 to step 6) has a single source
  of truth, not separate FE re-derivations.
* [x] No two steps display the same data from different sources.
* [x] Hardcoded values (like `idp.display_name = "WorkOS"`) are
  flagged as out-of-scope but tracked.
* [x] Cross-journey shared artifacts (`session.current`,
  `user.display_name`) document the consuming journey.
* [x] *(Round-2)* Cross-cutting scope artifact (`active_scope`) is
  documented as HIGH-risk with explicit consumer set covering FE shell,
  every page, the chat agent, every backend write, and the TS harness.

## Validation Checks (deferred to DESIGN)

These are validation questions DESIGN must answer when building the
framework:

* [ ] How is `correlation_id` propagated from machine to logs across
  three runtimes (worker/Node, backend/Python, FE/TS)? — Likely
  via the existing `X-Correlation-Id` header pattern, but the
  state machine must own the header value.
* [ ] What is the wire format for machine state projection? — JSON
  schema, partial updates, or full replay? The ADR-015 directive
  log is one reference shape; the J-001 machine is more
  state-shaped than directive-shaped.
* [ ] Does the FE's TanStack Query cache need an explicit
  invalidation hook tied to machine transitions? — Likely yes at
  `ready` entry (re-key by org_id) and at `expired_token` entry
  (invalidate any in-flight queries).
* [ ] *(Round-2)* What is the server-side resolver site for `active_scope`?
  Inertia shared-prop middleware vs Remix route loader vs Next.js
  `layout.tsx` vs vanilla SPA scope-resolver hook (the last is the
  drift-prone option). The framework ADR (OQ-1 Round-2 + OQ-8) settles
  this.
* [ ] *(Round-2)* What is the contract by which `active_scope` reaches
  the chat agent on every turn? It must come from the authoritative
  source, not from a parallel agent-internal fetch.
