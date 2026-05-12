# DISCUSS → DESIGN Handoff — `user-flow-state-machines`

> **Wave**: DISCUSS → DESIGN
> **Date**: 2026-05-11
> **From**: Luna (nw-product-owner)
> **To**: solution-architect (DESIGN wave)
> **Status**: DoR PASSED, self-review PASSED with caveats; orchestrator should re-run `nw-product-owner-reviewer` as an independent peer review before merging.

---

## TL;DR for the next architect

You inherit:

* One **deep-dive journey** (J-001 Login + Org Setup) fully
  specified — emotional arc, state machine, shared artifacts,
  integration checkpoints, failure modes, embedded Gherkin.
* **5 LeanUX stories** with DoR-passing AC, sized 1.5-3 days each.
* **5 measurable outcome KPIs** with baselines (most baselines are
  uninstrumented; DEVOPS owns establishing them).
* A **story map backbone** spanning all 8 flows, with 6 of them as
  stub placeholders for future DISCUSS passes.
* The **JOB-002 SSOT** committed to `docs/product/jobs.yaml`,
  compositional with JOB-001.

You are responsible for **one big architectural decision** (framework
choice; see Round-2 option matrix below) and **two smaller decisions**
(projection wire format; cross-machine freeze semantics).

> **Hard constraint (Round-2, user-imposed)**: the `agent/` (Hono worker)
> stays dedicated to the chat-brain interface — SSE streaming via Groq + tool
> dispatch + ADR-015's narrow per-channel UI directive log. It is **not** a
> candidate host for the flow-state-machine layer. The user's mental model is
> SSR-shaped: "API endpoints and presentation could use the same state
> machines, so the frontend just reloads after an API call and should see the
> same state as the backend." React + XState are committed as building
> blocks; the framework choice is the open variable. See
> `wave-decisions.md` §D8.

A third, smaller decision: **how the projection is wired** —
SSE push, polling, or both. ADR-015 is the prior art (SSE push +
fetchable log); the new feature can probably extend that pattern.

---

## Artifacts produced (this wave)

### Feature-level (`docs/feature/user-flow-state-machines/discuss/`)

* `wave-decisions.md` — entry-point rationale, scope-management
  strategy (tiered depth), DIVERGE-skip rationale, risks,
  JOB-002 draft.
* `journey-inventory.md` — all 8 flows catalogued; 7 as
  one-paragraph entries with status `catalog` or `future`; 1 deep
  dive (`login-and-org-setup`).
* `journey-login-and-org-setup-visual.md` — ASCII flow + emotional
  arc + 6 step mockups + integration checkpoints + 5 failure modes.
* `journey-login-and-org-setup.yaml` — structured schema; states,
  transitions, emitted events, shared artifacts, integration
  checkpoints, embedded Gherkin per step, failure-mode tags,
  testing-surface definition.
* `story-map.md` — backbone across 8 columns; 3 carpaccio slices
  for the deep-dive column; placeholder stories for the other 7;
  priority rationale.
* `shared-artifacts-registry.md` — 6 deep-dive artifacts + 2
  cross-cutting; sources of truth, consumers, integration risk
  levels, validation checks (DISCUSS-time + DESIGN-deferred).
* `user-stories.md` — 5 stories (US-001 through US-005), LeanUX
  template, Elevator Pitch, real persona/data, embedded AC,
  outcome KPIs per story.
* `outcome-kpis.md` — 5 KPIs (K1-K5), north star + leading +
  guardrail hierarchy, measurement plan, hypothesis, DEVOPS
  instrumentation handoff section.
* `dor-validation.md` — 9-item DoR per story; ALL PASSED.
* `po-review.yaml` — self-review per
  `nw-po-review-dimensions`; 0 critical / 1 high / 4 medium / 6
  low. APPROVED with caveats.
* `handoff-design.md` — this file.

### SSOT updates (committed to product SSOT roots)

* `docs/product/jobs.yaml` — added JOB-002; added cross-references
  to JOB-001 outcome composition.
* `docs/product/journeys/_inventory.md` — bootstrapped the
  journeys SSOT directory; J-001 indexed; J-002 through J-007
  catalogued as future.
* `docs/product/journeys/login-and-org-setup.yaml` — J-001
  contract: states + transitions + shared artifacts + integration
  checkpoints + failure modes + testing surface. This is the
  inter-feature contract; future features composing on top of
  J-001 read this file.

---

## What's solid (you can build directly on this)

* The journey **state-machine seed** (named states + transitions
  + emitted events) is the architectural skeleton for J-001 and
  the template every subsequent journey will fill in. Whichever
  framework you pick (XState etc.), this skeleton maps 1:1.
