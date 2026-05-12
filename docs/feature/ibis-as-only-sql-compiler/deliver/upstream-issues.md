# Upstream issues — `ibis-as-only-sql-compiler` deliver wave

Issues encountered during deliver-phase implementation that originate
OUTSIDE the step's `files_to_modify` scope. Surfaced here per the
boundary-rules contract — file changes outside the step's listed files
are escalated, not silently expanded.

## Phase 05 / Step 05-01 (MR-5 — model_sql → ibis pipeline)

### Pre-existing: `pandera` not installed → `./tools/test/test.sh --backend` fails

**Symptom**: from a clean `fcdc156` checkout (Phase 05 scaffold commit,
pre-MR-5), `./tools/test/test.sh --backend` fails during pytest collection:

```
tests/test_mappers.py:20: in <module>
    from backend.tests.integration.dataset_layer.harness import (
tests/integration/dataset_layer/harness.py:57: in <module>
    from tests.integration.dataset_layer.validation.pandera_validator import (
tests/integration/dataset_layer/validation/pandera_validator.py:28: in <module>
    import pandera.errors as pa_errors
E   ModuleNotFoundError: No module named 'pandera'
```

**Reproducer**:
```bash
git checkout fcdc156
./tools/test/test.sh --backend
```

The same failure occurs.

**Scope assessment**: NOT in scope for MR-5. The failure is in
`tests/test_mappers.py` which imports from `tests/integration/...` —
neither file lives in `files_to_modify` for step 05-01, and the missing
`pandera` package is a separate environment-provisioning concern.

**Routing**: should be filed as a separate issue against the test-harness
provisioning (likely `dc-wcy.x` for the dataset-layer harness phase, or a
new `chore(backend): add pandera to dev deps` PR). Not blocking MR-5.

**Local verification path for MR-5**: instead of the gate script's
fail-fast, run pytest directly excluding the two pre-broken paths:

```bash
cd backend && uv run pytest --tb=short --ignore=tests/integration --ignore=tests/test_mappers.py
```

This produces: `1344 passed, 6 errors` where the 6 errors are all the
same `pandera`-missing import error on test files unrelated to MR-5
(`tests/unit/test_chat_turn_validate_with.py`,
`tests/unit/test_harness_validate_after_wiring.py`,
`tests/unit/test_orders_staging_schema.py`,
`tests/unit/test_pandera_validator.py`,
`tests/unit/test_pandera_validator_budget.py`,
`tests/unit/test_retry_semantics.py`). All six errors reproduce on
baseline `fcdc156` and are NOT caused by MR-5.

After MR-5 the same `1344 passed, 6 errors` (now `1345 passed` after the
characterization-test additions, `6 errors` unchanged) holds.

### Out-of-scope file touched: `test_export_dbt_project.py` (L2 rewrite)

**Files modified outside `files_to_modify`**:

* `backend/tests/use_cases/project/test_export_dbt_project.py` (one
  substring assertion rewritten L2-style per
  `nw-test-refactoring-catalog`)
* `backend/tests/use_cases/project/_dbt/test_zip_orchestrator.py` (one
  substring assertion rewritten L2-style)

**Reason**: both files contained legacy-mechanism-pinning substring
assertions on the form `'TRIM("name")' in sql` / `'TRIM("col_a")' in sql`
that interrogated the legacy CTE compiler's bare-string TRIM emission.
After MR-5 the ibis pipeline emits `TRIM("<alias>"."<col>", '<chars>')` —
same operation, different byte shape. The Iron Rule's
"never-modify-a-failing-test" does NOT apply to L1–L3 test-refactoring of
pre-existing legacy-mechanism-pinning assertions (per
nw-test-refactoring-catalog), but the touched files were not listed in
the step's `files_to_modify`. Surfacing here for transparency.
