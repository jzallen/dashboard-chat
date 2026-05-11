"""M1.2 — eject-and-test drift detector (ADR-024 Phase 1).

Port of v1 ``milestone-1-eject-and-test.feature``::

  Scenario: Drift detector — eject fails when an exported test would fail
    Given a fresh project with a small orders dataset uploaded
    And a chat workflow has produced a staging model whose exported tests would fail
    When the customer ejects the project and re-runs the validations
    Then the ejected project re-validates as failed
    And the report names the failing validation by name

The ``orders.csv`` fixture has 2 rows with an empty ``order_id``;
marking the column required forces the schema.yml exporter to emit a
``not_null_stg_<project>_order_id`` test that the data violates. dbt
surfaces the named test in ``run_results.json``; the v2 driver carries
it through to ``TestReport.failures``.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from driver import DbtTestDriver


pytestmark = pytest.mark.real_io


def test_drift_detected_named_not_null_failure(
    driver: DbtTestDriver,
    jwt: str,
    project_with_orders: tuple[str, str],
    work_dir: Path,
) -> None:
    project_id, dataset_id = project_with_orders

    # ``order_id`` is the column that the fixture deliberately leaves
    # empty on 2 of 15 rows; marking it required surfaces the violation
    # through dbt's not_null test (DWD-9 deterministic setup).
    driver.patch_column_required(jwt, dataset_id, "order_id")

    report = driver.run(jwt, project_id, work_dir)

    assert report.status == "fail", (
        f"drift-detector expected status='fail'; got status={report.status!r}, "
        f"tests_run={report.tests_run!r}, output={report.dbt_output[-400:]!r}"
    )
    assert report.failures, (
        f"drift-detector expected at least one named failure; got {report.failures!r}"
    )
    failure_names = [f.name for f in report.failures]
    assert any("not_null" in name and "order_id" in name for name in failure_names), (
        f"expected a not_null test naming order_id to fail; got failure names "
        f"{failure_names!r}"
    )
