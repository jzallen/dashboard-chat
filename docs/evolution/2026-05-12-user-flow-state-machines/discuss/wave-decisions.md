# Wave Decisions — `user-flow-state-machines`

> **Wave**: DISCUSS
> **Date**: 2026-05-11
> **Author**: Luna (nw-product-owner)

This document captures the entry-point decisions, scope-management
strategy, and prior-wave consultation results that frame the DISCUSS
artifacts for `user-flow-state-machines`. It is not a story — it is the
audit trail explaining why this feature entered at DISCUSS (skipping
DISCOVER and DIVERGE), why only one flow is deep-dived, and which prior
ADRs constrain the downstream DESIGN wave.

---

## D1 — Feature type

**User-facing.** The feature changes how the UI is built (consumer of
a server-owned flow projection) AND how flows are tested (TS harness
driving the same server endpoints). Both audiences see observable
behavior changes; the feature is not a pure refactor.

## D2 — Walking skeleton vs brownfield extension

**Brownfield extension.** Precedent already exists for one flow:

* `backend/tests/integration/dataset_layer/harness.py`
  (`DatasetLayerHarness.chat_turn`) — a server-driven harness with
  retry budget and post-turn validation. This is the dataset-staging
  flow's de-facto state machine, expressed as test infrastructure.
* ADR-015 (`headless-presentation-state-retrieval`) — establishes
  server-owned per-channel UI directive log as a reflect-only,
  append-only resource that the FE consumes via `applyDirective`.
  This is the architectural pattern the new state-machine layer will
  generalize: **state lives server-side; the FE is a thin projection
  consumer; headless tests read from the same endpoint as the UI.**

The new feature **lifts the pattern from one flow (chat-driven dataset
staging) to all eight flows** (auth, org setup, project/session
management, upload, preview, transforms, view/report, dbt export).

The walking skeleton is therefore not "build the first flow" — it is
"build the surface that the first flow plugs into," using the
login-and-org-setup flow as the seed implementation (chosen because it
is the prerequisite for every other flow and is the friction point
that prompted this feature).

## D3 — UX research depth

**Comprehensive** — full emotional arcs, target affect per step, and
recovery design at error boundaries. This is appropriate because:

* The user's framing is product-shaped ("UI elements feel
  disconnected"), not infrastructure-shaped.
* The auth-and-org-setup flow has had real friction recently (JWKS
  warm-up, dev-mode token shape mismatch, etc.) — designing the
  emotional recovery path for that flow is high-leverage.

## D4 — JTBD applicability

**Yes.** A new job statement (JOB-002) is warranted — distinguishable
from JOB-001 by scope (all user flows, not just chat→dbt) and by
audience (the developer building presentation + the developer writing
acceptance tests are both first-class consumers, alongside the end
user). JOB-002 is drafted in §"JOB-002 draft" below for ratification
into `docs/product/jobs.yaml`.

## D5 — Why no DIVERGE wave

This codebase is brownfield (CLAUDE.md routes new features to DISCUSS
unless multiple solution paths are viable). The architectural pattern
is already partially established (ADR-015), and the user's framing
names the solution shape explicitly: *server-owned flow state
machines, drivable from Node, with the UI as a projection consumer.*
The remaining solution-space questions (XState vs hand-rolled reducer
vs Inertia-style; where the machines live; how the TS harness
composes) are DESIGN-wave decisions, not problem-framing decisions.

The absence of DIVERGE artifacts is a **noted risk**, not a blocker:

* No `docs/feature/user-flow-state-machines/diverge/recommendation.md`
* No `docs/feature/user-flow-state-machines/diverge/job-analysis.md`

Mitigation: DESIGN wave (solution-architect) is responsible for
considered options and rejected alternatives. The DISCUSS handoff
package lists the two big architectural decisions to seed that
conversation: (a) where the state-machine layer lives, (b) what runs
the machines.

## D6 — Scope-management strategy (orchestrator-imposed)

The user listed eight flows in scope:

