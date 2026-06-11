"""An org-create failure on our end is recoverable (Spec 5 — no dead end).

Gherkin (features/org-onboarding.feature):
  Scenario: An organisation creation that fails on our end is recoverable

Domain Spec 5 (domain-model.md §4.3) + ADR-048's binding constraint: a failure
that is NOT a re-edit (5xx / timeout / a compensated OR uncompensated provisioning
failure) lands in ``error_recoverable`` carrying the cause — and
``error_recoverable`` ACCEPTS outcome reports, so a re-submission converges. The
terminal-in-practice ``partial-setup`` dead-end dies. Compensated and uncompensated
failures are client-INDISTINGUISHABLE by design: the client reports the same
``org_create_failed`` cause and its retry succeeds either way.

Choreography: the client reports ``org_create_failed {cause: org_create_failed}``
(the retry class) → ``error_recoverable``; on retry it re-POSTs (clean after a
compensated failure; still succeeding after an uncompensated one) and reports
``org_created`` → ``ready``.

Display rule (amendment 2): the retry class triggers a generic "something went
wrong on our end" surface with a retry affordance — never the raw tag. The
no-raw-tag-in-DOM half is a browser/DELIVER assertion; here we assert the document
reaches the report-accepting ``error_recoverable`` state and recovers.

RED on the pre-feature stack because: (1) ``org_create_failed`` is not a wire member
(closed onboarding ACL → HTTP 400); (2) the shipped ``error_recoverable`` has no exit
transitions (terminal-in-practice). RED for the right reason: the recoverable error
arm is unimplemented.
"""

from __future__ import annotations

import uuid

import pytest
from driver import OnboardingDriver, jsonapi_single

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.error_path,
    pytest.mark.cdo_s3,
]


def test_org_create_failure_lands_recoverable_then_retry_succeeds(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    org_name = f"Recoverable Org {uuid.uuid4().hex[:8]}"

    # Given: they have begun their session and reached organisation setup.
    driver.session_begin(bearer=bearer, force_restart=True)
    doc = driver.probe_and_report_org(bearer=bearer).json()
    assert driver.region_state(doc, "onboarding") == "needs_org"

    # When: their organisation creation fails on our end and is reported (the
    # client observed a 5xx/timeout — compensated or not, indistinguishable here).
    reported = driver.report(
        "org_create_failed", {"cause": "org_create_failed", "org_name": org_name}, bearer=bearer
    )
    assert reported.status == 200, reported.body
    doc = reported.json()

    # Then: they land in a recoverable error state (not a terminal dead end).
    assert driver.region_state(doc, "onboarding") == "error_recoverable"

    # When: they try again — the re-POST succeeds (clean after a compensated
    # failure; still succeeds after an uncompensated one) — and report it.
    created = driver.create_org(org_name, bearer=bearer)
    assert created.status == 201, created.body
    doc = driver.report(
        "org_created", {"org": jsonapi_single(created.json())}, bearer=bearer
    ).json()

    # Then: the organisation is set up and they are no longer in an error state.
    assert driver.region_state(doc, "onboarding") == "ready"
    me = driver.get_my_org(bearer=bearer)
    assert me.status == 200
    assert me.json()["data"]["attributes"]["name"] == org_name
