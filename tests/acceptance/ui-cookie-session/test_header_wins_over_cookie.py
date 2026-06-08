"""A header credential takes precedence over the session cookie.

Gherkin: "A header credential takes precedence over the session cookie".

Slice: C1. Decision: D3 (priority HEADER > COOKIE).

Discriminator: present a VALID Bearer header alongside an INVALID auth_token
cookie. If the header is honoured first (D3), the request is allowed (200) and
the bad cookie is never consulted. If cookie-read were to override or run first,
the bad cookie would 401. This works in dev (where all real tokens resolve to
DEV_USER) precisely because the cookie is intentionally unverifiable.

REGRESSION GUARD (not pending): green now AND after C1. Today the cookie is
ignored entirely, so the valid header → 200. After C1 the header short-circuits
before the cookie is read, so still 200. The test exists so that adding
cookie-read in C1 must NOT break or override a present, valid header.
"""

from __future__ import annotations

import pytest
from driver import COOKIE_AUTH_TOKEN, CookieSessionDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.regression,
    pytest.mark.c1_authproxy_cookies,
]


def test_valid_header_wins_over_invalid_cookie(
    signed_in,
    driver: CookieSessionDriver,
) -> None:
    # A valid token (the legacy body token from sign-in) used in the header...
    valid_header_token = driver.body_token(signed_in)

    # ...alongside a deliberately unverifiable auth_token cookie.
    result = driver.authed_probe(
        bearer=valid_header_token,
        cookies={COOKIE_AUTH_TOKEN: "not-a-real-jwt.invalid.cookie"},
    )

    # The header credential is honoured first; the bad cookie is never consulted.
    assert result.status == 200, (
        f"valid-header + invalid-cookie request was {result.status}, expected 200 — "
        "the header credential must take precedence over the cookie (D3); adding "
        "cookie-read must not override a present valid header"
    )