1. Login + WorkOS callback
2. Org setup (CreateOrg)
3. Project + chat session management
4. Dataset upload (chat-driven and direct)
5. Table/dataset preview
6. Transform toggles (cleaning preview/apply/undo)
7. View + report creation
8. dbt export

Comprehensive depth across eight flows would balloon the DISCUSS
output. The orchestrator therefore imposed a **tiered-depth
strategy** that this wave honors:

| Tier | Treatment | Output |
|------|-----------|--------|
| **Tier A — Deep-dive** | Login + Org Setup (combined as `login-and-org-setup`) | Full visual + YAML + emotional arc + shared artifacts + Gherkin + LeanUX stories with AC |
| **Tier B — Catalog** | Other 7 flows | 1-2 paragraph entries in `journey-inventory.md` with entry/exit/emotional touchpoint; placeholder story-map column |
| **Tier C — Future** | Next DISCUSS passes | One flow per pass, sliced under the same architecture |

**Why login-and-org-setup is the deep-dive:**

1. **Recent friction.** The user just spent ~1 hour debugging
   auth-proxy JWKS warm-up + `DEV_AUTH_TOKEN` shape mismatch +
   WorkOS callback wiring. The flow is fresh in mind.
2. **Precondition for everything else.** Every other flow assumes
   "user is authenticated, org is set up."
3. **Cleanest demonstration of the pattern's value.** The
   auth/JWKS/cookie/token-shape state we just spent an hour
   reconciling is precisely the kind of state that, if owned by a
   server-driven state machine instead of being re-derived on the FE
   and in each test, would not have caused the friction.

## D7 — Phase 2.5 carpaccio scope

Slices are emitted only for `login-and-org-setup` (deep-dive). Other
flows appear in the story map as **placeholder columns** with a
single "to be detailed in next DISCUSS pass" stub. This keeps the
horizontal backbone honest while bounding the writing cost.

---

## Prior-wave consultation results

### `docs/product/jobs.yaml` — JOB-001 relevance

