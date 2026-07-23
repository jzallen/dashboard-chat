# ADR-024: Rebalance dbt-test-validation — Thin dbt-test Driver + Pandera Fast-Feedback Split

**Status:** Accepted — partially supersedes ADR-019
**Date:** 2026-05-11
**Accepted:** 2026-05-11 — all 5 phases merged on `origin/main` (Phase 0 `eb0cf40`, Phase 1 `ef42247`, Phase 2 `9797aa2`, Phase 3 `f73b2d5`, Phase 4 `b241afe`); promotion gated on Phase 4 green per migration-roadmap acceptance criterion.
**Bead:** TBD (assigned at DELIVER kickoff for Phase 0)
**Companion artifacts:**
- Prior decision: [ADR-019 — Eject-then-Test as the Dataset-Layer Validation Strategy](./adr-019-eject-then-test-validation.md)
- Shipped feature lifecycle: [docs/evolution/2026-05-11-dbt-test-validation.md](../evolution/2026-05-11-dbt-test-validation.md)
- Original design: [docs/architecture/dbt-test-validation/design.md](../architecture/dbt-test-validation/design.md)
- Migration roadmap: [docs/architecture/dbt-test-validation/migration-roadmap.md](../architecture/dbt-test-validation/migration-roadmap.md)
- Spike evidence: branch `spike/dbt-test-driver-simplification`, commits `f846d7d` (thin driver POC) and `b2c0c9f` (WS+M1+M5.1 reproduction)

## Context

ADR-019 ratified Option β (layered C+B): a per-flow `EjectAndTestOrchestrator`
that fetches the customer's exported dbt project, seeds a DuckDB profile,
invokes `dbtRunner.invoke()` for `deps`/`build`/`test`, and parses
`dbtRunnerResult.result` into an `EjectTestReport`; plus a per-turn
`PanderaValidator` for sub-200 ms shape feedback. The architecture shipped
green: 17 acceptance scenarios pass / 0 fail / 0 skip; backend gate stable
at 1338 passed; 5 Earned-Trust probes gate the orchestrator behind a
session-scoped fixture; three orthogonal enforcement layers (mypy/Protocol,
pytest-archon structural rule, behavioral CI gold-test) protect the probe
contract. JOB-001/O4 is satisfied by construction — the validation logic
in `tests/acceptance/dbt-test-validation/` IS what the customer runs when
they eject. Nothing in ADR-019 was wrong; the architecture earned its
ratification.

What ADR-019 could not see in advance is the cognitive-load profile that
emerged once the architecture lived under maintenance. The test
infrastructure carrying the load is large:

| Module | LOC | Role |
|---|---|---|
| `backend/tests/integration/dataset_layer/eject/orchestrator.py` | 418 | composes probes + seeder + runner + parser |
| `backend/tests/integration/dataset_layer/eject/probe.py` | 443 | the 5 Earned-Trust probes |
| `backend/tests/integration/dataset_layer/eject/parser.py` | 238 | `dbtRunnerResult.result` → `EjectTestReport` |
| `backend/tests/integration/dataset_layer/eject/seeder.py` | 209 | `DuckDBProfileSeeder` + env-var safety net |
| `backend/tests/integration/dataset_layer/eject/runner.py` | 106 | thin `dbtRunner.invoke()` wrapper |
| `backend/tests/integration/dataset_layer/eject/protocols.py` | 31 | `EjectOrchestratorProtocol` |
| `backend/tests/integration/dataset_layer/harness.py` | 1362 | facade — `chat_turn`, `eject_and_test`, `validate_with` hook, `StructuredRetryExhaustion` |
| `tests/acceptance/dbt-test-validation/steps/dbt_test_validation_steps.py` | 1126 | BDD step glue for 17 scenarios |
| `tests/acceptance/dbt-test-validation/test_behavioral_enforcement.py` | 136 | Earned-Trust contract test |
| **Test infra subtotal** | **~3,850 LOC** | |
| `backend/tests/integration/dataset_layer/validation/pandera_validator.py` | 143 | Pandera per-turn (kept separately under its own JTBD) |

