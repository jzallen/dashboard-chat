"""An organisation-less person is routed to onboarding, with their identity shown.

Gherkin (features/org-onboarding.feature):
  Scenario: An organisation-less person is routed to onboarding with their identity shown

Driving port: the user-facing ingress. Begin a session as the empty-org dev
principal; the document must settle in the onboarding phase / needs_org state and
carry the verified identity.

RED until: S1 (DEV_NO_ORG resolution) lands — under current code /api/orgs/me
resolves from the header claim, so the session settles `ready`, not `needs_org`.
"""

from __future__ import annotations

import pytest
from driver import DEV_USER_EMAIL, OnboardingDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.happy_path,
    pytest.mark.s3_ui_onboarding,
]


def test_session_begin_settles_needs_org_with_identity(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal

    # When: they begin their session.
    doc = driver.session_begin(bearer=bearer, force_restart=True).json()

    # Then: they are guided to onboarding to set up an organisation.
    assert driver.phase(doc) == "onboarding"
    assert driver.region_state(doc, "onboarding") == "needs_org"

    # And: their identity is shown on the onboarding surface.
    user = driver.region_context(doc, "onboarding").get("user", {})
    assert user.get("email") == DEV_USER_EMAIL
