"""HTTP driver for the org-onboarding acceptance suite.

All operations go through the real ingress (reverse-proxy) so the auth-proxy →
ui-state → backend path is exercised end to end — the path TBU (Tested But
Unwired) defects hide in. The only direct auth-proxy call is the public
``/api/auth/callback`` token mint.

Wire contract (ADR-046):
  GET  /ui-state/state           → one ChatAppStateDocument (no cold-start)
  POST /ui-state/state/events    → send one event; returns the new document
  GET  /api/orgs/me              → 404 when the principal has no org
  POST /api/orgs                 → create an org
  GET  /api/projects             → the principal's projects
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

# The dev principal minted by AUTH_MODE=dev (backend/app/auth/__init__.py DEV_USER).
DEV_USER_ID = "dev-user-001"
DEV_USER_EMAIL = "dev@localhost"


@dataclass
class HTTPResult:
    """A captured HTTP response."""

    status: int
    body: Any
    headers: dict[str, str] = field(default_factory=dict)

    def json(self) -> Any:
        return self.body


@dataclass
class OnboardingDriver:
    reverse_proxy_url: str
    auth_proxy_url: str
    _cached_dev_jwt: str | None = field(default=None, repr=False)

    # ── transport ────────────────────────────────────────────────────────────
    def _request(
        self,
        method: str,
        path: str,
        *,
        base: str | None = None,
        bearer: str | None = None,
        json_body: dict[str, Any] | None = None,
        timeout: float = 10.0,
    ) -> HTTPResult:
        url = f"{(base or self.reverse_proxy_url).rstrip('/')}{path}"
        headers: dict[str, str] = {}
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            resp = client.request(method, url, json=json_body, headers=headers)
        try:
            parsed: Any = resp.json()
        except ValueError:
            parsed = resp.text
        return HTTPResult(status=resp.status_code, body=parsed, headers=dict(resp.headers))

    def get(self, path: str, *, bearer: str | None = None, base: str | None = None) -> HTTPResult:
        return self._request("GET", path, base=base, bearer=bearer)

    def post(
        self,
        path: str,
        *,
        bearer: str | None = None,
        base: str | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> HTTPResult:
        return self._request("POST", path, base=base, bearer=bearer, json_body=json_body)

    # ── auth ─────────────────────────────────────────────────────────────────
    def mint_dev_jwt(self) -> str:
        """Mint a dev JWT via the public ``/api/auth/callback`` (AUTH_MODE=dev).

        The path is public on the auth-proxy; in dev the backend mints a JWT for
        ``DEV_USER`` regardless of the code value. Cached per driver instance.
        """
        if self._cached_dev_jwt is not None:
            return self._cached_dev_jwt
        url = f"{self.auth_proxy_url.rstrip('/')}/api/auth/callback"
        try:
            with httpx.Client(timeout=10.0, follow_redirects=False) as client:
                resp = client.post(url, json={"code": "dev-auth-code"})
        except httpx.RequestError as e:  # pragma: no cover - environment guard
            raise RuntimeError(
                f"mint_dev_jwt: cannot reach auth-proxy at {url} ({type(e).__name__}: {e}). "
                "Bring the compose stack up with `docker compose up -d`."
            ) from e
        if resp.status_code != 200:
            raise RuntimeError(
                f"mint_dev_jwt: auth-proxy returned {resp.status_code} from POST {url}: "
                f"{resp.text[:300]}. Verify AUTH_MODE=dev and that /api/* is proxied."
            )
        payload = resp.json()
        token = payload.get("access_token") or payload.get("token")
        if not isinstance(token, str) or not token:
            raise RuntimeError(
                f"mint_dev_jwt: 200 but no access_token/token field: {resp.text[:300]}"
            )
        self._cached_dev_jwt = token
        return token

    # ── ui-state surface ───────────────────────────────────────────────────────
    def session_begin(self, *, bearer: str, force_restart: bool = False) -> HTTPResult:
        return self.post_event(
            {"type": "session_begin", "payload": {"force_restart": force_restart}},
            bearer=bearer,
        )

    def post_event(self, event: dict[str, Any], *, bearer: str) -> HTTPResult:
        return self.post("/ui-state/state/events", bearer=bearer, json_body=event)

    def get_state(self, *, bearer: str) -> HTTPResult:
        return self.get("/ui-state/state", bearer=bearer)

    @staticmethod
    def region_state(doc: dict[str, Any], region: str) -> str | None:
        return ((doc or {}).get("regions", {}).get(region, {}) or {}).get("state")

    @staticmethod
    def region_context(doc: dict[str, Any], region: str) -> dict[str, Any]:
        return ((doc or {}).get("regions", {}).get(region, {}) or {}).get("context", {}) or {}

    @staticmethod
    def phase(doc: dict[str, Any]) -> str | None:
        return (doc or {}).get("phase")

    # ── backend app-DB side effects ─────────────────────────────────────────────
    def get_my_org(self, *, bearer: str) -> HTTPResult:
        return self.get("/api/orgs/me", bearer=bearer)

    def create_org(self, name: str, *, bearer: str) -> HTTPResult:
        return self.post("/api/orgs", bearer=bearer, json_body={"name": name})

    def list_projects(self, *, bearer: str) -> HTTPResult:
        return self.get("/api/projects", bearer=bearer)
