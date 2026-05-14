"""Driver helpers for the failure-simulation-consolidation acceptance suite.

The driver is intentionally thin — it composes ``httpx``, ``pathlib``, and
``subprocess`` without inventing new abstractions. Tests own the scenario
logic; the driver owns the I/O.

Responsibilities:

- Subprocess invocation of the new TS registry under
  ``shared/failure-simulation/`` for unit-shaped scenarios (drives
  ``probe``, ``shouldInject``, ``detectUnknownSignals``, ``assertKnown``,
  ``manifest``, ``KNOB``).
- Stdout capture + JSON-line parsing for the audit-emitter scenarios
  (ADR-037 schema).
- HTTP probes against ``reverse-proxy``, ``ui-state``, and ``agent`` for the
  gate / inspection-probe scenarios that need the real compose stack.
- Manifest-file inspection (existence + entry enumeration) for the
  drift-check scenarios in US-CONSOL-5.

Subprocess scripts are written into a temp directory and invoked via
``node --input-type=module ...`` so the package import path resolves
correctly. The driver does not embed inline JS — each scenario passes a
script template owned by the test, keeping driver shape minimal.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx


SEMVER_REGEX = re.compile(r"^v?\d+\.\d+\.\d+(?:-[\w\.]+)?(?:\+[\w\.]+)?$")
"""Permissive semver matcher — DELIVER picks the exact string for
`removal.target_release`; DISTILL only asserts the shape."""


@dataclass
class HTTPProbe:
    """Captured response from an HTTP probe."""

    status: int
    content_type: str
    body: str
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class RegistryRun:
    """Captured output from a ``node`` subprocess that drove the registry."""

    returncode: int
    stdout: str
    stderr: str
    events: list[dict[str, Any]]
    """Parsed JSON-line audit events extracted from stdout."""


@dataclass
class FailureSimulationDriver:
    """Higher-level operations the failure-simulation acceptance tests compose."""

    reverse_proxy_url: str
    ui_state_url: str
    agent_url: str
    repo_root: Path
    registry_dir: Path

    # Optional bucket populated by ``captured_stdout_events`` fixture.
    _stdout_event_bucket: list[dict[str, Any]] | None = None

    # ───────────────────────────── Subprocess: registry ─────────────────────────────

    def run_registry_script(
        self,
        script_body: str,
        *,
        env: dict[str, str] | None = None,
        cwd: Path | None = None,
        timeout: float = 30.0,
    ) -> RegistryRun:
        """Run a snippet of ESM TypeScript against the new registry package.

        The snippet is wrapped in a small preamble that:

        - sets ``process.env`` from ``env`` before importing the registry,
        - imports from ``@dashboard-chat/shared-failure-simulation`` (the
          workspace package name committed in ADR-036), and
        - prints any thrown error's name + message to stderr.

        Returns a ``RegistryRun`` with stdout, stderr, returncode, and the
        list of JSON-line audit events the script wrote.
        """
        full_env = dict(env or {})
        # node needs PATH inherited from the surrounding shell to find npm/node.
        import os as _os

        for k in ("PATH", "HOME", "NODE_PATH"):
            if k not in full_env and k in _os.environ:
                full_env[k] = _os.environ[k]

        run = subprocess.run(
            ["node", "--input-type=module", "-e", script_body],
            cwd=str(cwd or self.repo_root),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=full_env,
            check=False,
        )
        events = _parse_jsonl_events(run.stdout)
        if self._stdout_event_bucket is not None:
            self._stdout_event_bucket.extend(events)
        return RegistryRun(
            returncode=run.returncode,
            stdout=run.stdout,
            stderr=run.stderr,
            events=events,
        )

    def probe_in_subprocess(
        self,
        *,
        environment: str | None,
        failure_simulation_enabled: str | None = None,
        nwave_harness_knobs: str | None = None,
        service_name: str = "ui-state",
    ) -> RegistryRun:
        """Spawn a fresh node process, call `probe(env, service_name)` from
        the registry, and capture the startup audit events.

        The script imports the registry via the workspace package name fixed
        by ADR-036 (``@dashboard-chat/shared-failure-simulation``). Every
        permutation of the three env vars goes through this single helper.
        """
        env: dict[str, str] = {}
        if environment is not None:
            env["ENVIRONMENT"] = environment
        if failure_simulation_enabled is not None:
            env["FAILURE_SIMULATION_ENABLED"] = failure_simulation_enabled
        if nwave_harness_knobs is not None:
            env["NWAVE_HARNESS_KNOBS"] = nwave_harness_knobs

        script = (
            "import { probe } from '@dashboard-chat/shared-failure-simulation';\n"
            f"const verdict = probe(process.env, {json.dumps(service_name)});\n"
            "process.stdout.write(JSON.stringify({__verdict: verdict}) + '\\n');\n"
        )
        return self.run_registry_script(script, env=env)

    # ───────────────────────────── Manifest inspection ─────────────────────────────

    def manifest_file_exists(self) -> bool:
        return (self.registry_dir / "manifest.ts").is_file()

    def read_manifest_source(self) -> str:
        return (self.registry_dir / "manifest.ts").read_text(encoding="utf-8")

    def manifest_canonical_names(self) -> list[str]:
        """Enumerate canonical knob names from the manifest source.

        Uses a static regex pass (no node subprocess) — the manifest is data,
        canonical names match the kebab-case pattern ADR-038 fixes. This is
        sufficient for the discovery-time scenarios (US-CONSOL-1 #4); for
        runtime semantics scenarios use ``run_registry_script``.
        """
        if not self.manifest_file_exists():
            return []
        source = self.read_manifest_source()
        # name: 'verb-noun-kebab-case' as KnobCanonicalName
        pattern = re.compile(
            r"name:\s*['\"]([a-z][a-z0-9-]*[a-z0-9])['\"]\s*as\s*KnobCanonicalName"
        )
        return pattern.findall(source)

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
        base_url = (base or self.reverse_proxy_url).rstrip("/")
        headers: dict[str, str] = {}
        if accept:
            headers["Accept"] = accept
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        if extra_headers:
            headers.update(extra_headers)
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(base_url + path, headers=headers)
        return HTTPProbe(
            status=resp.status_code,
            content_type=resp.headers.get("content-type", ""),
            body=resp.text,
            headers={k.lower(): v for k, v in resp.headers.items()},
        )

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
        base_url = (base or self.reverse_proxy_url).rstrip("/")
        headers: dict[str, str] = {"Accept": "application/json"}
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        if extra_headers:
            headers.update(extra_headers)
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(base_url + path, headers=headers, json=json_body)
        return HTTPProbe(
            status=resp.status_code,
            content_type=resp.headers.get("content-type", ""),
            body=resp.text,
            headers={k.lower(): v for k, v in resp.headers.items()},
        )

    # ───────────────────────────── Source-tree introspection ─────────────────────────────

    def grep_production_source_for_knob_patterns(self) -> dict[str, list[str]]:
        """Find every failure-simulation knob-name pattern in production source.

        Returns a mapping of pattern → list of "file:line" hits. Used by
        CA-1 (manifest-vs-source drift check) to verify the canonical names
        in source match the manifest entries.

        Patterns matched (per ADR-038):
            - X-Force-* HTTP headers
            - __force_*__ and __expire_*__ XState events
            - force_*_failures and similar body-field keys
        """
        roots = [
            self.repo_root / "ui-state",
            self.repo_root / "agent",
        ]
        patterns: dict[str, re.Pattern[str]] = {
            "header": re.compile(r"X-Force-[A-Za-z][A-Za-z0-9-]*"),
            "event": re.compile(r"__(?:force|expire)_[a-z][a-z0-9_]*__"),
            "body-field-legacy": re.compile(r"harness_force_[a-z_]+"),
            "body-field": re.compile(r"\bforce_reissue_failures\b"),
        }
        hits: dict[str, list[str]] = {k: [] for k in patterns}
        for root in roots:
            if not root.exists():
                continue
            for path in root.rglob("*.ts"):
                # Skip vendored / generated artifacts.
                if any(part in {"node_modules", "dist", "build"} for part in path.parts):
                    continue
                try:
                    text = path.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    continue
                for kind, pattern in patterns.items():
                    for line_no, line in enumerate(text.splitlines(), start=1):
                        if pattern.search(line):
                            rel = path.relative_to(self.repo_root)
                            hits[kind].append(f"{rel}:{line_no}")
        return hits


# ───────────────────────────── module-private helpers ─────────────────────────────


def _parse_jsonl_events(stdout: str) -> list[dict[str, Any]]:
    """Parse stdout one line at a time; collect lines that look like audit JSON.

    Per ADR-037, the registry emits one JSON object per line via
    ``console.log(JSON.stringify(event))``. Non-JSON lines (subprocess
    preamble stdout, etc.) are skipped silently. Audit events are identified by the
    presence of an ``event.name`` field beginning with ``failure-simulation.``.
    """
    events: list[dict[str, Any]] = []
    for raw in stdout.splitlines():
        line = raw.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        name = parsed.get("event.name") or parsed.get("__verdict")
        if isinstance(name, str) and name.startswith("failure-simulation."):
            events.append(parsed)
        elif "__verdict" in parsed:
            # The verdict payload from probe_in_subprocess.
            events.append(parsed)
    return events