The harness alone has grown from 695 → 1104 → 1362 LOC across three
iterations without scenario-count growth. The proximate causes are
known and recorded: ADR-014 wire-vocab churn, ADR-015 presentation-state
log, and the layering of `validate_with` + `eject_and_test` + the
structured retry exhaustion on top of `chat_turn`. The deeper cause is
structural: the BDD acceptance shape forces a generic harness facade to
absorb every per-flow concern. Each new concern adds a new method to
`harness.py` and a new step-glue entry to `dbt_test_validation_steps.py`,
and each future ADR-014-shaped change ripples through both.

A spike (branch `spike/dbt-test-driver-simplification`, commits `f846d7d` +
`b2c0c9f`) demonstrated that the customer-facing acceptance contracts of
`dbt-test-validation` — WS, M1 (happy-path / drift-detector /
customer-fidelity), and M5.1 (env_var rejection) — can be reproduced by a
thin `dbt_test_driver.py` at **~400 LOC**, with the five scenarios written
as procedure-shaped pytest tests calling the driver directly rather than
going through `harness.eject_and_test`. The spike's driver bundles
ProjectExporter (HTTP zip fetch + unzip), a minimal profile patcher, a
direct `dbtRunner.invoke()` call, and a thin result-parser into one cohesive
file. The probes do not survive in the spike driver because the failure
modes they catch surface as scenario errors (the driver fails loudly when
dbt-core is missing, when the export endpoint is unreachable, when MinIO
is unreadable — there is nowhere for these failures to silently pass).

The spike's recommendation is **PARTIAL_MIGRATION at ~80% confidence**:
keep the customer-fidelity acceptance contracts but reproduce them with
~9× less test infrastructure; keep the Pandera per-turn validator under
its own JTBD (developer fast-feedback ergonomics — sub-200ms shape check
during chat-turn authoring, a distinct value from the per-flow eject gate);
reclassify the chat-protocol invariants and retry-semantics tests out of
`dbt-test-validation` to their natural home (chat-protocol unit tests);
retire the M3 probe scenarios with the orchestrator they gate.

Three scenarios drive the timing of the decision:

1. **The next ADR-014 wire-vocab change is in progress.** A third refactor
   of `chat_turn` is anticipated. The current shape will absorb the churn
   the same way the previous two did: harness LOC up, scenario count
   unchanged, cognitive load up.
2. **The five M3 probes are infrastructure for an orchestrator we now
   doubt.** They are honest and load-bearing today (Earned Trust did its
   job five times during DELIVER — every Phase-0 substrate gap surfaced
   with a named probe reason rather than a silent green or confusing red).
   But they exist because the orchestrator is wired through a long
   composition chain (harness facade → orchestrator → seeder → runner →
   parser, each a separate file with its own state). The spike's driver
   collapses that chain; the failure modes either surface inline or never
   arise (no env_var substitution layer means no `probe_minio_readable_via_duckdb`
   to gate against).
3. **The per-turn Pandera layer has a different JTBD from the per-flow
   eject gate**, which ADR-019 acknowledged in passing (O3, O6) but did
   not isolate as its own thing. The spike clarified this: Pandera's value
   is **developer fast-feedback ergonomics during chat-turn authoring** —
   a sub-200ms shape check that triggers the AC1.5 rephrase loop without
   waiting for a 30-90 s eject cycle. That JTBD is independent of customer
   fidelity, and it survives under any per-flow validation scheme. Pandera
   should keep, but not as "the per-turn arm of β" — as its own thing with
   its own home.

Reading this carefully: the question is **not** whether ADR-019 was correct
(it was). The question is whether the rebalance the spike reveals is worth
the migration cost. The spike argues yes at ~3,000 LOC net deletion against
acceptance contracts that remain identical at the customer-facing surface,
with reversibility staged phase-by-phase.

## Decision

