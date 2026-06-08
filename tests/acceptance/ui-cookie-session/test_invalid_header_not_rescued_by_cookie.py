"""An invalid header credential is not rescued by a valid session cookie.

Gherkin: "An invalid header credential is not rescued by a valid session cookie".

Slice: C1. Decision: D3 — priority is HEADER > COOKIE, and a *present* header is
terminal: "if Authorization: Bearer is present, use it; ELSE fall back to the
cookie". So a present-but-invalid header must 401 — the cookie fallback only
applies when NO header is present, not when a header is present and fails.

GUARD (green now AND after C1, *if* C1 is implemented correctly): today the
catch-all reads the header only, so an invalid header → 401 (cookie ignored).
After C1, a correct readCredential honours the present header and its failure is
final → still 401. This test exists precisely to catch the plausible
mis-implementation "try header; on failure fall back to cookie", which would turn
this 200 and silently weaken the priority rule into a fallback chain.
"""

from __future__ import annotations

import pytest
from driver import COOKIE_AUTH_TOKEN, CookieSessionDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.error_path,
    pytest.mark.guard,
    pytest.mark.c1_authproxy_cookies,
]


def test_invalid_header_is_not_rescued_by_valid_cookie(
    signed_in,
    driver: CookieSessionDriver,
) -> None:
    # Given: a person has signed in and holds a VALID auth_token cookie.
    valid_cookie_token = driver.auth_cookie_value(signed_in)

    # When: they make a request with an INVALID header alongside the valid cookie.
    result = driver.authed_probe(
        bearer="garbage.invalid.header-jwt",
        cookies={COOKIE_AUTH_TOKEN: valid_cookie_token},
    )

    # Then: the request is refused — the present header is honoured first and its
    # failure is final; the cookie fallback must NOT rescue an invalid header (D3).
    assert result.status == 401, (
        f"invalid-header + valid-cookie request was {result.status}, expected 401 — "
        "a present Authorization header is terminal; cookie-read must NOT be a "
        "fallback chain that rescues a failed header (D3)"
    )
