"""An invalid organisation name keeps the person on organisation setup.

Gherkin (features/org-onboarding.feature):
  Scenario: An invalid organisation name keeps the person on organisation setup

Driving port: the user-facing ingress. Submitting a blank/invalid org name must
NOT advance to creating_org; the onboarding region stays `needs_org` and surfaces
an inline validation problem (regions.onboarding.context.org_validation_error).

The onboarding machine's `needs_org` has a guarded transition: `org_form_submitted`
with a name failing `isOrgNameValid` falls through to `recordOrgValidationError`
(no state change).

RED until: S1 (DEV_NO_ORG so the principal is in needs_org at all) lands.
"""

from __future__ import annotations

import pytest
from driver import OnboardingDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.error_path,
    pytest.mark.s3_ui_onboarding,
]


def test_blank_org_name_stays_needs_org_with_inline_error(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal

    # Given: they have begun their session and reached organisation setup.
    doc = driver.session_begin(bearer=bearer, force_restart=True).json()
    assert driver.region_state(doc, "onboarding") == "needs_org"

    # When: they submit an organisation name that is not allowed (blank).
    doc = driver.post_event(
        {"type": "org_form_submitted", "payload": {"org_name": "   "}}, bearer=bearer
    ).json()

    # Then: they are shown an inline problem with the name, and remain on setup.
    assert driver.region_state(doc, "onboarding") == "needs_org"
    err = driver.region_context(doc, "onboarding").get("org_validation_error")
    assert err is not None, "expected an inline org_validation_error to be surfaced"

    # And: no organisation was created for this principal.
    assert driver.get_my_org(bearer=bearer).status == 404