* The **shared artifacts registry** names every cross-state
  variable with a source of truth. If your framework forces
  these to be derived (Suspense-style: render only when both
  `org.name` and `user.display_name` are in the projection),
  the "no flicker" K2 metric becomes mechanically true rather
  than dependent on instrumentation.
* The **integration checkpoints** (IC-1 through IC-6 in the
  journey YAML) are the cross-state invariants — they're the
  test surface for the framework itself. The TS harness should
  expose these as assertions.
* The **outcome-kpi instrumentation list** in `outcome-kpis.md`
  is ready for DEVOPS to scope into a one-day spike.

## What's open (DESIGN must answer)

> **Round-2 update**: OQ-1 ("where does the state-machine layer live?") and
> OQ-2 ("what runs the machines?") have been replaced by **OQ-1 (Round-2):
> Framework choice**, presented as an explicit option matrix below. The
> user has hard-constrained the agent OUT of contention (D8) and committed
> to React + XState as building blocks; the framework choice is the open
> variable.

### OQ-1 (Round-2): Framework choice — architecture option matrix

The user's mental model is SSR-shaped: "API endpoints and presentation could
use the same state machines, so the frontend just reloads after an API call
and should see the same state as the backend." That framing biases hardest
toward Inertia or Remix; Next.js is the most ambitious payoff but the
biggest mental-model shift; vanilla SPA + client-side XState is the
cheapest delta but does not resolve the JOB-002 divergence problem.

| Option | What it is | What it costs | Solves JOB-002 server-owned-state? | Expresses scope chain (D9)? |
|---|---|---|---|---|
| **A. Vanilla Vite SPA + client-side XState** | Keep current frontend; XState runs in the browser; state machines as React hooks. | Cheapest delta. | **NO** — server does not know flow state. The UI/test divergence problem JOB-002 names does not go away. | Manual context plumbing (the kind that drifted in the recent ChatView race). |
| **B. New BFF Node service ("flow choreographer") + XState server-side + React SPA reads projection over HTTP** | A NEW Node service (NOT the agent) owns state machines + projections. FE polls/subscribes for projection. Tests drive the choreographer's HTTP surface directly. | New service to deploy + observe; auth-proxy must know about it; meaningful new infra. | YES, fully. | Yes via projection shape, but the FE still has to wire scope into every component manually. |
| **C. Inertia.js (Hono adapter) + XState server-side** | Server returns `{component, props}` per route; every navigation is a server round-trip that re-renders props. React components mostly preserved; React Router removed; state-management shrinks dramatically. | 2-4 weeks for codebase of this size. Frontend container becomes a Node process. nginx still fronts everything. | YES — by construction. Closest semantic match to user's "FE reloads after API call → same state as backend" framing. | Yes — `shared props` express `active_scope` once at the layout/middleware boundary. |
| **D. Remix + XState server-side** | Per-route loader/action pattern; loaders re-run on every action. React components mostly portable. Vite has first-class Remix support. | 4-8 weeks. Chat SSE + agent integration need rework. | YES. | Yes — `useRouteLoaderData` + nested route layouts express scope inheritance cleanly. |
| **E. Next.js App Router + XState server-side** | Server Components + Server Actions; biggest mental-model shift; biggest payoff (colocate data fetching). | 6-12 weeks; Vite replaced by Next.js bundler. | YES. | Yes — parallel routes + `layout.tsx` express scope inheritance most naturally of all options. |

**User-signalled lean**: the "FE reloads after API call → same state as
backend" framing points hardest at **C (Inertia)** as the closest semantic
match, with **D (Remix)** as the next-closest. The user has NOT committed to
either; the framework choice is the DESIGN-wave deliverable. The PO surfaces
the user's preference shape; the architect picks the framework.

**Anti-preference (recorded)**: the user explicitly does not want the
flow-state-machine layer to live inside the agent/worker. Option A's
client-side XState is also a known anti-preference in the sense that it does
not resolve the JOB-002 divergence problem the user named.

### Smaller open questions (unchanged from iteration 1)

