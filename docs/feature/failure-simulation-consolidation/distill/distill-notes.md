# DISTILL notes — failure-simulation-consolidation

DISTILL-wave artifacts for `failure-simulation-consolidation`. Produced
2026-05-14 from the DISCUSS SSOT (`stories.md`, `acceptance-criteria.md`,
`journey.md`) and the DESIGN handoff package (4 ADRs + `c4-context.md` +
`component-design.md` + `handoff-design-to-distill.md`).

## What landed in DISTILL

```
docs/feature/failure-simulation-consolidation/distill/
  roadmap.json         # 5 MRs sequencing US-CONSOL-1..5
  distill-notes.md     # this file

tests/acceptance/failure-simulation-consolidation/
  pyproject.toml
  conftest.py
  driver.py
  test_us_consol_1_unified_registry.py        # 5 scenarios
  test_us_consol_2_environment_gate.py         # 7 scenarios (12 + 2 parametrizations)
  test_us_consol_3_audit_log.py                # 5 scenarios
  test_us_consol_4_migration.py                # 5 scenarios (Group B)
  test_us_consol_5_sprawl_friction.py          # 4 scenarios
  test_journey_invariants_fsc.py               # 3 cross-cutting (2 Group A + 1 Group C)
  test_contract_assertions.py                  # CA-1..CA-9
```

55 collected pytest items (29 acceptance scenarios × parametrizations +
9 contract assertions × parametrizations). All RED at handoff — the
`shared/failure-simulation/` module does not yet exist. DELIVER drives them
to GREEN.

## Scenario → test mapping

The acceptance suite mirrors the DESIGN handoff's group classification
(Group A — directly exercise the registry's API; Group B — migration
safety-net; Group C — deprecation-specific).

### Group A — direct API exercise (22 scenarios)

| Story | Scenario | Test |
|---|---|---|
| US-CONSOL-1 | 1 — discover every knob in one file | `test_us_consol_1_unified_registry.py::test_developer_discovers_every_knob_in_one_manifest_file` |
| US-CONSOL-1 | 2 — knob outside manifest is rejected | `test_us_consol_1_unified_registry.py::test_a_knob_outside_the_manifest_is_rejected_with_unknown_audit_event` |
| US-CONSOL-1 | 3 — typo'd knob surfaces hint | `test_us_consol_1_unified_registry.py::test_a_typo_knob_name_surfaces_a_hint_pointing_at_the_manifest` |
| US-CONSOL-1 | 4 — all 6 listed after consolidation | `test_us_consol_1_unified_registry.py::test_all_six_existing_knobs_are_listed_with_canonical_names_after_consolidation` |
| US-CONSOL-1 | 5 — manifest is single SSOT | `test_us_consol_1_unified_registry.py::test_manifest_is_single_source_of_truth_across_ui_state_and_agent` |
| US-CONSOL-2 | 1 — production rejects every knob | `test_us_consol_2_environment_gate.py::test_production_rejects_every_knob_invocation_even_with_legacy_flag_set` |
| US-CONSOL-2 | 2 — staging rejects by default | `test_us_consol_2_environment_gate.py::test_staging_rejects_every_knob_invocation_by_default` |
| US-CONSOL-2 | 3 — dev/ci permit | `test_us_consol_2_environment_gate.py::test_dev_and_ci_environments_permit_knob_invocation` (parametrized) |
| US-CONSOL-2 | 4 — unset defaults to restrictive | `test_us_consol_2_environment_gate.py::test_unset_environment_defaults_to_production_restrictive_gate` |
| US-CONSOL-2 | 5 — inspection probes absent outside dev/ci | `test_us_consol_2_environment_gate.py::test_inspection_probe_endpoints_are_absent_outside_dev_or_ci` (parametrized) |
| US-CONSOL-2 | 6 — gate verdict logged once at startup | `test_us_consol_2_environment_gate.py::test_gate_verdict_is_logged_exactly_once_at_startup` |
| US-CONSOL-2 | 7 — production independent of legacy flag | `test_us_consol_2_environment_gate.py::test_production_behavior_is_independent_of_legacy_flag_value` (6-cell matrix) |
| US-CONSOL-3 | 1 — fired emits structured entry | `test_us_consol_3_audit_log.py::test_a_fired_knob_emits_exactly_one_structured_audit_entry` |
| US-CONSOL-3 | 2 — rejected emits distinct entry | `test_us_consol_3_audit_log.py::test_a_rejected_knob_emits_a_distinct_audit_entry` |
| US-CONSOL-3 | 3 — unknown emits warning + manifest pointer | `test_us_consol_3_audit_log.py::test_an_unknown_knob_emits_a_warning_audit_entry_with_manifest_pointer` |
| US-CONSOL-3 | 4 — absent for normal requests | `test_us_consol_3_audit_log.py::test_audit_entries_are_absent_for_normal_requests` |
| US-CONSOL-3 | 5 — correlation id across actor boundary | `test_us_consol_3_audit_log.py::test_audit_entries_carry_correlation_id_across_actor_boundary` |
| US-CONSOL-5 | 1 — knob without manifest fails CI | `test_us_consol_5_sprawl_friction.py::test_assert_known_rejects_a_knob_not_listed_in_the_manifest` |
| US-CONSOL-5 | 2 — empty rationale fails | `test_us_consol_5_sprawl_friction.py::test_manifest_entry_with_empty_rationale_fails_schema_validation` |
| US-CONSOL-5 | 3 — missing contract-test field fails | `test_us_consol_5_sprawl_friction.py::test_manifest_entry_without_contract_test_consideration_fails_validation` |
| US-CONSOL-5 | 4 — 7th knob lands as normal MR | `test_us_consol_5_sprawl_friction.py::test_a_seventh_knob_lands_as_a_normal_mr_with_manifest_wiring_and_scenario` |
| Cross-story 2 | hostile-env integration | `test_journey_invariants_fsc.py::test_hostile_environment_integration_asserts_production_safety` |

