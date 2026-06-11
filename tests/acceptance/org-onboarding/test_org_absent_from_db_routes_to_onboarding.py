"""A person whose organisation is absent from the app DB is routed to onboarding.

Gherkin (features/org-onboarding.feature):
  Scenario: A person whose organisation is absent from the app is routed to onboarding

This is the app-DB-existence contract: onboarding is gated on the organisation
EXISTING IN THE APP DB (GET /api/orgs/me → 404), NOT on the token's org claim. A
principal whose claimed org is not a row in our DB must land in onboarding.

Driving port: the user-facing ingress. With DEV_NO_ORG the injected X-Org-Id
header is ignored and the org is resolved from the DB by ``created_by``; with no
matching row, /api/orgs/me 404s, the client reports ``org_not_found``, and the
session settles ``needs_org``.

RED on the pre-feature stack because: ``org_not_found`` is not a wire member yet
(the closed onboarding ACL rejects it as unknown → HTTP 400), so the report never
drives the region. RED for the right reason: the report-driven model is unimplemented.
"""

from __future__ import annotations

import pytest
from driver import OnboardingDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.happy_path,
    pytest.mark.cdo_s1,
]


def test_org_absent_from_db_routes_to_onboarding(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal

    # Given: the app has no organisation owned by them.
    assert driver.get_my_org(bearer=bearer).status == 404, (
        "precondition: the principal must have no org row — the app-DB-existence "
        "contract is what this scenario asserts; a 200 here means the header claim "
        "is short-circuiting (DEV_NO_ORG not in effect)"
    )

    # When: they begin their session and report that they have no organisation.
    driver.session_begin(bearer=bearer, force_restart=True)
    reported = driver.probe_and_report_org(bearer=bearer)
    assert reported.status == 200, reported.body
    doc = reported.json()

    # Then: they are guided to onboarding to set up an organisation.
    assert driver.phase(doc) == "onboarding"
    assert driver.region_state(doc, "onboarding") == "needs_org"
