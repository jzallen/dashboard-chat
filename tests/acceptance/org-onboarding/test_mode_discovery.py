"""The sign-in surface learns the sign-in mode before showing any affordance (§d).

Gherkin (features/org-onboarding.feature):
  Scenario: The sign-in surface learns the sign-in mode before showing any affordance

ADR-050 §d: mode discovery is a side-effect-free ``GET /api/auth/config →
200 {"mode": "dev" | "workos"}`` served locally by auth-proxy (the sole AUTH_MODE
reader), no credential required, ``Cache-Control: public, max-age=300``. The login
surface renders NO sign-in affordance until the mode is known, then shows the dev
button ONLY when the server says ``dev`` (no flash of a dev affordance in workos
mode). The endpoint must be side-effect-free (unlike ``/api/auth/login``, which
mints a one-shot CSRF state per call).

This port-to-port test asserts the endpoint CONTRACT against the dev stack:
``mode == "dev"``, cacheable, no credential. The "renders the dev button only in
dev / no dev affordance in workos" half is a ui/ + browser assertion (DELIVER); the
workos-mode response is covered by auth-proxy unit tests (the dev acceptance stack
cannot run in workos mode). See distill/wave-decisions.md (DWD-6).

RED on the pre-feature stack because: ``GET /api/auth/config`` does not exist yet —
the request does not return ``200 {"mode": "dev"}``. RED for the right reason: the
mode-discovery endpoint is unimplemented.
"""

from __future__ import annotations

import pytest
from driver import OnboardingDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.happy_path,
    pytest.mark.cdo_s4,
]


def test_auth_config_reports_dev_mode_without_side_effects(
    driver: OnboardingDriver, requires_compose_stack: None
) -> None:
    # When: the sign-in surface asks which sign-in mode is in effect (no credential).
    first = driver.get_auth_config()

    # Then: it learns the mode (the dev stack reports dev).
    assert first.status == 200, f"expected 200 from GET /api/auth/config, got {first.status}: {first.body!r}"
    assert isinstance(first.body, dict), f"expected a JSON object, got {first.body!r}"
    assert first.body.get("mode") == "dev", (
        f"the dev stack must report mode=dev (permitting the dev sign-in affordance), "
        f"got {first.body!r}"
    )

    # And: in development the development sign-in affordance is permitted (the
    # server says dev — the dev button may render).
    # (The ui/ rendering rule is a DELIVER/browser assertion.)

    # And: the call is cacheable (config read, not a sign-in initiation).
    cache_control = {k.lower(): v for k, v in first.headers.items()}.get("cache-control", "")
    assert "max-age" in cache_control, (
        f"mode discovery must be cacheable (Cache-Control: public, max-age=300), "
        f"got Cache-Control={cache_control!r}"
    )

    # And: it is side-effect-free — a second identical call returns the same answer
    # (unlike /api/auth/login, which mints a one-shot CSRF state per call).
    second = driver.get_auth_config()
    assert second.status == 200, second.body
    assert second.body.get("mode") == "dev"