| OQ | Question | Why it matters | Recommended posture |
|----|----------|----------------|---------------------|
| OQ-3 | **Projection wire format** | SSE vs polling; full-state vs deltas. | Extend ADR-015's pattern: SSE push for live updates, GET endpoint for replay. Reach for full-state-per-event in the first cut; deltas are an additive future. In options C/D/E the wire format collapses into the framework's data fetching primitive (Inertia props / Remix loaders / Next.js Server Components) — re-evaluate after framework choice. |
| OQ-4 | **Where does machine state persist?** | In-process map vs Redis vs Postgres. | Mirror ADR-017's capability-presence dispatch (Stream.io > Redis > noop) — pick the same backend the session-event reader uses. Aligning persistence is the highest-leverage simplification this feature can request. |
| OQ-5 | **Cross-machine freeze semantics for `expired_token`** | US-005 AC requires "all other flow machines freeze their mutations during expired_token." How is this signaled? | Likely a framework-level pause/resume signal that every machine declares a handler for. Whether it's a top-level orchestrator state or peer-to-peer pub/sub is a DESIGN call. In option C, a 401 from any server-rendered route forces a re-render of the auth-bound layout — the freeze becomes mechanical. |
| OQ-6 | **TS harness composition pattern** | US-004 implies `harness.user_flow.begin_auth("maya")` style. Is the harness one class per machine, or one class with a sub-namespace per machine? | One class per machine, composed into a top-level facade. Mirrors `DatasetLayerHarness` shape; preserves the option of each machine's harness being independently testable. In options C/D/E the harness can drive HTTP routes directly (no test-only state surface) — re-evaluate after framework choice. |
| OQ-7 | **WCAG accessibility on recoverable-error panel** | Self-review HIGH issue. | Make the panel a `role="alertdialog"` with focus management on entry, correlation id in a copyable `<code>` block, sufficient color contrast. Standard pattern; cite in ADR. |
| OQ-8 | **Scope-chain expressibility** (Round-2) | The framework must let server-resolved scope (`active_scope = {org_id, project_id, resource_type?, resource_id?}`) flow into every projection/render. Inertia's `shared props`, Remix's `useRouteLoaderData`, and Next.js parallel-routes + `layout.tsx` all express this. Vanilla SPA + XState client-side requires manual context plumbing that has historically drifted (the ChatView project-context race). | The chosen framework must score "EXPRESSES NATURALLY" on the scope-chain criterion in the framework ADR. See `shared-artifacts-registry.md` §`active_scope` (HIGH risk) and Round-2 §"Scope-chain expressibility" below. |

---

## Constraints inherited from the architecture brief

| ADR | Constraint | How this feature respects it |
|-----|-----------|------------------------------|
| ADR-014 | ChatEvent vocabulary stratified into `DomainEvent` / `UiDirective` | Machine transitions emit `DomainEvent`s; UI projection is derived. Cross-machine signals (`expired_token`) are `DomainEvent`s, not directives. |
| ADR-015 | Reflect-only directive log; FE applies in-process via `applyDirective` | This feature **generalizes** ADR-015 from one-log-per-channel to N-machines-per-flow. Existing log endpoint is the prototype. The FE's `applyDirective` reducer is the simplest possible "what runs the machine" implementation; OQ-2 evaluates whether to keep that shape or replace with XState. |
| ADR-016 | Integration-test compose stack mirrors prod topology | TS harness routes through auth-proxy in any acceptance suite. No test-only backdoor. |
| ADR-017 | SessionEventReader capability-presence dispatch | OQ-4 — align state-machine persistence with whatever ADR-017 chose. |

---

## Test surface inherited

* **Python `DatasetLayerHarness`** stays as the backend+agent
  contract guard (JOB-001). It is not the surface JOB-002 wants;
  do not extend it to cover J-001.
* **New TS `UserFlowHarness`** is the surface JOB-002 wants. It
  composes with `DatasetLayerHarness` (a JOB-001-shaped test can
  call into the TS harness for auth setup and then into the Python
  harness for chat-turn validation) — both observe the same
  server-owned machines.

---

## DEVOPS handoff (platform-architect)

See `outcome-kpis.md` for instrumentation specs. Specifically:

* **8 FE events** + **2 auth-proxy/worker events** to instrument.
* **3 real-time dashboards** (K2/K3/K4).
* **3 paging alerts** on guardrails (auth-callback p95, K3
  recovery rate, K2 north star).
* **Baseline gap**: K1/K2/K3 have no current instrumentation;
  budget a one-day spike to land instrumentation BEFORE the
  framework so before/after is measurable.

---

## DISTILL handoff (acceptance-designer)

The acceptance-designer (Quinn / DISTILL wave) gets:

* `journey-login-and-org-setup.yaml` — embedded Gherkin per step
  is the acceptance-test seed.
* 5 stories with 4-5 UAT scenarios each = ~22 Gherkin scenarios
  ready for translation.
* 5 named failure modes in the journey YAML — extra negative
  scenarios per the JTBD-BDD integration playbook (job-map step
  coverage).
* Integration checkpoints IC-1 through IC-6 are the property-shaped
  invariants — should land as `@property`-tagged scenarios.
* Outcome KPIs in `outcome-kpis.md` — used by DISTILL to assert
  the measurement contract is achievable from inside acceptance
  tests where applicable (e.g., K1's "≤100ms" is testable
  end-to-end).

---

## Risks (carried forward to DESIGN)

