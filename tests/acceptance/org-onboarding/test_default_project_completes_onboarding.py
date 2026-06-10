"""After the organisation, the person creates the default project.

Gherkin (features/org-onboarding.feature):
  Scenario: After the organisation, the person creates the default project

Driving port: the user-facing ingress. With an organisation in place, the
project-context region settles `no_projects`; the principal submits the first
project's name (`create_project_submitted`), and the project is created — onboarding
complete.

RED until: S1 (no auto-create, so no_projects is reachable) AND S4 (the
default-project step) land.
"""

from __future__ import annotations

import uuid

import pytest
from driver import OnboardingDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.happy_path,
    pytest.mark.s4_ui_default_project,
]


def test_no_projects_then_create_project_submitted_completes(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    org_name = f"Project Step Org {uuid.uuid4().hex[:8]}"
    project_name = "Default Project"

    # Given: they have set up their organisation.
    driver.session_begin(bearer=bearer, force_restart=True)
    doc = driver.post_event(
        {"type": "org_form_submitted", "payload": {"org_name": org_name}}, bearer=bearer
    ).json()
    assert driver.region_state(doc, "onboarding") == "ready"

    # Then: they are asked to create their first project (no auto-create — D2).
    assert driver.region_state(doc, "projectContext") == "no_projects"

    # When: they submit a name for their first project.
    doc = driver.post_event(
        {"type": "create_project_submitted", "payload": {"org_name": project_name}},
        bearer=bearer,
    ).json()

    # Then: the first project is created and onboarding is complete.
    assert driver.region_state(doc, "projectContext") == "project_selected"
    listing = driver.list_projects(bearer=bearer).json()
    rows = listing.get("data", listing) if isinstance(listing, dict) else listing
    # JSON:API rows nest name under attributes; tolerate a flat shape too.
    names = [r.get("name") or r.get("attributes", {}).get("name") for r in rows]
    assert names == [project_name], f"expected exactly the one default project, got {names}"