**Adopt the dbt-test driver pattern for the customer-fidelity acceptance
contracts (WS + M1 + M5.1).** Reproduce the five customer-fidelity scenarios
as procedure-shaped pytest tests calling a thin
`dbt_test_driver.py` (~400 LOC) that bundles export-fetch + unzip +
profile-patch + `dbtRunner.invoke()` + result-parse into one cohesive
module. Retire the `eject/` orchestrator family (orchestrator + probe +
parser + seeder + runner + protocols, ~1,445 LOC) and the harness's
`eject_and_test` method (and its supporting `validate_with` hook +
`StructuredRetryExhaustion` if they only support Pandera-on-`chat_turn`
which moves to a separate seam).

**Keep the per-turn Pandera validator under its own JTBD** (developer
fast-feedback ergonomics). The Pandera schemas (`OrdersStaging` and any
future shape) and the validator stay; the seam through which `chat_turn`
invokes them is reviewed in Phase 4 (see migration roadmap).

**Reclassify protocol invariants and retry-semantics scenarios** to a
chat-protocol unit-test home. M4 (AC1.4 raw-tool-call leak guard + ADR-016
ingress URL invariant) is protocol-shaped, not data-shaped. M2.2 + M2.3
(retry-success-on-rephrase + retry-exhausted-with-diff) and M5.2
(structured-retry-exhaustion) already monkeypatch
`PanderaValidator.validate` — they are protocol-level unit tests wearing
acceptance-test clothing.

**Retire the five M3 probe scenarios with the orchestrator they gate.**
The substrate-lie defense moves into the dbt-test driver's natural failure
behavior (the driver fails loudly when its dependencies are missing —
import errors, HTTP errors, dbt-runner errors). The behavioral enforcement
test (`test_behavioral_enforcement.py`) retires with the protocol it
enforces.

**Upstream `s3_use_ssl` into the exported `profiles.yml`** as Phase 0
of the migration. The spike's driver patches `profiles.yml` post-unzip to
add `s3_use_ssl: false` for MinIO. This works around a gap in the export
template: dbt-duckdb defaults `s3_use_ssl: true`, and any customer running
their ejected project against MinIO will hit the same wall. The fix
belongs in `backend/app/use_cases/project/_dbt/profiles_yml.py` — adding
`s3_use_ssl: "{{ env_var('S3_USE_SSL', 'true') | as_bool }}"` (Jinja-typed
to bool; default `true` preserves production behavior; MinIO operators set
`S3_USE_SSL=false`). This change benefits customers directly (one less
workaround they need to learn) and removes the spike driver's only
profile-patching workaround.

**Stage the migration in six phases**, each independently revertable; if
any phase fails its acceptance gate, prior phases stand and the rest do
not land. See companion migration roadmap for phase-by-phase scope, files,
LOC, MR size, acceptance criteria, reversibility, dependencies, and risk.

### What is being superseded (precisely)

ADR-019 §"Decision outcome" ratified Option β — per-flow
`EjectAndTestOrchestrator` + per-turn `PanderaValidator`. This ADR
supersedes the **realization** of the per-flow arm: the
`EjectAndTestOrchestrator` mechanism (orchestrator + probe + parser +
seeder + runner + the harness `eject_and_test` facade method) is replaced
by a thin `dbt_test_driver.py` invoked directly from procedure-shaped
acceptance tests. The β layering principle — per-flow eject for
customer-fidelity, per-turn Pandera for fast feedback — is preserved.
What changes is the shape of the per-flow arm: BDD-via-facade →
procedure-via-driver.

### What is NOT being superseded

- **JOB-001 / O4 strategic level.** Every customer-fidelity scenario still
  ejects the customer's artifact and runs it through `dbtRunner`. The
  customer's first run remains the last test run. T5 = 5/5 by construction.
- **The eject endpoint and the export use case.** `GET /api/projects/{id}/export/dbt`
  and `export_dbt_project` are untouched. Their unit tests stand.
- **The Pandera per-turn validator.** `PanderaValidator` and the
  `OrdersStaging` schema stay; only the seam through which they're invoked
  is up for review.
- **ADR-016 (5-service compose stack), ADR-007 (Ibis SQL generation),
  ADR-014 (ChatEvent stratification).** No topology change, no SQL-generator
  change, no wire-schema change.
