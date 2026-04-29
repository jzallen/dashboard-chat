"""Step glue for dc-1k8 (log image identity on startup).

Strategy C (real local I/O): subprocess to bazel + docker compose, real
container processes, real stdout, real curl. No mocks.

Only the walking-skeleton scenario has fully-wired step bindings here.
Milestone 1-4 .feature files are tagged @pending; the crafter enables
them one at a time during DELIVER and extends the glue below.
"""
from __future__ import annotations

import json
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pytest
from pytest_bdd import given, parsers, then, when

# Canonical identity regex — sourced from
# docs/feature/log-image-identity-on-startup/design/upstream-changes.md.
# Loosened from the original DISCUSS regex to admit literal "unknown" tokens
# so that AC1.5 (graceful degradation) and AC1.1 (canonical line) are not
# mutually exclusive.
IDENTITY_REGEX = re.compile(
    r"^[A-Za-z0-9_-]+ image=\S+ "
    r"sha=(?:[0-9a-f]{7,40}|unknown)(?:\+dirty)? "
    r"built=(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z|unknown)$"
)


@dataclass
class IdentityCapture:
    """Holds the captured state for a scenario's assertions."""

    image: Optional[str] = None
    service: Optional[str] = None
    matched_line: Optional[str] = None
    captured_sha: Optional[str] = None
    captured_built: Optional[str] = None
    workspace_status_sha: Optional[str] = None


def _repo_root() -> Path:
    """Walk up to the directory containing docker-compose.yml."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "docker-compose.yml").exists():
            return parent
    raise RuntimeError("docker-compose.yml not found in any ancestor directory")


def _read_workspace_status_sha() -> str:
    """Run tools/workspace_status.sh and parse out STABLE_GIT_COMMIT."""
    root = _repo_root()
    result = subprocess.run(
        ["./tools/workspace_status.sh"],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    for line in result.stdout.splitlines():
        if line.startswith("STABLE_GIT_COMMIT "):
            return line.split(" ", 1)[1].strip()
    raise AssertionError(
        "tools/workspace_status.sh did not emit STABLE_GIT_COMMIT line"
    )


def _bazel_image_load(target: str) -> None:
    """Run `bazel run //...:image_load` for the given image target.

    We don't try to map the image tag back to a bazel target by hand —
    the existing project layout pairs each image with a `:image_load`
    sibling (see backend/BUILD.bazel, agent/BUILD.bazel, etc.). The
    crafter wires this up per-service as scenarios are enabled.
    """
    root = _repo_root()
    subprocess.run(
        ["bazel", "run", target],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )


def _compose_up(service: str) -> None:
    root = _repo_root()
    subprocess.run(
        ["docker", "compose", "up", "-d", service],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )


def _compose_down(service: Optional[str] = None) -> None:
    root = _repo_root()
    cmd = ["docker", "compose", "down"]
    if service is not None:
        cmd = ["docker", "compose", "stop", service]
    subprocess.run(cmd, cwd=root, capture_output=True, text=True, check=False)


def _compose_logs(service: str, max_lines: int = 50) -> str:
    root = _repo_root()
    result = subprocess.run(
        ["docker", "compose", "logs", "--no-color", service],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    # docker compose prefixes each line with "<service>  | " — strip it so
    # the regex matches the application's emitted line, not the wrapper.
    raw_lines = result.stdout.splitlines()[:max_lines]
    stripped = []
    for line in raw_lines:
        marker = "| "
        idx = line.find(marker)
        stripped.append(line[idx + len(marker) :] if idx != -1 else line)
    return "\n".join(stripped)


def _wait_for_log_match(
    service: str, regex: re.Pattern[str], timeout_s: float = 30.0
) -> Optional[str]:
    """Poll `docker compose logs <service>` until a line matches `regex`.

    Returns the matching line, or None on timeout. Polls at ~250ms cadence
    so a fast-booting container yields its identity line within a second.
    """
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        for line in _compose_logs(service).splitlines():
            if regex.match(line):
                return line
        time.sleep(0.25)
    return None


# ── pytest-bdd bindings ────────────────────────────────────────────────────


@pytest.fixture
def capture() -> IdentityCapture:
    return IdentityCapture()


@given(parsers.parse('the bazel image "{image}" has been freshly built'))
def given_freshly_built_image(
    image: str, capture: IdentityCapture, requires_real_io: None
) -> None:
    capture.image = image
    # Map image tag → bazel target. The four bazel-built services
    # use rules_oci's `oci_load(name = "image_tar", ...)` convention;
    # `bazel run //<svc>:image_tar` loads the image into the local
    # docker daemon under the configured `repo_tags`.
    target_map = {
        "dashboard-chat/api:bazel":        "//backend:image_tar",
        "dashboard-chat/agent:bazel":      "//agent:image_tar",
        "dashboard-chat/auth-proxy:bazel": "//auth-proxy:image_tar",
        "dashboard-chat/frontend:bazel":   "//frontend:image_tar",
    }
    if image not in target_map:
        pytest.fail(f"unknown image tag for bazel build: {image}")
    _bazel_image_load(target_map[image])
    capture.workspace_status_sha = _read_workspace_status_sha()


@when(parsers.parse('the "{service}" service is started via "docker compose up -d"'))
def when_service_started(
    service: str, capture: IdentityCapture, request: pytest.FixtureRequest
) -> None:
    capture.service = service
    _compose_up(service)
    request.addfinalizer(lambda: _compose_down(service))


@then(
    parsers.parse(
        'within the first 50 lines of "docker compose logs {service}" there is '
        'exactly one line matching the canonical identity regex'
    )
)
def then_one_identity_line_present(service: str, capture: IdentityCapture) -> None:
    line = _wait_for_log_match(service, IDENTITY_REGEX)
    assert line is not None, (
        f"no identity line matching {IDENTITY_REGEX.pattern!r} in first 50 "
        f"lines of `docker compose logs {service}` within 30s"
    )
    capture.matched_line = line

    # Parse out sha and built tokens for downstream assertions.
    parts = dict(token.split("=", 1) for token in line.split() if "=" in token)
    raw_sha = parts.get("sha", "")
    capture.captured_sha = raw_sha.removesuffix("+dirty")
    capture.captured_built = parts.get("built", "")


@then(
    "the captured sha equals the STABLE_GIT_COMMIT recorded by the "
    "workspace-status command at build time"
)
def then_sha_matches_workspace_status(capture: IdentityCapture) -> None:
    assert capture.captured_sha is not None, "no sha captured from identity line"
    assert capture.workspace_status_sha is not None, "workspace_status_sha not recorded"
    # The stdout line uses the 7-char short SHA (DESIGN §7); the JSON
    # payload keeps the full 40-char SHA. workspace_status emits full SHA.
    expected_short = capture.workspace_status_sha[:7]
    assert capture.captured_sha == expected_short, (
        f"identity-line sha={capture.captured_sha!r} does not match "
        f"workspace-status STABLE_GIT_COMMIT short={expected_short!r} "
        f"(full={capture.workspace_status_sha!r})"
    )
