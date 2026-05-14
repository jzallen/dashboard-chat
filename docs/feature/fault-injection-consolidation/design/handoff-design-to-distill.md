# Handoff — DESIGN to DISTILL

`fault-injection-consolidation` — DESIGN-wave handoff package. The
DISTILL wave consumes this document plus the four ADRs
(`adr-035..038-*.md`), the C4 (`c4-context.md`), and the component
design (`component-design.md`) to author the BDD acceptance tests and
the `roadmap.json` for delivery.

## What DESIGN decided (one-line summary per question)

| Question | Decision | Artifact |
|---|---|---|
| Q1 — gate composition | AND-compose `ENVIRONMENT in {dev,ci}` with `FAULT_INJECTION_ENABLED=true`; deprecate `NWAVE_HARNESS_KNOBS` over one release | ADR-035 |
| Q2 — module location | Registry: `shared/fault-injection/` (workspace package). Inspection probes: `agent/lib/inspection/` (categorically separate; share the gate). | ADR-036 |
| Q3 — audit sink | Structured stdout (JSON lines), OTel-compatible field shape, no new infrastructure | ADR-037 |
| Q4 — naming + phase plan | Headers unchanged (`X-Force-*`); events/body field drop `harness_` prefix; three-phase migration with `legacyAlias` as the phase-1→2 bridge | ADR-038 |

## Public API surface DISTILL writes tests against

DISTILL's acceptance suite drives the registry through its public API.
The 27 BDD scenarios from `discuss/acceptance-criteria.md` are still
authoritative; this section enumerates the API surface so DISTILL knows
which assertions to write against which entry point.

### Entry points exposed by `shared/fault-injection/`

| Entry point | Signature (informal) | Tested by scenarios |
|---|---|---|
| `probe(env, serviceName)` | startup gate evaluation; emits `fault-injection.gate.{enabled,disabled}` | US-CONSOL-2: scenarios 1, 2, 3, 4, 5, 6, 7 |
| `shouldInject(name, ctx)` | per-request decision; emits `fault-injection.{fired,rejected}` | US-CONSOL-1: scenarios 1, 2, 4, 5; US-CONSOL-2: 3; US-CONSOL-3: 1, 2, 5 |
| `detectUnknownSignals(ctx)` | middleware-side typo / drift detection; emits `fault-injection.unknown` | US-CONSOL-1: scenario 3; US-CONSOL-3: 3 |
| `assertKnown(name)` | CI lint helper for the drift check | US-CONSOL-5: scenarios 1, 2, 3 |
| `manifest` (typed array) | the SSOT data structure | US-CONSOL-1: scenarios 4, 5; US-CONSOL-5: 4 |
| `KNOB` (typed const accessor) | autocomplete + typo-prevention for callsites | implicit; covered by TS compile checks rather than runtime scenarios |

### Entry points exposed by `agent/lib/inspection/`

| Entry point | Behavior | Tested by scenarios |
|---|---|---|
| `registerInspectionRoutes(app, verdict)` | conditional registration of `/debug/*` routes based on gate verdict | US-CONSOL-2: scenarios 1, 2, 5 |

### Audit-emitter contract

| Event name | Emitted by | Schema reference | Tested by scenarios |
|---|---|---|---|
| `fault-injection.fired` | `shouldInject` | ADR-037 event 1 | US-CONSOL-3: 1, 4, 5; cross-story integration: 1 |
| `fault-injection.rejected` | `shouldInject` | ADR-037 event 2 | US-CONSOL-2: 1, 7; US-CONSOL-3: 2; cross-story: 2 |
| `fault-injection.unknown` | `detectUnknownSignals` | ADR-037 event 3 | US-CONSOL-1: 2, 3; US-CONSOL-3: 3 |
| `fault-injection.gate.enabled` | `probe` | ADR-037 event 4 | US-CONSOL-2: 3, 6 |
| `fault-injection.gate.disabled` | `probe` | ADR-037 event 4 | US-CONSOL-2: 1, 2, 4, 6 |
| `fault-injection.config.deprecated` | `probe` (when legacy var present) | ADR-037 event 5 | US-CONSOL-4: 6 |

## Contract assertions (CI-enforceable rules)

These are invariants the design commits to. DISTILL writes the
executable tests; DELIVER wires them into CI.

### CA-1 — Manifest-vs-source drift

> Every fault-injection knob-name pattern appearing in production
> source under `ui-state/` and `agent/` must correspond to a manifest
> entry (matched by canonical name or `legacyAlias`).