JOB-001 ("Validate chat-driven workflows across the eject-to-dbt
boundary") is **directly relevant**, especially these
outcome statements:

| Outcome | Status | Relevance to `user-flow-state-machines` |
|---------|--------|------------------------------------------|
| O3 — Minimize effort to keep tests valid when chat protocol changes | **under-served** (score 15) | New TS harness on top of state machines is the move that improves this outcome. |
| O4 — Maximize reuse of validation logic between in-app tests and ejected dbt | **under-served** (score 16) | Shared server-side state machine = shared validation surface. |
| O5 — Minimize marginal cost of adding the next user-flow test | **marginal** (score 12) | This is the linchpin outcome JOB-002 directly inherits and pushes. |

**Implication for DESIGN:** the new feature should be designed so it
**improves JOB-001's under-served outcomes** while serving JOB-002.
The existing Python integration tests (`DatasetLayerHarness`) stay
intact as the backend+agent contract guard; the new TS layer
**composes with** them, not replaces them.

### `docs/product/architecture/brief.md` — relevant constraints

Inherited from the architecture brief and ADRs:

| Source | Constraint | Effect on this feature |
|---|---|---|
| ADR-014 | ChatEvent vocabulary is stratified (`DomainEvent` and `UiDirective` parallel unions in `shared/chat/events.ts`) | The state-machine layer must respect the same stratification. State transitions emit DomainEvents; UI projections are derived. |
| ADR-015 | Headless presentation-state retrieval via reflect-only directive log; FE applies in-process via `applyDirective` | This feature **generalizes** ADR-015's pattern from one log-per-channel to N machines-per-flow. The FE's `applyDirective` flow is the prototype. |
| ADR-016 | Integration-test compose stack mirrors prod topology (5 services through auth-proxy) | The new TS harness must also route ingress through auth-proxy in any acceptance suite, mirroring `DatasetLayerHarness`. |
| ADR-017 | SessionEventReader uses capability-presence dispatch (Stream.io > Redis > noop) | The state-machine persistence backend has the same choice. Align with whatever ADR-017 chose. |

### `docs/product/journeys/` — not yet present

This DISCUSS bootstraps the directory. `journey-inventory.md` and
`login-and-org-setup.yaml` are the first two journey artifacts to land
under `docs/product/journeys/`.

### Absent SSOTs (noted, do not block)

* `docs/project-brief.md` — not present.
* `docs/stakeholders.yaml` — not present.
* `docs/product/vision.md` — not present.

These are bootstrapped lazily by features that need them; this
feature does not.

---

## JOB-002 draft (for ratification into jobs.yaml)

> **id**: JOB-002
> **title**: Drive every user flow through a server-owned state machine that UI and tests share
> **abstraction_layer**: strategic
> **statement**: When a Dashboard Chat user moves through any of the
> product's flows (auth, org setup, project/session management, upload,
> preview, transforms, view/report, dbt export), I want the flow's state
> to be owned by a single server-driven state machine — drivable from
> the Node server, projected to the UI, and assertable by a TS
> headless harness — so that the presentation layer is a thin consumer
> of a single source of truth instead of N React state machines that
> re-derive flow logic and drift from production.
> **emotional_layer**: When I add a new user flow OR a new flow test, I
> want the marginal cost to be defining one new machine — not editing
> N coordinated places (FE component state, FE test setup, Python
> integration harness, agent prompts).
> **social_layer**: When I show this codebase to a new contributor, I
> want flow state to look like *one obvious file per flow* — not a
> spelunk through React components, TanStack Query keys, and Python
> harness adapters to reconstruct what "logged in and org set up"
> means.
>
> **outcome_statements (proposed; ODI-style scoring deferred to a
> formal DIVERGE if/when revisited):**
>
> | id | text | importance | satisfaction | score | status |
> |---|---|---|---|---|---|
> | O1 | Minimize the time it takes to add a new user flow's headless test | 9 | 2 | 16 | under-served |
> | O2 | Minimize the divergence between what the UI shows and what a headless test asserts | 9 | 3 | 15 | under-served |
> | O3 | Minimize the cost of changing one flow's transition rules (one place, not N) | 8 | 3 | 13 | under-served |
> | O4 | Minimize the time-to-recovery when a flow hits an unexpected state (visible error UI + same error from the harness) | 7 | 4 | 10 | marginal |
> | O5 | Maximize the reuse of flow assertions between dev (TS harness) and acceptance (Python integration suite) | 8 | 4 | 12 | marginal |
>
> **references**: this discuss/ directory; ADR-015 (precedent
> pattern); `backend/tests/integration/dataset_layer/harness.py`
> (precedent harness).

---

## Risks

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| R1 | DIVERGE was skipped — DESIGN may surface options requiring a re-frame | Medium | Medium | DESIGN wave (solution-architect) explicitly enumerates options + rejected alternatives. If a fundamental re-frame surfaces, escalate to DIVERGE. |
| R2 | Tiered-depth strategy under-specifies 7 of 8 flows; downstream waves may need more depth before DELIVER | Medium | Low | Each subsequent flow's deep-dive is a separate DISCUSS pass; no flow ships to DELIVER without its own carpaccio slices. |
| R3 | The Python integration suite (`DatasetLayerHarness`) and the new TS harness could drift in vocabulary | Low | High | DESIGN wave names the shared vocabulary (likely the state-machine event log itself, projected to both languages). Mirror ADR-015's reference-reducer-in-shared-chat approach. |
| R4 | XState vs hand-rolled vs Inertia is a big DESIGN decision; bad choice creates lock-in | Medium | Medium | DESIGN wave produces an ADR with explicit option comparison before any code lands. |

---

## Round-2 iteration (2026-05-11, post-reviewer-approval)

The first DISCUSS pass was approved by an independent reviewer (Eclipse). The
user surfaced two additional constraints during the approval read-through that
materially change the option set DESIGN must weigh and add a cross-cutting
requirement that was implicit in the architecture but not explicit in the
DISCUSS artifacts. Both changes are **additive surgical edits**, not a rewrite.

### D8 — Hard constraint: the agent stays the chat brain

The user directive (verbatim):

