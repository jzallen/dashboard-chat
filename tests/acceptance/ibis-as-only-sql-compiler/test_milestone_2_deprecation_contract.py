"""Milestone-2 (MR-3) @deprecation_contract — free-form sql_definition rejected.

Drives the @deprecation_contract scenario from
``docs/feature/ibis-as-only-sql-compiler/distill/milestone-2-report-ibis-compiler.feature``:

    Scenario: A report-creation call carrying the deprecated free-form SQL
        field is rejected with a structured error

Per ADR-026 §"Decision outcome" item 2 — pre-production codebase, one-cut
rip-out — the report-creation use case rejects any caller still supplying the
deprecated ``sql_definition`` input with a structured 400 naming the field.
The storage column ``sql_definition`` is now ALWAYS derived by the
``ReportIbisCompiler`` from structured ``columns_metadata``; there is no
caller-supplied SQL path remaining.

Contracts pinned by this test:
  1. The HTTP boundary returns a 4xx (400) status for a request carrying
     ``sql_definition``.
  2. The error envelope names ``sql_definition`` as the deprecated field
     (analyst-readable message, no internal exception name leaks).
  3. The error envelope's title surfaces the deprecation contract
     ("Deprecated Report SQL Definition Field") so JSON:API consumers can
     classify the rejection.
  4. No report is persisted — the post-call report list count equals the
     pre-call count, proving the use case short-circuits before the
     repository write.

(Stretch contract: "the compiler is never invoked" — observable only
indirectly through the no-write-side-effect assertion, which is what we
test.)

Per DWD-1 Strategy C the suite skips cleanly when the compose stack is
unreachable; the GREEN gate at this step is satisfied by the use-case unit
tests when the stack is down.
"""

from __future__ import annotations

import pytest

from driver import CreatedDataset, ReportCreateError, ViewAcceptanceDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.milestone_2,
    pytest.mark.deprecation_contract,
]


def test_free_form_sql_definition_input_is_rejected_with_structured_error(
    driver: ViewAcceptanceDriver,
    jwt: str,
    project: str,
    orders_dataset: CreatedDataset,
) -> None:
    pre_reports = driver.list_reports(jwt, project)
    pre_count = len(pre_reports)

    result = driver.try_create_report(
        jwt,
        project,
        name="rogue_report",
        report_type="fact",
        source_refs=[orders_dataset.as_source_ref()],
        columns_metadata=[],
        sql_definition="SELECT 1",
    )

    # 1. Structured rejection at the HTTP boundary.
    assert isinstance(result, ReportCreateError), (
        f"expected the deprecated-sql_definition request to be rejected; "
        f"got successful response: {result}"
    )
    assert result.status_code == 400, (
        f"expected 400 deprecation rejection; got {result.status_code} "
        f"body={result.body}"
    )

    # 2. & 3. Error envelope names sql_definition + surfaces the deprecation
    # title so JSON:API consumers can branch on the contract.
    errors = result.body.get("errors", []) if isinstance(result.body, dict) else []
    assert errors, f"expected JSON:API errors array, got body={result.body!r}"
    err = errors[0]
    title = (err.get("title") or "").lower()
    detail = (err.get("detail") or "").lower()
    assert "deprecat" in title, (
        f"error title does not surface the deprecation contract: {err!r}"
    )
    assert "sql_definition" in detail, (
        f"error detail does not name the deprecated field 'sql_definition': "
        f"{err!r}"
    )

    # 4. No report persisted — the use case short-circuits before the write.
    post_reports = driver.list_reports(jwt, project)
    assert len(post_reports) == pre_count, (
        f"a report was persisted despite the deprecation rejection:\n"
        f"before: {pre_reports}\nafter: {post_reports}"
    )
