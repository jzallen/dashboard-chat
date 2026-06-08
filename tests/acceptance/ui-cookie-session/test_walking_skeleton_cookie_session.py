"""Walking skeleton — the single end-to-end cookie-session journey.

Gherkin (features/ui-cookie-session.feature):
  Scenario: A person signs in, works on their cookie session, sees their
            identity, and signs out

Driving port: the user-facing ingress (reverse-proxy). Driving the WHOLE ingress
(not the auth-proxy directly) is deliberate — it proves the ``Set-Cookie`` from
sign-in survives nginx and that the cookie round-trips on a later request, which
is the actual browser path.

RED until: C1 (Set-Cookie both cookies on callback + cookie-read on /api/*) AND
C2 (GET /api/auth/me + logout cookie-clear) land. Under current code the callback
sets no cookie, a cookie-only /api/* request 401s (the catch-all requires a Bearer
header), and /api/auth/me does not exist — so this fails at the first assertion.

Scope note: this API-level skeleton proves the auth-proxy contract end to end and
goes GREEN at C1+C2. The ui/ slices (C3 transport, C4 gate) are NOT exercised here
(this Python client is not the React app); they are proven by ui/ vitest authored
in DELIVER plus a manual/Playwright browser pass:
  - ui/app/catalog/dataSources/backendClient.test.ts  (C3 — credentials:'include', no Bearer)
  - ui/app/components/useCatalog.test.tsx              (C3 — getToken -> null)
  - ui/app/auth/tokenStorage.test.ts                  (C4 — hasSession() flag-cookie gate)
  - ui/app/routes/login.test.tsx + app-shell gate     (C4 — gate uses hasSession())
  - ui/app/auth/bootstrap.test.ts                     (C4 — callback no longer reads body token)
The browser-e2e journey goes GREEN at C1+C2+C3+C4. See distill/wave-decisions.md DWD-4
and distill/roadmap.json (C3/C4 driving_tests).
"""

from __future__ import annotations

import pytest
from driver import (
    COOKIE_AUTH_TOKEN,
    COOKIE_SESSION_FLAG,
    DEV_USER_EMAIL,
    DEV_USER_ID,
    CookieSessionDriver,
)

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.needs_compose_stack,
    pytest.mark.walking_skeleton,
    pytest.mark.happy_path,
    pytest.mark.c1_authproxy_cookies,
    pytest.mark.c2_authproxy_me_logout,
]


def test_sign_in_cookie_session_identity_and_sign_out(
    requires_compose_stack: None, driver: CookieSessionDriver
) -> None:
    ingress = driver.reverse_proxy_url

    # When: a person signs in (through the real ingress).
    signin = driver.sign_in(base=ingress)
    assert signin.status == 200

    # Then: their session credential is established as a protected cookie that
    # survived the ingress hop...
    auth_cookie = signin.cookie(COOKIE_AUTH_TOKEN)
    assert auth_cookie is not None, (
        "no auth_token Set-Cookie after sign-in through the ingress "
        f"(Set-Cookie names: {signin.cookie_names()})"
    )
    assert auth_cookie.http_only, "the credential cookie must be HttpOnly"

    # And: a browser-readable sign-in flag is set...
    flag = signin.cookie(COOKIE_SESSION_FLAG)
    assert flag is not None, "no session flag cookie set"
    assert not flag.http_only, "the sign-in flag must be readable by JS (not HttpOnly)"

    # And: the response still carries the legacy token for the existing web client (D2).
    legacy = signin.json().get("access_token")
    assert isinstance(legacy, str) and legacy, "callback body must keep access_token (D2)"

    # When: they make an authenticated request carried only by their session cookie.
    cookie_token = auth_cookie.value
    probe = driver.authed_probe(base=ingress, cookies={COOKIE_AUTH_TOKEN: cookie_token})

    # Then: the request is allowed (cookie-read works — header-less browser request).
    assert probe.status == 200, (
        f"cookie-only authenticated request was {probe.status}, expected 200 "
        "(C1 cookie-read on /api/* unbuilt)"
    )

    # And: their identity can be read back from the session.
    me = driver.get_me(base=ingress, cookies={COOKIE_AUTH_TOKEN: cookie_token})
    assert me.status == 200, f"/api/auth/me via cookie was {me.status}, expected 200 (C2 unbuilt)"
    body = me.json()
    assert body.get("userId") == DEV_USER_ID
    assert body.get("email") == DEV_USER_EMAIL

    # When: they sign out, carried by their session cookie.
    out = driver.sign_out(base=ingress, cookies={COOKIE_AUTH_TOKEN: cookie_token})
    assert out.status in (200, 204), f"sign-out was {out.status}"

    # Then: their session credential and sign-in flag are revoked (cleared cookies).
    cleared_auth = out.cookie(COOKIE_AUTH_TOKEN)
    cleared_flag = out.cookie(COOKIE_SESSION_FLAG)
    assert cleared_auth is not None and cleared_auth.is_cleared, (
        "sign-out must clear the auth_token cookie (Max-Age=0) — C2 unbuilt"
    )
    assert cleared_flag is not None and cleared_flag.is_cleared, (
        "sign-out must clear the session flag cookie (Max-Age=0) — C2 unbuilt"
    )

    # And: a request carrying no credential is refused (the signed-out state, once
    # the browser has dropped the cleared cookies).
    refused = driver.authed_probe(base=ingress)
    assert refused.status == 401