- **AC1.6 (≤300s wall-clock per CI run).** The v2 driver path is faster
  than the v1 path (no probe phase at session start; no harness facade
  indirection), not slower. Wall-clock margin improves.
- **The Earned-Trust principle.** Earned Trust did its job during DELIVER —
  every Phase-0 substrate gap surfaced loudly. The principle survives;
  the *mechanism* changes because the substrate-lie surface area shrinks
  with the orchestrator's deletion. The dbt-test driver's failure modes
  surface directly (import errors, HTTP errors, dbt-runner failures) at
  the point of use; the substrate cannot lie quietly because there is no
  intermediate caching/gating layer where a lie can hide.

### Why the rebalance is worth its migration cost

1. **~3,000 LOC net deletion.** The orchestrator family (~1,445 LOC),
   harness `eject_and_test` + `validate_with` + `StructuredRetryExhaustion`
   (estimated ~300-500 LOC reduction), step glue for the 11 retiring/
   reclassifying scenarios (estimated ~400-600 LOC reduction),
   `test_behavioral_enforcement.py` (136 LOC), and the four retiring
   acceptance test files net to roughly 3,000 LOC of test infra removed.
   The new v2 driver and unit-test reclassifications add ~400-600 LOC.
2. **Cognitive load reduction is structural, not stylistic.** A future
   contributor reading "how does the eject gate work?" today must reason
   about the harness facade, the session-scoped fixture, the probing
   protocol, the orchestrator's composition of five components, and the
   step-glue indirection. After the rebalance, the same question is
   answered by one ~400-LOC file with five procedure-shaped tests next to it.
3. **The next ADR-014 wire-vocab change becomes cheaper.** The v2 driver
   does not go through the harness's chat-turn facade. ChatEvent vocab
   churn that previously rippled into `chat_turn` and from there into
   `eject_and_test` step glue no longer touches the customer-fidelity
   contracts. The chat-protocol invariant tests (the reclassified M4)
   absorb future wire-vocab work in their natural home.
4. **The probes were honest infrastructure for an orchestrator that no
   longer exists.** Retiring them is not a loss of Earned-Trust posture;
   it is recognition that the substrate-lie surface area collapsed with
   the orchestrator. The dbt-test driver's import errors and HTTP errors
   ARE the failure-loudness mechanism.

### Reversibility

Each migration phase is independently revertable (see roadmap). The
critical invariants:

- Phase 0 (upstream `s3_use_ssl`) is a 2-line addition to a Jinja template
  with a default that preserves production behavior. Trivial revert.
- Phase 1 (promote v2 driver, leave v1 suite running) is purely additive.
  Delete the new v2 directory to revert.
- Phases 2-3 (reclassify M4 + retry tests) replace acceptance scenarios
  with unit tests; reverts restore the .feature scenarios + step glue.
- Phase 4 (delete orchestrator + retire v1 suite) is destructive; it
  follows only after Phases 1-3 are green. Atomic sub-MRs by file family
  allow partial revert.
- Phase 5 (doc updates to ADR-019 + evolution doc) is two small edits.

## Alternatives Considered

### Alternative A — Full migration to the spike driver; retire Pandera too

**Rejected.** Pandera's JTBD is developer fast-feedback during chat-turn
authoring: a sub-200 ms shape check that engages the AC1.5 rephrase loop
before the user sees a wrong-shape result, and gives a workflow-vs-data
triage signal (JOB-001 O6). The per-flow eject cycle is ~85-105s; it
cannot fill the same JTBD. The spike's claim that "5 customer-fidelity
scenarios reproduce with 9× less infra" is about per-flow validation;
it does not refute Pandera's per-turn JTBD.

### Alternative B — Keep current architecture; address LOC via refactoring only

**Rejected.** The cognitive load is structural, not stylistic. Refactoring
the orchestrator's 1,445 LOC into smaller files (or applying RPP L1-L6
passes to the harness) does not reduce the **number of moving parts** a
future contributor must reason about. The orchestrator + probe + seeder +
runner + parser + harness-facade + protocol + fixture composition root
is six layers regardless of how the LOC is sliced. The spike's claim is
that five of those six layers are unnecessary once the dbt-test driver
replaces the BDD-via-facade shape.