| # | Risk | From wave-decisions | DESIGN owns |
|---|------|---------------------|-------------|
| R1 | DIVERGE was skipped | §R1 | Enumerate options + rejected alternatives in the framework ADR; if fundamental re-frame surfaces, escalate to DIVERGE. |
| R2 | Tiered-depth under-specifies 7 of 8 flows | §R2 | Confirm the framework's surface is general enough that J-002 through J-007 plug in without re-architecture. |
| R3 | Python and TS harnesses could drift | §R3 | Ensure both read from the same projection endpoint; same vocabulary; no test-only backdoors. |
| R4 | XState vs hand-rolled vs Inertia is a big call | §R4 | Produce an ADR explicitly comparing options before any code lands. |

---

## Open questions for the user (if any surface during DESIGN)

* None blocking. The architectural decisions are the user's to
  ratify after the DESIGN wave's ADR lands — DISCUSS does not
  pre-commit to a framework.
* If the framework choice turns out to require sequencing
  changes (e.g., XState adoption needs a separate infra spike
  before US-001 can ship), surface that immediately rather
  than smuggling it into a DELIVER plan.

---

## Round-2: Scope-chain expressibility (cross-cutting)

The user surfaced (Round-2) that a load-bearing cross-cutting requirement
was implicit in the architecture but not explicit in the DISCUSS artifacts:
**every flow except login itself operates inside a specific scope**.

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

**The framework MUST let server-resolved scope flow into every projection /
render**. This is now codified as:

* **`active_scope`** — a new HIGH-risk cross-cutting shared artifact in
  `shared-artifacts-registry.md`. Single source of truth, set on every
  navigation, included in every API/agent call.
* **US-002 (reframed)** — the "identity chips" are now **scope chips**:
  org chip + project chip always visible in the app shell; resource chip
  (dataset/view/report name) when a context-active resource exists. The
  K2 first-paint guarantee extends to include the project chip.
* **US-004 (extended)** — the TS harness must be able to assert on
  `active_scope` at every state; mismatched scope is a test failure with
  named columns of what diverged.
* **`journey-inventory.md`** — every flow other than login is annotated
  with its scope dependency (e.g. "requires `{org, project}`" or
  "requires `{org, project, dataset}`").

**How candidate frameworks express this**:

| Option | Scope-chain expression mechanism | Drift risk |
|---|---|---|
| A. Vanilla SPA + XState | React Context + custom scope-resolver hook. Every component reads from context. Wiring is manual at every layer. | **HIGH** — this is the exact shape that drifted in the recent ChatView project-context race. |
| B. New BFF service | Projection includes `active_scope`; FE reads it once per route render. Wiring is one place but every component still consumes manually. | Medium — single source helps but FE still has to opt every component in. |
| C. Inertia.js | **`shared props`** — `active_scope` is a shared prop set by route-level middleware on the server; every component sees it without prop drilling. Scope resolution is a server-side concern. | **LOW** — by construction. |
| D. Remix | **`useRouteLoaderData`** + nested route layouts — `active_scope` resolves at the layout loader for `/org/:org/project/:project`, inherits downward. Children read via `useRouteLoaderData("root-scope")`. | **LOW** — by construction. |
| E. Next.js App Router | **Parallel routes + `layout.tsx`** — `active_scope` resolves in a server-side layout; Server Components read it directly via `params`; Client Components read it via a small Context wrapper at the layout boundary. | **LOW** — by construction, and most ergonomically of the five. |

The chat agent contract (per Round-2 D8) is unchanged: the agent receives
`org_id` (always), `project_id` (always), and optionally `dataset_id[]` for
in-request scope. The framework must guarantee the agent gets these from the
authoritative source on every turn, not from a separate FE fetch.

---

## Suggested DESIGN deliverables

1. **Framework ADR** answering OQ-1 (Round-2), OQ-3, OQ-4, OQ-5, OQ-8
   in one document, with explicit scoring of the five options against:
   (a) server-owned-state fitness, (b) scope-chain expressibility,
   (c) effort, (d) lock-in risk, (e) compatibility with the agent's
   existing SSE-streaming contract.
2. **C4 Container/Component diagram** showing where the
   state-machine layer sits relative to FE, worker, backend,
   auth-proxy — and how `active_scope` flows from server-side
   resolution into every render.
3. **Domain model** for the machine — entity types, projection
   shape (must include `active_scope`), persistence schema.
4. **Test architecture extension** to `docs/product/architecture/brief.md`
   covering the new TS harness alongside the existing
   `DatasetLayerHarness`. Harness must support `assert_scope_matches()`.
5. **Migration plan** from the current scattered React state to
   the new pattern — likely strangler-fig over US-001/US-002,
   then incremental for each subsequent flow. If options C/D/E are
   chosen, the migration also retires React Router; sequence that
   carefully.
