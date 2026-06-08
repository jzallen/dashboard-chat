"""An authenticated request is allowed when carried only by the session cookie.

Gherkin: "An authenticated request is allowed when carried only by the session
cookie".

Slice: C1. Decision: D3 (cookie fallback when no Authorization header).

RED until C1: the catch-all /api/* branch (auth-proxy/app.ts:692-732) requires
`Authorization: Bearer` UNCONDITIONALLY (no dev bypass, unlike /ui-state/* and
/worker/*). So a cookie-only request 401s today; it becomes 200 only once the
header>cookie fallback (D3) lands. This is the cleanest genuinely-RED probe in
the suite.
"""

from __future__ import annotations

import pytest
from driver import COOKIE_AUTH_TOKEN, CookieSessionDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.happy_path,
    pytest.mark.c1_authproxy_cookies,
    pytest.mark.pending,
]


def test_cookie_only_authenticated_request_is_allowed(
    signed_in,
    driver: CookieSessionDriver,
) -> None:
    # Given: a person has signed in and holds the minted auth_token cookie.
    cookie_token = driver.auth_cookie_value(signed_in)

    # When: they make an authenticated request carried ONLY by the cookie — no
    # Authorization header at all (the EventSource / header-less browser case).
    result = driver.authed_probe(cookies={COOKIE_AUTH_TOKEN: cookie_token})

    # Then: the request is allowed (the cookie was read and verified).
    assert result.status == 200, (
        f"cookie-only authenticated request was {result.status}, expected 200 — "
        "the catch-all /api/* must fall back to the auth_token cookie when no "
        "Authorization header is present (D3, C1)"
    )
