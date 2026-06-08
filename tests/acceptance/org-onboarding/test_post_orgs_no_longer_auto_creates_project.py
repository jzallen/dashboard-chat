"""Setting up an organisation no longer auto-creates a project (D2 regression).

Gherkin (features/org-onboarding.feature):
  Scenario: Setting up an organisation no longer auto-creates a project

Driving port: the user-facing ingress (`POST /api/orgs`). Creating an organisation
must NOT side-effect a "My First Project" — first-project creation now belongs
solely to the project-context `create_project_submitted` step.

RED until: S1 (D2 — drop the create_project call in create_organization) lands.
Under current code an org create auto-creates exactly one "My First Project", so
the empty-projects assertion fails.
"""

from __future__ import annotations

import uuid

import pytest
from driver import OnboardingDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.regression,
    pytest.mark.s1_backend,
]


def test_org_create_does_not_auto_create_a_project(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    org_name = f"No Auto Project Org {uuid.uuid4().hex[:8]}"

    # Given: an empty-org principal (no org resolves).
    assert driver.get_my_org(bearer=bearer).status == 404

    # When: they set up an organisation (directly, the create endpoint).
    created = driver.create_org(org_name, bearer=bearer)
    assert created.status == 201, created.body

    # Then: the organisation is set up, and no project has been created automatically.
    listing = driver.list_projects(bearer=bearer).json()
    rows = listing.get("data", listing) if isinstance(listing, dict) else listing
    assert rows == [], f"expected zero projects after org create, got {rows!r}"

    # And: no "My First Project" exists by name.
    names = [r.get("name") for r in rows]
    assert "My First Project" not in names
