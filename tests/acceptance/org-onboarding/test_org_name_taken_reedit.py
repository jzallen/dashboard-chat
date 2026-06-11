"""An organisation name already in use keeps the person on setup (Spec 4, re-edit).

Gherkin (features/org-onboarding.feature):
  Scenario: An organisation name already in use keeps the person on organisation setup

Domain Spec 4 (domain-model.md §4.3): a 409 on the org name is a RE-EDIT failure,
not a retry — the region REMAINS in ``needs_org`` with ``org_validation_error`` set
(today's 409 arm preserved), and no error screen is shown. The person edits the
name and succeeds — no dead end.

Choreography: the client POSTs the org; the backend's existing name-uniqueness
check returns ``409``; the client maps it to
``org_create_failed {cause: org_name_taken, org_name}`` and reports it.

Display rule (amendment 2): ``org_name_taken`` is machine-readable only; the
document surfaces ``org_validation_error`` (rendered as friendly inline help —
e.g. "That organisation name is already in use — try another"). The no-raw-tag-in-DOM
half is a browser/DELIVER assertion.

RED on the pre-feature stack because: ``org_create_failed`` is not a wire member
(closed onboarding ACL → HTTP 400), so the re-edit report cannot settle the region.
The backend ``409`` itself is existing behaviour. RED for the right reason: the
re-edit cause arm is unimplemented on the wire.
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


def test_name_taken_stays_needs_org_then_recovers_with_a_new_name(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    taken_name = f"Taken Org {uuid.uuid4().hex[:8]}"

    # Given: they have begun their session and reached organisation setup.
    driver.session_begin(bearer=bearer, force_restart=True)
    doc = driver.probe_and_report_org(bearer=bearer).json()
    assert driver.region_state(doc, "onboarding") == "needs_org"

    # And: that organisation name is already in use (someone took it first).
    first = driver.create_org(taken_name, bearer=bearer)
    assert first.status == 201, first.body

    # When: they attempt the same name — the backend rejects it as a conflict.
    conflict = driver.create_org(taken_name, bearer=bearer)
    assert conflict.status == 409, (
        f"expected a 409 name-conflict from the SSOT, got {conflict.status}: "
        f"{conflict.body!r}"
    )

    # And: the client maps the 409 to the re-edit cause and reports it.
    reported = driver.report(
        "org_create_failed",
        {"cause": "org_name_taken", "org_name": taken_name},
        bearer=bearer,
    )
    assert reported.status == 200, reported.body
    doc = reported.json()

    # Then: they remain on organisation setup with an inline problem (no error screen).
    assert driver.region_state(doc, "onboarding") == "needs_org"
    assert driver.region_context(doc, "onboarding").get("org_validation_error") is not None

    # When: they try a different name and report success.
    new_name = f"Fresh Org {uuid.uuid4().hex[:8]}"
    created = driver.create_org(new_name, bearer=bearer)
    assert created.status == 201, created.body
    doc = driver.report(
        "org_created", {"org": jsonapi_single(created.json())}, bearer=bearer
    ).json()

    # Then: onboarding settles ready — the re-edit path is not a dead end.
    assert driver.region_state(doc, "onboarding") == "ready"
