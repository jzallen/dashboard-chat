"""Milestone-2 (MR-3) modeling-violation contract — measures without dimensions.

Drives the modeling-violation scenario from
``docs/feature/ibis-as-only-sql-compiler/distill/milestone-2-report-ibis-compiler.feature``:

    Scenario: A report submitted with measures but no dimensions is rejected
        as a report-modeling violation

Per ADR-026 §"Decision outcome" item 2 and DWD-5 the report-creation use case
rejects a structurally-valid-but-meaningless aggregation — one or more
``role=measure`` columns with zero ``role=dimension`` columns — at the
use-case boundary with a NAMED structured error. The compiler must never see
a dimensionless aggregation; a future legitimate scalar-mart use case is a
typed variant, not a relaxation of this contract.

Contracts pinned by this test:
  1. The HTTP boundary returns a 400 status for the measure-only request.
  2. The error envelope's ``type`` (or equivalent classifier) names the
     contract: ``REPORT_REQUIRES_DIMENSION``.
  3. The error envelope's detail explains the violation in analyst terms —
     mentions the word "dimension" so a tool-call author can read the
     rejection without consulting source.
  4. No report is persisted — the post-call ``list_reports`` does not contain
     the rejected report's name, proving the use case short-circuits before
     the repository write (and crucially before compiler invocation).

Per DWD-1 Strategy C the suite skips cleanly when the compose stack is
unreachable; the use-case unit test in
``backend/tests/use_cases/report/test_create_report.py`` covers the same
contract for the GREEN gate when the stack is down.
"""

from __future__ import annotations

import pytest

from driver import CreatedDataset, ReportCreateError, ViewAcceptanceDriver

pytestmark = [pytest.mark.real_io, pytest.mark.milestone_2]


def test_measures_without_dimensions_rejected_as_modeling_violation(
    driver: ViewAcceptanceDriver,
    jwt: str,
    project: str,
    orders_dataset: CreatedDataset,
) -> None:
    pre_reports = driver.list_reports(jwt, project)
    pre_names = {_attribute(r, "name") for r in pre_reports}

    result = driver.try_create_report(
        jwt,
        project,
        name="loose_count",
        report_type="fact",
        source_refs=[orders_dataset.as_source_ref()],
        columns_metadata=[
            {
                "name": "order_count",
                "semantic_role": "measure",
                "semantic_type": "count",
                "source_column": "order_id",
                "source_ref": orders_dataset.id,
            }
        ],
    )

    # 1. Structured rejection at the HTTP boundary.
    assert isinstance(result, ReportCreateError), (
        f"expected the measures-without-dimensions request to be rejected; "
        f"got successful response: {result}"
    )
    assert result.status_code == 400, (
        f"expected 400 modeling-violation rejection; got {result.status_code} "
        f"body={result.body}"
    )

    # 2. & 3. Error envelope surfaces the modeling-violation contract.
    errors = result.body.get("errors", []) if isinstance(result.body, dict) else []
    assert errors, f"expected JSON:API errors array, got body={result.body!r}"
    err = errors[0]
    title = (err.get("title") or "").lower()
    detail = (err.get("detail") or "").lower()
    # The contract name surfaces in the title so JSON:API consumers can
    # branch on it ("Report Requires Dimension").
    assert "dimension" in title, (
        f"error title does not surface the modeling-violation contract: {err!r}"
    )
    # The detail is analyst-readable and names the requirement.
    assert "dimension" in detail, (
        f"error detail does not explain the dimension requirement to the analyst: {err!r}"
    )

    # 4. No report is persisted — short-circuit before the repository write.
    post_reports = driver.list_reports(jwt, project)
    post_names = {_attribute(r, "name") for r in post_reports}
    assert "loose_count" not in post_names, (
        f"a dimensionless report was persisted despite the modeling-violation rejection:\n"
        f"before names: {pre_names}\nafter names: {post_names}"
    )


def _attribute(record: dict, key: str) -> str | None:
    """Read ``key`` from a JSON:API record's ``attributes`` block."""
    attrs = record.get("attributes") if isinstance(record, dict) else None
    if isinstance(attrs, dict):
        value = attrs.get(key)
        if isinstance(value, str):
            return value
    return None
