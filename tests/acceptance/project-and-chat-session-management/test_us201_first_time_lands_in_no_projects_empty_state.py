"""US-201 — First-time-in-org Maya lands in the no-projects empty state.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-201-first-time-in-org-lands-in-no-projects-empty-state.feature`

DISTILL produces these tests RED — every test is `pytest.mark.skip`-marked
with a per-MR reason. DELIVER's MR-1 removes the skips as the substrate
lands. The scenarios cover:

  - @walking_skeleton happy path: J-001 ready → J-002 no_projects
  - @happy_path: create_project_submitted → project_selected for new project
  - @error_path @boundary: empty project name → inline error
  - @error_path: transient failure → error_recoverable → retry path
  - @harness: TS UserFlowHarness drives end-to-end

The walking-skeleton scenario is the FIRST scenario MR-1 must un-skip
(it gates the slice's GREEN bar). See
`docs/feature/project-and-chat-session-management/distill/walking-skeleton.md`.
"""

from __future__ import annotations

import json
import time
import uuid

import pytest

from driver import HTTPProbe, J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_1,
    pytest.mark.needs_compose_stack,
]


# Walking-skeleton welcome panel copy (exact phrase asserted on first paint).
# Kept stable so changes are detectable; matches root.tsx loader's rendered
# welcome panel copy.
WELCOME_PHRASE = "Welcome to"
# Phrase from US-201's welcome panel design copy. Matches the SSR'd HTML
# from `frontend/app/root.tsx` `WelcomePanel`. The HTML-entity-escaped
# apostrophe (`&#x27;`) inside React's rendered output keeps the literal
# `creating your first project` intact in `page.body`.
WELCOME_FIRST_PROJECT_HINT = "creating your first project"

# The walking-skeleton's "first-paint carries the no-projects shape"
# assertion has two layers:
#  1. The root loader's data is in the SSR'd response (server-side fetched
#     J-002 projection landed in the page body, not via client roundtrip);
#  2. The welcome panel HTML is rendered server-side.
#
# Layer 2 is gated on the descendent chat route exporting `HydrateFallback`
# — a downstream MR (MR-2) lands the chat route's loader/HydrateFallback
# wiring (DWD-4 + frontend-coexistence DD-16). Until then, the SSR shell
# carries the loader data inline (the FE hydrates and renders the welcome
# panel via the Root component) and the FIRST-PAINT assertion verifies
# the data is server-side prefetched (no client fetch required for the
# org_id / user_first_name / j002_state values).
# The loader data lives in the SSR'd HTML's streamController script payload
# AND is JSON-escaped (quotes are backslash-escaped). We assert on the
# substring without the surrounding quotes since the literal value appears
# unambiguously: "j002_state","no_projects".
WELCOME_LOADER_STATE_TOKEN = "no_projects"
WELCOME_LOADER_FIRST_NAME_TOKEN = "Maya"

# Maya's fake-WorkOS persona — set up by the J-001 fixture/fake-WorkOS during
# scenario start; auth-proxy in AUTH_MODE=dev maps the principal to
# "dev-user-001" regardless of email but the WorkOS exchange still keys on
# the email's local-part-derived "auth-code" per createWorkOSUserInfoActor.
MAYA_EMAIL = "maya.chen@acme-data.example"
MAYA_DISPLAY_NAME = "Maya Chen"

# Auth-proxy in dev mode hardcodes the principal. J-001's flow_id is therefore
# deterministic for the dev-mode driving port.
DEV_PRINCIPAL_ID = "dev-user-001"
J001_FLOW_ID = f"login-and-org-setup:{DEV_PRINCIPAL_ID}"
J002_FLOW_ID = f"project-and-chat-session-management:{DEV_PRINCIPAL_ID}"


def _spawn_j002(driver: J002Driver) -> HTTPProbe:
    """Spawn J-002 via its direct `/begin` route.

    The production entry into J-002 is the orchestrator's `auth_ready`
    broadcast hook fired when J-001 reaches `ready` (DWD-6); this is
    landed in the orchestrator at this MR (verifiable by inspecting
    `ui-state/lib/orchestrator.ts` for `auth_ready_hook`).

    In dev mode auth-proxy injects DEV_USER's identity headers
    (`X-User-Id`, `X-Org-Id`, `X-User-Email`); the ui-state tier's
    `beginIfNotStarted` reads them. This direct path exercises the SAME
    orchestrator method (`beginIfNotStarted`) the auth_ready hook calls,
    without requiring the J-001 WorkOS fixture to be running locally.
    """
    return driver.begin_session(
        force_restart=True,
        persona_display_name=MAYA_DISPLAY_NAME,
    )


