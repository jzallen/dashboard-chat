"""Signing in sets the two cookies and keeps the legacy body token.

Gherkin: "Signing in establishes a protected cookie and keeps the legacy token
in the body".

Slice: C1. Decisions: D1 (cookie attributes), D2 (keep body token), D6 (SameSite=Lax).

RED until C1: today POST /api/auth/callback returns the JSON body only and sets
NO Set-Cookie (auth-proxy/app.ts:126-151), so every cookie assertion fails while
the body-token assertion already passes — exactly the migration delta.
"""

from __future__ import annotations

import pytest
from driver import COOKIE_AUTH_TOKEN, COOKIE_SESSION_FLAG, CookieSessionDriver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.happy_path,
    pytest.mark.c1_authproxy_cookies,
    pytest.mark.pending,
]


def test_callback_sets_protected_cookie_flag_cookie_and_keeps_body_token(
    signed_in,
    driver: CookieSessionDriver,
) -> None:
    result = signed_in
    assert result.status == 200

    # D2: the legacy token is STILL in the body (frontend/ back-compat).
    legacy = result.json().get("access_token")
    assert isinstance(legacy, str) and legacy, "callback must keep access_token in the body (D2)"

    # D1: the credential cookie is HttpOnly (scripts cannot read it).
    auth = result.cookie(COOKIE_AUTH_TOKEN)
    assert auth is not None, f"no auth_token Set-Cookie (Set-Cookie names: {result.cookie_names()})"
    assert auth.value, "auth_token cookie must carry the JWT"
    assert auth.http_only, "auth_token must be HttpOnly"

    # D1/D6: first-party, whole-site, expires with the token; dev = no Secure.
    assert (auth.same_site or "").lower() == "lax", "auth_token SameSite must be Lax (D6)"
    assert auth.path == "/", "auth_token Path must be /"
    assert auth.max_age is not None, "auth_token must set Max-Age (= token expiry)"
    # Dev target runs over plain HTTP → Secure omitted so the cookie round-trips.
    assert not auth.secure, "auth_token must NOT be Secure in dev (AUTH_MODE=dev, HTTP)"

    # D1: the Max-Age tracks the token's expires_in returned in the same response.
    expires_in = result.json().get("expires_in")
    if isinstance(expires_in, int):
        assert auth.max_age == str(expires_in), "auth_token Max-Age must equal expires_in"

    # D1: a separate, JS-readable sign-in flag that carries no secret.
    flag = result.cookie(COOKIE_SESSION_FLAG)
    assert flag is not None, "no session flag cookie set"
    assert not flag.http_only, "the session flag must be readable by JS (NOT HttpOnly)"
    assert (flag.same_site or "").lower() == "lax", "session flag SameSite must be Lax"
    assert flag.path == "/", "session flag Path must be /"
    assert flag.value not in ("", '""'), "session flag must carry a truthy marker (e.g. '1')"
    assert flag.value != legacy, "the session flag must NOT carry the token (it is not a secret)"
