# ADR-036: Failure-Simulation Module Location and Category Boundary

**Status:** Accepted (2026-05-14)
**Date:** 2026-05-14
**Originating wave:** DESIGN — `failure-simulation-consolidation`
**Resolves:** `docs/evolution/2026-05-15-failure-simulation-consolidation/discuss/open-questions.md` Q2
**Companion ADRs:** ADR-035 (gate composition), ADR-037 (audit sink), ADR-038 (naming + phase plan)

## Context

The failure-simulation registry owns the manifest, the gate, and the audit
emission. Today's 6 knobs and 3 inspection probes live in two services:

| Surface | Location today |
|---|---|
| Knob: `X-Force-Create-Project-Failure` | `ui-state/index.ts`, `ui-state/lib/machines/project-context.ts` |
| Knob: `X-Force-List-Sessions-Failure` | `ui-state/index.ts` |
| Knob: `X-Force-Create-Session-Failure` | `ui-state/index.ts`, `ui-state/lib/machines/session-chat.ts` |
| Knob: `harness_force_reissue_failures` body field | `agent/index.ts` |
| Event: `__harness_force_failure__` | `ui-state/lib/machines/login-and-org-setup.ts` |
| Event: `__harness_expire_token__` | `ui-state/lib/machines/login-and-org-setup.ts` |
| Inspection probe: `GET /debug/last-request-scope` | `agent/index.ts` |
| Inspection probe: `GET /debug/request-log` | `agent/index.ts` (via `agent/lib/chat/requestLog.ts`) |
| Inspection probe: `POST /debug/request-log/clear` | `agent/index.ts` |

ADR-033 commits the project to source-tree directory names that describe
**the body of source they contain**. ADR-028 commits to the constraint
that no machine imports another machine — anything cross-machine is a
service that machines depend on. The DISCUSS recommendation in
`open-questions.md` Q2 is `shared/failure-simulation/` (precedent:
`shared/chat/` per CLAUDE.md, already a workspace package).

The category-boundary question is separate: the `/debug/*` endpoints are
**inspection probes** (read-only observation), not failure simulation
(write-side state forcing). They share the ENVIRONMENT gate but they are
different shapes of solution. The choice is whether to co-locate them or
keep them separate.

## Decision drivers

- **ADR-033 source-tree honesty.** A directory's name describes its
  content. `shared/failure-simulation/` contains the failure-simulation registry
  source. `agent/lib/inspection/` contains the inspection probe source.
  Each name is accurate for the body of code it holds.
- **ADR-028 machine isolation.** Machines call into a service; they do not
  import each other. The registry is exactly that service. It must be
  importable from both ui-state and agent without either service depending
  on the other.
- **Existing precedent: `shared/chat/`.** CLAUDE.md establishes
  `shared/chat/` as "single source of truth for the chat event schema;
  imported by both `agent/` and `frontend/`." The failure-simulation registry
  is the same pattern: single source of truth for cross-service test-mode
  behavior, imported by both `ui-state/` and `agent/`.
- **Category vocabulary clarity.** "Failure simulation" and "inspection probe"
  are different categories with different semantics. Co-locating them in
  one module muddies the vocabulary the DISCUSS pass worked to clarify.
  Separate modules with a shared gate dependency keeps the vocabulary
  honest.
- **Conway-Law fit.** The team has no separate ownership of inspection
  probes — they are an agent-service concern. Keeping them in the agent
  source tree avoids creating a phantom owner.

## Considered options

### Option A — `ui-state/lib/failure-simulation/` (ui-state owns it)

The registry lives inside ui-state. Agent imports it via relative path or
a workspace dependency. Inspection probes stay in `agent/lib/inspection/`.

**Trade-offs:**

- (−) Cross-service import: agent does not otherwise depend on ui-state.
  Adding the dependency creates a cycle hazard.
- (−) Source-tree-name violation per ADR-033 spirit: the registry is
  logically shared, not owned by ui-state.
- (−) Test isolation: ui-state's test runner would have to load the agent
  callsites' contracts to verify them.
- Rejected.

### Option B — `shared/failure-simulation/` (shared workspace package), `agent/lib/inspection/` (inspection probes separate) — SELECTED

The registry lives in `shared/failure-simulation/` as a workspace package
alongside `shared/chat/`. Both `ui-state/` and `agent/` depend on it.
Inspection probes live in `agent/lib/inspection/` and import only the
gate decision from `shared/failure-simulation/`.

**Trade-offs:**

- (+) Honors the `shared/chat/` precedent (CLAUDE.md established convention).
- (+) Single source of truth: one manifest, one gate, one audit emitter,
  shared by all consumers.
- (+) ADR-033 source-tree honesty: each directory's name describes its
  content — the registry is `shared/failure-simulation/`; the probes are
  `agent/lib/inspection/`.
- (+) Category vocabulary preserved: "failure-simulation registry" and
  "inspection probes" stay nameable and findable.
