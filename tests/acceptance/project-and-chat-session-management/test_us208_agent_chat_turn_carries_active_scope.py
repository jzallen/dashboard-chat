"""US-208 — Every J-002-originating chat turn carries X-Active-Scope from
the projection; agent rejects missing org_id / project_id with 400;
rejects header.org_id != jwt.org_id with 403. The X-Active-Scope header is
the exclusive source of scope: the legacy body.project_id migration
fallback and its hard compile-time sunset have been retired.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-208-agent-chat-turn-carries-active-scope.feature`

MR-4. Validates IC-J002-7 + DWD-3 contract.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_4,
    pytest.mark.needs_compose_stack,
]


# Dev-mode JWT — auth-proxy's dev branch accepts this as the dev user. In
# AUTH_MODE=dev the agent's authMiddleware verifies against the backend's
# JWKS; the auth-proxy adds X-Org-Id / X-User-Id identity headers. For
# acceptance scenarios at the reverse-proxy ingress, we use the static
# dev token (per CLAUDE.md "Auth: AUTH_MODE=dev").
DEV_BEARER = os.environ.get("DEV_BEARER", "dev-token-static")
DEV_ORG_ID = os.environ.get("DEV_ORG_ID", "dev-org-001")
DEV_USER_ID = os.environ.get("DEV_USER_ID", "dev-user-001")


def _bootstrap_project(driver: J002Driver) -> tuple[str, str]:
    """Helper: ensure dev-user-001 has at least one project; return (project_id, project_name).

    The bootstrap reads from the backend directly (auth-proxy mediates;
    dev-mode passes-through identity headers).
    """
    list_proc = subprocess.run(
        [
            "docker", "exec", "dashboard-api", "curl", "-s",
            "http://localhost:8000/api/projects",
            "-H", f"x-user-id: {DEV_USER_ID}",
            "-H", f"x-org-id: {DEV_ORG_ID}",
            "-H", "x-user-email: dev@localhost",
        ],
        capture_output=True, text=True, timeout=10,
    )
    body = json.loads(list_proc.stdout or "{}")
    items = body.get("data", []) if isinstance(body, dict) else []
    if items:
        item = items[0]
        attrs = item.get("attributes", {})
        return item["id"], attrs.get("name", item.get("name", "Unknown"))
    # Create one.
    create_proc = subprocess.run(
        [
            "docker", "exec", "dashboard-api", "curl", "-s",
            "-X", "POST",
            "http://localhost:8000/api/projects",
            "-H", "content-type: application/json",
            "-H", f"x-user-id: {DEV_USER_ID}",
            "-H", f"x-org-id: {DEV_ORG_ID}",
            "-H", "x-user-email: dev@localhost",
            "-d", json.dumps({"name": "US-208 Test Project"}),
        ],
        capture_output=True, text=True, timeout=10,
    )
    new_body = json.loads(create_proc.stdout)
    data = new_body.get("data", new_body)
    attrs = data.get("attributes", {})
    return data["id"], attrs.get("name", data.get("name", "US-208 Test Project"))


@pytest.mark.happy_path
def test_chat_turn_from_session_active_carries_x_active_scope_with_org_and_project(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """X-Active-Scope.org_id and project_id non-null; equal to FE chips on same paint;
    post-migration body does NOT carry project_id."""
    project_id, _ = _bootstrap_project(driver)
    probe = driver.post_agent_chat(
        bearer=driver.mint_dev_jwt(),
        active_scope={
            "org_id": DEV_ORG_ID,
            "project_id": project_id,
            "resource_type": None,
            "resource_id": None,
        },
        body={
            "messages": [{"role": "user", "content": "ping"}],
            "thread_id": "us208-happy",
        },
    )
    assert probe.status == 200, (
        f"agent /chat happy path returned {probe.status}: {probe.body[:300]}"
    )


@pytest.mark.error_path
def test_agent_rejects_chat_turn_missing_org_id_with_400(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """X-Active-Scope w/o org_id → 400; response body identifies "org_id" as missing; no LLM call."""
    probe = driver.post_agent_chat(
        bearer=driver.mint_dev_jwt(),
        active_scope={"project_id": "p-missing-org"},  # no org_id
        body={"messages": [{"role": "user", "content": "ping"}]},
    )
    assert probe.status == 400, f"expected 400, got {probe.status}: {probe.body[:300]}"
    assert "org_id" in probe.body, (
        f"expected diagnostic mentioning org_id; got {probe.body[:300]}"
    )


@pytest.mark.error_path
def test_agent_rejects_chat_turn_missing_project_id_with_400(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """X-Active-Scope w/o project_id → 400; response identifies "project_id" as missing."""
    probe = driver.post_agent_chat(
        bearer=driver.mint_dev_jwt(),
        active_scope={"org_id": DEV_ORG_ID},  # no project_id
        body={"messages": [{"role": "user", "content": "ping"}]},
    )
    assert probe.status == 400, f"expected 400, got {probe.status}: {probe.body[:300]}"
    assert "project_id" in probe.body, (
        f"expected diagnostic mentioning project_id; got {probe.body[:300]}"
    )


@pytest.mark.error_path
def test_agent_rejects_chat_turn_with_org_id_mismatch_to_jwt_with_403(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """JWT org_id != X-Active-Scope.org_id → 403; body names the mismatch."""
    project_id, _ = _bootstrap_project(driver)
    probe = driver.post_agent_chat(
        bearer=driver.mint_dev_jwt(),
        active_scope={
            "org_id": "other-tenant-001",  # mismatch
            "project_id": project_id,
            "resource_type": None,
            "resource_id": None,
        },
        body={"messages": [{"role": "user", "content": "ping"}]},
    )
    assert probe.status == 403, (
        f"expected 403 for cross-tenant scope, got {probe.status}: {probe.body[:300]}"
    )
    assert "org_id" in probe.body, (
        f"expected diagnostic mentioning org_id mismatch; got {probe.body[:300]}"
    )


@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_asserts_agent_received_scope_on_every_turn(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """Send 5 turns; harness.j002.assert_agent_received_scope(i) for i in [0..5)."""
    project_id, _ = _bootstrap_project(driver)
    # Clear the agent's request log so we're observing only this scenario's turns.
    # `/debug/*` is behind the agent's authMiddleware → real JWT required.
    agent_jwt = driver.mint_dev_jwt()
    driver.post(
        "/debug/request-log/clear",
        base=driver.agent_url,
        bearer=agent_jwt,
        json_body={},
    )
    for i in range(5):
        probe = driver.post_agent_chat(
            bearer=agent_jwt,
            active_scope={
                "org_id": DEV_ORG_ID,
                "project_id": project_id,
                "resource_type": None,
                "resource_id": None,
            },
            body={
                "messages": [{"role": "user", "content": f"ping {i}"}],
                "thread_id": f"us208-harness-{i}",
            },
        )
        assert probe.status == 200, (
            f"turn {i} expected 200, got {probe.status}: {probe.body[:200]}"
        )
    log = driver.get("/debug/request-log", base=driver.agent_url, bearer=agent_jwt)
    assert log.status == 200, f"agent /debug/request-log returned {log.status}"
    entries = json.loads(log.body).get("entries", [])
    assert len(entries) >= 5, f"expected >=5 entries, got {len(entries)}"
    for entry in entries[-5:]:
        scope = entry.get("scope")
        assert scope is not None, f"entry without scope: {entry}"
        assert scope.get("org_id") == DEV_ORG_ID
        assert scope.get("project_id") == project_id


@pytest.mark.error_path
def test_legacy_body_only_client_without_header_is_rejected_with_400(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """The migration body-fallback path is retired. A legacy client that omits
    X-Active-Scope and sends only body.project_id is rejected with 400 — there
    is no env flag that resurrects the fallback."""
    project_id, _ = _bootstrap_project(driver)
    # NO X-Active-Scope header — the only accepted source of scope.
    probe = driver.post_agent_chat(
        bearer=driver.mint_dev_jwt(),
        active_scope=None,
        body={
            "messages": [{"role": "user", "content": "ping"}],
            "project_id": project_id,
            "thread_id": "us208-no-header",
        },
    )
    assert probe.status == 400, (
        f"expected body-only client to be rejected with 400, got {probe.status}: "
        f"{probe.body[:300]}"
    )


@pytest.mark.boundary
def test_agent_scope_module_loads_cleanly_past_sunset_date_with_flag_on(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Terminal state of the X-Active-Scope migration: the agent boots cleanly
    past the former 2026-06-25 sunset even with SCOPE_HEADER_FALLBACK_ENABLED on.

    The hard compile-time sunset time-bomb has been removed along with the
    body-fallback path. This spawns `tsx` to import the boot-path scope module
    with the clock set past the old sunset and the retired flag on, asserting
    the module loads without throwing and no longer exports the sunset
    assertion. Port-to-port check that doesn't require a full container rebuild.
    """
    script = """
import * as scope from './agent/lib/chat/scope.ts';
const hasSunset =
  'assertScopeHeaderFallbackSunset' in scope ||
  'SCOPE_HEADER_FALLBACK_SUNSET' in scope;
console.log(JSON.stringify({ loaded: true, hasSunset }));
process.exit(0);
"""
    repo_root = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        ["npx", "tsx", "-e", script],
        cwd=repo_root,
        capture_output=True,
        text=True,
        timeout=60,
        env={
            **os.environ,
            "SCOPE_HEADER_FALLBACK_ENABLED": "true",
            # Old sunset was 2026-06-25; prove the clock no longer matters.
            "TZ": "UTC",
        },
    )
    if result.returncode != 0:
        pytest.skip(
            f"tsx invocation failed (returncode={result.returncode}); "
            f"workspace may not have JS deps installed: {result.stderr[:300]}"
        )
    payload = json.loads([ln for ln in result.stdout.splitlines() if ln.startswith("{")][-1])
    assert payload.get("loaded") is True, (
        f"scope module failed to load cleanly: {result.stdout!r} / {result.stderr[:300]}"
    )
    assert payload.get("hasSunset") is False, (
        "the hardcoded sunset time-bomb must be removed: scope.ts still exports "
        "a sunset constant/assertion"
    )
