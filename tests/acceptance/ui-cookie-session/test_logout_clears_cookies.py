"""Signing out revokes both the session credential and the sign-in flag.

Gherkin: "Signing out revokes both the session credential and the sign-in flag".

Slice: C2. Decision: D5 (logout reads cookie-or-header, deletes server session,
clears BOTH cookies with Max-Age=0).

RED until C2: today POST /api/auth/logout reads the Bearer header only and returns
204 with NO Set-Cookie (auth-proxy/app.ts:196-209). A cookie-carried logout sets
no clearing cookies, so the teardown assertions fail until C2.

Scope note (see delta-and-decisions.md §6): the honest, server-observable signed-
out signal is the Set-Cookie teardown asserted here, NOT a post-logout 401 from a
replayed cookie — verifyToken() is stateless, so a still-valid JWT would verify
until expiry. The "signed-out" state is the browser dropping the cleared cookies.
"""

from __future__ import annotations

import pytest
from driver import COOKIE_AUTH_TOKEN, COOKIE_SESSION_FLAG, CookieSessionDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.error_path,
    pytest.mark.c2_authproxy_me_logout,
    pytest.mark.pending,
]


def test_logout_clears_both_cookies(
    signed_in,
    driver: CookieSessionDriver,
) -> None:
    # Given: a person has signed in and holds the auth_token cookie.
    cookie_token = driver.auth_cookie_value(signed_in)

    # When: they sign out, carried by their session cookie (no Bearer header).
    out = driver.sign_out(cookies={COOKIE_AUTH_TOKEN: cookie_token})
    assert out.status in (200, 204), f"sign-out was {out.status}, expected 2xx"

    # Then: the session credential cookie is revoked (cleared: empty + Max-Age=0).
    cleared_auth = out.cookie(COOKIE_AUTH_TOKEN)
    assert cleared_auth is not None, (
        "sign-out set no Set-Cookie for auth_token — it must clear the credential cookie (D5)"
    )
    assert cleared_auth.is_cleared, (
        f"auth_token cookie not cleared on logout (value={cleared_auth.value!r}, "
        f"max-age={cleared_auth.max_age!r}); expected empty value + Max-Age=0"
    )
    assert cleared_auth.path == "/", "the clearing cookie must match Path=/ to actually delete it"

    # And: the sign-in flag cookie is revoked too.
    cleared_flag = out.cookie(COOKIE_SESSION_FLAG)
    assert cleared_flag is not None, "sign-out must also clear the session flag cookie (D5)"
    assert cleared_flag.is_cleared, (
        f"session flag cookie not cleared on logout (value={cleared_flag.value!r}, "
        f"max-age={cleared_flag.max_age!r})"
    )
