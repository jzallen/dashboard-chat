# ADR-024 Phase 4 — Pre-flight grep blocker report

**Date**: 2026-05-11
**Author**: nw-software-crafter agent (crew/immortan)
**Status**: BLOCKER — Phase 4 paused before any deletion
**Roadmap**: `docs/architecture/dbt-test-validation/migration-roadmap.md` §Phase 4

## Summary

Phase 4 kickoff requires a pre-flight grep for `eject_and_test`,
`EjectAndTestOrchestrator`, and `from ... eject` to surface latent callers
before the v1 acceptance suite + eject infrastructure are deleted. The grep
surfaced **9 in-code callers across 3 directories not enumerated in the
roadmap's Phase 4 sub-MRs**. Each is load-bearing (the test imports a
symbol the eject package owns, and pytest will fail at collection time
once the symbol disappears). Per the orchestrator's instructions to stop
on unexpected territory, deletion has not been started.

The roadmap explicitly anticipated callers only in:

- `tests/acceptance/dbt-test-validation/` (sub-MRs 4a + 4b)
- `backend/tests/integration/dataset_layer/eject/` (sub-MR 4c)
- `backend/tests/integration/dataset_layer/conftest.py` (sub-MR 4c)
- `backend/tests/integration/dataset_layer/harness.py` (sub-MR 4c, edit-not-delete)

The pre-flight grep found additional callers in:

1. `backend/tests/integration/dataset_layer/protocol_invariants/` — **1 file**.
2. `backend/tests/unit/` — **6 files**, totaling ~1,886 LOC.

This is materially larger than the ~3,200-3,400 LOC the roadmap projected;
adding these surfaces another ~2,000 LOC of deletion.

## Findings

### Finding 1 — `protocol_invariants/test_ingress_url_invariant.py` is structurally coupled to the orchestrator

**File**: `backend/tests/integration/dataset_layer/protocol_invariants/test_ingress_url_invariant.py` (108 LOC)

**What it does**: Tests the ADR-016 production-ingress URL invariant —
"the orchestrator's wired `_base_url` matches the auth-proxy ingress, never
the backend's internal port 8000." Reclassified in Phase 2 from the v1
acceptance suite's `milestone-4-protocol-invariants.feature`.

**The coupling**: The test imports `EjectAndTestOrchestrator` directly
(line 73), constructs one (line 80), and asserts on its private
`_base_url` attribute (line 86). The invariant is *about* the
orchestrator's URL composition — once the orchestrator goes away, the
invariant has nothing to assert on.

**Why this is a contradiction in the roadmap**: Phase 2's stated outcome
was "M4 protocol invariants moved to chat_protocol integration tests."
Phase 4c's stated outcome was "no module imports the eject package
anywhere." These two outcomes are incompatible for this specific
invariant — the invariant is, by definition, about the orchestrator.

**Recommendation**: **Delete this test** in sub-MR 4c. The invariant it
encodes ("test substrate routes through auth-proxy ingress, not
:8000") is preserved by the v2 driver's construction: the driver is
built only from `auth_proxy_url` and has no internal-port fallback, so
the invariant is satisfied by construction. If the migration owner wants
the invariant separately asserted, write a 10-line test against the v2
driver's exported `base_url` attribute; this is far cheaper than
keeping a coupled test alive.

**Companion**: The sibling test
`test_raw_tool_call_leak_guard.py` (also in `protocol_invariants/`) does
**not** import the eject package — it drives chat through `harness.chat_turn`
and asserts on `ChatEventTrace.raw_tool_call_seen`. That test stays untouched.

### Finding 2 — Six unit tests under `backend/tests/unit/` test the eject package internals

All six exist explicitly to drive the eject package's components. Each
imports from `tests.integration.dataset_layer.eject.*`. None has any
purpose once the eject package is deleted.

| File | LOC | What it tests | Mechanical action |
|---|---:|---|---|
| `test_eject_orchestrator.py` | 587 | `EjectAndTestOrchestrator.probe()` + `eject_and_test()` happy + sad paths | Delete |
| `test_dbt_runner.py` | 242 | `DbtRunner.run_build_and_test()` against real dbt | Delete |
| `test_run_results_parser.py` | 311 | `RunResultsParser.parse()` shape contract | Delete |
| `test_duckdb_profile_seeder.py` | 244 | `DuckDBProfileSeeder` mapping `minio_creds` → `profiles.yml` | Delete |
| `test_probe_happy_paths.py` | 304 | The 5 earned-trust probes (substrate liveness checks) | Delete |
| `test_harness_eject_validate_wiring.py` | 198 | Harness wiring for `eject_and_test` (delete) + `validate_after` (keep — referenced by Phase 3 retry tests) | **Split**: delete the 3 `eject_and_test` wiring tests; keep the 1 `validate_after` test (rename file to `test_harness_validate_after_wiring.py` or move into `backend/tests/integration/dataset_layer/validation/`) |
| **TOTAL** | **1,886** |  |  |

**Why the roadmap missed these**: Phase 4c's enumeration was scoped to
the *integration*-test layer:

> Delete (if exists): `backend/tests/unit/dataset_layer/test_eject_protocol.py`
> or equivalent ArchUnit-style structural test asserting
> `EjectAndTestOrchestrator` has a `probe()` method — the orchestrator no
> longer exists. Verify and delete.

The roadmap anticipated **one** ArchUnit-style structural test under
`backend/tests/unit/`. It did not anticipate **six** functional unit
tests for the eject package's internals. (The path mentioned —
`backend/tests/unit/dataset_layer/` — doesn't even exist in this repo;
the tests are at `backend/tests/unit/test_*.py` flat.)

