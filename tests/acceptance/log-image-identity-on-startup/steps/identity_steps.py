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
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

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
    # Milestone-2 (frontend HTTP surface): /_meta.json
    meta_status: Optional[int] = None
    meta_body: Optional[str] = None
    meta_json: Optional[dict[str, Any]] = None


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
    if target == "//frontend:image_tar":
        _ensure_repo_root_env(root)
    subprocess.run(
        ["bazel", "run", target],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )


def _ensure_repo_root_env(root: Path) -> None:
    """Frontend's `:dist` genrule sources `//:.env` at vite-build time. The
    file is gitignored and absent on a fresh worktree; an empty stub is
    sufficient for the identity test (we only need vite to finish, not for
    Stream.io / WorkOS env to be populated). Idempotent — never overwrites
    an existing file.
    """
    env_path = root / ".env"
    if not env_path.exists():
        env_path.write_text("STREAM_API_KEY=\n")


def _compose_up(service: str) -> None:
    root = _repo_root()
    subprocess.run(
        ["docker", "compose", "up", "-d", service],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )


def _compose_up_services(services: list[str]) -> None:
    """Start a set of compose services in one `docker compose up -d` call.

    The frontend's nginx config proxies to `auth-proxy` and `agent`; the
    `/api/` and `/health` location blocks resolve those names at config-
    parse time (no `resolver` directive on them today, unlike `/worker/` and
    the presentation-state location). Bringing the whole upstream subset up
    together lets nginx start cleanly so the static `/_meta.json` surface is
    actually reachable for the milestone-2 test.
    """
    root = _repo_root()
    subprocess.run(
        ["docker", "compose", "up", "-d", *services],
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


def _wait_for_http_200(url: str, timeout_s: float = 30.0) -> tuple[int, str]:
    """Poll `url` until it responds 200; return (status, body).

    Used for the frontend `/_meta.json` surface. Tolerates connection
    refused / DNS errors during nginx warmup, but propagates non-200
    responses immediately so a misconfigured endpoint fails fast.
    """
    deadline = time.monotonic() + timeout_s
    last_err: Optional[BaseException] = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2.0) as resp:
                return resp.status, resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as exc:
            last_err = exc
            time.sleep(0.5)
    raise AssertionError(
        f"GET {url} did not return any response within {timeout_s}s; "
        f"last error: {last_err!r}"
    )


def _frontend_capture(
    capture: IdentityCapture, request: pytest.FixtureRequest
) -> None:
    """Build the bazel frontend image, start the container, and capture both
    surfaces (stdout identity line + /_meta.json body) into ``capture``.

    Used by AC2.2 and AC2.3 Given-clauses where the prior AC2.1 stdout-only
    bindings are insufficient. The compose teardown is registered via
    ``request.addfinalizer`` so the scenario cleans up after itself.
    """
    capture.image = "dashboard-chat/frontend:bazel"
    capture.service = "frontend"
    _bazel_image_load("//frontend:image_tar")
    capture.workspace_status_sha = _read_workspace_status_sha()
    _compose_up_services(["auth-proxy", "agent", "frontend"])
    request.addfinalizer(lambda: _compose_down("frontend"))

    line = _wait_for_log_match("frontend", IDENTITY_REGEX)
    assert line is not None, (
        f"no identity line matching {IDENTITY_REGEX.pattern!r} in first 50 "
        "lines of `docker compose logs frontend` within 30s"
    )
    capture.matched_line = line
    parts = dict(token.split("=", 1) for token in line.split() if "=" in token)
    capture.captured_sha = parts.get("sha", "").removesuffix("+dirty")
    capture.captured_built = parts.get("built", "")

    # Frontend service publishes nginx on host port 5173 (compose maps 5173:80).
    status, body = _wait_for_http_200("http://localhost:5173/_meta.json")
    capture.meta_status = status
    capture.meta_body = body
    try:
        capture.meta_json = json.loads(body)
    except json.JSONDecodeError as exc:
        raise AssertionError(
            f"GET /_meta.json returned non-JSON body: {body!r} ({exc})"
        ) from exc


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
    if service == "frontend":
        # Frontend's nginx config proxies to `auth-proxy` and `agent`, and
        # the `/api/` + `/health` location blocks resolve those names at
        # config-parse time (no `resolver` directive on them today). Without
        # those upstreams already present, nginx exits and the container
        # never serves anything. Bring them up alongside frontend so the
        # static identity surface (stdout + /_meta.json) is reachable.
        _compose_up_services(["auth-proxy", "agent", "frontend"])
    else:
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


# ── Milestone 2: frontend container (stdout + HTTP) ───────────────────────


@then(parsers.parse('the line begins with the service identifier "{service_id}"'))
def then_line_begins_with_identifier(
    service_id: str, capture: IdentityCapture
) -> None:
    assert capture.matched_line is not None, "no identity line captured"
    prefix = service_id + " "
    assert capture.matched_line.startswith(prefix), (
        f"identity line {capture.matched_line!r} does not begin with "
        f"{prefix!r}"
    )