**Test shape:** node script that greps for the knob-name patterns
(`X-Force-*`, `__force_*__`, `__expire_*__`, `force_*` body fields) and
diffs the matches against the manifest. Non-zero diff → CI failure.

**Maps to:** US-CONSOL-1 scenario 2, US-CONSOL-5 scenarios 1, 4.

### CA-2 — Schema validation at module load

> Every manifest entry satisfies `KnobManifestEntry` (TS) and
> `ManifestEntrySchema` (Zod). An entry with empty `rationale` or
> missing `contractTestAlternativeConsidered` crashes the import.

**Test shape:** unit test in `shared/fault-injection/` that asserts a
known-bad entry (built in the test) is rejected; a known-good entry is
accepted.

**Maps to:** US-CONSOL-5 scenarios 2, 3.

### CA-3 — Composition-root probe invariant

> Every service that imports `shared/fault-injection/` calls `probe()`
> exactly once at startup, before any route or actor is bound. The
> service's stdout for a fresh process contains exactly one
> `fault-injection.gate.enabled` OR `fault-injection.gate.disabled`
> event before any other `fault-injection.*` event.

**Test shape:** behavioral test that launches the service in dev mode
with a captured stdout, asserts the first
`fault-injection.*` event by timestamp is a gate event, and asserts
no gate event appears more than once per process lifetime.

**Maps to:** US-CONSOL-2 scenarios 6, 7.

### CA-4 — Verdict cache stability per process

> Within a single process lifetime, `shouldInject` returns a consistent
> verdict — the gate is evaluated once at `probe()`, cached, and
> reused.

**Test shape:** mutate `process.env` between two `shouldInject` calls
in the same process; verify the second call uses the cached verdict
from the original `probe()`.

**Maps to:** Earned-Trust principle 12 (substrate-lie catalog).

### CA-5 — Audit-event JSON conformance

> Every audit event emitted by the registry is a single line of valid
> JSON on stdout whose shape matches the ADR-037 schema for its
> `event.name` field.

**Test shape:** for each event type, fire a scenario that produces the
event; capture stdout; parse the captured line as JSON; assert the
shape via the Zod schema.

**Maps to:** US-CONSOL-3 scenarios 1, 2, 3.

### CA-6 — Correlation-id propagation across actor boundary

> An audit event emitted from inside an XState actor carries the
> originating HTTP request's correlation id, provided the actor's
> input includes it (per ADR-028 input-threading convention).

**Test shape:** acceptance scenario that fires
`force-create-session-failure` via the eager-create actor with a
known correlation id; assert the audit entry's `correlation_id`
matches.

**Maps to:** US-CONSOL-3 scenario 5.

### CA-7 — Inspection-probe conditional registration

> The agent's `/debug/last-request-scope`, `/debug/request-log`, and
> `/debug/request-log/clear` routes return HTTP 404 (route absent),
> not HTTP 403 (route present but denied), whenever the gate verdict
> is disabled.

**Test shape:** start the agent service with `ENVIRONMENT=staging` and
hit each `/debug/*` path; assert 404 for each.

**Maps to:** US-CONSOL-2 scenarios 1, 2, 5.

### CA-8 — Legacy variable honors via deprecation warning

> When only `NWAVE_HARNESS_KNOBS=true` is present (legacy) and
> `FAULT_INJECTION_ENABLED` is unset, `probe()` honors the legacy
> value AND emits `fault-injection.config.deprecated` once at
> startup.

**Test shape:** start a service with the legacy var only; capture
stdout; assert both the gate event with `gate.flag: true` AND the
deprecation event are present.

**Maps to:** US-CONSOL-4 scenario 6.

### CA-9 — Production behavior independent of legacy flag value

> With `ENVIRONMENT=production`, the verdict is `disabled` regardless
> of whether `NWAVE_HARNESS_KNOBS` is `true`, `false`, or unset; and
> regardless of `FAULT_INJECTION_ENABLED`.

**Test shape:** matrix test over the three legacy values × two primary
values, all under `ENVIRONMENT=production`; assert verdict is
`disabled` and reason is `environment_tier_denies` in all 6 cases.

**Maps to:** US-CONSOL-2 scenario 7; cross-story scenario 2.

## The 27 acceptance scenarios — classification

DISTILL turns each scenario into an executable BDD test. The
classification below distinguishes scenarios that **directly exercise
the new module's API** from those that **exercise migrated production
code through pre-existing user-facing behavior**.

### Group A — Directly exercise the registry's API (new tests, DISTILL writes from scratch)