### Alternative C — Reclassify everything (M4 + M2 retry + M5.2) to chat-protocol immediately, skipping the dbt-test driver entirely

**Rejected.** The WS + M1 + M5.1 customer-fidelity contracts ARE the
load-bearing acceptance contracts for JOB-001 / O4. They need a test home.
Removing them without a replacement leaves O4 unvalidated. The dbt-test
driver IS the replacement home. Reclassifying M4 + retry tests is
necessary but not sufficient; the customer-fidelity contracts must move
to the driver before the orchestrator can be retired.

### Alternative D — Sampled-eject (γ from ADR-019)

**Not the same decision.** γ addresses wall-clock pressure at M ≥ 3
regression flows (today M=1). γ is still applicable as a future
contingency under the rebalanced architecture (the dbt-test driver's
scenarios can be sampled via pytest marker the same way the orchestrator's
were). γ is preserved as a future option; ADR-024 does not retire it.

## Consequences

### Positive

- **~3,000 LOC net test-infra deletion.** Maintenance load drops
  proportionally. New contributors onboard against ~400 LOC instead of
  ~3,850 LOC.
- **Future ADR-014 wire-vocab churn no longer ripples into customer-fidelity
  contracts.** The dbt-test driver does not depend on `chat_turn`.
- **MinIO-running customers stop tripping on `s3_use_ssl`.** Phase 0 is a
  product improvement disguised as a test-infra fix.
- **Pandera per-turn validation is recognized as its own JTBD**, not as
  "the cheap arm of β." Future Pandera work (schemas, validators, fast-
  feedback ergonomics) has a coherent home.
- **The customer's first run is still our last test run.** JOB-001 / O4
  is preserved by construction; the **shape** of how we run it changes,
  not the **fact** that we run it.

### Negative / accepted trade-offs

- **Migration cost.** Six MRs across six phases; estimated total agent-
  time and review-time non-trivial. Mitigation: each phase is independently
  shippable and revertable; the migration can pause indefinitely between
  phases without leaving the codebase in a broken state.
- **Loss of explicit probe scenarios.** The five M3 probes were honest
  Earned-Trust gold-tests that surfaced five distinct Phase-0 substrate
  gaps during DELIVER. Their retirement is justified by the orchestrator's
  retirement (the probes have no substrate to gate), but the project loses
  the explicit substrate-lie test cases. Mitigation: the dbt-test driver's
  failure modes (import errors, HTTP errors, dbt-runner errors) surface
  inline at the point of use; substrate lies cannot hide. The behavioral
  CI gold-test pattern (uninstall a dep, assert loud failure) can be
  reintroduced for the dbt-test driver if desired — but it is no longer
  required to gate a session-scoped composition root because there is no
  session-scoped composition root.
- **Two concurrent test architectures during the migration window.**
  Between Phase 1 (v2 driver lands alongside v1) and Phase 4 (v1 suite
  deleted), both architectures run in CI. Mitigation: this is the
  reversibility property in action; the cost is acceptable for the
  reversibility benefit.
- **The `validate_with` hook may or may not survive Phase 4.** If Pandera
  per-turn moves to a separate seam (decided in the migration roadmap's
  Decision Records §5), the `validate_with` parameter on `chat_turn`
  retires with the rest of the eject-related harness extensions. If it
  stays, the harness retains one fewer concern but not zero. Both outcomes
  are acceptable; the decision is made in the roadmap.

### Operational

- **No production deployment change.** Phase 0 changes the exported
  `profiles.yml` template, which customers consume. Backwards-compatible
  by Jinja default: `S3_USE_SSL` defaults to `true`, preserving today's
  behavior for customers running against AWS S3.
- **No compose-stack change.** ADR-016 inheritance preserved.
- **`dbt-core`, `dbt-duckdb`, `pandera` remain test extras.** The runtime
  isolation guard at `backend/tests/unit/test_test_extras_isolation.py`
  stays. `backend/app/**` MUST NOT import them.