- (+) Workspace dependency wiring is trivial — the npm workspace already
  consumes `@dashboard-chat/shared-chat`.
- (−) One additional workspace package to publish (internal-only; no
  external consumers).
- (−) Inspection probes share the gate dependency but not the module home.
  Devon must understand the boundary; documented in this ADR.

### Option C — per-service `lib/failure-simulation/` modules with only the manifest schema shared

Each service has its own `lib/failure-simulation/`. Only the manifest schema
(TypeScript type or JSON schema) is shared.

**Trade-offs:**

- (−) Duplicates gate logic in two places. Drift risk: ui-state and agent
  could implement the gate's interaction matrix differently.
- (−) Audit emission duplicated; correlation-id propagation across the
  ui-state→agent boundary becomes a per-implementation concern.
- (−) Earned Trust failure: two probes, two surfaces to verify; the
  consolidation goal is to have one.
- Rejected: drift risk is exactly the problem the consolidation exists to
  solve.

### Option D — co-locate inspection probes inside `shared/failure-simulation/`

The registry plus the probes both live in `shared/failure-simulation/`.

**Trade-offs:**

- (+) One module home for all gated test-mode behavior.
- (−) Conflates two categories the DISCUSS vocabulary deliberately
  separates: failure simulation (write-side, manifest-registered, audit-logged)
  vs inspection probes (read-side, route-registered, no manifest entry).
- (−) The probes need access to agent-internal state (`requestLog`,
  `last-request-scope`). Moving the probes to `shared/` means moving the
  state too, or threading it across the package boundary.
- Rejected: vocabulary cost is higher than the single-home benefit;
  category boundary is a feature, not a bug.

## Decision outcome

**Option B — `shared/failure-simulation/` for the registry; `agent/lib/inspection/`
for the inspection probes; both depend on the gate from
`shared/failure-simulation/gate`.**

### Module layout (specification — files listed, contents are DELIVER's job)

```
shared/failure-simulation/
  package.json              # @dashboard-chat/shared-failure-simulation
  tsconfig.json
  BUILD.bazel               # mirrors shared/chat/BUILD.bazel
  index.ts                  # public API surface (re-exports)
  manifest.ts               # the canonical knob list (typed entries)
  manifest.schema.ts        # Zod (or equivalent) schema for entries
  gate.ts                   # EVAL_GATE per ADR-035; probe() entrypoint
  registry.ts               # shouldInject(knobName, ctx); audit emit
  audit.ts                  # structured event emitter per ADR-037
  transports.ts             # header / event / body-field rendering helpers
  __fixtures__/             # mirrors shared/chat/__fixtures__/
    manifest-golden.ts      # frozen reference manifest for tests

agent/lib/inspection/
  index.ts                  # public API (registerInspectionRoutes)
  routes.ts                 # GET /debug/last-request-scope etc.
  README.md                 # explains the category boundary

ui-state/lib/                # no new directory — machines import shared/failure-simulation
  machines/login-and-org-setup.ts   # imports shouldInject from shared package
  machines/project-context.ts       # imports shouldInject from shared package
  machines/session-chat.ts          # imports shouldInject from shared package
  orchestrator.ts                   # composition root: gate.probe() at startup

agent/
  index.ts                  # composition root: gate.probe() at startup; conditional inspection-routes
```

### Public API of `shared/failure-simulation/` (surface only — signatures, not bodies)

The DELIVER wave implements these signatures; this ADR fixes the surface:

- `probe(env): GateVerdict` — startup probe; called once by each service's
  composition root before route registration or machine spawning. Returns
  the verdict and emits the startup log event.
- `shouldInject(knobName: KnobCanonicalName, ctx: InjectionContext): boolean` —
  the single decision point every callsite calls. Implements
  manifest-lookup + gate-check + audit-emit + verdict.
- `manifest: ReadonlyArray<KnobManifestEntry>` — typed, frozen at module
  load time. The `failure-simulation.manifest.ts` filename in the DISCUSS
  artifacts is the user-facing alias; the actual export is `manifest`.
- `assertKnown(knobName): void` — used by CI lint to validate that a name
  referenced in source has a manifest entry (US-CONSOL-5).

The exact TypeScript signatures, including `InjectionContext`, are
specified in `component-design.md`.

### Category boundary

| Category | Module | Manifest entry? | Audit log? | What it does |
|---|---|---|---|---|
| **Failure simulation** (write-side) | `shared/failure-simulation/` | Yes — 6 knobs | Yes — `failure-simulation.*` | Forces a deterministic failure at a port boundary in response to a header/event/body-field |
| **Inspection probes** (read-side) | `agent/lib/inspection/` | No | No (covered by the existing request log) | Exposes read-only observability endpoints under `/debug/*` |

