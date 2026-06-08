"""HTTP driver for the ui-cookie-session acceptance suite.

The feature is a credential **transport** migration (localStorage Bearer →
httpOnly cookie session), so the driver's job is to send requests carrying the
credential by *header*, by *cookie*, by *both*, or by *neither* — and to read
back the raw ``Set-Cookie`` headers so cookie attributes (HttpOnly, SameSite,
Path, Max-Age, Secure) can be asserted.

Two seams:

* The **discrete scenarios** target the auth-proxy directly (``auth_proxy_url``)
  — the honest seam where cookie behavior is implemented.
* The **walking skeleton** drives the user-facing ingress (``reverse_proxy_url``)
  to prove ``Set-Cookie`` survives nginx and the cookie round-trips end to end.

Wire contract under test (see ``design/delta-and-decisions.md`` §4):
  POST /api/auth/callback   → Set-Cookie auth_token (HttpOnly) + session=1 (JS);
                              body still has access_token (D2)
  GET  /api/<authenticated> → authorizes by Authorization header OR auth_token
                              cookie, header-first (D3)
  GET  /api/auth/me         → {userId, orgId, email} (cookie-or-header); 401 if neither (D4)
  POST /api/auth/logout     → clears both cookies (Max-Age=0) (D5)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

# The dev principal minted by AUTH_MODE=dev (backend/app/auth DEV_USER).
DEV_USER_ID = "dev-user-001"
DEV_ORG_ID = "dev-org-001"
DEV_USER_EMAIL = "dev@localhost"

# An authenticated backend read that exists today and is org-scoped — a stable
# probe for "does this credential authorize?". Routed through the catch-all
# /api/* proxy, which (unlike /ui-state/* and /worker/*) has no dev bypass.
AUTHED_PROBE_PATH = "/api/projects"

COOKIE_AUTH_TOKEN = "auth_token"
COOKIE_SESSION_FLAG = "session"


@dataclass
class ParsedCookie:
    """A single Set-Cookie header decomposed into value + attributes.

    ``attrs`` keys are lowercased. Flag attributes (HttpOnly, Secure) map to
    ``True``; valued attributes (Path, Max-Age, SameSite, Domain) map to their
    string value.
    """

    name: str
    value: str
    attrs: dict[str, Any] = field(default_factory=dict)

    @property
    def http_only(self) -> bool:
        return bool(self.attrs.get("httponly"))

    @property
    def secure(self) -> bool:
        return bool(self.attrs.get("secure"))

    @property
    def same_site(self) -> str | None:
        return self.attrs.get("samesite")

    @property
    def path(self) -> str | None:
        return self.attrs.get("path")

    @property
    def max_age(self) -> str | None:
        return self.attrs.get("max-age")

    @property
    def is_cleared(self) -> bool:
        """A deletion cookie: empty value AND Max-Age=0 (or an epoch Expires)."""
        if self.value not in ("", '""'):
            return False
        if self.attrs.get("max-age") == "0":
            return True
        expires = str(self.attrs.get("expires", "")).lower()
        return "1970" in expires or "01 jan 1970" in expires


def parse_set_cookie(raw: str) -> ParsedCookie:
    """Parse one ``Set-Cookie`` header value into a :class:`ParsedCookie`."""
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    name, _, value = parts[0].partition("=")
    attrs: dict[str, Any] = {}
    for segment in parts[1:]:
        key, sep, val = segment.partition("=")
        attrs[key.strip().lower()] = val.strip() if sep else True
    return ParsedCookie(name=name.strip(), value=value, attrs=attrs)


@dataclass
class HTTPResult:
    """A captured HTTP response, including the raw Set-Cookie header list."""

    status: int
    body: Any
    headers: dict[str, str] = field(default_factory=dict)
    set_cookies: list[str] = field(default_factory=list)

    def json(self) -> Any:
        return self.body

    def cookie(self, name: str) -> ParsedCookie | None:
        """The first Set-Cookie for ``name``, parsed; ``None`` if not present."""
        for raw in self.set_cookies:
            parsed = parse_set_cookie(raw)
            if parsed.name == name:
                return parsed
        return None

    def cookie_names(self) -> list[str]:
        return [parse_set_cookie(raw).name for raw in self.set_cookies]


@dataclass
class CookieSessionDriver:
    reverse_proxy_url: str
    auth_proxy_url: str

    # ── transport ────────────────────────────────────────────────────────────
    def request(
        self,
        method: str,
        path: str,
        *,
        base: str | None = None,
        bearer: str | None = None,
        cookies: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
        timeout: float = 10.0,
    ) -> HTTPResult:
        """One request. ``bearer`` sets the Authorization header; ``cookies``
        sets the Cookie header. Either, both, or neither — the point of the
        suite is to exercise each combination against the credential-priority
        rule (D3)."""
        url = f"{(base or self.auth_proxy_url).rstrip('/')}{path}"
        headers: dict[str, str] = {}
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            resp = client.request(
                method, url, json=json_body, headers=headers, cookies=cookies
            )
        try:
            parsed: Any = resp.json()
        except ValueError:
            parsed = resp.text
        return HTTPResult(
            status=resp.status_code,
            body=parsed,
            headers=dict(resp.headers),
            set_cookies=list(resp.headers.get_list("set-cookie")),
        )

    def get(
        self,
        path: str,
        *,
        base: str | None = None,
        bearer: str | None = None,
        cookies: dict[str, str] | None = None,
    ) -> HTTPResult:
        return self.request("GET", path, base=base, bearer=bearer, cookies=cookies)

    def post(
        self,
        path: str,
        *,
        base: str | None = None,
        bearer: str | None = None,
        cookies: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> HTTPResult:
        return self.request(
            "POST", path, base=base, bearer=bearer, cookies=cookies, json_body=json_body
        )

    # ── auth surface ───────────────────────────────────────────────────────────
    def sign_in(self, *, base: str | None = None, code: str = "dev-auth-code") -> HTTPResult:
        """POST the public ``/api/auth/callback`` (AUTH_MODE=dev mints DEV_USER's
        JWT regardless of code). Returns the full result so the test can read
        BOTH the Set-Cookie headers and the (still-present, D2) body token."""
        return self.post(
            "/api/auth/callback", base=base or self.auth_proxy_url, json_body={"code": code}
        )

    def body_token(self, result: HTTPResult) -> str:
        body = result.json()
        token = body.get("access_token") if isinstance(body, dict) else None
        if not isinstance(token, str) or not token:
            raise AssertionError(
                f"callback 200 but no access_token in body (D2 requires it kept): "
                f"{str(body)[:200]}"
            )
        return token

    def auth_cookie_value(self, result: HTTPResult) -> str:
        """The auth_token cookie value minted by a sign-in, or assertion error."""
        cookie = result.cookie(COOKIE_AUTH_TOKEN)
        if cookie is None:
            raise AssertionError(
                "sign-in did not Set-Cookie auth_token (C1 unbuilt). "
                f"Set-Cookie names seen: {result.cookie_names()}"
            )
        return cookie.value

    def get_me(
        self, *, base: str | None = None, bearer: str | None = None, cookies: dict[str, str] | None = None
    ) -> HTTPResult:
        return self.get("/api/auth/me", base=base, bearer=bearer, cookies=cookies)

    def sign_out(
        self, *, base: str | None = None, bearer: str | None = None, cookies: dict[str, str] | None = None
    ) -> HTTPResult:
        return self.post("/api/auth/logout", base=base, bearer=bearer, cookies=cookies)

    def authed_probe(
        self,
        *,
        base: str | None = None,
        bearer: str | None = None,
        cookies: dict[str, str] | None = None,
    ) -> HTTPResult:
        """Hit an authenticated backend read with whatever credential is given."""
        return self.get(AUTHED_PROBE_PATH, base=base, bearer=bearer, cookies=cookies)