### Group B — migration safety-net (6 scenarios)

| Story | Scenario | Test |
|---|---|---|
| US-CONSOL-4 | 1 — acceptance suite passes adapter phase | `test_us_consol_4_migration.py::test_acceptance_suite_passes_after_adapter_phase_migration` |
| US-CONSOL-4 | 2 — adapter-phase zero test changes | `test_us_consol_4_migration.py::test_adapter_phase_commits_contain_zero_test_changes` |
| US-CONSOL-4 | 3 — vocab cleanup renames atomically | `test_us_consol_4_migration.py::test_vocabulary_cleanup_commits_rename_production_and_tests_atomically` |
| US-CONSOL-4 | 4 — atomic per-knob commits | `test_us_consol_4_migration.py::test_each_knob_migration_is_one_atomic_commit` |
| US-CONSOL-4 | 5 — regression caught by audit log | `test_us_consol_4_migration.py::test_a_regression_is_caught_by_the_acceptance_suite_via_audit_log` |
| Cross-story 1 | all 6 knobs functional in dev | `test_journey_invariants_fsc.py::test_all_six_knobs_remain_functional_after_every_story_lands` |

### Group C — deprecation-specific (1 scenario)

| Story | Scenario | Test |
|---|---|---|
| US-CONSOL-4 | 6 — `NWAVE_HARNESS_KNOBS` deprecated | `test_journey_invariants_fsc.py::test_nwave_harness_knobs_is_deprecated_with_loud_startup_warning` |

### Contract assertions (CA-1..CA-9)

| CA | Topic | Test |
|---|---|---|
| CA-1 | manifest-vs-source drift | `test_contract_assertions.py::test_ca_1_manifest_vs_source_drift_check_catches_unregistered_knob` |
| CA-2 | schema validation at module load | `test_contract_assertions.py::test_ca_2_schema_validation_rejects_a_known_bad_entry` |
| CA-3 | composition-root probe invariant | `test_contract_assertions.py::test_ca_3_first_failure_simulation_event_is_a_gate_event` |
| CA-4 | verdict cache stability per process | `test_contract_assertions.py::test_ca_4_verdict_cache_is_stable_within_one_process_lifetime` |
| CA-5 | audit-event JSON conformance | `test_contract_assertions.py::test_ca_5_every_audit_event_is_a_single_line_of_valid_json` |
| CA-6 | correlation-id propagation | `test_contract_assertions.py::test_ca_6_correlation_id_propagates_across_the_actor_boundary` |
| CA-7 | inspection-probe conditional registration | `test_contract_assertions.py::test_ca_7_inspection_probe_returns_404_not_403_when_gate_is_disabled` (3 routes) |
| CA-8 | legacy variable honors w/ deprecation | `test_contract_assertions.py::test_ca_8_legacy_variable_honored_with_deprecation_event` |
| CA-9 | production independent of legacy flag | `test_contract_assertions.py::test_ca_9_production_verdict_is_disabled_regardless_of_flag_values` (9-cell matrix) |

