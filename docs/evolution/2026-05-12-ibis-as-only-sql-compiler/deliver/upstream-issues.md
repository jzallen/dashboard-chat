# Upstream issues — `ibis-as-only-sql-compiler` deliver wave

Issues encountered during deliver-phase implementation that originate
OUTSIDE the step's `files_to_modify` scope. Surfaced here per the
boundary-rules contract — file changes outside the step's listed files
are escalated, not silently expanded.

## Phase 05 / Step 05-01 (MR-5 — model_sql → ibis pipeline)

### Resolved: `pandera` install hygiene in local workspace

`pandera>=0.29` is declared in
[`backend/pyproject.toml`](../../../../backend/pyproject.toml) under
`[project.optional-dependencies] test`. The crafter's local venv had not
been synced with the `test` extra (`uv sync --all-extras` fixes it), so
pytest collection failed on the six `tests/unit/test_*pandera*.py` /
`test_harness_validate_after_wiring.py` / `test_orders_staging_schema.py`
/ `test_retry_semantics.py` / `test_chat_turn_validate_with.py` files
that import pandera transitively.

After `uv sync --all-extras`, `./tools/test/test.sh --backend` runs
end-to-end with **1400 passed, 0 failed** on commit `d417700`. The
Refinery's CI environment installs `[project.optional-dependencies] test`
from `pyproject.toml`, so the MQ gate is not affected — the local
fail-fast was a workspace-setup issue, not a code issue.

**Reproducer of the fix**:
```bash
cd backend && uv sync --all-extras
cd .. && ./tools/test/test.sh --backend
# 1400 passed, 191 warnings
```

No upstream issue remains — note preserved here only for future workers
hitting the same pandera-missing collection error.

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
