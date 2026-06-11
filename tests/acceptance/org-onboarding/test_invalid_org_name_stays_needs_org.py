"""An invalid organisation name keeps the person on organisation setup (re-edit).

Gherkin (features/org-onboarding.feature):
  Scenario: An invalid organisation name keeps the person on organisation setup

REWRITTEN for client-driven-onboarding. The old scenario asserted the machine-side
``isOrgNameValid`` guard — which RETIRES (ADR-049 §3.3). Validation moves to the
SSOT: the backend ``OrgCreate`` schema gains the name validation (strip + min
length, ADR-050 §c). The new flow:

  client POSTs an invalid name → backend ``422`` → client maps the status to
  ``org_create_failed {cause: org_name_invalid, org_name}`` (re-edit class) →
  reports it → onboarding REMAINS in ``needs_org`` with ``org_validation_error``
  set (the inline form signal) → the person re-edits and succeeds (NO dead end).

Display rule (ratification amendment 2): ``org_name_invalid`` is a machine-readable
wire value only. The re-edit signal surfaced to the document is
``org_validation_error`` (which the UI renders as friendly inline helper text); the
raw cause tag is never rendered. The "no raw tag in the rendered DOM" half is a
browser/DELIVER assertion — this port-to-port test asserts the document contract:
the region stays ``needs_org`` and ``org_validation_error`` is set.

RED on the pre-feature stack because: (1) ``OrgCreate.name`` is an unconstrained
str today, so a blank name is accepted (``201``), not ``422`` — the backend
validation is unimplemented; (2) ``org_create_failed`` is not a wire member yet
(closed onboarding ACL → HTTP 400). RED for the right reason.
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
    pytest.mark.cdo_s2,
]


def test_invalid_name_rejected_by_backend_stays_needs_org_then_recovers(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal

    # Given: they have begun their session and reached organisation setup.
    driver.session_begin(bearer=bearer, force_restart=True)
    doc = driver.probe_and_report_org(bearer=bearer).json()
    assert driver.region_state(doc, "onboarding") == "needs_org"

    # When: they attempt an organisation name the app rejects as invalid (blank).
    attempted = driver.create_org("   ", bearer=bearer)

    # Then: the backend (the SSOT, where the retired guard relocated) rejects it.
    assert attempted.status == 422, (
        f"expected the backend OrgCreate schema to reject a blank name with 422, "
        f"got {attempted.status}: {attempted.body!r}"
    )

    # And: the client maps the status to the re-edit cause and reports it.
    reported = driver.report(
        "org_create_failed",
        {"cause": "org_name_invalid", "org_name": "   "},
        bearer=bearer,
    )
    assert reported.status == 200, reported.body
    doc = reported.json()

    # Then: they are shown a friendly inline problem with the name (the document
    # carries the re-edit signal), and they remain on organisation setup.
    assert driver.region_state(doc, "onboarding") == "needs_org"
    err = driver.region_context(doc, "onboarding").get("org_validation_error")
    assert err is not None, "expected an inline org_validation_error to be surfaced"

    # And: no organisation was created for this principal.
    assert driver.get_my_org(bearer=bearer).status == 404

    # And: they can try a different, valid name and succeed — no dead end.
    org_name = f"Recovered Org {uuid.uuid4().hex[:8]}"
    created = driver.create_org(org_name, bearer=bearer)
    assert created.status == 201, created.body
    doc = driver.report(
        "org_created", {"org": jsonapi_single(created.json())}, bearer=bearer
    ).json()
    assert driver.region_state(doc, "onboarding") == "ready"