## Known-unknowns from the DESIGN handoff — resolved or escalated

The DESIGN handoff's "Open issues / known unknowns" section names three
deferrals. DISTILL's disposition:

### KU-1 — `removal.target_release` semver string

**DESIGN punted to DELIVER.** ADRs 037 and 038 commit to the field's
presence and intent but not to a specific semver string.

**DISTILL resolution:** RESOLVED via shape-not-value assertion.
`driver.py` exposes `SEMVER_REGEX` (permissive semver matcher); tests in
`test_journey_invariants_fsc.py::test_nwave_harness_knobs_is_deprecated_with_loud_startup_warning`
and `test_contract_assertions.py::test_ca_8_legacy_variable_honored_with_deprecation_event`
match against the regex, not an exact value. DELIVER picks the string;
any well-shaped semver (e.g. `v2.0.0`, `1.5.0`, `v3.0.0-beta.1`) satisfies
the contract.

### KU-2 — stdout-capture helper shape

**DESIGN punted to DISTILL.** Existing suites use various capture
techniques (`capfd`, subprocess capture). DISTILL picks the helper.

**DISTILL resolution:** RESOLVED — chose subprocess capture exclusively.
Rationale: the registry runs in a `node` child process for every API
scenario, so the natural capture point is `subprocess.run(...,
capture_output=True, text=True)` followed by line-by-line JSON parsing.
This avoids the pytest-capture / monkey-patch complications around
`console.log` in the JS layer (per ADR-037 §"Earned Trust" — the substrate
lie is "console.log is monkey-patched and swallows the audit event"; child
process capture is immune).

The helper is `FailureSimulationDriver.run_registry_script(...)` plus the
private `_parse_jsonl_events()` parser. The `captured_stdout_events`
pytest fixture exposes a list bucket for tests that want to inspect events
across multiple driver calls within one test.

### KU-3 — `detectUnknownSignals` middleware placement order

**DESIGN punted to DELIVER.** Exact Hono middleware position is a DELIVER
decision; tests should not depend on it.

**DISTILL resolution:** RESOLVED — tests bypass middleware ordering by
invoking `detectUnknownSignals(ctx)` directly from a node subprocess. No
test depends on the middleware being installed in any particular order. If
DELIVER discovers that a middleware position matters for a behavior
(e.g. unknown-signal detection must happen before auth — unlikely but
possible), that surfaces as a wiring-level test in the inner TDD loop
rather than as an acceptance regression here.

## Test-infrastructure patterns introduced

### 1. `node --input-type=module -e <script>` as the registry driver

`driver.run_registry_script(script_body, env=...)` spawns a child node
process with `--input-type=module`, passes the script body via `-e`, and
captures stdout. Each test owns its own script. The driver does not embed
inline JS — keeping the driver minimal per CLAUDE.md "thin driver"
guidance.

The package import path resolves via the workspace package name
`@dashboard-chat/shared-failure-simulation` per ADR-036 (Bazel-managed
workspace package). Tests run from `repo_root` as cwd so the workspace
resolution works.

### 2. Process-level stdout capture for audit events

Audit events are emitted via `console.log(JSON.stringify(event))` per
ADR-037. The driver parses captured stdout line-by-line, ignoring
non-JSON lines, and filters lines whose `event.name` matches
`failure-simulation.*` OR whose payload is the test-only `__verdict`
marker.

Substrate-lie defense: capture happens at the child-process boundary, not
via a mocked `console.log` inside the test process. Per ADR-037, this
catches the failure mode "the emitter calls `console.log` correctly but a
mocked logger in the test swallows it."

### 3. Per-env-var permutation via the `probe_in_subprocess` helper

`FailureSimulationDriver.probe_in_subprocess(environment, ...)` collapses
the three relevant env vars into a single typed call. The CA-9 9-cell
matrix and the US-CONSOL-2 Scenario 7 6-cell matrix both go through this
helper, so the gate's behavior is verified across the full Cartesian
product without test-side combinatorial duplication.

### 4. Manifest source introspection — `manifest_canonical_names()`

