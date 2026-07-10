# Migration Roadmap — Rebalance `dbt-test-validation`

> **Feature**: rebalance-dbt-test-validation
> **ADR**: [ADR-024 — Rebalance dbt-test-validation](../../decisions/adr-024-rebalance-dbt-test-validation.md) (Accepted, 2026-05-11 — partially supersedes ADR-019)
> **Status**: Shipped — all 6 phases (0–5) merged on `main`. This document is retained as the durable design record of the migration; the shipped-lifecycle narrative lives in [docs/evolution/2026-05-11-dbt-test-validation.md §Migration to dbt-test driver (ADR-024)](../../evolution/2026-05-11-dbt-test-validation.md#migration-to-dbt-test-driver-adr-024), which is the single source of truth for the rebalance outcome.
> **Spike evidence base**: branch `spike/dbt-test-driver-simplification`, commits `f846d7d` + `b2c0c9f`

## Summary

Six phases, each independently revertable. Phase 0 ships a small upstream
product improvement (native `s3_use_ssl` in the exported `profiles.yml`)
that also unblocks Phase 1's driver promotion. Phases 1-3 expand the
codebase (v2 driver + reclassified unit tests run alongside v1). Phase 4
deletes the orchestrator family and v1 acceptance scenarios in atomic
sub-MRs. Phase 5 cross-references the doc set.

Net effect after Phase 5: ~3,000 LOC of test infrastructure removed;
customer-fidelity acceptance contracts preserved at WS + M1.1 + M1.2 +
M1.3 + M5.1 (5 procedure-shaped scenarios calling a ~400 LOC driver);
Pandera per-turn JTBD preserved under its own home; chat-protocol
invariants and retry-semantics tests at their natural unit-test home.

## Order of phases — why this order

The order is dictated by safety, not convenience.

- **Phase 0 must precede Phase 1** because the v2 driver's `m1_happy_path`
  works around the `s3_use_ssl` gap by post-unzip patching. Promoting the
  driver while leaving the workaround in place would ship a non-customer-
  fidelity artifact (the workaround is invisible to customers, who hit
  the same wall fresh). Phase 0 dissolves the workaround.
- **Phases 2 + 3 reclassify scenarios out before Phase 4 deletes their
  hosts.** Reclassifying M4 and the retry tests shrinks the v1 suite
  monotonically and leaves a small, coherent set behind for Phase 4 to
  delete. Doing Phase 4 first would force a "delete then reclassify from
  the deleted thing" reverse, which is harder to reason about.
- **Phase 4 must follow Phases 1-3** because the orchestrator can only
  be deleted after every dependent scenario has moved.
- **Phase 5 must follow Phase 4** because we should not claim "migrated"
  in ADR-019's status update while the v1 suite still exists.

Each phase has its own acceptance gate. If any phase fails, prior phases
stand on their own and the rest do not land.

## Decision Records

These positions are taken before Phase 1 starts. They are revisitable if
phase execution reveals friction; revisits are tracked here.

### DR-1 — Pandera per-turn home

**Decision**: Keep `backend/tests/integration/dataset_layer/validation/`
as the home for `pandera_validator.py` and `schemas/`. Do NOT move to
a new directory.

**Rationale**: The Pandera per-turn validator is **integration-level**
test infrastructure (it runs against real `TableState.df` produced by the
real backend in the harness's `chat_turn` path). It is NOT unit-level
(no isolated component under test). The existing location is correct;
renaming would introduce import churn without conceptual gain. The signal
that "Pandera is not part of the eject pipeline" is carried by the
directory's content (no orchestrator, no eject references) after Phase 4,
not by a directory rename.

**Alternatives rejected**:
- `backend/tests/integration/dataset_layer/fast_feedback/` — proposes a
  new conceptual category for ~150 LOC. Categories cost cognition;
  earning one with two files is not worth it.
- `backend/tests/unit/validation/` — Pandera per-turn is integration,
  not unit. Moving it to `tests/unit/` would mislead.

### DR-2 — v2 layout

**Decision**: Phase 1 lands the v2 driver and its 5 scenarios at
`tests/acceptance/dbt-test-validation-v2/`, with its own `pyproject.toml`
+ venv. The v1 suite at `tests/acceptance/dbt-test-validation/` stays
untouched until Phase 4. Phase 4 deletes the v1 suite. **No rename of
v2 → v1** — the v2 directory becomes the canonical home. The
"-v2" suffix is informational during transition; after Phase 4 the
directory IS the only acceptance suite for dbt-test validation.

**Rationale**: Reversibility per-phase is the load-bearing property.
A side-by-side layout means Phase 1 is purely additive — delete the
v2 directory to revert. An in-place rewrite (shrink v1 from 17 → 5
scenarios) couples Phase 1 to Phase 4, which loses the staging benefit.
The `-v2` suffix survives only ~3-4 MRs (Phases 1-4); the cost of the
naming inconsistency is small and bounded; a post-Phase-4 rename MR is
cheap if desired.

**Alternatives rejected**:
- In-place rewrite at Phase 1 (shrink v1 to 5 scenarios). Couples
  Phase 1 to Phase 4. Loses partial revertability.
- Rename v2 → v1 at Phase 4 close-out. Optional later cleanup MR; not
  in the load-bearing path.

### DR-3 — WS contract under v2

**Decision**: v2 WS inherits the exact v1 contract:
`EjectTestReport.models_built >= 1 AND tests_run >= 1` only. No
strengthening (no "assert a specific named test ran").

**Rationale**: DWD-9 (from the v1 walking-skeleton hardening) is correct
in its scope: the WS proves the eject-then-test cycle ran end-to-end and
the parser observed results. Pass/fail assertions and named-test
assertions belong to M1, where fixture-driven setup makes outcomes
deterministic. Strengthening v2 WS would re-introduce the determinism
problem DWD-9 solved. The driver-shape change does not move the WS
contract; only the realization changes.

**Alternatives rejected**:
- "Assert `not_null_stg_orders_region` ran by name." This belongs to M1.1
  (drift-detector) where it already lives. Duplicating it at WS adds
  determinism risk without coverage gain.

### DR-4 — M3 probe coverage under v2

**Decision**: **(c) Acceptable risk — substrate lies surface as scenario
failures in CI.** The v2 driver does not inherit probes. The dbt-test
driver's failure modes (import errors when dbt-core is missing, HTTP
errors when the export endpoint is unreachable, dbt-runner errors when
MinIO is unreadable or `run_results` shape drifts) surface inline at the
point of use. There is no session-scoped composition root to gate against
substrate lies because there is no session-scoped composition root.

**Rationale**: The five M3 probes existed because the orchestrator was a
long composition chain (harness → orchestrator → seeder → runner → parser)
where a substrate lie at the bottom could silently pass at the top. With
the chain collapsed into one ~400 LOC driver, lies cannot hide — the
driver fails loudly at the call site, scenario-by-scenario. The behavioral
CI gold-test pattern (uninstall a dep, assert loud failure) is
reintroducible for the v2 driver if a specific lie surface needs explicit
test coverage; it is not required to gate a non-existent composition root.

**Alternatives rejected**:
- (a) v2 driver inherits probes. Reintroduces the composition root and
  the probe contract for ~400 LOC of driver. The probes' value scales
  with the surface area they gate; ~400 LOC is below the threshold.
- (b) v2 fails loudly at session start so probes are redundant. Conflates
  "fails loudly at session start" (a probe pattern) with "fails loudly
  at point of use" (the actual driver pattern). The driver pattern is
  what eliminates the gating need; (b) misnames it.

**Reversibility**: If a substrate-lie incident occurs post-migration that
the driver did NOT catch loudly, a single behavioral CI gold-test can be
added for that specific lie without restoring the orchestrator. The
mechanism is decoupled from the gating composition root.

### DR-5 — `validate_with` hook fate

**Decision**: The `validate_with=...` parameter on `harness.chat_turn`
**stays** through Phase 4. The `StructuredRetryExhaustion` class stays.
Pandera per-turn invocation continues to flow through the
`chat_turn(validate_with=schema)` hook. The hook is part of `chat_turn`'s
extensibility surface, not part of the eject infrastructure.

**Rationale**: M2.1 (the kept fast-feedback Pandera scenario — "shape-
correct validates within budget") drives Pandera through the
`chat_turn(validate_with=schema)` hook today. Moving Pandera to a separate
seam (e.g. a free function called post-`chat_turn` in test code) would
duplicate the engagement-with-rephrase-loop logic that the hook owns.
The hook is small, cohesive, and orthogonal to the eject machinery; its
LOC cost is paid for by M2.1's coverage. Deleting it would force M2.1
to invent a new wiring.

**Phase 4 shrinks `harness.py` by removing**:
- `eject_and_test(...)` method and its `_eject_orchestrator` plumbing
- `StructuredRetryExhaustion`? — see below. The class is referenced by
  the retry-semantics tests (M2.2, M2.3, M5.2) which reclassify in
  Phase 3. After Phase 3 the class has no callers in acceptance tests.
  If the reclassified unit tests still need it (they probably do, since
  it carries structured diff info), it stays as a small typed-exception
  module either in `harness.py` or extracted to a sibling
  `validation/retry_exhaustion.py`. Decision deferred to Phase 3 / 4
  boundary, not load-bearing for this ADR.

**Alternatives rejected**:
- Delete `validate_with` in Phase 4, force M2.1 to a separate seam. Adds
  ~30-50 LOC of wiring elsewhere; saves ~20 LOC in the harness. Net
  negative.

---

## Phase 0 — Upstream `profiles_yml.py` native MinIO support

**Scope**: Add `s3_use_ssl` env_var to the exported `profiles.yml` so
MinIO-running customers (and the v2 driver) do not need to patch the
profile post-unzip. Jinja-typed default (`true`) preserves AWS-S3
production behavior.

**Files**:
- `backend/app/use_cases/project/_dbt/profiles_yml.py` (+2 LOC) — add
  `"s3_use_ssl": "{{ env_var('S3_USE_SSL', 'true') | as_bool }}"` to the
  `dev` target's `settings` dict, between `s3_endpoint` and
  `s3_url_style`.
- `backend/tests/use_cases/project/test_export_dbt_project.py` — extend
  the existing tests for `export_dbt_project` to assert the new key is
  present in the rendered profile. Estimate +5-10 LOC.

**LOC**: +2 (src) / +5-10 (tests) / -0.

**MR size**: S.

**Acceptance criteria**:
- `pytest backend/tests/use_cases/project/test_export_dbt_project.py` passes with the new assertion.
- Manually render a profile and confirm `s3_use_ssl: "{{ env_var('S3_USE_SSL', 'true') | as_bool }}"` is present.
- The v1 acceptance suite (`./tools/test/test.sh --acceptance=dbt-test-validation`) still passes (the v1 seeder produces its own concrete profile.yml; this change does not affect it).
- Backend gate green: `./tools/test/test.sh --backend`.

**Reversibility**: Revert the 2-line addition. The Jinja default (`true`)
preserves prior behavior for AWS-S3 customers; MinIO operators previously
patched their profile manually and continue to do so on revert.

**Dependencies**: None.

**Why this order**: Phase 0 is the precondition for Phase 1's driver
promotion — promoting the v2 driver while it still patches the profile
post-unzip would entrench the workaround instead of removing it. Phase 0
also stands alone as a product improvement; if the rest of the migration
stalls, Phase 0 has independent value.

**Risk + mitigation**:
- **Risk**: A customer with `S3_USE_SSL` set to something unparseable by
  the `as_bool` filter (e.g. "yes", "1") gets a profile render error.
- **Mitigation**: Jinja `as_bool` accepts the standard strings (`true`,
  `false`, `True`, `False`); document the accepted values in the rendered
  profile's comment or in the export feature doc. Worst case the customer
  sees a clear render error and unsets the var (falling back to the
  default).

---

## Phase 1 — Promote spike driver to first-class infrastructure

**Scope**: Move `tests/spike/dbt_test_driver.py` to a canonical home and
rewrite WS + M1.1 + M1.2 + M1.3 + M5.1 as procedure-shaped pytest tests
calling the driver directly. The v1 suite stays running unchanged in
parallel.

**Files** (all under `tests/acceptance/dbt-test-validation-v2/` per DR-2):
- `pyproject.toml` — new acceptance-suite venv, mirroring v1's shape.
  Estimate ~40 LOC.
- `conftest.py` — fixture wiring for compose-up + auth + project bootstrap.
  Estimate ~80-120 LOC (slimmer than v1's conftest because no session-
  scoped probe fixture).
- `driver.py` — the dbt-test driver (~400 LOC per spike). Bundles:
  - `fetch_and_unzip(project_id, target_dir)` — HTTP GET to
    `/api/projects/{id}/export/dbt`, unzip to tmpdir.
  - `seed_profile(target_dir, minio_creds)` — write concrete `profiles.yml`
    (post-Phase-0, this is a thin substitution; pre-Phase-0 it patches
    `s3_use_ssl` post-unzip, but Phase-0 makes the post-unzip patch
    unnecessary).
  - `run_dbt(target_dir)` — sequential `dbtRunner.invoke(['deps'])` →
    `invoke(['build'])` → `invoke(['test'])` against tmpdir DuckDB.
  - `parse_results(dbt_runner_result) -> EjectTestReport` — translate
    `.result` into a structured value.
  - `TestReport` dataclass — `models_built`, `tests_run`, `failures`,
    `seeded_profile_bucket`, `seeded_profile_endpoint`.
- `test_walking_skeleton.py` — procedure-shaped WS test calling
  `driver.run(project_id)`; asserts `report.models_built >= 1 AND report.tests_run >= 1` (DR-3 inherit).
- `test_m1_happy_path.py` — happy-path: configure orders schema, run
  driver, assert pass.
- `test_m1_drift_detector.py` — Pandera/schema.yml drift: tighten Pandera,
  run driver, assert a named dbt test fails (carries the failing test
  name).
- `test_m1_customer_fidelity.py` — assert `seeded_profile_bucket` /
  `seeded_profile_endpoint` equal backend's MinIO config read from compose
  env.
- `test_m5_env_var_rejection.py` — unknown env_var in exported profile
  raises with a structured error (port of v1 M5.1; the spike's driver may
  or may not have this — Phase 1 adds it if the spike omitted it).
- `fixtures/orders.csv` — copy of v1's fixture (or symlink; pick at
  Phase 1 kickoff).
- `uv.lock`, `README.md` (small) — mirrors v1.

**Tooling**: `./tools/test/test.sh --acceptance=dbt-test-validation-v2`
selector added (or use existing flag mechanism). Confirm at Phase 1
kickoff.

**LOC** (rough):
- `driver.py`: ~400.
- 5 test files: ~50-80 each → ~250-400.
- `conftest.py`: ~80-120.
- `pyproject.toml` + lock + README: ~50-100.
- Total v2 add: ~800-1,000.

**MR size**: M.

**Acceptance criteria**:
- 5 v2 scenarios pass: WS, M1.1, M1.2, M1.3, M5.1 (`./tools/test/test.sh --acceptance=dbt-test-validation-v2`).
- v1 suite still passes (`./tools/test/test.sh --acceptance=dbt-test-validation`).
- Backend gate green (`./tools/test/test.sh --backend`).
- The v2 driver does NOT call `_patch_profiles_yml` workaround (the Phase 0 upstream fix dissolved the need).
- Wall-clock per v2 scenario ≤ v1 wall-clock per equivalent scenario (sanity check; AC1.6 is not regressed).

**Reversibility**: Delete the `tests/acceptance/dbt-test-validation-v2/`
directory. The v1 suite is unchanged.

**Dependencies**: Phase 0 (so the driver does not need the post-unzip
`s3_use_ssl` patch).

**Why this order**: Phase 1 is the first phase that demonstrates v2 viability
at the customer-fidelity surface. It is purely additive (v1 stays running),
so it is the lowest-risk way to land the architecture shift; failures here
do not affect the v1 suite.

**Risk + mitigation**:
- **Risk**: A v1 scenario the spike did not reproduce reveals a
  customer-fidelity contract the driver cannot express (e.g. some M1.3
  observable surface the spike missed).
- **Mitigation**: Phase 1 acceptance gate requires ALL 5 v2 scenarios
  green. If the gate fails on one scenario, the spike's 80% confidence
  needs review before Phase 2 starts; the migration can pause indefinitely
  with v1 running fine and the v2 directory present-but-flagged.
- **Risk**: Wall-clock regression on a v2 scenario (the driver is doing
  the same work, but the absence of probe pre-warming might shift the
  per-scenario cost profile).
- **Mitigation**: Measure first run on CI; if regression > 10%, profile
  and tune before promoting to "passing." If the spike's 9× LOC reduction
  cannot deliver the same or better wall-clock, the rebalance loses one
  of its claimed benefits.

---

## Phase 2 — Reclassify M4 protocol invariants

**Scope**: M4 (AC1.4 raw-tool-call leak guard + ADR-016 production-ingress
URL invariant) is protocol-shaped, not data-shaped. Move it out of
`dbt-test-validation` to a chat-protocol home.

**Decision: chat-protocol invariant location.** Place under
`backend/tests/integration/chat_protocol/` (or `backend/tests/integration/
dataset_layer/protocol_invariants/` if a closer-to-harness home is
preferred — pick at Phase 2 kickoff based on which existing module the
new tests most naturally compose with). The tests use the existing
harness `chat_turn` to drive flows; they assert on captured SSE
transcripts (AC1.4) and on `capture.fetch_url` (ADR-016 ingress). They
do NOT involve eject or Pandera.

**Files**:
- New: `backend/tests/integration/chat_protocol/test_raw_tool_call_leak_guard.py` (AC1.4) — ports v1's `Scenario: AC1.4 retention` step glue into a pytest function. Estimate ~50-80 LOC.
- New: `backend/tests/integration/chat_protocol/test_ingress_url_invariant.py` (ADR-016) — ports v1's `Scenario: ADR-016 production ingress` step glue into a pytest function. Estimate ~50-80 LOC.
- Delete: `tests/acceptance/dbt-test-validation/milestone-4-protocol-invariants.feature` (~30 LOC).
- Delete: `tests/acceptance/dbt-test-validation/test_milestone_4_invariants.py` (estimate ~30-50 LOC).
- Edit: `tests/acceptance/dbt-test-validation/steps/dbt_test_validation_steps.py` — remove the M4-specific step bindings. Estimate -80-120 LOC. (The 1126-LOC step glue is shared across all milestones; M4 contributes the smallest slice.)

**LOC**: +100-160 (new unit tests) / -140-200 (deletions) → net ~-40-60.

**MR size**: S-M.

**Acceptance criteria**:
- AC1.4 raw-tool-call leak guard still enforced (new test asserts SSE transcript contains no `__TOOL_CALL__:` prefix or equivalent).
- ADR-016 production-ingress URL invariant still enforced (new test asserts `capture.fetch_url` matches the expected ingress pattern).
- v1 suite collects 14 scenarios (was 16), all pass.
- v2 suite (5 scenarios) still passes.
- Backend gate green.

**Reversibility**: Revert removes the new tests and restores the M4
`.feature` + step glue. The deleted glue blocks are localized to M4-
tagged step bindings; revert is clean.

**Dependencies**: Phase 1 not strictly required, but recommended after
Phase 1 to keep the v1 suite shrinking monotonically (one direction of
change, easier to reason about).

**Why this order**: Phase 2 retires the smallest, most-clearly-misplaced
piece first. M4 scenarios are unambiguously protocol-shaped — no eject,
no Pandera, just SSE transcripts and URL inspection. Reclassifying them
first builds confidence in the reclassification pattern before the harder
Phase 3 retry-semantics reclassification.

**Risk + mitigation**:
- **Risk**: The new test home does not have the same fixture wiring as
  the v1 acceptance suite; ports need fixture surgery.
- **Mitigation**: Use the existing `backend/tests/integration/dataset_layer/
  conftest.py` fixtures as the starting point; they already wire compose-up
  + auth + harness. The new tests can sit next to or share fixtures with
  the existing dataset-layer integration tests.

---

## Phase 3 — Reclassify M2.2 / M2.3 retry + M5.2 retry-exhaustion

**Scope**: Move retry-with-rephrase (M2.2), retry-exhausted-with-diff
(M2.3), and structured retry-exhaustion (M5.2) to a chat-protocol unit-test
home. These three scenarios already monkeypatch
`PanderaValidator.validate` to drive deterministic pass/fail/exhaustion
paths — they are unit tests wearing acceptance-test clothing.

**Decision: retry-semantics test location.** Place under
`backend/tests/unit/dataset_layer/test_retry_semantics.py`. The tests
exercise `chat_turn`'s rephrase-loop logic by monkeypatching the
validator's verdict; they do not need the full compose stack (only the
harness's chat-turn machinery and a stubbed validator). Unit-style is the
right shape.

**Files**:
- New: `backend/tests/unit/dataset_layer/test_retry_semantics.py` — three
  tests:
  - `test_retry_success_on_rephrase` (M2.2 port).
  - `test_retry_exhausted_with_structured_diff` (M2.3 + M5.2 merged port —
    same underlying mechanism; M5.2 was M2.3 + structured-attribute
    assertion; merge or keep separate based on Phase 3 author's call).
  - `test_retry_budget_respects_ac15` — sanity check on the rephrase budget.
  Estimate ~120-180 LOC across three tests.
- Delete: `tests/acceptance/dbt-test-validation/milestone-2-validate-after.feature` scenarios "retry-success-on-rephrase" + "retry-exhausted-with-diff" (keep "shape-correct validates within budget" — M2.1 — in the v1 suite for Phase 4 retirement, OR migrate it to v2 here). Estimate -20-30 LOC of feature text.
- Delete: `tests/acceptance/dbt-test-validation/milestone-5-failure-modes.feature` scenario "retry-exhaustion-with-diff" (keep "env_var rejection" — M5.1 — which v2 already inherits). Estimate -10-15 LOC.
- Edit: `tests/acceptance/dbt-test-validation/test_milestone_2_validate_after.py` and `test_milestone_5_failure_modes.py` — remove the retry-related test methods. Estimate -50-80 LOC.
- Edit: `tests/acceptance/dbt-test-validation/steps/dbt_test_validation_steps.py` — remove the retry-related step bindings. Estimate -150-200 LOC.

**LOC**: +120-180 (new unit tests) / -230-325 (deletions) → net ~-100-145.

**MR size**: S.

**Acceptance criteria**:
- 3 retry-shape scenarios become 3 (or 2 if M2.3 + M5.2 merge) unit tests under `backend/tests/unit/dataset_layer/`.
- Retry-with-rephrase semantics still enforced (test asserts AC1.5 budget honored).
- Structured retry-exhaustion semantics still enforced (test asserts `StructuredRetryExhaustion` carries `prompt`, `attempts`, `validation_diff`, `sse_transcript` typed attributes).
- v1 suite collects 11 scenarios (was 14 after Phase 2), all pass.
- v2 suite (5 scenarios) still passes.
- Backend gate green; new unit tests count toward backend gate.

**Reversibility**: Revert restores M2.2 + M2.3 + M5.2 scenarios + step
glue and deletes the new unit-test file.

**Dependencies**: Phase 2 (keeps the v1 suite shrinking monotonically;
makes Phase 4's atomic deletions cleaner).

**Why this order**: Retry-semantics tests are subtler than M4 invariants
— they monkeypatch the validator and assert on rephrase-loop behavior.
Phase 2 builds confidence with the easier case before tackling these.

**Risk + mitigation**:
- **Risk**: The retry-loop logic in `chat_turn` requires real backend
  state to exercise; a pure unit test cannot reach it.
- **Mitigation**: The v1 step glue already monkeypatches
  `PanderaValidator.validate` — the test is already pseudo-unit-shaped.
  Port the existing monkeypatch into the new unit-test home. If it turns
  out a pure unit test cannot drive the rephrase loop (because `chat_turn`
  requires SSE machinery + a real session), promote to
  `backend/tests/integration/dataset_layer/test_retry_semantics.py`
  instead — it stays in the chat-protocol family but as integration. Decide
  at Phase 3 kickoff based on the spike port of the first test.

---

## Phase 4 — Retire harness extensions + eject infrastructure + v1 acceptance suite

**Scope**: With Phases 1-3 done, the harness `eject_and_test` method, the
`eject/` package (orchestrator + probe + parser + seeder + runner +
protocols), the v1 acceptance suite for dbt-test-validation, and the
behavioral-enforcement test become unreferenced or replaced. Delete in
atomic sub-MRs by file family.

**Sub-MR 4a — Delete behavioral enforcement test**:
- Delete: `tests/acceptance/dbt-test-validation/test_behavioral_enforcement.py` (136 LOC).
- Justification: The behavioral enforcement test gates the Earned-Trust
  probe contract on the orchestrator. With the orchestrator being deleted
  (sub-MR 4c), the test has nothing to gate.
- LOC: -136.
- MR size: S.
- Acceptance: backend gate green; v2 suite still green.

**Sub-MR 4b — Delete v1 acceptance suite (WS + M1 + M3 + remaining M2/M5)**:
- Delete: `tests/acceptance/dbt-test-validation/{walking-skeleton.feature, milestone-1-eject-and-test.feature, milestone-3-earned-trust-probes.feature, milestone-2-validate-after.feature, milestone-5-failure-modes.feature}` and their `test_*.py` counterparts and the `steps/` package.
- M2.1 (shape-correct validates within budget) — review at this sub-MR
  kickoff. Either (i) migrate to v2 as a sixth scenario (`test_m2_pandera_happy_path.py`); or (ii) move to `backend/tests/integration/
  dataset_layer/validation/test_pandera_per_turn.py` as a non-acceptance
  integration test (matching DR-1's keep-Pandera-where-it-is decision).
  Pick (ii) per DR-1; M2.1 is per-turn integration, not customer-fidelity
  acceptance.
- Estimate: -1126 (steps glue) - ~250 (test_*.py files) - ~150 (feature
  files) = ~-1,500 LOC.
- LOC: -1,500 (deletions); +30-50 (M2.1 port to validation/).
- MR size: L (split into smaller sub-sub-MRs if desired: one per feature
  file family).
- Acceptance: backend gate green; v2 suite still green; M2.1 lives at its
  new home and passes.

**Sub-MR 4c — Delete eject infrastructure + structural unit tests + protocol-invariant coupling** (EXPANDED 2026-05-11 per [adr-024-phase-4-blocker.md](../../research/adr-024-phase-4-blocker.md)):
- Delete: `backend/tests/integration/dataset_layer/eject/` entire package
  (`__init__.py`, `protocols.py`, `parser.py`, `orchestrator.py`,
  `probe.py`, `seeder.py`, `runner.py`) — 1,445 LOC.
- Edit: `backend/tests/integration/dataset_layer/conftest.py` — remove
  the session-scoped `eject_orchestrator` fixture and any imports of the
  eject package. Estimate -50-100 LOC.
- Edit: `backend/tests/integration/dataset_layer/harness.py` — remove
  `eject_and_test(...)` method (~80 LOC including docstring), the
  `_eject_orchestrator` plumbing (~20-40 LOC), and any related imports.
  Estimate -100-150 LOC. **Keep** `validate_with` parameter on `chat_turn`
  per DR-5; **keep** `StructuredRetryExhaustion` per DR-5 (still
  referenced by reclassified Phase 3 tests).
- Edit: `backend/pyproject.toml` — `dbt-core` and `dbt-duckdb` test
  extras: keep (the v2 driver consumes them). `pandera` test extra: keep.
- Edit: `backend/tests/unit/test_test_extras_isolation.py` — sanity-check
  the guard still passes (no `backend/app/**` imports of dbt-* or pandera);
  no changes expected.
- Delete: `backend/tests/integration/dataset_layer/protocol_invariants/test_ingress_url_invariant.py` (108 LOC) — structurally coupled to `EjectAndTestOrchestrator`. The ADR-016 production-ingress URL invariant the test asserts is satisfied by the v2 driver's construction (built only from `auth_proxy_url`, no internal-port fallback); the test is *about* the orchestrator's URL composition and dies with the orchestrator. The sibling `protocol_invariants/test_raw_tool_call_leak_guard.py` (Phase 2's other product) stays — it drives chat through `harness.chat_turn` and does not import eject.
- Delete (6 structural unit tests under `backend/tests/unit/`, ~1,886 LOC total — paths are flat, NOT `backend/tests/unit/dataset_layer/` as the original roadmap implied):
  - `test_eject_orchestrator.py` (587 LOC) — `EjectAndTestOrchestrator.probe()` + `eject_and_test()` happy + sad paths.
  - `test_dbt_runner.py` (242 LOC) — `DbtRunner.run_build_and_test()` against real dbt.
  - `test_run_results_parser.py` (311 LOC) — `RunResultsParser.parse()` shape contract.
  - `test_duckdb_profile_seeder.py` (244 LOC) — `DuckDBProfileSeeder` mapping `minio_creds` → `profiles.yml`.
  - `test_probe_happy_paths.py` (304 LOC) — the 5 earned-trust probes (substrate liveness checks).
- Reshape: `backend/tests/unit/test_harness_eject_validate_wiring.py` (198 LOC) — drop the 3 `eject_and_test`-wiring tests; keep the 1 `validate_after`-wiring test (DR-5; still referenced by Phase 3 retry tests and M2.1's port). Rename in place to `test_harness_validate_after_wiring.py` — in-place rename is the safer default; the surviving test composes with `backend/tests/unit/` fixtures (not the integration-layer conftest), so moving it under `backend/tests/integration/dataset_layer/validation/` would force a fixture port. Net ~-130 LOC.
- LOC: -3,481 to -3,581 (-1,595 to -1,695 original + -1,886 unit tests + -108 ingress invariant - ~-108 reshape).
- MR size: L (split per file family if desired).
- Acceptance: backend gate green; v2 suite still green; reclassified unit tests still green; M2.1 at new home still green; no module imports `backend.tests.integration.dataset_layer.eject` anywhere; pre-flight grep for `EjectAndTestOrchestrator|eject_and_test|from.*\.eject` against `*.py` returns ZERO matches.

**Sub-MR 4d — Shrink dataset_layer test step glue (only if remaining)**:
- After sub-MRs 4a/4b/4c, the `tests/acceptance/dbt-test-validation/` directory should be empty or near-empty. If empty, delete the directory.
- LOC: -50-100 (residual cleanup).
- MR size: S.
- Acceptance: backend gate green; v2 suite green; directory `tests/acceptance/dbt-test-validation/` is gone.

**Total Phase 4 LOC** (across sub-MRs, post-2026-05-11 expansion): roughly
-5,200 to -5,400 deletion, +30-50 addition (M2.1 port) → net ~-5,150 to
-5,350 deletion. (Pre-expansion estimate was -3,200 to -3,400 deletion;
the expansion added ~1,886 LOC from six structural unit tests and
108 LOC from the ingress invariant test — see [adr-024-phase-4-blocker.md](../../research/adr-024-phase-4-blocker.md).)

**Net migration LOC** (after Phases 1-4): -5,000 to -5,300 (revised; the
spike's "~3,000 LOC net deletion" claim measured only the integration-
test surface — the unit-test layer was undercounted).

**Reversibility per sub-MR**: Each sub-MR is independently revertable.
The order 4a → 4b → 4c → 4d is recommended; reversing requires reversing
in inverse order. If sub-MR 4c is reverted but 4b is not, the v1 suite
is gone but the orchestrator is back — recoverable but ugly. Atomicity
discipline matters most here.

**Dependencies**: Phases 1-3 (every dependent scenario has moved).

**Why this order**: Phase 4 is the destructive phase. Sub-MR ordering
deletes weakest-coupling first (behavioral enforcement test gates one
contract), then v1 suite (which already has zero customer-fidelity
coverage after Phases 1-3 moved everything), then the eject infrastructure
(which has no callers after the v1 suite is gone), then directory cleanup.

**Risk + mitigation**:
- **Risk**: A latent caller of the eject package or harness `eject_and_test`
  exists in a place not surveyed (e.g. an experimental notebook, a
  one-off integration test outside the surveyed paths).
- **Mitigation**: Phase 4 kickoff runs a full repo grep for
  `eject_and_test|EjectAndTestOrchestrator|from.*eject` and surfaces
  every match. Each match is either deleted with the package or
  reclassified.
- **Risk**: Sub-MR 4b deletes the v1 acceptance suite but the v2 suite
  has a hidden coverage gap not surfaced in Phase 1's acceptance gate.
- **Mitigation**: A 1-week "soak" between Phase 1's merge and Phase 4's
  kickoff in CI/local dev surfaces gaps before they cause an irreversible
  delete. The soak duration is at the migration owner's discretion.
- **Risk**: M2.1's port to `backend/tests/integration/dataset_layer/
  validation/` requires harness facilities that no longer exist post-4c.
- **Mitigation**: M2.1 moves in sub-MR 4b BEFORE 4c deletes the
  orchestrator. M2.1 uses `validate_with=schema` on `chat_turn` per DR-5;
  that hook stays. M2.1's port should be a clean lift.

### Why the original scope was off — note for future reclassifications

The pre-flight grep that produced [adr-024-phase-4-blocker.md](../../research/adr-024-phase-4-blocker.md)
surfaced ~2,000 LOC the roadmap did not enumerate. Two distinct gaps:

1. **The path drift**: The roadmap referenced `backend/tests/unit/dataset_layer/test_eject_protocol.py` as a possible structural test. The actual unit tests live at `backend/tests/unit/test_*.py` (flat), and there are six of them (not one), totalling ~1,886 LOC. The original survey scoped only the integration-test layer.

2. **The reclassification couldn't actually decouple `test_ingress_url_invariant.py`**: Phase 2's outcome was "M4 protocol invariants moved to a chat-protocol home." The ingress URL invariant *is* an assertion about `EjectAndTestOrchestrator._base_url` — the coupling is the invariant. Moving the file out of the v1 acceptance suite did not (and could not) decouple the test from the orchestrator. A "reclassified" test that still imports the orchestrator is still part of the orchestrator's blast radius; the reclassification was a directory move, not a re-derivation against a different seam. For future similar reclassifications: if the reclassified test imports the same symbol it tested before, it has not actually been decoupled, and it will need to be re-derived (or deleted) when the original seam is retired. **The reclassification target seam must be load-bearing, not just topographical.**

The v2 driver's `base_url` is built only from `auth_proxy_url` with no internal-port fallback, so the invariant the deleted test asserted is satisfied by construction. If a future incident motivates separately asserting the URL composition, write a 10-line test against the v2 driver's exported `base_url`; this is far cheaper than a fixture-heavy orchestrator-coupled assertion.

---

## Phase 5 — Update ADR-019 + evolution doc

**Scope**: Add a "Status update — partially superseded by ADR-024" note
to ADR-019 (top of the file, in addition to keeping the original
ratification preserved). Update the evolution doc with a "Migration to
dbt-test driver" addendum citing the new shape and the LOC delta.

**Files**:
- Edit: `docs/decisions/adr-019-eject-then-test-validation.md` — prepend
  a short status-update block under the "Status" line (not modifying the
  original Status/Date/Ratified lines). Estimate +10-15 LOC.
- Edit: `docs/evolution/2026-05-11-dbt-test-validation.md` — append a
  "Migration to dbt-test driver (ADR-024)" section after "Outcome" with
  the LOC delta, the surviving scope, and the cross-reference. Estimate
  +20-30 LOC.

**LOC**: +30-45.

**MR size**: S.

**Acceptance criteria**:
- ADR-019 has a visible "partially superseded by ADR-024" notice at the top.
- The evolution doc references ADR-024 in its migration addendum.
- Both docs cross-reference each other.
- ADR-024's Status line still reads "Proposed — partially supersedes
  ADR-019" and can be promoted to "Accepted" by the project owner when
  Phase 4 is green.

**Reversibility**: Revert the doc edits. The code state is unchanged.

**Dependencies**: Phase 4 done (do not claim "migrated" while the v1 suite
still exists).

**Why this order**: Documentation should match reality. Updating ADR-019
and the evolution doc before Phase 4 is done would make the docs lie.

**Risk + mitigation**:
- **Risk**: Phase 4 surfaces a gap that forces a Phase-1 retry; the doc
  update gets ahead of code reality.
- **Mitigation**: Phase 5 is the last phase deliberately. If Phase 4
  needs revisit, Phase 5 waits.

---

## Out of scope (this roadmap does NOT cover)

- New acceptance scenarios beyond the WS + M1 + M5.1 customer-fidelity set.
- New Pandera schemas beyond `OrdersStaging` (future work; not on this
  migration's critical path).
- C4 diagram updates (no new architecture being introduced; ADR-024 is a
  rebalance).
- Mutation testing of the new v2 driver.
- Performance optimization of the v2 driver (the spike showed wall-clock
  improvement; no further tuning needed until profiled).
- DEVOPS handoff updates for contract-testing `dbt-core` ↔ parser. The
  original ADR-019 §10 recommendation stands; it now applies to the v2
  driver's parser rather than `RunResultsParser`. If a contract test is
  added in DEVOPS, it targets the v2 driver's parse function.

## Migration outcomes (after Phase 5)

| Surface | Before | After |
|---|---|---|
| Test infra LOC carrying customer-fidelity acceptance | ~3,850 | ~545 (v2 driver) |
| Customer-fidelity scenarios | 5 (WS + M1 + M5.1) via BDD-facade | 5 via procedure-driver at `tests/acceptance/dbt-test-validation-v2/` |
| Pandera per-turn scenarios | 1 (M2.1) via BDD-facade | 1 via integration-test in `validation/` |
| Chat-protocol invariants | 2 (M4) via BDD-facade | 1 in `protocol_invariants/` (raw-tool-call leak guard); ingress URL invariant retired with orchestrator per [phase-4-blocker.md](../../research/adr-024-phase-4-blocker.md) — coupling was the invariant |
| Retry semantics | 3 (M2.2 + M2.3 + M5.2) via BDD-facade | 3 unit tests in `backend/tests/unit/test_retry_semantics.py` (flat path — see [phase-4-blocker.md](../../research/adr-024-phase-4-blocker.md)) |
| Earned-Trust probe scenarios | 5 (M3) via BDD-facade | 0 (substrate lies surface inline at point of use) |
| Behavioral-enforcement gold-test | 1 file (136 LOC) | 0 (no orchestrator to enforce) |
| `EjectAndTestOrchestrator` family | 1,445 LOC | 0 |
| Harness `eject_and_test` method | ~80 LOC | 0 |
| Harness `validate_with` hook | preserved (per DR-5) | preserved |
| Harness `StructuredRetryExhaustion` | preserved (per DR-5) | preserved |
| Exported `profiles.yml` `s3_use_ssl` support | absent (customer workaround) | native (Phase 0) |
| Net test infra LOC delta | — | **~-5,000 to -5,300 LOC** (revised post-Phase-4-blocker — see [phase-4-blocker.md](../../research/adr-024-phase-4-blocker.md)) |
| JOB-001 / O4 strategic level | satisfied | satisfied |
| AC1.6 wall-clock | ~85-105 s | improved (no probe phase at session start) |
| ADR-016 compose-stack fidelity | preserved | preserved |
| ADR-007 / Ibis | preserved | preserved |
| ADR-014 / ChatEvent vocab | preserved | preserved + reduced blast radius into validation |
