"""After the organisation, the first project is created automatically.

Gherkin (features/org-onboarding.feature):
  Scenario: After the organisation, the first project is created automatically

Driving port: the user-facing ingress. With an organisation in place, the parent
advances to the project-context phase and the region waits on the initial scope
(``awaiting_scope_report``). The client AUTOMATICALLY creates the default project
(real write, no user input — project naming is a later feature) and reports
``project_created``; the region settles ``project_selected`` and the person enters
the app on that project (the (f) triple).

This is where the UI-1 quirk dies: the old ``create_project_submitted`` event
carried the project name in ``payload.org_name`` (a misnomer). The event retires;
the client posts a real ``POST /api/projects`` and reports ``project_created``.

RED on the pre-feature stack because: the old model settles ``no_projects`` (not
``awaiting_scope_report``) and ``project_created`` is not the wire trigger
(``create_project_submitted`` was). RED for the right reason: the automatic Phase-D
report choreography is unimplemented.
"""

from __future__ import annotations

import uuid

import pytest
from driver import OnboardingDriver, jsonapi_single, row_names

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.happy_path,
    pytest.mark.cdo_s1,
]


def test_default_project_is_created_automatically_and_completes(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    org_name = f"Project Step Org {uuid.uuid4().hex[:8]}"
    project_name = "My First Project"

    # Given: they have set up their organisation.
    driver.session_begin(bearer=bearer, force_restart=True)
    driver.probe_and_report_org(bearer=bearer)
    created = driver.create_org(org_name, bearer=bearer)
    assert created.status == 201, created.body
    doc = driver.report(
        "org_created", {"org": jsonapi_single(created.json())}, bearer=bearer
    ).json()
    assert driver.region_state(doc, "onboarding") == "ready"

    # Then: they are waiting on their initial project scope (parent advanced;
    # no auto-create on the backend — the regression behaviour).
    assert driver.region_state(doc, "projectContext") == "awaiting_scope_report"

    # When: their first project is created automatically (real write) and reported.
    proj_created = driver.create_project(project_name, bearer=bearer)
    assert proj_created.status == 201, proj_created.body
    project = jsonapi_single(proj_created.json())
    doc = driver.report("project_created", {"project": project}, bearer=bearer).json()

    # Then: onboarding is complete and they enter the app on a selected project.
    assert driver.region_state(doc, "projectContext") == "project_selected"
    assert driver.active_scope_project_id(doc) == project["id"]
    assert driver.phase(doc) == "chat"

    # And exactly the one default project exists in the backend SSOT.
    listing = driver.list_projects(bearer=bearer).json()
    rows = listing.get("data", listing) if isinstance(listing, dict) else listing
    assert row_names(rows) == [project_name], (
        f"expected exactly the one default project, got {row_names(rows)}"
    )