The discovery-time scenarios (US-CONSOL-1 #1, #4) read the manifest as
static data via a regex over `manifest.ts`. This is cheap (no subprocess)
and validates the manifest's textual shape — which is itself the SSOT
per ADR-038. Runtime semantics scenarios use the subprocess path.

### 5. Production-source pattern grep via `grep_production_source_for_knob_patterns()`

CA-1 (manifest-vs-source drift) needs to find every header / event /
body-field knob-name pattern in `ui-state/` and `agent/`. The driver
performs the grep with `re.compile` patterns; the CA-1 test then
cross-references hits against the manifest. The same helper is reusable
by US-CONSOL-1 Scenario 5 (single SSOT across services).

### 6. Pytest markers for cross-cutting selection

The `pyproject.toml` defines markers for:

- Story slice (`us_consol_1` .. `us_consol_5`).
- Migration release (`mr_1` .. `mr_5`).
- Test group (`group_a`, `group_b`, `group_c`).
- Contract assertion (`contract_assertion`).
- Path category (`happy_path`, `error_path`, `boundary`).
- Real-I/O / compose-stack / node preconditions.

DELIVER can select per-MR: `pytest -m mr_2` runs only the MR-2 GREEN
slice; `pytest -m contract_assertion` runs CA-1..CA-9.

### 7. Parametrization across the gate's verdict matrix

`test_us_consol_2_environment_gate.py::test_production_behavior_is_independent_of_legacy_flag_value`
and `test_contract_assertions.py::test_ca_9_*` both use
`@pytest.mark.parametrize` to cover the full env-var matrix. This is
the single place where parametrization is heavy; the rest of the suite
favors named scenarios for readability.

### 8. `requires_shared_failure_simulation` fixture — explicit RED at handoff

The fixture intentionally raises `FileNotFoundError` (not
`pytest.skip(...)`) when the registry package is absent. Rationale:
DISTILL hands off RED tests; converting them to skipped tests would
mask the gap. DELIVER's MR-1 lands the package and the fixture
becomes a no-op; the conversion-to-skip-fallback is optional and can
be a later DELIVER step if scenario isolation needs it.

## Suite verification at handoff

```bash
cd tests/acceptance/failure-simulation-consolidation \
  && uv run --no-project --with pytest --with pytest-asyncio --with httpx --with pyyaml \
     pytest --collect-only -q
```

→ 55 items collected, 0 collection errors.

```bash
cd tests/acceptance/failure-simulation-consolidation \
  && uv run --no-project --with pytest --with pytest-asyncio --with httpx --with pyyaml \
     pytest --tb=no -q
```

→ 47 errors + 3 failures + 5 skipped (compose stack unreachable in this
shell). All RED; no GREEN. The errors are `FileNotFoundError:
shared/failure-simulation/ does not exist at ...` and the failures are
git-history assertions on the migration commits (MR-4 / MR-5 have not
landed). This is the expected RED state DELIVER consumes.

## Vocabulary check at handoff

```bash
grep -rE '\bfault[- ]injection\b|\bnwave\b' \
  tests/acceptance/failure-simulation-consolidation/ \
  docs/feature/failure-simulation-consolidation/distill/
```

→ The only matches are the legitimate references:

- `NWAVE_HARNESS_KNOBS` (the legacy env var being deprecated — appears
  in scenario titles and assertions about deprecation behavior).
- `nwave-ai` mentioned in comments referring to the SDLC tool, in
  context where that is the correct usage.

No new product-code identifiers carry "fault injection", "harness" (as
a generic descriptor), or "nwave". The legacy strings appear only where
the design explicitly requires them (deprecation-warning assertions).

## What DELIVER consumes

1. `roadmap.json` — 5 MRs, dependency-ordered, with per-MR exit criteria
   and the list of scenarios to unskip / turn GREEN at each.
2. The 55 RED tests under `tests/acceptance/failure-simulation-consolidation/`.
3. The Iron Rule reminder: never modify a failing test to make it pass.
   If a test is wrong, revert and escalate.
4. The known-unknowns: all three deferred items have explicit DISTILL
   resolutions documented in this file. KU-1 is shape-not-value; KU-2 is
   subprocess capture; KU-3 is direct invocation.

## References

- `../discuss/stories.md`
- `../discuss/acceptance-criteria.md`
- `../discuss/journey.md`
- `../design/handoff-design-to-distill.md`
- `../design/component-design.md`
- `../design/adr-035-failure-simulation-gate-composition.md`
- `../design/adr-036-failure-simulation-module-location.md`
- `../design/adr-037-failure-simulation-audit-sink.md`
- `../design/adr-038-failure-simulation-naming-phase-plan.md`
- `/workspaces/dashboard-chat/CLAUDE.md` — per-feature acceptance suite pattern
