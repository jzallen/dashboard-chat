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
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List, Optional

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
    # AC1.2: identity line captured after each (re)start, in order.
    identity_lines: List[str] = field(default_factory=list)
    # AC1.3: full stdout from `tools/workspace_status.sh`.
    workspace_status_output: Optional[str] = None


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
    # check=False — during poll loops, the target container may not yet be
    # visible to compose (race between `up -d` returning and the project
    # state catching up). A transient non-zero `compose logs` should not
    # abort the wait; the next poll cycle will succeed.
    result = subprocess.run(
        ["docker", "compose", "logs", "--no-color", service],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return ""
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


def _all_identity_lines(service: str, max_lines: int = 1000) -> list[str]:
    """Return every line in `docker compose logs <service>` matching IDENTITY_REGEX.

    Used by AC1.2: after stop+start, the container accumulates a fresh identity
    line per startup; this helper counts them so the test can wait for "one
    new identity line emitted" between restarts.
    """
    raw = _compose_logs(service, max_lines=max_lines)
    return [line for line in raw.splitlines() if IDENTITY_REGEX.match(line)]


def _wait_for_identity_count(
    service: str, expected: int, timeout_s: float = 30.0
) -> list[str]:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        lines = _all_identity_lines(service)
        if len(lines) >= expected:
            return lines
        time.sleep(0.25)
    return _all_identity_lines(service)


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
    line = _wait_for_log_match(service, IDENTITY_REGEX, timeout_s=60.0)
    assert line is not None, (
        f"no identity line matching {IDENTITY_REGEX.pattern!r} in first 50 "
        f"lines of `docker compose logs {service}` within 60s"
    )
    capture.matched_line = line

    # Parse out sha and built tokens for downstream assertions.
    parts = dict(token.split("=", 1) for token in line.split() if "=" in token)
    raw_sha = parts.get("sha", "")
    capture.captured_sha = raw_sha.removesuffix("+dirty")
    capture.captured_built = parts.get("built", "")


# ── AC1.4: stale-vs-fresh diagnosis ───────────────────────────────────────


@given(
    parsers.parse(
        'the bazel image "{image}" has been freshly built for the current HEAD'
    )
)
def given_freshly_built_for_head(
    image: str, capture: IdentityCapture, requires_real_io: None
) -> None:
    given_freshly_built_image(image, capture, requires_real_io)


@when(
    parsers.parse(
        'the developer runs "docker compose up -d {service_up}" and inspects '
        '"docker compose logs {service_logs}"'
    )
)
def when_developer_inspects_logs(
    service_up: str,
    service_logs: str,
    capture: IdentityCapture,
    request: pytest.FixtureRequest,
) -> None:
    assert service_up == service_logs, (
        f"step expects identical service in both places: "
        f"up={service_up!r} logs={service_logs!r}"
    )
    when_service_started(service_up, capture, request)
    then_one_identity_line_present(service_up, capture)


def _git_short_sha() -> str:
    out = subprocess.run(
        ["git", "rev-parse", "--short=7", "HEAD"],
        cwd=_repo_root(),
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


@then(parsers.parse('the captured sha equals "{value}"'))
def then_captured_sha_equals(value: str, capture: IdentityCapture) -> None:
    """Generic sha-equality assertion.

    Two callers in this codebase: AC1.4 passes the literal token
    ``git rev-parse --short=7 HEAD`` (computed at assertion time) and AC1.5
    passes ``unknown`` (literal). Dispatch on the literal so a single
    parameterized binding covers both — pytest-bdd does not let two
    @then-bindings share the same parser shape with different parameter
    names without ambiguity.
    """
    if value == "git rev-parse --short=7 HEAD":
        expected = _git_short_sha()
    else:
        expected = value
    assert capture.captured_sha == expected, (
        f"captured sha {capture.captured_sha!r} != expected {expected!r}"
    )


@then(parsers.parse('the captured built equals "{value}"'))
def then_captured_built_equals(value: str, capture: IdentityCapture) -> None:
    assert capture.captured_built == value, (
        f"captured built {capture.captured_built!r} != expected {value!r}"
    )


def _capture_stale_image_identity(
    image: str, request: pytest.FixtureRequest
) -> str:
    """Boot `image` with a synthetic stale `version.json` mounted, return its
    captured identity line.

    This simulates "an out-of-date image started without rebuilding" by
    overriding only the file the identity loader reads. Compose isn't needed
    — `docker run` is enough since we only care about the identity line that
    is emitted *before* the app reaches its compose-dependent startup steps.
    """
    import tempfile

    stale_payload = (
        '{"image":"' + image + '",'
        '"sha":"deadbeefcafebabe1234567890abcdef12345678",'
        '"dirty":false,'
        '"built":"2020-01-01T00:00:00Z"}'
    )
    with tempfile.NamedTemporaryFile(
        mode="w", suffix="-stale-version.json", delete=False
    ) as fh:
        fh.write(stale_payload)
        stale_path = fh.name
    Path(stale_path).chmod(0o644)
    request.addfinalizer(lambda: Path(stale_path).unlink(missing_ok=True))

    container = "dc-1k8-stale-image"
    subprocess.run(
        ["docker", "rm", "-f", container],
        capture_output=True,
        text=True,
        check=False,
    )
    subprocess.run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            container,
            "-v",
            f"{stale_path}:/etc/dashboard-chat/version.json:ro",
            image,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    request.addfinalizer(
        lambda: subprocess.run(
            ["docker", "rm", "-f", container],
            capture_output=True,
            text=True,
            check=False,
        )
    )

    deadline = time.monotonic() + 30.0
    while time.monotonic() < deadline:
        logs = subprocess.run(
            ["docker", "logs", container],
            capture_output=True,
            text=True,
            check=True,
        )
        for raw in logs.stdout.splitlines() + logs.stderr.splitlines():
            if IDENTITY_REGEX.match(raw):
                return raw
        time.sleep(0.25)
    raise AssertionError(
        f"no identity line in stale-image stdout/stderr within 30s "
        f"(image={image!r}, container={container!r})"
    )


@then(
    parsers.parse(
        'if instead an out-of-date image is started without rebuilding, the '
        'captured sha differs from "git rev-parse --short=7 HEAD"'
    )
)
def then_stale_image_sha_differs(
    capture: IdentityCapture, request: pytest.FixtureRequest
) -> None:
    # Tear down the freshly-running api so its container_name is free for
    # the stale-mount run below (compose owns dashboard-api; the stale run
    # uses a distinct name).
    if capture.service is not None:
        _compose_down(capture.service)

    expected_head = _git_short_sha()
    image = capture.image or "dashboard-chat/api:bazel"
    stale_line = _capture_stale_image_identity(image, request)

    parts = dict(token.split("=", 1) for token in stale_line.split() if "=" in token)
    stale_sha = parts.get("sha", "").removesuffix("+dirty")
    assert stale_sha != expected_head, (
        f"stale-image sha {stale_sha!r} unexpectedly equals current HEAD "
        f"{expected_head!r}; the diagnostic property is not detectable"
    )


# ── AC1.3: dirty working tree is flagged ──────────────────────────────────


@given("there are uncommitted changes in the working tree")
def given_uncommitted_changes(
    capture: IdentityCapture,
    requires_real_io: None,
    request: pytest.FixtureRequest,
) -> None:
    """Force a known dirty state by writing an untracked sentinel file.

    Adding an untracked file is the lightest-weight way to make
    `git status --porcelain` non-empty without touching tracked files. The
    finalizer removes it so the precondition is hermetic regardless of
    ambient state (CI clean tree or contributor laptop already dirty).
    """
    sentinel = _repo_root() / ".dc-1k8-dirty-sentinel"
    sentinel.write_text("dirty marker for AC1.3\n", encoding="utf-8")
    request.addfinalizer(lambda: sentinel.unlink(missing_ok=True))

    porcelain = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=_repo_root(),
        capture_output=True,
        text=True,
        check=True,
    )
    assert porcelain.stdout.strip() != "", (
        "precondition failed: expected dirty working tree but "
        "`git status --porcelain` is empty after writing sentinel"
    )


@when("the bazel workspace-status command is invoked")
def when_workspace_status_invoked(capture: IdentityCapture) -> None:
    result = subprocess.run(
        ["./tools/workspace_status.sh"],
        cwd=_repo_root(),
        capture_output=True,
        text=True,
        check=True,
    )
    capture.workspace_status_output = result.stdout


@then(parsers.parse('it emits "{token}"'))
def then_workspace_status_emits(token: str, capture: IdentityCapture) -> None:
    assert capture.workspace_status_output is not None, (
        "workspace_status.sh output not captured — Given step did not run"
    )
    lines = [line.strip() for line in capture.workspace_status_output.splitlines()]
    assert token in lines, (
        f"workspace_status.sh did not emit a line equal to {token!r}; "
        f"got lines: {lines!r}"
    )


@then(
    parsers.parse(
        'a freshly-built image started under those conditions logs an identity '
        'line containing "{marker}" immediately after the SHA'
    )
)
def then_dirty_image_logs_marker(
    marker: str, capture: IdentityCapture, request: pytest.FixtureRequest
) -> None:
    # Build a fresh api image while the dirty sentinel is in place. The
    # version_layer macro re-runs the workspace_status command at every
    # build so the resulting version.json carries dirty=true.
    given_freshly_built_image("dashboard-chat/api:bazel", capture, None)
    capture.service = "api"
    _compose_up("api")
    request.addfinalizer(lambda: _compose_down("api"))

    line = _wait_for_log_match("api", IDENTITY_REGEX)
    assert line is not None, (
        f"no identity line matching {IDENTITY_REGEX.pattern!r} after fresh "
        f"build under dirty tree"
    )
    capture.matched_line = line

    parts = dict(token.split("=", 1) for token in line.split() if "=" in token)
    sha_token = parts.get("sha", "")
    assert marker in sha_token, (
        f"identity sha-token {sha_token!r} does not contain {marker!r}; "
        f"full line: {line!r}"
    )
    # "Immediately after the SHA": the token is exactly <hex>+dirty (no other
    # characters between the hex and the marker).
    expected_pattern = re.compile(r"^[0-9a-f]{7,40}" + re.escape(marker) + r"$")
    assert expected_pattern.match(sha_token), (
        f"sha-token {sha_token!r} has {marker!r} but not immediately after "
        f"the hex SHA (expected pattern {expected_pattern.pattern!r})"
    )


# ── AC1.2: identity is built-in, not start-in ─────────────────────────────


@given(
    parsers.parse(
        'the bazel image "{image}" has been freshly built at build commit {commit}'
    )
)
def given_freshly_built_image_at_commit(
    image: str, commit: str, capture: IdentityCapture, requires_real_io: None
) -> None:
    # Same build path as AC1.1; the `commit` token is informational ("HEAD" in
    # the Examples table) — its concrete value is whatever the workspace_status
    # command stamped at build time, which is asserted in the Then step.
    given_freshly_built_image(image, capture, requires_real_io)


@when(
    parsers.parse(
        'the "{service}" container is started, stopped, and restarted three times'
    )
)
def when_started_stopped_restarted_3x(
    service: str, capture: IdentityCapture, request: pytest.FixtureRequest
) -> None:
    capture.service = service
    _compose_up(service)
    request.addfinalizer(lambda: _compose_down(service))

    # Initial startup: wait for the first identity line.
    initial = _wait_for_identity_count(service, expected=1)
    assert len(initial) >= 1, (
        f"no identity line emitted on first start of {service!r}; "
        f"compose logs lacked a match for {IDENTITY_REGEX.pattern!r}"
    )
    capture.identity_lines = list(initial)

    # Three stop+start cycles. We use `restart` so the same container is
    # reused — its accumulated stdout grows by exactly one identity line per
    # cycle, which makes "every startup logs the same sha and built" trivial
    # to assert without juggling --since timestamps.
    root = _repo_root()
    for cycle in range(1, 4):
        subprocess.run(
            ["docker", "compose", "restart", service],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        target = len(initial) + cycle
        lines = _wait_for_identity_count(service, expected=target)
        assert len(lines) >= target, (
            f"expected at least {target} identity lines after restart cycle "
            f"{cycle} of {service!r}, found {len(lines)}"
        )
        capture.identity_lines = list(lines)


@then(
    parsers.parse(
        "every startup logs sha={commit} and built equals the original "
        "build timestamp"
    )
)
def then_every_startup_stable(commit: str, capture: IdentityCapture) -> None:
    assert capture.workspace_status_sha is not None
    expected_sha = capture.workspace_status_sha[:7]
    if commit != "HEAD":
        # Allow callers to pin an explicit short sha in the Examples table.
        expected_sha = commit

    lines = capture.identity_lines
    assert len(lines) >= 4, (
        f"expected at least 4 identity lines (1 initial + 3 restarts), "
        f"got {len(lines)}: {lines!r}"
    )

    # All captured lines must agree on sha and built — the values were stamped
    # into version.json at build time, so subsequent restarts cannot change them.
    first_parts = dict(t.split("=", 1) for t in lines[0].split() if "=" in t)
    expected_built = first_parts.get("built", "")
    for idx, line in enumerate(lines):
        parts = dict(t.split("=", 1) for t in line.split() if "=" in t)
        sha = parts.get("sha", "").removesuffix("+dirty")
        built = parts.get("built", "")
        assert sha == expected_sha, (
            f"identity line {idx} sha={sha!r} does not match expected "
            f"{expected_sha!r}; line was {line!r}"
        )
        assert built == expected_built, (
            f"identity line {idx} built={built!r} does not match initial "
            f"built={expected_built!r}; line was {line!r}"
        )


@then(parsers.parse('the line begins with the service identifier "{service_name}"'))
def then_line_starts_with_service_name(
    service_name: str, capture: IdentityCapture
) -> None:
    assert capture.matched_line is not None, "no identity line captured"
    assert capture.matched_line.startswith(f"{service_name} "), (
        f"identity line {capture.matched_line!r} does not begin with "
        f"service identifier {service_name!r}"
    )


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


# ── Milestone 4: graceful degradation when version.json is missing/corrupt ──
#
# Scenarios bind-mount an alternate file (or /dev/null) over
# /etc/dashboard-chat/version.json so the running container observes a
# missing-or-malformed payload without rebuilding the image without the
# version layer (per design upstream-changes.md, the canonical regex was
# loosened to admit literal "unknown" tokens). The override is delivered via
# a temporary docker-compose.override.yml — compose merges service `volumes`
# from base + override, and a later mount targeting the same path wins.

_MILESTONE_4_FRONTEND_PEERS = ("auth-proxy", "agent")


def _write_compose_override(service: str, host_path: str) -> Path:
    """Write a temp docker-compose.override.yml that overlays *host_path*
    onto /etc/dashboard-chat/version.json (read-only) for *service*.

    Also injects a placeholder ``GROQ_API_KEY`` for the agent service: agent
    hard-exits at startup when the variable is unset (agent/index.ts:30) but
    its identity log is emitted *before* that check. The graceful-degradation
    AC is "service stays running with version.json missing", so the agent's
    Groq dependency must be satisfied via env-injection or the test fails for
    an unrelated reason. Other services do not gate startup on env this way.
    """
    fh = tempfile.NamedTemporaryFile(
        mode="w", suffix="-version-override.yml", delete=False
    )
    overlay = (
        "services:\n"
        f"  {service}:\n"
        "    volumes:\n"
        f"      - {host_path}:/etc/dashboard-chat/version.json:ro\n"
    )
    if service == "agent":
        overlay += (
            "    environment:\n"
            "      GROQ_API_KEY: dc-1k8-milestone4-stub\n"
        )
    elif service == "frontend":
        # Frontend stack brings up agent; ensure agent stays alive too.
        overlay += (
            "  agent:\n"
            "    environment:\n"
            "      GROQ_API_KEY: dc-1k8-milestone4-stub\n"
        )
    fh.write(overlay)
    fh.close()
    return Path(fh.name)


def _compose_up_with_override(
    services: list[str], override_path: Path
) -> None:
    root = _repo_root()
    # --force-recreate guarantees the override volume is honoured even when
    # a prior iteration left a stopped container with stale spec around;
    # capturing stderr so the assertion message includes compose's reason
    # rather than a bare CalledProcessError.
    result = subprocess.run(
        [
            "docker", "compose",
            "-f", "docker-compose.yml",
            "-f", str(override_path),
            "up", "-d",
            "--force-recreate",
            *services,
        ],
        cwd=root,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"`docker compose up -d {' '.join(services)}` failed "
            f"(rc={result.returncode}):\nSTDOUT:\n{result.stdout}\n"
            f"STDERR:\n{result.stderr}"
        )


def _compose_container_status(service: str) -> str:
    """Return the docker State.Status for the compose-managed *service*.

    Uses `docker compose ps --format json` so we can read state directly
    without a second `docker inspect` round-trip — the inspect was racy when
    compose recreated the container between the ps and inspect calls.
    Returns ``""`` if the service has no current container.
    """
    root = _repo_root()
    result = subprocess.run(
        ["docker", "compose", "ps", "--format", "json", "--all", service],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return ""
    # `compose ps --format json` emits one JSON object per line (NDJSON).
    for raw in result.stdout.splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            continue
        # `compose ps` may return a single object or a list depending on the
        # version; handle both shapes.
        if isinstance(entry, list):
            for item in entry:
                if item.get("Service") == service:
                    return str(item.get("State", ""))
        elif isinstance(entry, dict) and entry.get("Service") == service:
            return str(entry.get("State", ""))
    return ""


def _compose_full_down() -> None:
    """Bring the compose stack fully down with orphan removal.

    Used as the milestone-4 teardown. `compose stop` / `compose rm` of a
    single service leaves dependent containers (api → port 8000, redis,
    minio) bound to host ports between iterations; the next iteration's
    `--force-recreate` sometimes races the port release, surfacing as
    'address already in use' on api. A full down is heavy-handed but
    deterministic, and milestone-4 only runs three scenarios in the suite.
    """
    root = _repo_root()
    subprocess.run(
        ["docker", "compose", "down", "--remove-orphans"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )


def _start_with_version_override(
    service: str,
    host_path: str,
    capture: IdentityCapture,
    request: pytest.FixtureRequest,
) -> None:
    capture.service = service
    services_to_start = (
        [*_MILESTONE_4_FRONTEND_PEERS, service]
        if service == "frontend"
        else [service]
    )
    override = _write_compose_override(service, host_path)
    request.addfinalizer(lambda: override.unlink(missing_ok=True))
    _compose_up_with_override(services_to_start, override)
    request.addfinalizer(_compose_full_down)


@when(
    parsers.parse(
        'the "{service}" container is started with '
        '"/etc/dashboard-chat/version.json" overridden by "{host_path}"'
    )
)
def when_container_started_with_version_override(
    service: str,
    host_path: str,
    capture: IdentityCapture,
    request: pytest.FixtureRequest,
) -> None:
    _start_with_version_override(service, host_path, capture, request)


@when(
    parsers.parse(
        'the "{service}" container is started with '
        '"/etc/dashboard-chat/version.json" overridden by a file '
        'containing "{content}"'
    )
)
def when_container_started_with_corrupt_version(
    service: str,
    content: str,
    capture: IdentityCapture,
    request: pytest.FixtureRequest,
) -> None:
    fh = tempfile.NamedTemporaryFile(
        mode="w", suffix="-corrupt-version.json", delete=False
    )
    fh.write(content)
    fh.close()
    Path(fh.name).chmod(0o644)
    request.addfinalizer(lambda: Path(fh.name).unlink(missing_ok=True))
    _start_with_version_override(service, fh.name, capture, request)


@then(
    parsers.parse(
        'the service starts successfully and remains in state "{state}"'
    )
)
def then_service_in_state(state: str, capture: IdentityCapture) -> None:
    assert capture.service is not None, "no service captured"
    # Identity is logged before any compose-dependent boot work, so a passing
    # regex match (asserted by the same scenario's "exactly one line"
    # assertion) is necessary but not sufficient — we also require the
    # container to settle into the requested state, proving graceful
    # degradation did not crash the boot path.
    deadline = time.monotonic() + 30.0
    last = ""
    while time.monotonic() < deadline:
        last = _compose_container_status(capture.service)
        if last == state:
            return
        # "starting" / "created" are transient; "exited" / "dead" are fatal.
        if last in {"exited", "dead", "removing"}:
            break
        time.sleep(0.5)
    raise AssertionError(
        f"service {capture.service!r} state={last!r}, expected {state!r}"
    )


@then(
    parsers.parse(
        'the identity line in "docker compose logs {service}" contains '
        'sha={sha} and built={built}'
    )
)
def then_identity_line_contains(
    service: str, sha: str, built: str, capture: IdentityCapture
) -> None:
    # Milestone-4 boots are cold (--force-recreate) so the api/agent paths
    # take ~15-20s to emit the identity line after MinIO + DB init. 60s gives
    # comfortable headroom on slower CI runners.
    line = _wait_for_log_match(service, IDENTITY_REGEX, timeout_s=60.0)
    assert line is not None, (
        f"no identity line matching {IDENTITY_REGEX.pattern!r} in first 50 "
        f"lines of `docker compose logs {service}` within 30s"
    )
    capture.matched_line = line
    parts = dict(token.split("=", 1) for token in line.split() if "=" in token)
    captured_sha = parts.get("sha", "").removesuffix("+dirty")
    captured_built = parts.get("built", "")
    capture.captured_sha = captured_sha
    capture.captured_built = captured_built
    assert captured_sha == sha, (
        f"identity line sha={captured_sha!r}, expected {sha!r}; "
        f"line was {line!r}"
    )
    assert captured_built == built, (
        f"identity line built={captured_built!r}, expected {built!r}; "
        f"line was {line!r}"
    )


@then(parsers.parse('"GET {path}" returns {status:d}'))
def then_http_get_returns(
    path: str, status: int, capture: IdentityCapture
) -> None:
    # Frontend nginx publishes on host port 5173 (compose 5173:80).
    assert path == "/_meta.json", f"unsupported HTTP path: {path!r}"
    actual_status, body = _wait_for_http_200(f"http://localhost:5173{path}")
    capture.meta_status = actual_status
    capture.meta_body = body
    try:
        capture.meta_json = json.loads(body)
    except json.JSONDecodeError as exc:
        raise AssertionError(
            f"GET {path} returned non-JSON body: {body!r} ({exc})"
        ) from exc
    assert actual_status == status, (
        f"GET {path} status={actual_status}, expected {status}"
    )


@then(
    parsers.parse(
        'the response body is JSON with sha="{sha}" and built="{built}"'
    )
)
def then_response_body_with_tokens(
    sha: str, built: str, capture: IdentityCapture
) -> None:
    body = capture.meta_json
    assert body is not None, "no /_meta.json JSON body captured"
    assert body.get("sha") == sha, (
        f"/_meta.json sha={body.get('sha')!r}, expected {sha!r}"
    )
    assert body.get("built") == built, (
        f"/_meta.json built={body.get('built')!r}, expected {built!r}"
    )
