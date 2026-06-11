"""An unrecognised report is rejected at the edge (the closed wire union).

Gherkin (features/org-onboarding.feature):
  Scenario: An unrecognised report is rejected at the edge

ADR-050 §e.2 + ADR-049 D4: the wire union becomes CLOSED (the ``{type: string}``
catch-all retires). The router ACL validates EVERY POST against the full closed
vocabulary — an unknown ``type`` is rejected with ``400`` at the edge in every
phase. This resolves ADR-046's "unmodeled-event silence" question and underpins the
crash-class elimination (vocabulary routing requires naming the vocabulary).

The discriminating contract is enforcement in the ENGAGED phase: today the router
only validates the onboarding vocabulary while ``phase == onboarding`` and forwards
everything verbatim afterwards (an unknown type → ``200``, silently dropped). Under
the closed union it must be ``400`` regardless of phase.

RED on the pre-feature stack because: reaching engaged needs the new report
vocabulary (RED at setup on the old stack), and even once engaged the old router
forwards the unknown type as ``200`` rather than rejecting it. RED for the right
reason: total closed-union enforcement is unimplemented.
"""

from __future__ import annotations

import uuid

import pytest
from driver import OnboardingDriver, jsonapi_single

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.needs_dev_no_org,
    pytest.mark.error_path,
    pytest.mark.cdo_s3,
]


def test_unknown_event_type_is_rejected_in_engaged_phase(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    org_name = f"Closed Union Org {uuid.uuid4().hex[:8]}"
    project_name = "My First Project"

    # Given: they have completed onboarding and entered the app (engaged phase).
    driver.session_begin(bearer=bearer, force_restart=True)
    driver.probe_and_report_org(bearer=bearer)
    created = driver.create_org(org_name, bearer=bearer)
    assert created.status == 201, created.body
    driver.report("org_created", {"org": jsonapi_single(created.json())}, bearer=bearer)
    proj = driver.create_project(project_name, bearer=bearer)
    assert proj.status == 201, proj.body
    doc = driver.report(
        "project_created", {"project": jsonapi_single(proj.json())}, bearer=bearer
    ).json()
    assert driver.phase(doc) == "chat"
    selected_project_id = driver.active_scope_project_id(doc)

    # When: a report of an unrecognised kind arrives.
    rejected = driver.post_event(
        {"type": "definitely_not_a_real_event", "payload": {}}, bearer=bearer
    )

    # Then: it is rejected as a bad request (the closed union rejects at the edge)...
    assert rejected.status == 400, (
        f"expected the closed wire union to reject an unknown type with 400, "
        f"got {rejected.status}: {rejected.body!r}"
    )

    # ...and changes nothing: the current state is intact and the service is alive.
    after = driver.get_state(bearer=bearer)
    assert after.status == 200, after.body
    assert driver.phase(after.json()) == "chat"
    assert driver.active_scope_project_id(after.json()) == selected_project_id
