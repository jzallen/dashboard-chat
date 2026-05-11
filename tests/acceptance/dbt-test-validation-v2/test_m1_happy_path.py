"""M1.1 — eject-and-test happy path (ADR-024 Phase 1).

Mirrors the v1 ``milestone-1-eject-and-test.feature`` happy-path
scenario, port of:

  Scenario: Customer's project ejects and validates green when staging is correct
    Given a fresh project with a small orders dataset uploaded
    And a chat workflow has produced a staging model that is shape-correct
    When the customer ejects the project and re-runs the validations
    Then the ejected project re-validates successfully
    And the report names at least one model that was built
    And the report names at least one validation that was executed

DWD-9 (from v1): the chat layer has no production write path for
``schema_config.constraints``; the M1 happy-path uses PATCH-driven
deterministic setup instead of an LLM turn so the green signal is
reproducible across CI runs. The PATCH on ``region`` (all-15-rows
populated) forces the schema.yml exporter to emit a passing
``not_null_stg_orders_region`` test.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from driver import DbtTestDriver


pytestmark = pytest.mark.real_io


def test_happy_path_revalidates_green(
    driver: DbtTestDriver,
    jwt: str,
    project_with_orders: tuple[str, str],
    work_dir: Path,
) -> None:
    project_id, dataset_id = project_with_orders

    driver.patch_column_required(jwt, dataset_id, "region")

    report = driver.run(jwt, project_id, work_dir)

    assert report.status == "pass", (
        f"expected status='pass'; got status={report.status!r}, "
        f"failures={report.failures!r}, output={report.dbt_output[-400:]!r}"
    )
    assert report.models_built, (
        f"happy-path expected at least one model built; got {report.models_built!r}"
    )
    assert report.tests_run, (
        f"happy-path expected at least one test executed; got {report.tests_run!r}"
    )
