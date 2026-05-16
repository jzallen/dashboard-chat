"""US-210 — J-002 honors FREEZE from J-001's expired_token; THAW replays
queued intents in FIFO; stale-intent filter drops intents whose target
no longer applies; replay buffer timeout → error_recoverable.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-210-freeze-thaw-replay.feature`

MR-6 — final milestone; substrate amortization payoff. Validates IC-J002-6
+ DWD-7 stale-intent guards. INCLUDES the Praxis F-4 deferred scenario
(concurrent dataset picks during FREEZE with FIFO + staleness-guard
semantics) per the review §5 recommendation.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_6,
    pytest.mark.needs_compose_stack,
]

DEV_PRINCIPAL_ID = "dev-user-001"
DEV_ORG_ID = "dev-org-001"
SC_FLOW_ID = f"session-chat:{DEV_PRINCIPAL_ID}"
PC_FLOW_ID = f"project-and-chat-session-management:{DEV_PRINCIPAL_ID}"


# ───────────────────────────── dev backend seeding ─────────────────────────────


def _api_curl(method: str, path: str, body: dict | None = None,
               org_id: str = DEV_ORG_ID) -> str:
    args = [
        "docker", "exec", "dashboard-api", "curl", "-sS",
        "-X", method, f"http://localhost:8000{path}",
        "-H", f"x-user-id: {DEV_PRINCIPAL_ID}",
        "-H", f"x-org-id: {org_id}",
        "-H", "x-user-email: dev@localhost",
    ]
    if body is not None:
        args += ["-H", "content-type: application/json", "-d", json.dumps(body)]
    return subprocess.run(
        args, capture_output=True, text=True, timeout=10, check=True
    ).stdout


def _create_project(name: str) -> str:
    return json.loads(_api_curl("POST", "/api/projects", {"name": name}))["data"]["id"]


def _create_session(project_id: str, title: str) -> str:
    body = json.loads(
        _api_curl("POST", f"/api/projects/{project_id}/sessions", {"title": title})
    )
    return body["data"]["id"] if "data" in body else body["id"]


def _create_dataset(project_id: str, name: str) -> str:
    import uuid
    dataset_id = str(uuid.uuid4())
    sql = (
        f"import sqlite3; conn=sqlite3.connect('/data/app.db'); "
        f"conn.execute(\"INSERT INTO datasets (id, project_id, name, schema_config, "
        f"partition_fields, created_at, updated_at) VALUES "
        f"('{dataset_id}', '{project_id}', '{name}', '{{}}', '[]', "
        f"'2026-05-15', '2026-05-15')\"); conn.commit(); print('inserted')"
    )
    proc = subprocess.run(
        ["docker", "exec", "dashboard-api", "python", "-c", sql],
        capture_output=True, text=True, timeout=10, check=True,
    )
    assert "inserted" in proc.stdout, proc.stderr
    return dataset_id


# ───────────────────────────── flow helpers ─────────────────────────────


def _sc(driver: J002Driver) -> dict:
    probe = driver.get(
        f"/ui-state/flow/session-chat/projection?flow_id={SC_FLOW_ID}",
        base=driver.auth_proxy_url,
    )
    return json.loads(probe.body) if probe.status == 200 else {}


def _pc(driver: J002Driver) -> dict:
    probe = driver.get(
        f"/ui-state/flow/project-and-chat-session-management/projection?flow_id={PC_FLOW_ID}",
        base=driver.auth_proxy_url,
    )
    return json.loads(probe.body) if probe.status == 200 else {}


def _spawn_to_session_list(driver: J002Driver) -> dict:
    """Reset both J-002 flows then spawn project-context → session-chat;
    settle session-chat in session_list_loaded. Hermetic per scenario
    (the shared dev-user-001 principal would otherwise bleed state)."""
    driver.post(
        "/ui-state/flow/session-chat/begin",
        base=driver.auth_proxy_url,
        json_body={"persona_display_name": "Maya Chen", "principal_id": DEV_PRINCIPAL_ID},
    )
    begin = driver.post(
        "/ui-state/flow/project-and-chat-session-management/begin",
        base=driver.auth_proxy_url,
        json_body={"persona_display_name": "Maya Chen", "principal_id": DEV_PRINCIPAL_ID},
    )
    assert begin.status == 200, f"begin {begin.status}: {begin.body[:300]}"
    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        if _sc(driver).get("state") == "session_list_loaded":
            return _sc(driver)
        time.sleep(0.05)
    pytest.fail(f"session-chat never reached session_list_loaded; last={_sc(driver)!r}")


def _post_event(driver: J002Driver, machine: str, flow_id: str, type_: str,
                 payload: dict, extra_headers: dict | None = None) -> None:
    driver.post(
        f"/ui-state/flow/{machine}/event",
        base=driver.auth_proxy_url,
        json_body={"flow_id": flow_id, "type": type_, "payload": payload},
        extra_headers=extra_headers,
    )


def _freeze(driver: J002Driver, reason: str | None = None) -> None:
    body: dict = {"principal_id": DEV_PRINCIPAL_ID}
    kind = "thaw" if reason else "freeze"
    if reason:
        body["reason"] = reason
    r = driver.post(
        f"/ui-state/flow/session-chat/{kind}",
        base=driver.auth_proxy_url,
        json_body=body,
    )
    assert r.status == 200, f"/{kind} {r.status}: {r.body[:300]}"


def _thaw(driver: J002Driver, reason: str = "thaw") -> None:
    body: dict = {"principal_id": DEV_PRINCIPAL_ID, "reason": reason}
    r = driver.post(
        "/ui-state/flow/session-chat/thaw",
        base=driver.auth_proxy_url,
        json_body=body,
    )
    assert r.status == 200, f"/thaw {r.status}: {r.body[:300]}"


def _wait_state(driver: J002Driver, getter, want: str, timeout: float = 8.0) -> dict:
    deadline = time.monotonic() + timeout
    last: dict = {}
    while time.monotonic() < deadline:
        last = getter(driver)
        if last.get("state") == want:
            return last
        time.sleep(0.05)
    pytest.fail(f"state never reached {want}; last={last!r}")


@pytest.mark.happy_path
def test_token_expiry_during_session_resume_pauses_and_replays_with_original_correlation(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """resuming_session → freeze → THAW → resuming_session with same correlation reference;
    the 401 in-flight response is discarded by J-002 with no transition."""
    proj_id = _create_project("Q4 Analytics")
    session_id = _create_session(proj_id, "chat-9b2a")
    sc = _spawn_to_session_list(driver)
    original_correlation = sc.get("correlation_id")
    assert original_correlation, f"no correlation on session_list_loaded: {sc!r}"

    # Maya clicks the session; the resume is held (gated test knob) so the
    # orchestrator FREEZE broadcast lands while J-002 is still in
    # resuming_session — the in-flight transcript-load 401-discard contract.
    def _click() -> None:
        _post_event(
            driver, "session-chat", SC_FLOW_ID, "session_clicked",
            {"session_id": session_id},
            extra_headers={"X-Force-Slow-Resume": "3000"},
        )

    t = threading.Thread(target=_click, daemon=True)
    t.start()
    # Give the click time to be dispatched and the actor to enter
    # resuming_session (now holding in the gated slow-resume window).
    time.sleep(1.0)

    # J-001 expires → orchestrator broadcasts FREEZE.
    _freeze(driver)

    frozen = _wait_state(driver, _sc, "freeze")
    assert frozen["context"].get("last_live_state") == "resuming_session", (
        f"US-210 #1: froze from resuming_session; got "
        f"{frozen['context'].get('last_live_state')!r}"
    )
    t.join(timeout=6.0)
    # The slow resume's 401-equivalent response is discarded — no
    # transition out of freeze from the stopped in-flight invoke.
    time.sleep(0.3)
    assert _sc(driver)["state"] == "freeze", "in-flight resume must be discarded"

    # Silent re-auth succeeds → THAW. freeze → resuming_session (re-invoke
    # with fresh JWT) → session_active.
    _thaw(driver)
    active = _wait_state(driver, _sc, "session_active")
    assert active["context"].get("session_id") == session_id, (
        f"US-210 #1: resumed session id; got {active['context'].get('session_id')!r}"
    )
    # The original correlation reference is preserved across freeze/thaw.
    assert active.get("correlation_id") == original_correlation, (
        f"US-210 #1: correlation must be preserved; "
        f"{active.get('correlation_id')!r} != {original_correlation!r}"
    )


@pytest.mark.happy_path
def test_token_expiry_during_project_switch_replays_after_thaw(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """switching_project → freeze → THAW → switching_project → project_selected for Q3."""
    _create_project("Q4 Analytics")
    q3_id = _create_project("Q3 Sales")
    _spawn_to_session_list(driver)
    pc = _wait_state(driver, _pc, "project_selected")
    original_correlation = pc.get("correlation_id")

    def _switch() -> None:
        _post_event(
            driver, "project-and-chat-session-management", PC_FLOW_ID,
            "switching_project_intent", {"new_project_id": q3_id},
            extra_headers={"X-Force-Slow-Switch-Project": "3000"},
        )

    t = threading.Thread(target=_switch, daemon=True)
    t.start()
    time.sleep(1.0)
    _freeze(driver)

    frozen = _wait_state(driver, _pc, "freeze")
    assert frozen["context"].get("last_live_state") == "switching_project", (
        f"US-210 #2: froze from switching_project; got "
        f"{frozen['context'].get('last_live_state')!r}"
    )
    t.join(timeout=6.0)

    _thaw(driver)
    settled = _wait_state(driver, _pc, "project_selected")
    proj = settled["context"].get("project") or {}
    assert proj.get("id") == q3_id, (
        f"US-210 #2: must land in Q3 after thaw; got {proj!r}"
    )
    assert settled.get("correlation_id") == original_correlation, (
        f"US-210 #2: correlation preserved; "
        f"{settled.get('correlation_id')!r} != {original_correlation!r}"
    )


@pytest.mark.skip(reason="DELIVER-deferred to MR-6; FIFO replay + per-intent stale filter (DWD-7)")
@pytest.mark.boundary
def test_multiple_intents_queued_during_freeze_replay_serially_in_fifo_with_stale_drop(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """switching_project + session_clicked queued during FREEZE; THAW replays in FIFO;
    Q3 switch settles; Q4 session_clicked is stale-dropped with observability event;
    final state = session_list_loaded for Q3."""
    pytest.fail("not yet implemented")


@pytest.mark.error_path
@pytest.mark.boundary
def test_replay_buffer_timeout_transitions_to_error_recoverable(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """silent_reauth_failed; 5s timeout; orchestrator emits replay_abandoned;
    J-002 → error_recoverable carrying originating user-action for re-issue."""
    proj_id = _create_project("Q4 Analytics")
    session_id = _create_session(proj_id, "chat-9b2a")
    sc = _spawn_to_session_list(driver)
    original_correlation = sc.get("correlation_id")

    # Click → resume held → FREEZE catches resuming_session in flight.
    def _click() -> None:
        _post_event(
            driver, "session-chat", SC_FLOW_ID, "session_clicked",
            {"session_id": session_id},
            extra_headers={"X-Force-Slow-Resume": "3000"},
        )

    t = threading.Thread(target=_click, daemon=True)
    t.start()
    time.sleep(1.0)
    _freeze(driver)
    frozen = _wait_state(driver, _sc, "freeze")
    assert frozen["context"].get("last_live_state") == "resuming_session"
    t.join(timeout=6.0)

    # Silent re-auth FAILS → the 5s replay window lapses with no THAW →
    # the orchestrator emits replay_abandoned; J-002 freeze →
    # error_recoverable, originating user-action preserved for re-issue.
    _thaw(driver, reason="abandoned")
    err = _wait_state(driver, _sc, "error_recoverable")
    assert err["context"].get("underlying_cause_tag") == "replay_abandoned", (
        f"US-210 #4: cause must be replay_abandoned; "
        f"got {err['context'].get('underlying_cause_tag')!r}"
    )
    # The originating user-action (the session_clicked target) is preserved
    # on the machine context for re-issue (retry history target).
    assert err["context"].get("pending_resume_session_id") == session_id, (
        "US-210 #4: originating session_clicked must be preserved for re-issue"
    )
    assert err.get("correlation_id") == original_correlation, (
        "US-210 #4: original correlation reference preserved"
    )


@pytest.mark.happy_path
def test_freeze_during_session_welcome_preserves_welcome_view_no_flicker(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """session_welcome → freeze → THAW → session_welcome; no flicker."""
    _create_project("Q4 Analytics")
    _spawn_to_session_list(driver)
    _post_event(driver, "session-chat", SC_FLOW_ID, "new_session_clicked", {})
    welcome = _wait_state(driver, _sc, "session_welcome")
    # Welcome view shape: no session row, composer empty (chips visible).
    assert welcome["context"].get("session_id") is None

    # Token expires with NO J-002 mutation in flight.
    _freeze(driver)
    frozen = _wait_state(driver, _sc, "freeze")
    assert frozen["context"].get("last_live_state") == "session_welcome"
    # The welcome context is preserved underneath the banner (no flicker —
    # session_id stays null, nothing was created).
    assert frozen["context"].get("session_id") is None

    _thaw(driver)
    back = _wait_state(driver, _sc, "session_welcome")
    assert back["context"].get("session_id") is None, (
        "US-210 #5: welcome state must be intact after thaw (no ghost row)"
    )


@pytest.mark.skip(
    reason=(
        "DELIVER-deferred to MR-6 — PRAXIS F-4 deferred scenario. Per the system-"
        "designer review §3 F-4 and DD-4 in distill/wave-decisions.md: on THAW, "
        "dataset intents replay in FIFO order. If intent N passes the ScopeResolver "
        "I4 guard and intent N+1 fails (dataset deleted / cross-tenant), the project "
        "+ resource context for intent N persists — intent N+1 is silent-dropped "
        "with stale_intent_dropped_after_thaw."
    )
)
@pytest.mark.praxis_f4
@pytest.mark.boundary
@pytest.mark.property
def test_praxis_f4_concurrent_dataset_picks_during_freeze_fifo_replay_with_staleness_guard(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Praxis F-4: two `dataset_resolved_by_agent` intents queue during FREEZE.

    Intent N (valid) settles first; intent N+1 (cross-tenant / deleted) is
    silent-dropped with `stale_intent_dropped_after_thaw`. The session's
    `active_dataset_id` reflects intent N. Asserts:
      - FIFO replay order via the replay buffer's arrival ordering
      - intent N's scope persists in `active_scope.resource_*`
      - intent N+1 emits the observability event (NOT scope_mismatch_terminal)
      - `harness.j002.assert_stale_intent_dropped("dataset_resolved_by_agent", <bad-id>)` succeeds
    """
    pytest.fail("not yet implemented — Praxis F-4 deferred scenario")


@pytest.mark.skip(reason="DELIVER-deferred to MR-6; un-skip when harness.j002.freeze + thaw ship")
@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_drives_freeze_thaw_end_to_end(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """harness.j002.freeze() + thaw(); subsequent mutations queue; assert_no_stale_intents_dropped()."""
    pytest.fail("not yet implemented")
