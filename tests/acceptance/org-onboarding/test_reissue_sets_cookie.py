"""Creating an organisation refreshes the person's session via Set-Cookie (§a).

Gherkin (features/org-onboarding.feature):
  Scenario: Creating an organisation refreshes the person's session

ADR-050 §a (un-parks ui-cookie-session D8): on ``POST /api/orgs → 201`` with a
preservable user identity, the reissue seam emits the refreshed org-scoped token as
``Set-Cookie: auth_token=<jwt>; HttpOnly; SameSite=Lax; Path=/; Max-Age=<exp>``
(+``Secure`` iff AUTH_MODE != dev) ALONGSIDE the retained ``X-New-Access-Token``
header — two distinct, never-collapsed Set-Cookie headers (UC-6). The hook is
mode-agnostic (path/method/status-guarded only), so it fires in dev too; the client
does nothing (the cookie is httpOnly) and the next request — Phase D's project POST
— rides the new claim automatically.

Dev-path note: in dev the refreshed claim is harmless redundancy — ``DEV_NO_ORG``
resolves the org from the DB by ``created_by``, so Phase D succeeds with the SAME
bearer regardless of the reissue (asserted here as continuity). The
workos-mode claim-correctness (the new token actually carries the new org_id) is
compose-gated and covered by auth-proxy unit tests (see distill/wave-decisions.md
DWD-6); the dev acceptance asserts the Set-Cookie EMISSION contract.

RED on the pre-feature stack because: the reissue seam emits ``X-New-Access-Token``
only — the ``Set-Cookie: auth_token`` emission (D8) is unimplemented, so no
``auth_token`` Set-Cookie is present on the org-create 201. RED for the right reason.
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
    pytest.mark.cdo_s4,
]


def _cookie_named(set_cookies: list[str], name: str) -> str | None:
    prefix = f"{name}="
    for raw in set_cookies:
        if raw.strip().lower().startswith(prefix.lower()):
            return raw
    return None


def test_org_create_201_reissues_auth_token_cookie(
    driver: OnboardingDriver, fresh_dev_principal: str
) -> None:
    bearer = fresh_dev_principal
    org_name = f"Reissue Org {uuid.uuid4().hex[:8]}"

    # Given: an empty-org principal reaching organisation setup.
    driver.session_begin(bearer=bearer, force_restart=True)
    driver.probe_and_report_org(bearer=bearer)

    # When: they create a valid organisation.
    created = driver.create_org(org_name, bearer=bearer)
    assert created.status == 201, created.body

    # Then: their session is refreshed — the response carries a Set-Cookie auth_token
    # (the D8 reissue cookie), HttpOnly, never collapsed with the session flag.
    auth_cookie = _cookie_named(created.set_cookies, "auth_token")
    assert auth_cookie is not None, (
        f"expected a Set-Cookie: auth_token on the org-create 201 (ADR-050 §a / D8), "
        f"got Set-Cookie headers: {created.set_cookies!r}"
    )
    assert "httponly" in auth_cookie.lower(), (
        f"the reissued auth_token cookie must be HttpOnly, got {auth_cookie!r}"
    )

    # And: later steps carry the new organisation — Phase D succeeds with the SAME
    # bearer (dev: DEV_NO_ORG makes the reissue harmless redundancy; this asserts
    # the dev path needs no client token handling).
    proj = driver.create_project("My First Project", bearer=bearer)
    assert proj.status == 201, proj.body