Both consume `probe()` and `gate.verdict` from `shared/failure-simulation/`.
Inspection probes register their Hono routes conditionally based on the
verdict — when `disabled`, no `/debug/*` route is registered (returns 404,
not 403, per US-CONSOL-2 AC).

The boundary rule:

> Anything that *forces* a port-boundary failure is failure simulation
> (manifest-registered, audit-logged). Anything that only *reads* state
> is an inspection probe (route-registered, gate-shared, no manifest).

### Cross-service import topology (after the migration)

```
shared/failure-simulation/  ◄──── ui-state/ (all machines + orchestrator + index.ts)
        ▲
        │
        └──── agent/index.ts (registry calls)
                 │
                 └── agent/lib/inspection/ ◄── (uses gate.verdict only)
```

No source-tree directory depends on another peer source-tree directory
(`agent` does not import from `ui-state`; `ui-state` does not import from
`agent`). Both depend on `shared/failure-simulation/`. This is exactly the
shape of the existing `shared/chat/` dependency in CLAUDE.md.

### ADR-028 compliance check

ADR-028 forbids one machine from importing another. This decision does
not weaken that constraint:

- The registry is a **service** the machines call into via the typed
  `shouldInject()` function. It is not a state-graph mixin and does not
  participate in any machine's transition graph.
- Machines remain leaves of the actor tree. The orchestrator owns the
  composition-root call to `probe()`; individual machines never call
  `probe()` themselves.
- State-injection events (`__force_failure__`, `__expire_token__`) remain
  machine-local. The registry only mediates the env-gate, the manifest
  lookup, and the audit emission; it does not synthesize or forward
  events between machines.

### Earned Trust — module-location probe

Per principle 12, the module-location decision itself has an empirical
verification:

1. **Composition-root invariant (`wire then probe then use`):** every
   service whose source imports `shared/failure-simulation/` must call
   `probe()` exactly once at startup, before any route is registered or
   any actor is spawned. The audit log entry from `probe()` is the
   "I am wired" announcement.
2. **CI gold test (catalogued substrate lies):** the registry's test
   suite includes a process-level test that the audit log entry's
   `service` field correctly identifies the calling service. This
   catches the failure mode "I imported the registry but forgot to call
   `probe()` in this service's composition root."
3. **ArchUnit-style enforcement (three orthogonal layers):**
   - Subtype check: `tsc`'s structural-type check on the `probe`
     function signature catches misuse at compile time.
   - Structural check: a small AST script (added in DELIVER) scans
     `ui-state/index.ts`, `ui-state/lib/orchestrator.ts`, and
     `agent/index.ts` for a call to `probe()`. CI fails if missing.
   - Behavioral check: the CI gold test above exercises the registry
     end-to-end against a recorded startup-log fixture.

This is the Earned-Trust contract this ADR commits the project to. The
DELIVER wave implements it; the DISTILL wave writes the behavioral
fixture.

## Consequences

### Positive

- Source-tree honesty (ADR-033): each directory's name describes its
  content.
- Single source of truth for the failure-simulation surface across services
  — exactly the consolidation goal.
- Category vocabulary preserved: "failure simulation" and "inspection
  probes" stay nameable and findable.
- Conway-Law fit: no phantom ownership; the agent service keeps its
  read-only probes; the shared package owns the gate.
- Composition root wiring is explicit and auditable — every service that
  consumes the registry calls `probe()` once at startup, and the audit
  log records the wiring.

### Negative / accepted trade-offs

- One additional workspace package (`@dashboard-chat/shared-failure-simulation`)
  to maintain. Wiring overhead is bounded — `shared/chat/` is the existing
  template.
- Two module homes (`shared/failure-simulation/` and `agent/lib/inspection/`)
  for what an outsider might initially read as one feature. Documented
  in this ADR's category-boundary section and in
  `agent/lib/inspection/README.md` (DELIVER wave).
- Inspection probes still depend on the gate decision. The agent's
  composition root must call `probe()` from the shared package even if
  it has no knob callsites of its own. Documented in
  `component-design.md`.

### Neutral

- Future addition of inspection probes in `ui-state/` (if needed) would
  create a `ui-state/lib/inspection/` directory mirroring the agent's
  pattern. The category boundary scales by service.
- If a future feature blurs the boundary — e.g. a write-side probe that
  also reads internal state — a follow-up ADR ratifies the category
  reassignment. The boundary is rule, not law.

## Open questions

None. Q2 from `open-questions.md` is resolved by this ADR.

## References

- `docs/evolution/2026-05-15-failure-simulation-consolidation/discuss/open-questions.md` — Q2
- ADR-033 (source-tree topology separation) — primary constraint on
  directory naming
- ADR-028 (XState v5 actor model) — machine isolation constraint preserved
- CLAUDE.md "Shared" section — `shared/chat/` precedent for cross-service
  workspace packages
- `shared/chat/package.json`, `shared/chat/BUILD.bazel` — template for
  `shared/failure-simulation/` setup
