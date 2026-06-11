"""A first-project failure is recoverable and converges (Spec 7b — probe-first).

Gherkin (features/org-onboarding.feature):
  Scenario: A first-project creation that fails on our end is recoverable and converges

Domain Spec 7b (domain-model.md §5.3) + retry policy (ADR-050 §c): the default
project's retry class is ``project_create_failed`` → ``error_recoverable``
(report-accepting). The retry is PROBE-FIRST CONVERGENCE: before re-POSTing, the
client re-probes ``GET /api/projects`` — a non-empty result means the earlier POST
actually succeeded (a lost response), so the client reports ``scope_resolved`` (the
existing project) rather than creating a DUPLICATE. The flow completes on exactly
one project.

This scenario exercises the lost-response case: the real ``POST /api/projects``
succeeds, but the client (modelled as having lost the response) reports
``project_create_failed``; the probe-first retry finds the project and converges via
``scope_resolved`` — no second project is created.

RED on the pre-feature stack because: the project-context region is invoke-driven
(``resolving_initial_scope`` / ``creating_project``); ``project_create_failed`` and
``scope_resolved`` are not report triggers and the post-org region is not
``awaiting_scope_report``. (On the old stack the run cannot even reach this point —
``org_created`` is rejected as unknown.) RED for the right reason.
"""

from __future__ import annotations

import uuid

import pytest
from driver import OnboardingDriver, jsonapi_single, row_names

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.error_path,
    pytest.mark.cdo_s3,
]


def test_project_failure_recovers_via_probe_first_convergence_no_duplicate(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    org_name = f"Converge Org {uuid.uuid4().hex[:8]}"
    project_name = "My First Project"

    # Given: they have set up their organisation (region waits on initial scope).
    driver.session_begin(bearer=bearer, force_restart=True)
    driver.probe_and_report_org(bearer=bearer)
    created = driver.create_org(org_name, bearer=bearer)
    assert created.status == 201, created.body
    doc = driver.report(
        "org_created", {"org": jsonapi_single(created.json())}, bearer=bearer
    ).json()
    assert driver.region_state(doc, "projectContext") == "awaiting_scope_report"

    # And: the first-project write actually SUCCEEDED on the backend (real write)...
    proj = driver.create_project(project_name, bearer=bearer)
    assert proj.status == 201, proj.body
    project = jsonapi_single(proj.json())

    # When: ...but the client lost the response and reports a failure.
    doc = driver.report(
        "project_create_failed", {"cause": "project_create_failed"}, bearer=bearer
    ).json()

    # Then: they are offered a way to try again (a recoverable error state).
    assert driver.region_state(doc, "projectContext") == "error_recoverable"

    # When: they try again PROBE-FIRST — the project is found to already exist, so
    # they report the resolved scope (not a second create).
    listing = driver.list_projects(bearer=bearer).json()
    rows = listing.get("data", listing) if isinstance(listing, dict) else listing
    assert row_names(rows) == [project_name], (
        f"probe-first precondition: exactly one project should exist, got {row_names(rows)}"
    )
    doc = driver.report("scope_resolved", {"project": project}, bearer=bearer).json()

    # Then: onboarding is complete on exactly one project — no duplicate created.
    assert driver.region_state(doc, "projectContext") == "project_selected"
    assert driver.active_scope_project_id(doc) == project["id"]
    final = driver.list_projects(bearer=bearer).json()
    final_rows = final.get("data", final) if isinstance(final, dict) else final
    assert row_names(final_rows) == [project_name], (
        f"convergence must not duplicate the project, got {row_names(final_rows)}"
    )
