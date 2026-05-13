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

    # ───────────────────────── J-002 endpoint helpers ─────────────────────────

    def get_j002_projection(
        self,
        *,
        flow_id: str,
        bearer: str | None = None,
        base: str | None = None,
    ) -> HTTPProbe:
        """GET the J-002 projection. The endpoint contract is fixed by DESIGN
        (handoff-design-to-distill.md §"Endpoints to assert against")."""
        return self.get(
            f"/ui-state/flow/project-and-chat-session-management/projection?flow_id={flow_id}",
            base=base,
            bearer=bearer,
        )

    def post_j002_event(
        self,
        *,
        flow_id: str,
        event: dict[str, Any],
        bearer: str | None = None,
        base: str | None = None,
    ) -> HTTPProbe:
        return self.post(
            "/ui-state/flow/project-and-chat-session-management/event",
            base=base,
            bearer=bearer,
            json_body={"flow_id": flow_id, "event": event},
        )

    def open_j002_deep_link(
        self,
        *,
        principal_id: str,
        intent_project_id: str | None = None,
        intent_session_id: str | None = None,
        intent_resource_id: str | None = None,
        intent_resource_type: str | None = None,
        bearer: str | None = None,
        base: str | None = None,
    ) -> HTTPProbe:
        payload: dict[str, Any] = {"principal_id": principal_id}
        if intent_project_id is not None:
            payload["intent_project_id"] = intent_project_id
        if intent_session_id is not None:
            payload["intent_session_id"] = intent_session_id
        if intent_resource_id is not None:
            payload["intent_resource_id"] = intent_resource_id
        if intent_resource_type is not None:
            payload["intent_resource_type"] = intent_resource_type
        return self.post(
            "/ui-state/flow/project-and-chat-session-management/open-deep-link",
            base=base,
            bearer=bearer,
            json_body=payload,
        )

    def post_agent_chat(
        self,
        *,
        bearer: str,
        active_scope: dict[str, Any] | None,
        body: dict[str, Any],
        base: str | None = None,
    ) -> HTTPProbe:
        """POST /chat to the agent — via reverse-proxy by default per DWD-3 / IC-J002-7.

        The agent's middleware reads `X-Active-Scope` exclusively (post-sunset);
        during the migration window, body's `project_id` is the fallback per DWD-3.
        """
        headers: dict[str, str] = {}
        if active_scope is not None:
            headers["X-Active-Scope"] = json.dumps(active_scope)
        return self.post(
            "/chat",
            base=base,
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

    # ───────────────────────────── Convenience predicates ─────────────────────────────

    def projection_state(self, probe: HTTPProbe) -> str | None:
        """Extract `state` from a J-002 projection response (if JSON parseable)."""
        if "json" not in probe.content_type.lower():
            return None
        try:
            data = json.loads(probe.body)
        except json.JSONDecodeError:
            return None
        value = data.get("state")
        return value if isinstance(value, str) else None

    def projection_active_scope(self, probe: HTTPProbe) -> dict[str, Any] | None:
        if "json" not in probe.content_type.lower():
            return None
        try:
            data = json.loads(probe.body)
        except json.JSONDecodeError:
            return None
        scope = data.get("active_scope")
        return scope if isinstance(scope, dict) else None
