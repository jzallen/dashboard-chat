"""HTTP driver for the org-onboarding / client-driven-onboarding acceptance suite.

All operations go through the real ingress (reverse-proxy) so the auth-proxy →
ui-state → backend path is exercised end to end — the path TBU (Tested But
Unwired) defects hide in. The only direct auth-proxy call is the public
``/api/auth/callback`` token mint.

Under client-driven-onboarding (ADR-048/049/050) the *client* drives the flow and
owns ALL writes: it probes the SSOTs, POSTs the writes (`/api/orgs`,
`/api/projects`), and then REPORTS the outcome it observed to ui-state as a
past-tense outcome event (`org_found` / `org_not_found` / `org_created` /
`org_create_failed` / `scope_resolved` / `no_projects_found` / `project_created`
/ `project_create_failed`). This driver therefore plays the client: it performs
the real backend writes AND narrates them to ui-state. ui-state itself has ZERO
egress — it transitions only on these reports (INV-PCO: the reports are trusted
for presentation coordination only, never as a resource oracle, which is why the
DB side effects are always re-asserted against the backend, never read off the
ui-state document).

Wire contract (ADR-046 transport unchanged; ADR-050 closed vocabulary):
  GET  /api/auth/config          → {mode: "dev"|"workos"} (no credential — mode discovery)
  GET  /ui-state/state           → one ChatAppStateDocument (no cold-start)
  POST /ui-state/state/events    → send one event; returns the new document
  GET  /api/orgs/me              → 404 when the principal has no org
  POST /api/orgs                 → create an org (201 → JSON:API single)
  POST /api/projects             → create a project (201 → JSON:API single)
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
    # Set-Cookie is multi-valued; ``headers`` (a dict) collapses duplicates, so
    # the reissue assertions (ADR-050 §a — two distinct, never-collapsed
    # Set-Cookie headers, UC-6) read this list instead.
    set_cookies: list[str] = field(default_factory=list)

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
        return HTTPResult(
            status=resp.status_code,
            body=parsed,
            headers=dict(resp.headers),
            set_cookies=list(resp.headers.get_list("set-cookie")),
        )

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

    @staticmethod
    def active_scope_project_id(doc: dict[str, Any]) -> str | None:
        """The (f) gate companion: active_scope.project_id (non-null on entry)."""
        return ((doc or {}).get("active_scope", {}) or {}).get("project_id")

    def report(
        self, event_type: str, payload: dict[str, Any] | None = None, *, bearer: str
    ) -> HTTPResult:
        """Post one past-tense outcome event (the client narrating an observed result).

        Sugar over :meth:`post_event`. The whole point of the client-reported
        model: the client does the real write, observes the SSOT's answer, and
        reports the outcome here so ui-state can advance the screen-flow.
        """
        return self.post_event({"type": event_type, "payload": payload or {}}, bearer=bearer)

    # ── mode discovery (ADR-050 §d) ────────────────────────────────────────────
    def get_auth_config(self) -> HTTPResult:
        """Side-effect-free mode discovery — GET /api/auth/config, NO credential.

        Renders nothing; reveals only {mode}. Pre-auth by definition (the login
        surface must learn the mode before any sign-in affordance is shown).
        """
        return self.get("/api/auth/config")

    # ── backend app-DB side effects (the resource SSOT — INV-PCO) ───────────────
    def get_my_org(self, *, bearer: str) -> HTTPResult:
        return self.get("/api/orgs/me", bearer=bearer)

    def create_org(self, name: str, *, bearer: str) -> HTTPResult:
        return self.post("/api/orgs", bearer=bearer, json_body={"name": name})

    def create_project(self, name: str, *, bearer: str) -> HTTPResult:
        """POST /api/projects — the client's write for Phase D's default project.

        Not intercepted by auth-proxy (ADR-050 §c); backend statuses arrive
        verbatim. 201 → JSON:API single (data.id + data.attributes.name).
        """
        return self.post("/api/projects", bearer=bearer, json_body={"name": name})

    def list_projects(self, *, bearer: str) -> HTTPResult:
        return self.get("/api/projects", bearer=bearer)

    # ── client-side probe→report choreography (the relocated flow policy) ────────
    def probe_and_report_org(self, *, bearer: str) -> HTTPResult:
        """Phase B: probe org existence, then report the DEFINITIVE answer only.

        ADR-050 §c earned-trust rule: only ``200`` / ``404`` are reportable.
        - 200 → report ``org_found {org:{id,name}}`` (the returning-user fast path).
        - 404 → report ``org_not_found {}``.
        - any other status (5xx / network) is NOT reportable — the probe result is
          returned unreported so the caller stays in ``awaiting_org_report``.

        Returns the ui-state document HTTPResult on a definitive answer, else the
        raw (non-reportable) probe HTTPResult.
        """
        me = self.get_my_org(bearer=bearer)
        if me.status == 200:
            org = jsonapi_single(me.json())
            return self.report("org_found", {"org": org}, bearer=bearer)
        if me.status == 404:
            return self.report("org_not_found", {}, bearer=bearer)
        return me  # transport failure → not reportable (earned-trust rule)


# ── JSON:API helpers ───────────────────────────────────────────────────────────
def jsonapi_single(body: Any) -> dict[str, str]:
    """Extract {id, name} from a JSON:API single document (data.id + attributes.name).

    Tolerates a flat ``{id, name}`` shape too. The {id, name} pair is exactly the
    display snapshot the outcome-report payloads carry (OrgSnapshot /
    ProjectSnapshot — ADR-050 §e.1).
    """
    data = body.get("data", body) if isinstance(body, dict) else body
    if not isinstance(data, dict):
        return {}
    attributes = data.get("attributes", {}) if isinstance(data.get("attributes"), dict) else {}
    return {
        "id": str(data.get("id", "")),
        "name": str(attributes.get("name", data.get("name", ""))),
    }


def jsonapi_rows(body: Any) -> list[dict[str, Any]]:
    """Normalise a JSON:API collection to a list of rows."""
    rows = body.get("data", body) if isinstance(body, dict) else body
    return rows if isinstance(rows, list) else []


def row_names(rows: list[dict[str, Any]]) -> list[str]:
    """Project the ``name`` out of JSON:API rows (tolerating a flat shape)."""
    return [r.get("name") or (r.get("attributes", {}) or {}).get("name") for r in rows]