These scenarios test the `shared/fault-injection/` package, the
audit emitter, the gate's `probe()`, or the inspection-probe
conditional-registration logic. They are net-new tests; nothing in
the existing acceptance suite covers them today.

- US-CONSOL-1 scenarios 1, 2, 3, 4, 5 (5 scenarios — manifest discovery, unknown-name rejection, typo hint, manifest contents, single SSOT)
- US-CONSOL-2 scenarios 1, 2, 3, 4, 5, 6, 7 (7 scenarios — gate verdict matrix, conditional probe registration, startup-event uniqueness, legacy-flag-independence)
- US-CONSOL-3 scenarios 1, 2, 3, 4, 5 (5 scenarios — audit emission for fired/rejected/unknown/absent/correlation-id)
- US-CONSOL-5 scenarios 1, 2, 3, 4 (4 scenarios — manifest drift / schema validation / 7th-knob walkthrough)
- Cross-story scenario 2 — hostile-environment integration test

**Total Group A: 22 scenarios.**

### Group B — Exercise migrated production code through user-facing behavior (existing tests + new assertions)

These scenarios are about the migration preserving observable
behavior. The existing acceptance suite already covers the user-facing
behaviors; the new scenarios add assertions that the migration didn't
break them.

- US-CONSOL-4 scenarios 1, 2, 3, 4, 5 (5 scenarios — adapter-phase suite passes, phase-1 zero-test-changes, phase-2 atomic per-rename commits, per-knob atomic commits, regression detection through audit log)
- Cross-story scenario 1 — all 6 knobs functional in dev compose after every story lands

**Total Group B: 6 scenarios.**

### Group C — Deprecation-specific

- US-CONSOL-4 scenario 6 — `NWAVE_HARNESS_KNOBS` deprecation warning + behavior preserved

**Total Group C: 1 scenario.**

**Grand total: 22 + 6 + 1 = 29 scenarios.** This is 2 more than the
`acceptance-criteria.md` count of 27 — the two extras are the
cross-story integration scenarios DISTILL should treat as first-class
tests (they were tagged as "cross-story" in the DISCUSS pass but they
have first-class behavior worth their own test entries).

If DISTILL prefers to keep the cross-story scenarios grouped with their
primary story, the count returns to 27 — the classification is a
mechanical re-grouping, not a content change.

## Acceptance-test surface map

For each story, where the tests live:

| Story | Suite location | Test runner |
|---|---|---|
| US-CONSOL-1 (registry + manifest) | `tests/acceptance/fault-injection-consolidation/` (new suite per CLAUDE.md per-feature pattern) | `cd tests/acceptance/fault-injection-consolidation && uv run --no-project pytest` |
| US-CONSOL-2 (gate) | same suite + `tests/acceptance/fault-injection-consolidation/test_gate_*.py` | same |
| US-CONSOL-3 (audit) | same suite + `tests/acceptance/fault-injection-consolidation/test_audit_*.py` | same |
| US-CONSOL-4 (migration) | existing `tests/acceptance/project-and-chat-session-management/` (the safety net) — no new tests, only assertions that pre-existing tests still pass through the migration | `cd tests/acceptance/project-and-chat-session-management && uv run --no-project pytest` |
| US-CONSOL-5 (sprawl) | same as US-CONSOL-1 suite | same |
| Cross-story 1 (all knobs functional) | existing `project-and-chat-session-management` suite | same |
| Cross-story 2 (hostile-env) | new `tests/acceptance/fault-injection-consolidation/test_hostile_environment.py` | same |

The new suite directory follows the existing per-feature pattern (each
has its own `pyproject.toml` + venv). DISTILL bootstraps the suite.

## Constraints DISTILL must respect

1. **Iron Rule.** Pre-existing acceptance tests in
   `project-and-chat-session-management/` were authored against the
   current wire contract. US-CONSOL-4's migration preserves that
   contract until phase 2 rename commits. DISTILL writes assertions
   for the *new* registry-driven behaviors; the migration MR (DELIVER)
   keeps the existing tests passing.

2. **No internal-class mocks.** Per CLAUDE.md and ADR-028, mocks only
   at port boundaries. The `shouldInject()` API is a port boundary by
   construction; the audit emitter is a port boundary. Internal
   functions (`matchTransport`, `readTier`) are not mocked.

3. **Audit-log assertion via stdout capture, not via mocked logger.**
   CA-5 says JSON conformance is verified by parsing actual captured
   stdout. DISTILL writes a test helper for stdout capture per service
   under test.

4. **Correlation id is propagated through XState `input`, not via a
   global.** CA-6 / ADR-028 — DISTILL's actor-side tests must pass
   correlation id explicitly via the actor's `input` parameter.

