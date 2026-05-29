"""Driver helpers for the J-002 (`project-and-chat-session-management`) acceptance suite.

The driver exposes the operations every test reaches for:

  - HTTP probes against `reverse-proxy` (the user-facing ingress), `auth-proxy`,
    `ui-state`, and `agent` host ports.
  - File-system inspections of the repo working tree (file presence,
    grep, source-tree fan-out checks for DWD-4 loader migration).
  - Subprocess invocation of the TS UserFlowHarness `harness.j002.*` namespace.
  - Marker-bearer-token minting for auth-forwarding probes.

The driver is intentionally thin: it composes `httpx`, `pathlib`, and
`subprocess` without inventing new abstractions. Tests own the scenario
logic; the driver owns the I/O. DELIVER may extend it (one method per
MR, per the roadmap) without restructuring.
"""

from __future__ import annotations

import json
import re
import secrets
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx


@dataclass
class HTTPProbe:
    """Captured response from an HTTP probe."""

    status: int
    content_type: str
    body: str
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class J002Driver:
    """Higher-level operations the J-002 acceptance tests compose."""

    reverse_proxy_url: str
    auth_proxy_url: str
    ui_state_url: str
    agent_url: str
    repo_root: Path
    _cached_dev_jwt: str | None = field(default=None, repr=False)

    # ───────────────────────────── HTTP probes ─────────────────────────────

    def get(
        self,
        path: str,
        *,
        base: str | None = None,
        bearer: str | None = None,
        accept: str | None = None,
        extra_headers: dict[str, str] | None = None,
        timeout: float = 10.0,
    ) -> HTTPProbe:
        """GET `path` against `base` (default: reverse-proxy) and capture the response."""
        return self._request("GET", path, base=base, bearer=bearer, accept=accept,
                             extra_headers=extra_headers, body=None, timeout=timeout)

    def post(
        self,
        path: str,
        *,
        base: str | None = None,
        bearer: str | None = None,
        json_body: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
        timeout: float = 10.0,
    ) -> HTTPProbe:
        """POST JSON to `path` against `base` (default: reverse-proxy)."""
        return self._request(
            "POST", path, base=base, bearer=bearer, accept="application/json",
            extra_headers=extra_headers, body=json_body, timeout=timeout,
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        base: str | None,
        bearer: str | None,
        accept: str | None,
        extra_headers: dict[str, str] | None,
        body: dict[str, Any] | None,
        timeout: float,
    ) -> HTTPProbe:
        base_url = (base or self.reverse_proxy_url).rstrip("/")
        url = f"{base_url}{path}"
        headers: dict[str, str] = {}
        if bearer is not None:
            headers["Authorization"] = f"Bearer {bearer}"
        if accept is not None:
            headers["Accept"] = accept
        if extra_headers:
            headers.update(extra_headers)
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            response = client.request(method, url, headers=headers, json=body)
        return HTTPProbe(
            status=response.status_code,
            content_type=response.headers.get("content-type", ""),
            body=response.text,
            headers={k.lower(): v for k, v in response.headers.items()},
        )

    # ───────────────────────── /state surface helpers ─────────────────────────
    #
    # ADR-046 MR-6 — the three former per-machine mounts
    # (`/ui-state/flow/<machine>/{projection,event,begin,open-deep-link}`) are
    # replaced by ONE document surface:
    #   - reads  : GET  /ui-state/state         → ChatAppStateDocument
    #   - writes : POST /ui-state/state/events   → {type, payload} ⇒ new document
    # Each former per-machine projection is now a `regions.<region>` slice of
    # the one document; the single authoritative `active_scope` and bookkeeping
    # are hoisted to the top level. Identity is header-derived (no `flow_id`).
    # Region keys: `onboarding`, `projectContext`, `sessionChat`.

    def get_state_document(
        self,
        *,
        bearer: str | None = None,
        base: str | None = None,
    ) -> HTTPProbe:
        """GET /ui-state/state — the single per-principal ChatAppStateDocument."""
        return self.get("/ui-state/state", base=base, bearer=bearer)

    def post_state_event(
        self,
        *,
        event_type: str,
        payload: dict[str, Any] | None = None,
        bearer: str | None = None,
        base: str | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> HTTPProbe:
        """POST /ui-state/state/events — submit one event; the response IS the
        new document."""
        return self.post(
            "/ui-state/state/events",
            base=base,
            bearer=bearer,
            extra_headers=extra_headers,
            json_body={"type": event_type, "payload": payload or {}},
        )

    def begin_session(
        self,
        *,
        force_restart: bool = True,
        persona_display_name: str | None = None,
        principal_id: str | None = None,  # noqa: ARG002 — header-derived now; kept for call-site compat
        bearer: str | None = None,
        base: str | None = None,
    ) -> HTTPProbe:
        """Spawn / reset the per-principal actor. Begin is the reserved
        `session_begin` event now (ADR-046 Decision 3a); `force_restart=True`
        cold-starts (wiping the prior event log)."""
        payload: dict[str, Any] = {"force_restart": force_restart}
        if persona_display_name is not None:
            payload["persona_display_name"] = persona_display_name
        return self.post_state_event(
            event_type="session_begin", payload=payload, bearer=bearer, base=base
        )

    def get_j002_projection(
        self,
        *,
        flow_id: str | None = None,  # noqa: ARG002 — header-derived now; kept for call-site compat
        bearer: str | None = None,
        base: str | None = None,
    ) -> HTTPProbe:
        """GET the single `/state` document. The former per-machine projection
        is now its `regions.projectContext` slice; read it via
        `projection_state(probe)` / `projection_context(probe)`. `flow_id` is
        ignored (identity is header-derived) and retained only for call-site
        compatibility."""
        return self.get_state_document(bearer=bearer, base=base)

    def post_j002_event(
        self,
        *,
        flow_id: str | None = None,  # noqa: ARG002 — header-derived now; kept for call-site compat
        event: dict[str, Any],
        bearer: str | None = None,
        base: str | None = None,
    ) -> HTTPProbe:
        """Submit a `{type, payload}` event to the single event surface."""
        return self.post_state_event(
            event_type=str(event.get("type")),
            payload=event.get("payload"),
            bearer=bearer,
            base=base,
        )

    def open_j002_deep_link(
        self,
        *,
        principal_id: str | None = None,  # noqa: ARG002 — header-derived now; kept for call-site compat
        intent_project_id: str | None = None,
        intent_session_id: str | None = None,
        intent_resource_id: str | None = None,
        intent_resource_type: str | None = None,
        bearer: str | None = None,
        base: str | None = None,
    ) -> HTTPProbe:
        """Open a deep link — now the ordinary `open_deep_link` event on the one
        event surface (ADR-046 Decision 3)."""
        payload: dict[str, Any] = {}
        if intent_project_id is not None:
            payload["intent_project_id"] = intent_project_id
        if intent_session_id is not None:
            payload["intent_session_id"] = intent_session_id
        if intent_resource_id is not None:
            payload["intent_resource_id"] = intent_resource_id
        if intent_resource_type is not None:
            payload["intent_resource_type"] = intent_resource_type
        return self.post_state_event(
            event_type="open_deep_link", payload=payload, bearer=bearer, base=base
        )

    def post_agent_chat(
        self,
        *,
        bearer: str,
        active_scope: dict[str, Any] | None,
        body: dict[str, Any],
        base: str | None = None,
    ) -> HTTPProbe:
        """POST /chat to the agent. Defaults to `agent_url` because the
        reverse-proxy's nginx config does not currently route `/chat` to
        the agent — `/api/*` goes to auth-proxy, `/worker/*` is stripped
        and forwarded to agent, but `/chat` falls through to web-ssr's
        RRv7 404 page (upstream-issues.md O-MR4-06). Callers can override
        with `base=` to drive via the reverse-proxy once the nginx rule
        lands.

        The agent's middleware reads `X-Active-Scope` exclusively (post-sunset);
        during the migration window, body's `project_id` is the fallback per DWD-3.
        """
        headers: dict[str, str] = {}
        if active_scope is not None:
            headers["X-Active-Scope"] = json.dumps(active_scope)
        return self.post(
            "/chat",
            base=base or self.agent_url,
            bearer=bearer,
            extra_headers=headers,
            json_body=body,
        )

    # ───────────────────────────── Repo file probes ─────────────────────────────

    def path_exists(self, *parts: str) -> bool:
        return (self.repo_root / Path(*parts)).exists()

    def read_repo_text(self, *parts: str) -> str:
        return (self.repo_root / Path(*parts)).read_text(encoding="utf-8")

    def grep_repo(
        self,
        pattern: str,
        *,
        paths: list[str],
        suffixes: tuple[str, ...] = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".json"),
        exclude_paths: list[str] | None = None,
    ) -> list[tuple[Path, int, str]]:
        """Return (path, line_no, line) for every match of `pattern` (regex) under `paths`."""
        compiled = re.compile(pattern)
        exclude = {p.rstrip("/") for p in (exclude_paths or [])}
        matches: list[tuple[Path, int, str]] = []
        for start in paths:
            root = self.repo_root / start
            if not root.exists():
                continue
            for file in root.rglob("*"):
                if not file.is_file():
                    continue
                rel = file.relative_to(self.repo_root)
                if any(str(rel).startswith(ex + "/") for ex in exclude):
                    continue
                if file.suffix not in suffixes:
                    continue
                try:
                    text = file.read_text(encoding="utf-8")
                except (UnicodeDecodeError, OSError):
                    continue
                for line_no, line in enumerate(text.splitlines(), start=1):
                    if compiled.search(line):
                        matches.append((rel, line_no, line))
        return matches

    # ───────────────────────────── TS harness driver ─────────────────────────────

    def run_ts_harness(
        self,
        script_inline: str,
        *,
        timeout: float = 30.0,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        """Run an inline TS snippet against the J-001 acceptance suite's TS harness.

        The harness lives at `tests/acceptance/user-flow-state-machines/harness/`
        and gains the `harness.j002.*` namespace in MR-1 DELIVER. This wrapper
        constructs an ESM-importing node invocation that drives a scripted
        sequence and returns its JSON output on stdout.

        DELIVER may switch this to a Cucumber `World`-style invocation if the
        TS suite's existing pattern is preferred; the contract here is one
        scripted invocation per scenario.
        """
        script_path = self.repo_root / "tests" / "acceptance" / "user-flow-state-machines"
        return subprocess.run(
            ["node", "--input-type=module", "-e", script_inline],
            cwd=script_path,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**(env or {})},
            check=False,
        )

    # ───────────────────────────── Marker bearer ─────────────────────────────

    def mint_probe_bearer(self, *, prefix: str = "j002") -> str:
        """Mint a distinctive bearer-token string for an auth-forwarding probe.

        NOT a valid JWT — a sentinel string the test recognizes. The
        auth-forwarding scenarios verify that this exact string survives the
        loader → auth-proxy → agent pipeline.
        """
        return f"{prefix}-probe-{secrets.token_hex(8)}"

    # ───────────────────────────── Dev JWT mint ─────────────────────────────

    def mint_dev_jwt(self) -> str:
        """Return a JWT the agent's `authMiddleware` accepts.

        The agent's middleware verifies bearer tokens as RS256 JWTs against
        backend's JWKS — kid `dev-key-1`, audience `dev-client`, issuer
        `http://localhost:8000`. The static `dev-token-static` is not a JWT
        and the agent rejects it with 401. Tests posting to `/chat` (or the
        agent's `/debug/*` probes) need a real backend-signed JWT — this
        helper mints one.

        Flow: POST `/api/auth/callback` to auth-proxy. The path is in
        auth-proxy's PUBLIC_PATHS so no bearer is required; auth-proxy
        proxies to backend's `/api/auth/callback`, which in `AUTH_MODE=dev`
        invokes `DevAuthProvider.handle_callback` to mint a JWT for
        `DEV_USER` (`dev-user-001` / `dev-org-001`) regardless of the auth
        code value. The returned JWT is signed by backend's `dev-key-1` and
        matches the agent's JWKS lookup byte-for-byte.

        Note on the M2M alternative: auth-proxy's `/api/auth/token`
        (OAuth2 client_credentials) mints JWTs signed by auth-proxy's own
        keypair (kid `auth-proxy:m2m:1`). Those tokens authenticate calls
        through the auth-proxy ingress (where auth-proxy's verifyToken
        dispatcher recognises the M2M kid) but the agent never sees the
        auth-proxy keypair — the M2M path is the right shape for partners
        calling `/api/*` routes, not direct `/chat` calls. The
        `/api/auth/callback` path matches the FE chat flow's actual
        end-to-end shape: backend mints, agent verifies.

        Cached per driver-instance — the JWT TTL is 300s in dev and
        re-minting on every assertion is wasteful. Tests that need a fresh
        JWT can reset `self._cached_dev_jwt = None` and call again; nothing
        in MR-4-verify scope needs that.

        Raises `RuntimeError` with a hint when the auth-proxy is unreachable
        (the most common operational failure).
        """
        if self._cached_dev_jwt is not None:
            return self._cached_dev_jwt
        url = f"{self.auth_proxy_url.rstrip('/')}/api/auth/callback"
        try:
            with httpx.Client(timeout=10.0, follow_redirects=False) as client:
                response = client.post(url, json={"code": "dev-auth-code"})
        except httpx.RequestError as e:
            raise RuntimeError(
                f"mint_dev_jwt: cannot reach auth-proxy at {url} "
                f"({type(e).__name__}: {e}). Bring the compose stack up "
                f"with `docker compose up -d` from the repo root."
            ) from e
        if response.status_code != 200:
            raise RuntimeError(
                f"mint_dev_jwt: auth-proxy returned {response.status_code} "
                f"from POST {url}: {response.text[:300]}. Verify AUTH_MODE=dev "
                f"on the backend and that the auth-proxy is proxying /api/*."
            )
        token = response.json().get("token")
        if not isinstance(token, str) or not token:
            raise RuntimeError(
                f"mint_dev_jwt: auth-proxy returned 200 but no token field: "
                f"{response.text[:300]}"
            )
        self._cached_dev_jwt = token
        return token

    # ───────────────────────────── Convenience predicates ─────────────────────────────

    def projection_state(
        self, probe: HTTPProbe, region: str = "projectContext"
    ) -> str | None:
        """Extract `regions.<region>.state` from a `/state` document response.

        Defaults to the `projectContext` region (the former J-002 project-context
        projection). Pass `region="sessionChat"` for the session-chat slice or
        `region="onboarding"` for the J-001 slice."""
        if "json" not in probe.content_type.lower():
            return None
        try:
            data = json.loads(probe.body)
        except json.JSONDecodeError:
            return None
        slice_ = (data.get("regions") or {}).get(region) or {}
        value = slice_.get("state")
        return value if isinstance(value, str) else None

    def projection_context(
        self, probe: HTTPProbe, region: str = "projectContext"
    ) -> dict[str, Any] | None:
        """Extract `regions.<region>.context` from a `/state` document response."""
        if "json" not in probe.content_type.lower():
            return None
        try:
            data = json.loads(probe.body)
        except json.JSONDecodeError:
            return None
        slice_ = (data.get("regions") or {}).get(region) or {}
        ctx = slice_.get("context")
        return ctx if isinstance(ctx, dict) else None

    def projection_active_scope(self, probe: HTTPProbe) -> dict[str, Any] | None:
        """The single authoritative top-level `active_scope` of the document."""
        if "json" not in probe.content_type.lower():
            return None
        try:
            data = json.loads(probe.body)
        except json.JSONDecodeError:
            return None
        scope = data.get("active_scope")
        return scope if isinstance(scope, dict) else None