@given(parsers.parse('"{service_id}" is running and serving the SPA'))
def given_frontend_running(
    service_id: str,
    capture: IdentityCapture,
    requires_real_io: None,
    request: pytest.FixtureRequest,
) -> None:
    assert service_id == "dashboard-frontend", (
        f"unexpected frontend service identifier: {service_id!r}"
    )
    _frontend_capture(capture, request)


@when(parsers.parse('the developer issues "GET {path}"'))
def when_developer_issues_get(path: str, capture: IdentityCapture) -> None:
    # The Given-clause already issued the request via _wait_for_http_200 so
    # nginx-warmup polling and the response capture share one timeout. This
    # step asserts the path is the one the Given pre-fetched, so accidental
    # divergence between the .feature and the fixture is loud.
    assert path == "/_meta.json", f"unsupported HTTP path: {path!r}"
    assert capture.meta_body is not None, (
        "no /_meta.json body captured — Given clause did not run"
    )


@then(parsers.parse("the response status is {status:d}"))
def then_response_status(status: int, capture: IdentityCapture) -> None:
    assert capture.meta_status == status, (
        f"expected GET /_meta.json status={status}, got {capture.meta_status}"
    )


@then("the response body is JSON of shape {image, sha, dirty, built}")
def then_response_body_canonical_shape(capture: IdentityCapture) -> None:
    body = capture.meta_json
    assert body is not None, "no JSON body parsed from /_meta.json"
    expected_keys = {"image", "sha", "dirty", "built"}
    actual_keys = set(body.keys())
    missing = expected_keys - actual_keys
    assert not missing, (
        f"/_meta.json missing required keys {missing}; got keys {actual_keys}"
    )
    assert isinstance(body["image"], str), (
        f"/_meta.json image is {type(body['image']).__name__}, expected str"
    )
    assert isinstance(body["sha"], str), (
        f"/_meta.json sha is {type(body['sha']).__name__}, expected str"
    )
    assert isinstance(body["dirty"], bool), (
        f"/_meta.json dirty is {type(body['dirty']).__name__}, expected bool"
    )
    assert isinstance(body["built"], str), (
        f"/_meta.json built is {type(body['built']).__name__}, expected str"
    )


@then(
    "the response sha equals the sha emitted in the stdout identity line "
    "from AC2.1"
)
def then_response_sha_matches_stdout_line(capture: IdentityCapture) -> None:
    assert capture.matched_line is not None, "no stdout identity line captured"
    assert capture.meta_json is not None, "no /_meta.json body captured"
    stdout_sha = capture.captured_sha or ""
    json_sha = capture.meta_json.get("sha", "")
    # DESIGN §7: stdout uses 7-char short SHA; JSON keeps the full 40-char
    # SHA so machine consumers can do exact matches. They refer to the same
    # commit iff the full SHA starts with the short SHA. The graceful-
    # degradation branch (AC1.5) substitutes the literal token "unknown" in
    # both surfaces.
    if stdout_sha == "unknown":
        assert json_sha == "unknown", (
            f"stdout sha=unknown but /_meta.json sha={json_sha!r}"
        )
    else:
        assert json_sha.startswith(stdout_sha), (
            f"/_meta.json sha={json_sha!r} does not start with stdout "
            f"short sha={stdout_sha!r}"
        )


@given('the frontend identity line and "/_meta.json" body have been captured')
def given_frontend_both_surfaces_captured(
    capture: IdentityCapture,
    requires_real_io: None,
    request: pytest.FixtureRequest,
) -> None:
    _frontend_capture(capture, request)


@then(
    "the frontend identity line conforms to the canonical regex used by "
    "milestones 1 and 4"
)
def then_frontend_identity_canonical_regex(capture: IdentityCapture) -> None:
    assert capture.matched_line is not None, "no frontend identity line captured"
    assert IDENTITY_REGEX.match(capture.matched_line), (
        f"frontend identity line {capture.matched_line!r} does not match "
        f"canonical regex {IDENTITY_REGEX.pattern!r}"
    )


@then('the "/_meta.json" body schema matches the canonical JSON shape')
def then_meta_json_canonical_shape(capture: IdentityCapture) -> None:
    body = capture.meta_json
    assert body is not None, "no /_meta.json body captured"
    expected_keys = {"image", "sha", "dirty", "built"}
    actual_keys = set(body.keys())
    missing = expected_keys - actual_keys
    assert not missing, (
        f"/_meta.json missing canonical keys {missing}; got {actual_keys}"
    )
    assert isinstance(body["image"], str) and body["image"], (
        f"image must be non-empty str, got {body['image']!r}"
    )
    assert isinstance(body["sha"], str) and body["sha"], (
        f"sha must be non-empty str, got {body['sha']!r}"
    )
    assert isinstance(body["dirty"], bool), (
        f"dirty must be bool, got {type(body['dirty']).__name__}"
    )
    assert isinstance(body["built"], str) and body["built"], (
        f"built must be non-empty str, got {body['built']!r}"
    )
