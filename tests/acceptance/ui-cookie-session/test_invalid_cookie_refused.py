"""A request bearing an invalid session cookie and no header is refused.

Gherkin: "A request bearing an invalid session cookie and no header is refused".

Slice: C1. Decision: D3 — the cookie fallback must VERIFY the token, not merely
accept any cookie's presence. This is the security-relevant complement to the
cookie-happy-path: it locks that cookie-read cannot become an auth bypass.

GUARD (green now AND after C1): today a cookie-only /api/* request 401s because no
Bearer header is present; after C1 cookie-read lands but the cookie is
unverifiable, so it still 401s — now for the right reason (failed verification).
Either way the contract "unverifiable credential → refused" holds.
"""

from __future__ import annotations

import pytest
from driver import COOKIE_AUTH_TOKEN, CookieSessionDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.error_path,
    pytest.mark.c1_authproxy_cookies,
]


def test_unverifiable_cookie_is_refused(
    requires_compose_stack: None,
    driver: CookieSessionDriver,
) -> None:
    # When: an authenticated request carries only an unverifiable session cookie.
    result = driver.authed_probe(
        cookies={COOKIE_AUTH_TOKEN: "garbage.not-a-jwt.value"},
    )

    # Then: the request is refused (cookie-read must verify, never trust presence).
    assert result.status == 401, (
        f"request with an unverifiable auth_token cookie was {result.status}, "
        "expected 401 — cookie-read must verify the token, not accept any cookie (D3)"
    )
