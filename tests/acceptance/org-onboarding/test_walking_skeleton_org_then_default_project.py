"""Walking skeleton — the single end-to-end onboarding journey.

Gherkin (features/org-onboarding.feature):
  Scenario: A new person creates an organisation and a first project, then enters the app

Driving port: the user-facing ingress. The empty-org dev principal begins a
session, is routed to onboarding, creates an organisation, then creates a first
project, and onboarding completes.

RED until: S1 (DEV_NO_ORG + created_by + drop auto-create) AND S4 (default-project
step) land. Under current code /api/orgs/me resolves from the header claim, so the
session never settles in needs_org and this fails at the first assertion.
"""

from __future__ import annotations

import uuid

import pytest
from driver import OnboardingDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.walking_skeleton,
    pytest.mark.happy_path,
    pytest.mark.s4_ui_default_project,
]


def test_orgless_principal_completes_org_and_default_project(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    org_name = f"Acceptance Org {uuid.uuid4().hex[:8]}"
    project_name = "Default Project"

    # Given: an empty-org principal — /api/orgs/me 404s under DEV_NO_ORG.
    assert driver.get_my_org(bearer=bearer).status == 404

    # When: they begin their session.
    doc = driver.session_begin(bearer=bearer, force_restart=True).json()

    # Then: they are guided to onboarding to set up an organisation.
    assert driver.phase(doc) == "onboarding"
    assert driver.region_state(doc, "onboarding") == "needs_org"

    # When: they submit a valid organisation name.
    doc = driver.post_event(
        {"type": "org_form_submitted", "payload": {"org_name": org_name}}, bearer=bearer
    ).json()

    # Then: the organisation is set up (onboarding settles ready) and recorded as
    # owned by them — proven end to end because /api/orgs/me now resolves for the
    # same principal under DEV_NO_ORG (only possible via created_by linkage).
    assert driver.region_state(doc, "onboarding") == "ready"
    me = driver.get_my_org(bearer=bearer)
    assert me.status == 200
    assert me.json()["data"]["attributes"]["name"] == org_name

    # And: they are asked to create their first project.
    assert driver.region_state(doc, "projectContext") == "no_projects"

    # When: they submit a name for their first project.
    doc = driver.post_event(
        {
            "type": "create_project_submitted",
            # name carried under both keys — see upstream-issues.md UI-1 (the
            # machine's pending-name field is misnamed `org_name`).
            "payload": {"name": project_name, "org_name": project_name},
        },
        bearer=bearer,
    ).json()

    # Then: the first project is created and onboarding is complete.
    assert driver.region_state(doc, "projectContext") == "project_selected"
    projects = driver.list_projects(bearer=bearer).json()
    rows = projects.get("data", projects) if isinstance(projects, dict) else projects
    # JSON:API rows nest name under attributes; tolerate a flat shape too.
    names = [p.get("name") or p.get("attributes", {}).get("name") for p in rows]
    assert project_name in names

    # And: onboarding complete = org exists AND a default project exists.
    assert driver.phase(doc) in ("project_context", "chat")
