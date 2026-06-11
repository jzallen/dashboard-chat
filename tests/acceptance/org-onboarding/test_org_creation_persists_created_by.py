"""Creating an organisation records its owner (created_by linkage).

Gherkin (features/org-onboarding.feature):
  Scenario: Creating an organisation records its owner

Driving port: the user-facing ingress. The client creates the org (real write),
then reports ``org_created``; the onboarding region settles ``ready``. Ownership is
asserted END TO END: under DEV_NO_ORG, /api/orgs/me resolves the just-created org
for the SAME principal, which is only possible if ``created_by`` linked the org to
the user.

(The direct column assertion — organizations.created_by == user.id — lives in the
gate-tested backend unit test; the OrgSettings response does not expose created_by,
so the resolution behaviour is the honest API-level observable.)

RED on the pre-feature stack because: ``org_created`` is rejected by the closed
onboarding ACL as unknown (HTTP 400), so the report never settles the region
``ready``. The ``created_by`` linkage itself is already shipped behaviour; what is
unimplemented here is the report-driven settle.
"""

from __future__ import annotations

import uuid

import pytest
from driver import OnboardingDriver, jsonapi_single

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.happy_path,
    pytest.mark.cdo_s1,
]


def test_org_creation_links_owner_so_principal_resolves_it(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    org_name = f"Owner Link Org {uuid.uuid4().hex[:8]}"

    # Given: they have begun their session and reached organisation setup.
    driver.session_begin(bearer=bearer, force_restart=True)
    doc = driver.probe_and_report_org(bearer=bearer).json()
    assert driver.region_state(doc, "onboarding") == "needs_org"
    # Pre-state: no org resolves for this principal.
    assert driver.get_my_org(bearer=bearer).status == 404

    # When: they create a valid organisation (real write) and report it.
    created = driver.create_org(org_name, bearer=bearer)
    assert created.status == 201, created.body
    doc = driver.report(
        "org_created", {"org": jsonapi_single(created.json())}, bearer=bearer
    ).json()

    # Then: the organisation is set up.
    assert driver.region_state(doc, "onboarding") == "ready"

    # And: the organisation record names them as its owner — proven because the
    # same principal now resolves exactly this org under DEV_NO_ORG.
    me = driver.get_my_org(bearer=bearer)
    assert me.status == 200
    assert me.json()["data"]["attributes"]["name"] == org_name