## Cross-decision composition

- **ADR-024 ↔ ADR-019** — Partial supersession. ADR-019's per-flow
  orchestrator mechanism is replaced; ADR-019's two-layer principle (per-
  flow + per-turn) is preserved. ADR-019 is **not retired** — it remains
  the foundational ratification of the eject-then-test direction; ADR-024
  rebalances the realization.
- **ADR-024 ↔ ADR-016** — Independent. Compose stack unchanged.
- **ADR-024 ↔ ADR-007** — Independent. Ibis still materializes the in-app
  DuckDB; the v2 driver still targets a separate DuckDB reading the same
  MinIO Parquet sources.
- **ADR-024 ↔ ADR-014** — The rebalance reduces ADR-014's blast radius
  into the validation surface. The dbt-test driver does not depend on
  ChatEvent vocab. Reclassified chat-protocol unit tests absorb future
  wire-vocab work in their natural home.
- **ADR-024 ↔ ADR-015** — Independent. Presentation-state log is
  orthogonal.
- **ADR-024 ↔ JOB-001 / O4** — Preserved by construction. The customer's
  first run is still our last test run; the **shape** of how we run it
  changes.

## Open questions

1. **Bead assignment for Phase 0.** This ADR is Proposed; a bead id is
   assigned at DELIVER kickoff for the Phase 0 upstream change.
2. **v2 driver final location.** Pick at Phase 1: `tests/acceptance/
   dbt-test-validation-v2/` during transition, renamed to in-place
   `tests/acceptance/dbt-test-validation/` after Phase 4 (the position
   taken in the migration roadmap). Open to reversal if a clean-cut-over
   path looks cheaper at Phase 1 kickoff.
3. **Pandera per-turn future home.** Decision Records §1 in the migration
   roadmap picks one; revisitable if Phase 4 reveals seam friction.

## References

- **Partial supersession of**: [ADR-019 — Eject-then-Test as the Dataset-Layer Validation Strategy](./adr-019-eject-then-test-validation.md). ADR-019 is not retired — its decision drivers (JOB-001/O4, AC1.6, ADR-016 fidelity, ADR-007 separation, Earned-Trust principle) all stand. This ADR partially supersedes ADR-019 by replacing the realization of the per-flow orchestrator mechanism.
- **Evidence base**: branch `spike/dbt-test-driver-simplification`, commits `f846d7d` (thin driver POC) + `b2c0c9f` (WS + M1 + M5.1 reproduction). The spike's findings doc was not merged into the repo; this ADR is the evidence record.
- **Companion migration roadmap**: [docs/architecture/dbt-test-validation/migration-roadmap.md](../architecture/dbt-test-validation/migration-roadmap.md) — six phases, each independently revertable.
- **Shipped feature lifecycle**: [docs/evolution/2026-05-11-dbt-test-validation.md](../evolution/2026-05-11-dbt-test-validation.md).
- **Original design**: [docs/architecture/dbt-test-validation/design.md](../architecture/dbt-test-validation/design.md).
- **Constraint ADRs** (all preserved): ADR-007 (Ibis), ADR-014 (ChatEvent stratification), ADR-015 (presentation-state log), ADR-016 (5-service compose), ADR-017 (SessionEventReader dispatch).
- **JOB-001**: `docs/product/jobs.yaml`.
- **Upstream profile-template fix target**: `backend/app/use_cases/project/_dbt/profiles_yml.py`.
- **Acceptance suite to be rebalanced**: `tests/acceptance/dbt-test-validation/` (17 scenarios — 1 WS + 3 M1 + 3 M2 + 5 M3 + 2 M4 + 2 M5 + 1 behavioral enforcement).
- **Test infrastructure to be retired**: `backend/tests/integration/dataset_layer/eject/` (~1,445 LOC), `tests/acceptance/dbt-test-validation/test_behavioral_enforcement.py` (~136 LOC), harness extensions (~300-500 LOC reduction).
- **Test infrastructure preserved**: `backend/tests/integration/dataset_layer/validation/` (Pandera validator + schemas — ~150 LOC), reviewed for future home in roadmap.
