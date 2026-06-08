"""The signed-in person's identity can be read back; no credential is refused.

Gherkin:
  - "The signed-in person's identity can be read back from the session cookie"
  - "Asking who they are with no credential is refused"

Slice: C2. Decision: D4 (NEW GET /api/auth/me; cookie-or-header; 401 when neither).

RED until C2: GET /api/auth/me does not exist today, so it falls through to the
catch-all /api/* proxy. Carried by a cookie only (no Bearer) that catch-all 401s
(it requires a header) — so the identity read-back fails today and passes once the
endpoint lands and reads the cookie. The "no credential → 401" half is a GUARD:
it already 401s today (missing header) and must keep 401-ing after C2 (D4 says
401 when neither is present).
"""

from __future__ import annotations

import pytest
from driver import (
    COOKIE_AUTH_TOKEN,
    DEV_ORG_ID,
    DEV_USER_EMAIL,
    DEV_USER_ID,
    CookieSessionDriver,
)


@pytest.mark.real_io
@pytest.mark.needs_compose_stack
@pytest.mark.happy_path
@pytest.mark.c2_authproxy_me_logout
@pytest.mark.pending
def test_identity_read_back_from_cookie(
    signed_in,
    driver: CookieSessionDriver,
) -> None:
    # Given: a person has signed in and holds the auth_token cookie.
    cookie_token = driver.auth_cookie_value(signed_in)

    # When: they ask who they are, carried only by the cookie.
    me = driver.get_me(cookies={COOKIE_AUTH_TOKEN: cookie_token})

    # Then: their identity is returned (the SPA can no longer decode the JWT itself).
    assert me.status == 200, f"/api/auth/me via cookie was {me.status}, expected 200 (C2/D4)"
    body = me.json()
    assert body.get("userId") == DEV_USER_ID
    assert body.get("orgId") == DEV_ORG_ID
    assert body.get("email") == DEV_USER_EMAIL


@pytest.mark.real_io
@pytest.mark.needs_compose_stack
@pytest.mark.error_path
@pytest.mark.c2_authproxy_me_logout
def test_identity_request_without_credential_is_refused(
    requires_compose_stack: None,
    driver: CookieSessionDriver,
) -> None:
    # When: someone asks who they are carrying no credential at all.
    me = driver.get_me()

    # Then: the request is refused as unauthenticated (D4: 401 when neither present).
    assert me.status == 401, f"/api/auth/me with no credential was {me.status}, expected 401"