> "I want agent to remain dedicated to chat brain interface. When I was
> talking about driving tests with server-side state machines, I was thinking
> about the ssr features of something like next.js. The idea being api
> endpoints and presentation could use the same state machines, so the
> frontend just reloads after api call and should see the same state as
> backend."

**Effect on the option set**:

* The `agent/` (Hono worker) keeps its current scope: SSE streaming via Groq
  + tool dispatch + ADR-015's narrow per-channel UI directive log. It is
  **not** a candidate host for the ui-state-machine layer.
* Original OQ-1 ("Where does the state-machine layer live?") and OQ-2 ("What
  runs the machines?") collapse into a single question framed around
  **SSR-style frameworks where API endpoints and presentation share state
  machines** — see `handoff-design.md` Round-2 §"Architecture option matrix".
* The user's mental model anchor: "the frontend just reloads after an API
  call and should see the same state as the backend." This shape points
  hardest at **Inertia.js** (server returns `{component, props}` per route;
  every navigation is a server round-trip) and secondarily at **Remix**
  (per-route loaders re-run on every action). Vanilla SPA + client-side
  XState is still on the table as the lowest-delta option, but DESIGN must
  recognize that the UI/test divergence problem JOB-002 names does not go
  away on that path — the server still does not own flow state.
* React + XState as building blocks is **committed**; the framework choice
  is the open variable.

### D9 — Cross-cutting scope chain (Org → Project → Dataset/View/Report → context-UIs)

The user directive (verbatim):

> "Something that is critical to chat interaction and navigation is the
> relationship between Org, Project, and Dataset/View/Report. The user is
> always in an Org context, chat is always in a Project context scoped to an
> Org but may need to decide what datasets are in the scope of the request,
> Datasets/Views/Reports belong to a Project (maybe later user permissions)
> are added. Then there are things like the transforms, data preview, and
> sql preview which are context dependent."

**Effect on this wave's artifacts**:

The scope chain is:

```text
User (authenticated)
  └─ Org (always present, single)
       └─ Project (chat always operates inside one; user may have many)
            ├─ Dataset  (belongs to project; chat MAY scope further to one or more)
            ├─ View     (belongs to project; built from one or more datasets)
            └─ Report   (belongs to project; aggregation on datasets+views)
                 └─ Context-dependent sub-UIs (transforms, data preview, SQL preview)
                      [scoped to the active Dataset/View/Report]
```

Future: user permissions inside org/project.

The chat agent needs to know: `org_id` (always), `project_id` (always), and
may need to negotiate `dataset_id[]` for in-request scope. This is
load-bearing for **every flow in the inventory** except login itself, and
is now a **first-class shared artifact** (`active_scope`) in
`shared-artifacts-registry.md` with HIGH integration risk.

**Effect on the option set**: framework choice MUST express scope inheritance
cleanly. Inertia's `shared props` pattern, Remix's `useRouteLoaderData`, and
Next.js parallel-routes + `layout.tsx` express this naturally. Vanilla SPA +
client-side XState requires manual context plumbing — exactly the kind of
plumbing that has historically drifted in this codebase (the ChatView
project-context race from the recent debugging session is the canonical
example).

### Round-2 risk additions

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| R5 | A framework chosen for ergonomic reasons (e.g., vanilla SPA + XState) fails to express the Org/Project/Dataset scope chain cleanly, forcing manual context plumbing that drifts (recapitulating the ChatView project-context race) | Medium | High | DESIGN ADR must score each option explicitly against the scope-chain expressibility criterion (`handoff-design.md` Round-2 §"Architecture option matrix"). Vanilla SPA cannot win this criterion without proposing explicit middleware (e.g., a route-level scope resolver). |
| R6 | The chat agent (worker) currently receives `project_id` ad-hoc per request; if `active_scope` is moved to a server-rendered prop bag, the agent must continue to receive `project_id` (and may need `dataset_id[]` per turn) from the same authoritative source | Low | Medium | DESIGN names the contract: every agent-bound request carries `active_scope`; the agent does not derive it from a separate fetch. |
