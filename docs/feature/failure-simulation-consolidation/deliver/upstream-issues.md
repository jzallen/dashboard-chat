# DELIVER — upstream issues / observations

Findings DELIVER surfaces back to prior waves. None of these blocked MR-1
landing; each is documented for the MR-2 / MR-3 / MR-4 dispatchers and for
the reviewer.

## MR-1 — incidentally-GREEN scenarios outside the MR-1 scenario set

Four DISTILL scenarios outside the MR-1 unskipped set turn GREEN once MR-1
lands — not because MR-1 over-delivers, but because the test asserts on
behavior that the MR-1 natural surface (`manifest` + `detectUnknownSignals`)
already produces.

| Test | Pytest mark | Behavior asserted | Why GREEN at MR-1 |
|---|---|---|---|
| `test_us_consol_3_audit_log.py::test_an_unknown_knob_emits_a_warning_audit_entry_with_manifest_pointer` | `mr_3` | `failure-simulation.unknown` emitted with `knob.name.raw` and `manifest.path` for a typo'd header | `detectUnknownSignals` is MR-1 scope (US-CONSOL-1 Scenarios 2/3) and emits the same event shape. The MR-3 test is effectively a duplicate of US-CONSOL-1 Scenario 3. |
| `test_us_consol_3_audit_log.py::test_audit_entries_are_absent_for_normal_requests` | `mr_3` | No `failure-simulation.*` invocation events for a request that carries no knob signal | MR-1's `shouldInject` is an inert stub (returns `false`, emits nothing) and `detectUnknownSignals` short-circuits on non-knob headers. The absence is natural at MR-1; MR-3's audit emitter does not have to add anything to satisfy this assertion. |
| `test_us_consol_4_migration.py::test_acceptance_suite_passes_after_adapter_phase_migration` | `mr_4` | The existing `project-and-chat-session-management/` suite directory exists AND the manifest lists 6 knobs | Both are structural invariants of MR-1 — no migration commits are needed for the assertions to hold. |
| `test_us_consol_4_migration.py::test_a_regression_is_caught_by_the_acceptance_suite_via_audit_log` | `mr_4` | A typo'd header produces `failure-simulation.unknown` (and no `fired`) | Uses `detectUnknownSignals` (MR-1 scope). `fired == []` follows from `shouldInject` being the inert MR-1 stub. |

**Disposition:** no change requested. The tests are correct; the pytest marks
suggest a later MR but the actual surface they exercise is MR-1. These tests
will continue to pass after MR-2/MR-3/MR-4 land their own changes — they are
load-bearing future-regression sentinels for the MR-1 stubs even though the
roadmap counted them in later MRs.

**For the MR-2 / MR-3 dispatcher:** when wiring the real gate and audit
emission, do not regress these four — they cover natural surface and
should stay GREEN through the rest of the rollout.

## MR-1 — KU-1 / KU-3 disposition

Per `roadmap.json::known_unknowns_handed_off_to_deliver`:

- **KU-1** (`removal.target_release` semver string) — deferred to MR-5. MR-1
  does not emit `failure-simulation.config.deprecated`; the field's content
  is the MR-5 dispatcher's call. DISTILL's `SEMVER_REGEX` shape assertion
  is the contract; any well-shaped semver string satisfies it.
- **KU-3** (`detectUnknownSignals` middleware placement order) — moot at
  MR-1. The MR-1 surface exposes the function for direct invocation; the
  middleware-position decision is deferred to MR-2 when the composition
  roots are wired. No DISTILL test depends on a middleware order at MR-1.

KU-2 (stdout-capture helper choice) was resolved in DISTILL.
