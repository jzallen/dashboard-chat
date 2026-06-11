"""An organisation-less person is routed to onboarding, with their identity shown.

Gherkin (features/org-onboarding.feature):
  Scenario: An organisation-less person is routed to onboarding with their identity shown

Driving port: the user-facing ingress. Begin a session as the empty-org dev
principal; the document settles in ``awaiting_org_report`` carrying the verified
identity (seeded from auth-proxy-verified headers at cold-start, DR-4 — NOT from a
re-verification round-trip, which retires). The client then probes existence and
reports ``org_not_found``; the region settles ``needs_org`` and the person is
routed to onboarding.

RED on the pre-feature stack because: the old invoke model settles ``needs_org``
directly on session_begin (no ``awaiting_org_report`` state exists), and
``org_not_found`` is rejected by the closed onboarding ACL as unknown (HTTP 400).
RED for the right reason: the report-driven state-set is unimplemented.
"""

from __future__ import annotations

import pytest
from driver import DEV_USER_EMAIL, OnboardingDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.happy_path,
    pytest.mark.cdo_s1,
]


def test_session_begin_awaits_report_then_needs_org_with_identity(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal

    # When: they begin their session.
    doc = driver.session_begin(bearer=bearer, force_restart=True).json()

    # Then: they are waiting to learn whether they have an organisation.
    assert driver.phase(doc) == "onboarding"
    assert driver.region_state(doc, "onboarding") == "awaiting_org_report"

    # And: their identity is shown on the onboarding surface (header-seeded).
    user = driver.region_context(doc, "onboarding").get("user", {})
    assert user.get("email") == DEV_USER_EMAIL

    # When: they find they have no organisation and report it.
    reported = driver.probe_and_report_org(bearer=bearer)
    assert reported.status == 200, reported.body
    doc = reported.json()

    # Then: they are guided to onboarding to set up an organisation.
    assert driver.phase(doc) == "onboarding"
    assert driver.region_state(doc, "onboarding") == "needs_org"
