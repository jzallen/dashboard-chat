"""Walking skeleton — the single end-to-end client-driven onboarding journey.

Gherkin (features/org-onboarding.feature):
  Scenario: A new person creates an organisation and a first project, then enters the app

Driving port: the user-facing ingress. The empty-org dev principal begins a
session, learns it has no organisation (probe → report), is guided to onboarding,
creates an organisation (real write → report), then its first project is created
automatically (real write → report), and onboarding completes — the person enters
the app on a selected project.

What changed vs. the shipped server-actor suite (ADR-048/049/050):
  - session_begin now settles in ``awaiting_org_report`` (no server-side I/O to
    verify); the *client* probes ``GET /api/orgs/me`` and reports the definitive
    answer (``org_not_found`` / ``org_found``).
  - the org write is a real ``POST /api/orgs`` followed by an ``org_created``
    report (the retired ``org_form_submitted`` write-event is gone).
  - Phase D is AUTOMATIC: a real ``POST /api/projects`` followed by a
    ``project_created`` report (the retired ``create_project_submitted`` event,
    with its UI-1 ``org_name`` misnomer, is gone).
  - app entry is asserted on the (f) triple of the project_created response's OWN
    document: projectContext.state == project_selected AND active_scope.project_id
    set AND phase == chat.

RED on the pre-feature stack because: session_begin settles ``needs_org`` (old
invoke model), the closed onboarding ACL rejects ``org_not_found`` / ``org_created``
as unknown (HTTP 400 — they are not yet wire members), so the region never reaches
``awaiting_org_report`` → ``ready`` and the report POSTs do not return state
documents. RED for the right reason: the new vocabulary + state-set is unimplemented.

INV-PCO: every resource claim is re-asserted against the backend SSOT
(``GET /api/orgs/me``, ``GET /api/projects``) — never read off the ui-state document.
"""

from __future__ import annotations

import uuid

import pytest
from driver import OnboardingDriver, jsonapi_single, row_names

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.walking_skeleton,
    pytest.mark.happy_path,
    pytest.mark.cdo_s1,
]


def test_orgless_principal_completes_org_and_default_project(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    org_name = f"Acceptance Org {uuid.uuid4().hex[:8]}"
    project_name = "My First Project"

    # Given: an empty-org principal — /api/orgs/me 404s under DEV_NO_ORG.
    assert driver.get_my_org(bearer=bearer).status == 404

    # When: they begin their session.
    doc = driver.session_begin(bearer=bearer, force_restart=True).json()

    # Then: they are waiting to learn whether they have an organisation (no
    # server-side probe — the wait is for the CLIENT's report).
    assert driver.phase(doc) == "onboarding"
    assert driver.region_state(doc, "onboarding") == "awaiting_org_report"

    # When: they find they have no organisation and report it.
    reported = driver.probe_and_report_org(bearer=bearer)
    assert reported.status == 200, reported.body
    doc = reported.json()

    # Then: they are guided to onboarding to set up an organisation.
    assert driver.region_state(doc, "onboarding") == "needs_org"

    # When: they create a valid organisation (real write) and report it.
    created = driver.create_org(org_name, bearer=bearer)
    assert created.status == 201, created.body
    org = jsonapi_single(created.json())
    reported = driver.report("org_created", {"org": org}, bearer=bearer)
    assert reported.status == 200, reported.body
    doc = reported.json()

    # Then: the organisation is set up (onboarding settles ready) and recorded as
    # owned by them — proven end to end because /api/orgs/me now resolves for the
    # same principal under DEV_NO_ORG (only possible via created_by linkage).
    assert driver.region_state(doc, "onboarding") == "ready"
    me = driver.get_my_org(bearer=bearer)
    assert me.status == 200
    assert me.json()["data"]["attributes"]["name"] == org_name

    # And the parent advances to the project-context phase, waiting on the initial
    # scope (the client has not probed/created the project yet).
    assert driver.region_state(doc, "projectContext") == "awaiting_scope_report"

    # When: their first project is created automatically (real write) and reported.
    proj_created = driver.create_project(project_name, bearer=bearer)
    assert proj_created.status == 201, proj_created.body
    project = jsonapi_single(proj_created.json())
    reported = driver.report("project_created", {"project": project}, bearer=bearer)
    assert reported.status == 200, reported.body
    doc = reported.json()

    # Then: onboarding is complete and they enter the app on a selected project —
    # the (f) triple, atomic on the project_created response's OWN document.
    assert driver.region_state(doc, "projectContext") == "project_selected"
    assert driver.active_scope_project_id(doc) == project["id"]
    assert driver.phase(doc) == "chat"

    # And the project exists in the backend SSOT (INV-PCO — assert via the backend).
    listing = driver.list_projects(bearer=bearer).json()
    assert project_name in row_names(
        listing.get("data", listing) if isinstance(listing, dict) else listing
    )