**Why these are not "external callers"**: They are tests of the eject
package's own surfaces — they are *part* of the eject deletion's blast
radius, not surprise callers. But because the roadmap underscoped them,
the pre-flight grep correctly flags them as unenumerated.

### Finding 3 — `test_harness_eject_validate_wiring.py` has a mixed fate

This is the one file whose deletion is non-trivial. It exercises four
behaviors:

1. `eject_and_test` delegates to injected orchestrator → goes with eject
2. `eject_and_test` raises clearly when no orchestrator injected → goes
3. `eject_and_test` raises clearly when no `tmp_path` supplied → goes
4. `validate_after` fetches table state then delegates to PanderaValidator
   → **keeps** (DR-5; the `validate_after` method on the harness is still
   referenced by the chat_turn `validate_with` hook composition, see
   `harness.py:1036` — and the M2.1 port will exercise it)

**Recommendation**: Reshape this file into a smaller wiring test for
`validate_after` only — drop tests 1-3, keep test 4. Or move test 4 into
the new `backend/tests/integration/dataset_layer/validation/` test
module that the M2.1 port creates. Either keeps coverage on the kept-in
behavior without forcing a full delete-rewrite.

## Recommendation

**Expand Phase 4 scope explicitly** to include:

- Sub-MR 4c additions:
  - `backend/tests/integration/dataset_layer/protocol_invariants/test_ingress_url_invariant.py` → delete (108 LOC).
  - `backend/tests/unit/test_eject_orchestrator.py` → delete (587 LOC).
  - `backend/tests/unit/test_dbt_runner.py` → delete (242 LOC).
  - `backend/tests/unit/test_run_results_parser.py` → delete (311 LOC).
  - `backend/tests/unit/test_duckdb_profile_seeder.py` → delete (244 LOC).
  - `backend/tests/unit/test_probe_happy_paths.py` → delete (304 LOC).
  - `backend/tests/unit/test_harness_eject_validate_wiring.py` → drop tests 1-3, keep test 4 (or move test 4 into `validation/`). Net ~-130 LOC.

- Sub-MR 4b unchanged.
- Sub-MR 4a unchanged.

**Revised Phase 4 net deletion** (with these additions):
~-3,200 LOC (roadmap) + ~-1,800 LOC (this expansion) ≈ **~-5,000 LOC net deletion**.

This stays inside the spike's "~3,000 LOC net deletion" claim by a wide
margin once the +30-50 M2.1 port addition is included; the roadmap's
estimate was conservative against the unit-test layer.

## Why the soak window mattered

The user explicitly waived the roadmap's recommended "1-week soak"
between Phase 1 merge and Phase 4 kickoff (per the briefing). A soak
would not have surfaced these particular files (they're test code, not
production code, and don't show up as "the v2 driver lost coverage on
something"); they would only show up via either the pre-flight grep
this report is the output of, or by attempting to run `--backend` post-deletion
and reading the `ModuleNotFoundError`s. The pre-flight grep is what the
soak was substituting for. **It caught the gap.**

## What I'm not doing without approval

- Not deleting any of the 7 files listed in Finding 2 (~1,886 LOC) until the
  scope expansion is approved.
- Not deleting `test_ingress_url_invariant.py` until either (a) approval to
  delete or (b) approval to reformulate against the v2 driver's `base_url`.
- Not editing `test_harness_eject_validate_wiring.py` (mixed-fate split)
  until approval.
- The sub-MR 4a + 4b + 4c-as-scoped-in-roadmap work CAN proceed as the
  roadmap specifies; only the unenumerated test files block.

## Suggested next step (for the migration owner)

Approve sub-MR 4c scope expansion to include the 7 unit/integration tests
above. Phase 4 proceeds atomically with the expanded 4c.

If the owner disagrees and wants a different split (e.g., make these a
new sub-MR 4c.5 between 4c and 4d, or reformulate the ingress test
against v2 driver), this report supplies the trace; the agent will re-plan
from there.
