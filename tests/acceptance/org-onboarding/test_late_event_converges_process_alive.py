"""Late/out-of-phase reports converge and never crash the service (Spec 8).

Gherkin (features/org-onboarding.feature):
  Scenario: A late or duplicate report after entering the app changes nothing and never crashes

Domain Spec 8 (domain-model.md §6.2) — the regression for the 2026-06-10 crash
class. After the person has entered the app (engaged), a stale tab's onboarding
report (or a duplicate ``project_created``) arrives out of phase. Under phase-gated
vocabulary routing the event has no handler in the current phase → NO transition,
NO send into a settled/stopped child → the response is the current settled document
and the process stays alive. The old design forwarded every event into
``active_child_id`` and could send into a stopped child, throwing inside event
processing and killing the ui-state process.

This port-to-port test asserts the user-facing guarantee: convergence (the late
report changes nothing; the current document is returned) AND liveness (a
subsequent request still succeeds). NOTE: the specific process-crash vector
(``user_rejected`` reached via a re-verify failure) is not reproducible in the dev
fake-WorkOS stack (the re-verify always succeeds and ``user_rejected`` retires);
the deterministic crash reproduction is a DELIVER ui-state unit test. See
distill/wave-decisions.md (DWD-5).

RED on the pre-feature stack because: reaching engaged requires the new report
vocabulary (``org_created`` is rejected as unknown on the old stack → HTTP 400), so
the happy-path setup cannot complete. RED for the right reason: the report-driven
engaged entry is unimplemented.
"""

from __future__ import annotations

import uuid

import pytest
from driver import OnboardingDriver, jsonapi_single

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.regression,
    pytest.mark.cdo_s3,
]


def _complete_onboarding(driver: OnboardingDriver, bearer: str) -> dict:
    org_name = f"Late Event Org {uuid.uuid4().hex[:8]}"
    project_name = "My First Project"
    driver.session_begin(bearer=bearer, force_restart=True)
    driver.probe_and_report_org(bearer=bearer)
    created = driver.create_org(org_name, bearer=bearer)
    assert created.status == 201, created.body
    driver.report("org_created", {"org": jsonapi_single(created.json())}, bearer=bearer)
    proj = driver.create_project(project_name, bearer=bearer)
    assert proj.status == 201, proj.body
    project = jsonapi_single(proj.json())
    doc = driver.report("project_created", {"project": project}, bearer=bearer).json()
    assert driver.region_state(doc, "projectContext") == "project_selected"
    assert driver.phase(doc) == "chat"
    return doc


def test_late_and_duplicate_reports_converge_and_service_stays_alive(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal

    # Given: they have completed onboarding and entered the app.
    settled = _complete_onboarding(driver, bearer)
    entered_project_id = driver.active_scope_project_id(settled)

    # When: a stale report from an earlier step arrives out of phase (a stale tab
    # re-posting an onboarding outcome long after the phase advanced).
    late = driver.report("org_created", {"org": {"id": "stale", "name": "Stale"}}, bearer=bearer)

    # Then: no change occurs and the current state is returned (not an error/crash).
    assert late.status == 200, late.body
    doc = late.json()
    assert driver.phase(doc) == "chat"
    assert driver.region_state(doc, "projectContext") == "project_selected"
    assert driver.active_scope_project_id(doc) == entered_project_id

    # And a duplicate in-phase report is idempotent (re-submit after a lost response).
    dup = driver.report(
        "project_created",
        {"project": {"id": entered_project_id or "", "name": "My First Project"}},
        bearer=bearer,
    )
    assert dup.status == 200, dup.body
    assert driver.active_scope_project_id(dup.json()) == entered_project_id

    # And: the state service is still alive and serving requests (the liveness
    # regression — the 2026-06-10 process death must not recur).
    after = driver.get_state(bearer=bearer)
    assert after.status == 200, after.body
    assert driver.phase(after.json()) == "chat"