5. **Deprecation event is observable.** CA-8 says the
   `fault-injection.config.deprecated` event is emitted on the same
   startup as the gate event. DISTILL writes a test that captures
   startup stdout and asserts both events appear (order: gate event
   first, then deprecation, or vice versa — the design does not
   commit to an order).

## External integrations

None new. The registry has no external HTTP surface; it is in-process.

**No contract-test annotation required.** The existing external
integrations (Groq, WorkOS-or-equivalent IdP) are unchanged by this
design wave. Platform-architect's handoff package is the same one
established by earlier waves.

## Effort sizing — confirmation per story

The DISCUSS-wave sizing in `stories.md` ("PASS — 5 stories, estimated
6-8 days total"; each story S = 1-3 days) was confirmed during DESIGN.
No story shifts from S to M. Specifically:

| Story | DISCUSS estimate | DESIGN re-estimate | Drivers |
|---|---|---|---|
| US-CONSOL-1 | S (1-3 days) | **S** | Manifest is data; registry is ~6 functions; no infra |
| US-CONSOL-2 | S (1-3 days) | **S** | Gate algorithm fits in `gate.ts` (~50 lines); composition root is one call per service |
| US-CONSOL-3 | S (1-3 days) | **S** | Audit emitter is one function + types; no new sink infrastructure |
| US-CONSOL-4 | S–M edge | **S** (phased) | Three phases inside one MR; `legacyAlias` is the bridge so adapter-phase wire is identical |
| US-CONSOL-5 | S (1-3 days) | **S** | Drift check is a small node script; schema validation is Zod on existing types |

All five stories remain at S. The DESIGN wave introduced a transitional
`legacyAlias` manifest field (ADR-038) to keep US-CONSOL-4 phase 1 at
wire-identical, which holds the story at S despite carrying both the
adapter and vocabulary-cleanup concerns.

## What DISTILL produces

Per the wave map in CLAUDE.md, DISTILL writes:

1. **BDD acceptance tests** for the 27 (or 29, see classification
   above) scenarios. Group A scenarios go in the new
   `tests/acceptance/fault-injection-consolidation/` suite. Group B
   scenarios add assertions to existing suite scenarios.
2. **A `roadmap.json`** at the feature directory describing the
   delivery sequence and mapping each story to its commits.
3. **Walking-skeleton handoff to DELIVER** — DISTILL's RED state is
   DELIVER's input.

## Open issues / known unknowns

1. **`removal.target_release` semver value in
   `fault-injection.config.deprecated`.** The DESIGN ADRs (037, 038)
   commit to the field's presence and intent but not to a specific
   semver string. DISTILL's test should match a semver-shape regex,
   not an exact value, until DELIVER picks the string.

2. **Exact stdout-capture helper shape.** The acceptance suites today
   use various capture techniques (pytest's `capfd`, subprocess
   capture for full-service tests). DISTILL picks the helper shape
   when authoring the audit-log assertions.

3. **`detectUnknownSignals` middleware placement.** The component
   design specifies the function exists; the exact placement (Hono
   middleware position, before or after auth) is a DELIVER decision.
   Tests should not depend on middleware order.

These three are explicitly delegated to DISTILL or DELIVER — they
don't block the design handoff.

## DISTILL acceptance criteria for this handoff

DISTILL declares ready to begin when:

- [ ] Has read the four ADRs (035, 036, 037, 038).
- [ ] Has read `c4-context.md` and `component-design.md`.
- [ ] Has classified the 27 (or 29) scenarios into Group A / B / C per
  the section above.
- [ ] Has scaffolded `tests/acceptance/fault-injection-consolidation/`
  with its `pyproject.toml` per the CLAUDE.md pattern.
- [ ] Has confirmed the existing `project-and-chat-session-management/`
  suite is green at HEAD before adding any new assertions.

If any of the above fails, DISTILL returns to DESIGN for clarification.

## References

- ADR-035: gate composition (`adr-035-fault-injection-gate-composition.md`)
- ADR-036: module location (`adr-036-fault-injection-module-location.md`)
- ADR-037: audit sink (`adr-037-fault-injection-audit-sink.md`)
- ADR-038: naming + phase plan (`adr-038-fault-injection-naming-phase-plan.md`)
- C4 view: `c4-context.md`
- Component design: `component-design.md`
- DISCUSS handoff: `../discuss/definition-of-ready.md`
- DISCUSS scenarios: `../discuss/acceptance-criteria.md`
- DISCUSS open questions: `../discuss/open-questions.md` (all four resolved)
