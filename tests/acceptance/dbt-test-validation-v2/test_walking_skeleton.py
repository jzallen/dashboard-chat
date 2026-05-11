"""Walking-skeleton scenario for the v2 dbt-test driver (ADR-024 Phase 1).

DR-3 (v2 WS contract): the WS proves the eject-then-build-then-test
cycle ran end-to-end and the parser observed results. The contract is
identical to v1's walking skeleton: ``models_built >= 1 AND tests_run
>= 1``. Pass/fail and named-test assertions belong to M1 where the
fixture setup makes outcomes deterministic; they do NOT belong here.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from driver import DbtTestDriver


pytestmark = [pytest.mark.real_io, pytest.mark.walking_skeleton]


def test_walking_skeleton_cycle_runs_end_to_end(
    driver: DbtTestDriver,
    jwt: str,
    project_with_orders: tuple[str, str],
    work_dir: Path,
) -> None:
    project_id, dataset_id = project_with_orders

    # Use the same deterministic constraint the v1 WS uses: ``region`` is
    # populated on every fixture row, so the not_null test the exporter
    # emits passes. The WS proves the cycle ran, not whether the run was
    # green; using a deterministic-pass column keeps the WS independent of
    # the row-shape coverage M1 tests.
    driver.patch_column_required(jwt, dataset_id, "region")

    report = driver.run(jwt, project_id, work_dir)

    assert report.models_built, (
        f"WS expected at least one model built; got models_built={report.models_built!r}, "
        f"phase={report.dbt_phase}, output={report.dbt_output[-400:]!r}"
    )
    assert report.tests_run, (
        f"WS expected at least one test executed; got tests_run={report.tests_run!r}, "
        f"phase={report.dbt_phase}, output={report.dbt_output[-400:]!r}"
    )
