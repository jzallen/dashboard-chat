"""Driver helpers for the frontend-coexistence acceptance suite.

The driver exposes the operations every test reaches for:

  - HTTP probes against `reverse-proxy` (the user-facing ingress).
  - File-system inspections of the repo working tree (file presence,
    file content grep, source-tree grep).
  - `docker compose config --services` subprocess introspection.
  - Marker-bearer-token minting for the auth-forwarding scenarios.

The driver is intentionally thin: it composes `httpx`, `pathlib`,
and `subprocess` without inventing new abstractions. Tests own the
scenario logic; the driver owns the I/O.
"""

from __future__ import annotations

import re
import secrets
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx


@dataclass
class HTTPProbe:
    """Captured response from an HTTP probe against `reverse-proxy`."""

    status: int
    content_type: str
    body: str
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class FrontendCoexistenceDriver:
    """Higher-level operations the acceptance tests compose."""

    reverse_proxy_url: str
    auth_proxy_url: str
    repo_root: Path

    # ───────────────────────────── HTTP probes ─────────────────────────────

    def get(
        self,
        path: str,
        *,
        bearer: str | None = None,
        accept: str | None = None,
        timeout: float = 10.0,
    ) -> HTTPProbe:
        """GET `path` against `reverse-proxy` and capture the response.

        `bearer` adds an `Authorization: Bearer <bearer>` header.
        `accept` sets the `Accept` header (used for SSE-stream probes).
        """
        headers: dict[str, str] = {}
        if bearer is not None:
            headers["Authorization"] = f"Bearer {bearer}"
        if accept is not None:
            headers["Accept"] = accept
        url = f"{self.reverse_proxy_url}{path}"
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            response = client.get(url, headers=headers)
        return HTTPProbe(
            status=response.status_code,
            content_type=response.headers.get("content-type", ""),
            body=response.text,
            headers={k.lower(): v for k, v in response.headers.items()},
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
        exclude_paths: list[str] | None = None,
    ) -> list[tuple[Path, int, str]]:
        """Return (path, line_no, line) for every match of `pattern` (regex) under `paths`.

        Walks files under each path; skips directories listed in
        `exclude_paths`. Used by the BrowserRouter-presence,
        AuthProvider-in-loader, and presentation-state-in-loader
        scenarios.
        """
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
                # Skip excluded directories.
                rel = file.relative_to(self.repo_root)
                if any(str(rel).startswith(ex + "/") for ex in exclude):
                    continue
                # Only inspect text-y source files.
                if file.suffix not in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"}:
                    continue
                try:
                    text = file.read_text(encoding="utf-8")
                except (UnicodeDecodeError, OSError):
                    continue
                for line_no, line in enumerate(text.splitlines(), start=1):
                    if compiled.search(line):
                        matches.append((rel, line_no, line))
        return matches

    # ───────────────────────────── docker compose ─────────────────────────────

    def compose_services(self) -> list[str]:
        """Return the list of services declared by the repo's `docker-compose.yml`."""
        result = subprocess.run(
            ["docker", "compose", "config", "--services"],
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]

    def compose_service_block(self, service: str) -> dict[str, Any]:
        """Return the YAML-parsed compose block for `service`."""
        import yaml  # local import — yaml is a test-only dep

        result = subprocess.run(
            ["docker", "compose", "config"],
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        config = yaml.safe_load(result.stdout)
        services = config.get("services", {})
        if service not in services:
            raise KeyError(f"service `{service}` not found in compose config")
        return services[service]

    # ───────────────────────────── Marker bearer ─────────────────────────────

    def mint_probe_bearer(self, *, prefix: str = "probe") -> str:
        """Mint a distinctive bearer-token string for an auth-forwarding probe.

        The token is NOT a valid JWT — it's a sentinel string the test
        recognizes. The auth-forwarding scenarios verify that this exact
        string survives the SSR boundary; they do not depend on
        `auth-proxy` accepting the token.
        """
        return f"{prefix}-{secrets.token_hex(8)}"

    # ───────────────────────────── Convenience predicates ─────────────────────────────

    def response_is_html_shell(self, probe: HTTPProbe) -> bool:
        """True iff the response is an HTML5 shell (a `<div id="root">` + a `<script>` reference)."""
        if probe.status != 200:
            return False
        if "text/html" not in probe.content_type.lower():
            return False
        body = probe.body
        if "<html" not in body.lower() or "<body" not in body.lower():
            return False
        if 'id="root"' not in body and "id='root'" not in body:
            return False
        if "<script" not in body.lower():
            return False
        if "Error: " in body or "Stack trace" in body or "<pre>" in body[:5000]:
            return False
        return True
