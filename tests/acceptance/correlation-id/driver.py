"""Driver helpers for the correlation-id (US-1) acceptance suite.

The driver owns the I/O the K1 cross-service assertion reaches for:

  - HTTP probes against `auth-proxy` (the ingress that mints the id) so a single
    request traverses ≥2 services (auth-proxy → backend).
  - Capture of the JSON log lines each service emitted for that request, read
    back through `docker compose logs <service>`, parsed into the shared
    `LogRecord` envelope so the test can assert on `attributes.correlation_id`.

It is intentionally thin: it composes `httpx`, `subprocess`, and `json` without
inventing new abstractions. Tests own the scenario logic; the driver owns the
I/O. Implementation sub-issues may extend it without restructuring.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

# The `event.module` / `event.action` / `attributes` envelope keys are the
# cross-service logging contract (`shared/logging/log.ts`). The correlation id
# surfaces under `attributes.correlation_id` (header↔attribute name split with
# `X-Request-Id` is intentional).
CORRELATION_ATTRIBUTE = "correlation_id"


@dataclass
class HTTPProbe:
    """Captured response from an HTTP probe."""

    status: int
    content_type: str
    body: str
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class CorrelationDriver:
    """Higher-level operations the correlation-id acceptance tests compose."""

    auth_proxy_url: str
    repo_root: Path

    # ───────────────────────────── HTTP probes ─────────────────────────────

    def request(
        self,
        method: str,
        path: str,
        *,
        bearer: str | None = None,
        extra_headers: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
        timeout: float = 10.0,
    ) -> HTTPProbe:
        """Drive `method path` against the auth-proxy ingress and capture the response."""
        url = f"{self.auth_proxy_url.rstrip('/')}{path}"
        headers: dict[str, str] = {}
        if bearer is not None:
            headers["Authorization"] = f"Bearer {bearer}"
        if extra_headers:
            headers.update(extra_headers)
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            response = client.request(method, url, headers=headers, json=json_body)
        return HTTPProbe(
            status=response.status_code,
            content_type=response.headers.get("content-type", ""),
            body=response.text,
            headers={k.lower(): v for k, v in response.headers.items()},
        )

    def mint_dev_jwt(self) -> str:
        """Return a backend-signed JWT the services accept.

        POSTs `/api/auth/callback` (a PUBLIC_PATH, so no bearer required); in
        `AUTH_MODE=dev` the backend mints a JWT for `DEV_USER` regardless of the
        code. Used to drive an authenticated request deep enough to traverse
        auth-proxy → backend and reach a backend error path.
        """
        url = f"{self.auth_proxy_url.rstrip('/')}/api/auth/callback"
        with httpx.Client(timeout=10.0, follow_redirects=False) as client:
            response = client.post(url, json={"code": "dev-auth-code"})
        if response.status_code != 200:
            raise RuntimeError(
                f"mint_dev_jwt: auth-proxy returned {response.status_code} from "
                f"POST {url}: {response.text[:300]}"
            )
        token = response.json().get("token")
        if not isinstance(token, str) or not token:
            raise RuntimeError(f"mint_dev_jwt: no token field: {response.text[:300]}")
        return token

    # ─────────────────────────── Log-line capture ───────────────────────────

    def service_log_records(self, service: str, *, since: str) -> list[dict[str, Any]]:
        """Return the JSON `LogRecord`s `service` emitted since `since`.

        Reads `docker compose logs <service> --since <since>` from the repo root
        (works whether or not the service pins a `container_name`, and across
        `--scale`d replicas) and keeps the lines that parse as the shared JSON
        envelope. Non-JSON lines (startup banners, framework noise) are dropped.
        """
        proc = subprocess.run(
            [
                "docker", "compose", "logs", "--no-color", "--no-log-prefix",
                "--since", since, service,
            ],
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        records: list[dict[str, Any]] = []
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                records.append(parsed)
        return records

    @staticmethod
    def correlation_ids(records: list[dict[str, Any]]) -> set[str]:
        """Collect the distinct, non-empty `attributes.correlation_id` values."""
        ids: set[str] = set()
        for record in records:
            attributes = record.get("attributes")
            if not isinstance(attributes, dict):
                continue
            value = attributes.get(CORRELATION_ATTRIBUTE)
            if isinstance(value, str) and value:
                ids.add(value)
        return ids