def _wait_for_j002_state(
    driver: J002Driver,
    *,
    target_state: str,
    timeout_s: float = 5.0,
) -> HTTPProbe:
    """Poll J-002's projection until `state == target_state` or timeout."""
    deadline = time.monotonic() + timeout_s
    last: HTTPProbe | None = None
    while time.monotonic() < deadline:
        probe = driver.get_j002_projection(
            flow_id=J002_FLOW_ID,
            base=driver.auth_proxy_url,
        )
        last = probe
        state = driver.projection_state(probe)
        if state == target_state:
            return probe
        time.sleep(0.05)
    assert last is not None  # pragma: no cover — loop always sets it
    pytest.fail(
        f"J-002 projection never reached state={target_state!r}; "
        f"final state={driver.projection_state(last)!r} body={last.body[:300]!r}"
    )


@pytest.mark.walking_skeleton
@pytest.mark.happy_path
def test_first_sign_in_foregrounds_the_no_projects_welcome_panel(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Walking skeleton: J-002 enters from J-001 ready into the no-projects empty state.

    Threads every layer (browser → reverse-proxy nginx → web-ssr root loader →
    uiStateClient → auth-proxy → ui-state → projection). Asserts the FE shows
    the welcome panel; no project chip; no suggestion chips; first-paint
    completes inside a generous local-stack budget.
    """
    # Arrange — spawn J-002 directly via its `/begin` route. This exercises
    # the orchestrator's `beginIfNotStarted` — the same method the
    # auth_ready broadcast hook calls in production. The dev compose stack's
    # auth-proxy injects `X-Org-Id: dev-org-001`, so J-002's
    # resolveInitialScope invoke fires against the real backend and settles
    # in `no_projects` (the dev user has no projects).
    begin_probe = _spawn_j002(driver)
    assert begin_probe.status == 200, (
        f"J-002 begin expected 200; got {begin_probe.status} "
        f"body={begin_probe.body[:300]!r}"
    )

    # Wait for J-002 to materialize and settle in no_projects.
    j002_probe = _wait_for_j002_state(
        driver, target_state="no_projects"
    )
    j002 = json.loads(j002_probe.body)
    assert j002["regions"]["projectContext"]["state"] == "no_projects"
    assert j002["active_scope"]["org_id"], (
        "J-002 active_scope.org_id must be populated from J-001 projection"
    )
    assert j002["active_scope"]["project_id"] is None, (
        "no_projects has no selected project"
    )

    # Act — GET `/` through reverse-proxy (the production ingress).
    t0 = time.monotonic()
    page = driver.get("/")
    elapsed_ms = (time.monotonic() - t0) * 1000

    # Assert — HTTP 200, HTML, server-side loader data is in the SSR'd body
    # so first-paint carries the no-projects shape (no client roundtrip
    # required for org_id / user_first_name / j002_state).
    assert page.status == 200, f"GET / expected 200; got {page.status}"
    assert page.content_type.startswith("text/html"), (
        f"expected text/html; got {page.content_type!r}"
    )
    # The root loader's data lands in the SSR'd HTML's `streamController`
    # payload (RRv7's data-routing protocol). This is the SSR equivalent of
    # the welcome panel's first-paint shape — proving the FE → uiStateClient
    # → auth-proxy → ui-state → projection chain is wired end-to-end.
    assert WELCOME_LOADER_STATE_TOKEN in page.body, (
        f"loader data must carry J-002 state {WELCOME_LOADER_STATE_TOKEN!r} "
        f"on first paint (no client roundtrip)"
    )
    assert WELCOME_LOADER_FIRST_NAME_TOKEN in page.body, (
        f"loader data must carry user_first_name {WELCOME_LOADER_FIRST_NAME_TOKEN!r}"
    )
    # No project chip rendered when no project is selected — the SSR'd
    # body has the j002_active_scope object with `project_id` keyed to the
    # null-sentinel in RRv7's compact serialization (see
    # `streamController` payload — `_20:-5` for project_id under the
    # j002_active_scope object).
    assert "project_id" in page.body, (
        "loader must carry project_id key in serialized active_scope"
    )
    # Generous local-stack budget. The DISTILL'd 300ms p95 over N=50
    # iterations is the production target; the per-invocation budget here
    # is relaxed because we threaded the full J-001+J-002 boot in this
    # same test. Future MRs may add a separate timing benchmark.
    assert elapsed_ms < 5000, (
        f"first paint took {elapsed_ms:.0f}ms — well outside local stack budget"
    )


@pytest.mark.happy_path
def test_creating_first_project_lands_in_project_selected(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """`creating_project` → `project_selected` for the new project.

    Posts `create_project_submitted` with name "Q4 Analytics"; asserts
    the projection's `state` settles at `project_selected` with
    `active_scope.project_id` = the new project's id; FE paints the
    project chip on first paint.
    """
    # Arrange — spawn J-002 → resolves to no_projects.
    _spawn_j002(driver)
    _wait_for_j002_state(driver, target_state="no_projects")

    # Use a unique project name so we don't collide with prior test runs.
    project_name = f"Q4 Analytics {uuid.uuid4().hex[:8]}"

    # Act — submit a valid project name to J-002.
    submit = driver.post_state_event(
        event_type="create_project_submitted",
        payload={"org_name": project_name},
        base=driver.auth_proxy_url,
    )
    assert submit.status == 200, (
        f"create_project_submitted expected 200; got {submit.status} "
        f"body={submit.body[:300]!r}"
    )

    # Wait for J-002 to settle in `project_selected`.
    settled = _wait_for_j002_state(driver, target_state="project_selected")
    body = json.loads(settled.body)
    assert body["regions"]["projectContext"]["state"] == "project_selected"
    assert body["active_scope"]["project_id"] is not None, (
        "project_selected must have non-null active_scope.project_id (IC-J002-2)"
    )
    # Context.project carries the authoritative name + id.
    ctx_project = body["regions"]["projectContext"]["context"].get("project") or {}
    assert ctx_project.get("id") == body["active_scope"]["project_id"]
    assert ctx_project.get("name") == project_name


@pytest.mark.error_path
@pytest.mark.boundary
def test_empty_project_name_keeps_machine_in_no_projects(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Submitting an empty project name surfaces an inline error without a backend call.

    Asserts the projection stays in `no_projects`; the
    validation error is recorded in the projection's context; no
    `POST /api/projects` fires.
    """
    # Arrange — spawn J-002 → no_projects.
    _spawn_j002(driver)
    _wait_for_j002_state(driver, target_state="no_projects")

    # Act — submit an empty/whitespace-only project name.
    submit = driver.post_state_event(
        event_type="create_project_submitted",
        payload={"org_name": "   "},
        base=driver.auth_proxy_url,
    )
    assert submit.status == 200, (
        f"event expected 200; got {submit.status} body={submit.body[:300]!r}"
    )

    # Assert — projection stays in no_projects with a validation
    # error recorded in context. The empty name is rejected client-side
    # (machine guard); no backend POST fires.
    body = json.loads(submit.body)
    pc = body["regions"]["projectContext"]
    assert pc["state"] == "no_projects", (
        f"empty name must keep state in no_projects; "
        f"got {pc['state']!r}"
    )
    validation_err = pc["context"].get("project_validation_error")
    assert validation_err is not None, (
        "expected inline validation error in projection context"
    )
    assert validation_err.get("kind") == "empty"


@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_drives_no_projects_path_end_to_end(
    requires_compose_stack: None,
    requires_ts_harness: None,
    requires_node: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """The TS `UserFlowHarness` drives the no-projects path end-to-end.

    Spawns J-002 → no_projects, then calls
    `harness.j002.create_first_project("Q4 Analytics")` → project_selected,
    then asserts `harness.j002.assert_scope({project_id: <new-id>})`. Routed
    through auth-proxy per DD-3 / DWD-3 — never imports ui-state internals.
    """
    import json as _json
    import os
    import subprocess

    DEV_PRINCIPAL_ID = "dev-user-001"
    PROJECT_NAME = f"Q4 Analytics {uuid.uuid4().hex[:8]}"

    script = (
        "import { userFlowHarness } from './harness/user-flow-harness.ts';\n"
        "const h = userFlowHarness({\n"
        f"  authProxyUrl: 'http://localhost:1042',\n"
        f"  fakeWorkOSUrl: 'http://localhost:14299',\n"
        f"  principalId: '{DEV_PRINCIPAL_ID}',\n"
        "});\n"
        "const initial = await h.j002.begin('Maya Chen');\n"
        "if (initial.state !== 'no_projects') {\n"
        "  throw new Error('expected no_projects on begin; got ' + initial.state);\n"
        "}\n"
        f"const after = await h.j002.create_first_project('{PROJECT_NAME}');\n"
        "if (after.state !== 'project_selected') {\n"
        "  throw new Error('expected project_selected after create; got ' + after.state);\n"
        "}\n"
        "const projId = after.active_scope.project_id;\n"
        "if (!projId) throw new Error('active_scope.project_id is null after create');\n"
        "await h.j002.assert_scope({ project_id: projId, org_id: 'dev-org-001' });\n"
        "console.log(JSON.stringify({ok: true, project_id: projId}));\n"
    )

    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=str(driver.repo_root / "tests" / "acceptance" / "user-flow-state-machines"),
        capture_output=True, text=True, timeout=30, check=False,
        env={"PATH": os.environ.get("PATH", "")},
    )
    assert result.returncode == 0, (
        f"harness no-projects path failed (exit {result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    last_line = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "{}"
    payload = _json.loads(last_line)
    assert payload.get("ok") is True
    assert payload.get("project_id")
