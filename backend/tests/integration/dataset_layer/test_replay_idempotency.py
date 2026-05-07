"""G.2 — Replay + idempotency end-to-end test.

Verifies the cross-product invariant of Phase 1's C.2 (replay endpoint) and
C.3 (idempotency keys): under HTTP retry of a tool-call request, the
backend's ``Idempotency-Key`` layer prevents duplicate execution and the
session replay stream remains consistent — exactly one ``transform_applied``
event lands in replay for the (logically) one transform that was created.

Why this test exists
--------------------

Phase 1 shipped C.2 (``GET /api/sessions/{id}/events``) and C.3 (the
``Idempotency-Key`` middleware on ``POST/PATCH /api/datasets/{id}/transforms``)
independently. Each layer has its own unit/contract tests, but their
interaction — the most likely production bug pattern under retry — had zero
end-to-end coverage. This test closes that gap end-to-end through the
5-service compose stack (auth-proxy → backend → worker → query-engine →
MinIO, plus Redis for F.2's ``RedisSessionEventReader``).

What it asserts
---------------

1. Backend C.3 contract for ``POST /transforms``: re-POSTing with the same
   ``Idempotency-Key`` and identical body returns the cached response;
   re-POSTing with the same key but a different body returns 409.
2. The dataset's transform count is 1 after two retries — the second POST
   did NOT create a duplicate row in the metadata store.
3. Replay C.2 contract: a chat turn that exercises the cleaning dispatcher
   pushes exactly one ``transform_applied`` event into the Redis-backed
   session event stream, and ``GET /api/sessions/{id}/events`` returns it.
4. Cross-product invariant via ``DatasetLayerHarness.assert_exactly_once_via_replay``:
   given the agent-emitted ``transform_id``, the replay stream contains
   exactly one matching event. A retry-loop bug that double-emitted under
   redelivery would surface here.
5. Same shape for ``PATCH /transforms`` (the soft-delete / update entry
   point that stands in for ``DELETE /rows/{id}`` in the bead's mutation
   set — the literal ``/rows`` routes do not exist in the codebase; the
   PATCH router docstring already calls this out).

Architectural note: agent-side ``Idempotency-Key`` forwarding
-------------------------------------------------------------

The agent does not currently forward an ``Idempotency-Key`` header through
to the backend's transforms endpoint (verified by grep: zero matches across
``agent/`` and ``worker/``). So the "redelivery" this test exercises is at
the HTTP boundary — a client that retries the backend POST with the same
key. If a future bead wires ``Idempotency-Key`` through the agent's
``backendClient``, the same harness primitives will catch agent-side
double-emit regressions without code change here.

Skip semantics
--------------

The test inherits the dataset_layer fixtures: it skips when the auth-proxy,
agent, or backend is unreachable, when the dev-mode callback fails, or when
PAT issuance is not enabled. It additionally skips when the backend's
``SessionEventReader`` has not been wired to a real adapter — the noop
default returns empty pages and would yield false-green replay assertions.
"""

from __future__ import annotations

import asyncio
import os
import pathlib
import secrets
import socket
from urllib.parse import urlparse

import pytest

from .harness import DatasetLayerHarness

DEMO_CSV = pathlib.Path(__file__).parent / "fixtures" / "ecommerce-orders.csv"

# After turn_done, the agent's persister writes asynchronously. Give the
# Redis XADD a small grace window before reading via the replay endpoint —
# small enough that a wedged persister (the bug we want to catch) still
# fails the count assertion.
PERSISTENCE_GRACE_SECONDS = 0.5


# ---------------------------------------------------------------------------
# Real-adapter precheck
# ---------------------------------------------------------------------------


def _redis_reachable_for_backend() -> bool:
    """Best-effort check: is the backend wired to a non-noop SessionEventReader?

    The backend dispatch helper (``event_replay_dispatch.select_session_event_reader``)
    picks Redis if ``REDIS_URL`` is set, else noop. We can't introspect the
    backend's settings from here, so we look at the test runner's env —
    compose dev exports the same ``REDIS_URL`` to the backend service via
    docker-compose.yml. Fall through to True if we can reach the host:port
    (the test will surface a false positive as "no events in replay" rather
    than silently passing).
    """
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        return False
    parsed = urlparse(redis_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _redis_reachable_for_backend(),
    reason=(
        "G.2 requires a real SessionEventReader adapter (F.2 Redis). "
        "Set REDIS_URL (compose default: redis://redis:6379/0) or run "
        "`docker compose up -d` so the backend selects the Redis adapter."
    ),
)


# ---------------------------------------------------------------------------
# Test bodies
# ---------------------------------------------------------------------------


def _trim_region_body() -> dict:
    """The transform body the agent's cleaning dispatcher would post for
    ``trim`` on the ``region`` column. Mirrored here so a direct backend
    POST exercises the same C.3 surface as the agent path would."""
    return {
        "transforms": [
            {
                "name": "trim on region",
                "transform_type": "clean",
                "target_column": "region",
                "expression_config": {"operation": "trim"},
            }
        ]
    }


def _title_case_region_body() -> dict:
    """Distinct body sharing the target_column with ``_trim_region_body``,
    used to verify Idempotency-Key + body-mismatch → 409 Conflict.
    """
    return {
        "transforms": [
            {
                "name": "title case on region",
                "transform_type": "clean",
                "target_column": "region",
                "expression_config": {"operation": "case", "mode": "title"},
            }
        ]
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_post_transforms_idempotency_and_replay_exactly_once(
    dataset_layer_env: dict[str, str],
    dataset_layer_pat: str,
    dataset_layer_project: str,
) -> None:
    """POST /transforms x Idempotency-Key x replay — single end-to-end story.

    The story walks the four observable contracts in order:
      A. Direct backend retry honors the cached response (C.3).
      B. Mismatched body under the same key returns 409 (C.3).
      C. The metadata store contains exactly one transform after retries.
      D. A chat turn that fires the cleaning dispatcher persists exactly one
         ``transform_applied`` to the replay stream, observable through
         ``GET /api/sessions/{id}/events`` (C.2 + F.2 cross-check).
      E. ``assert_exactly_once_via_replay`` correlates the agent-emitted
         transform_id with a single replay event (C.2 x C.3 invariant).
    """
    if not DEMO_CSV.exists():
        pytest.skip(f"demo CSV fixture missing at {DEMO_CSV}")

    async with DatasetLayerHarness(
        auth_proxy_url=dataset_layer_env["auth_proxy_url"],
        agent_url=dataset_layer_env["agent_url"],
        user_jwt=dataset_layer_env["user_jwt"],
        project_id=dataset_layer_project,
        pat=dataset_layer_pat,
    ) as h:
        dataset_id = await h.upload_csv(DEMO_CSV)
        session = await h.create_session()
        session_id = session["id"]
        thread_id = session["stream_thread_id"]

        idem_key = f"g2-post-{secrets.token_hex(8)}"
        body = _trim_region_body()

        # --- A. Idempotent retry returns the cached response ---------------
        r1 = await h.post_transforms_direct(dataset_id, body, idempotency_key=idem_key)
        assert r1.status_code == 201, f"first POST not 201: {r1.status_code} {r1.text[:300]}"
        body_r1 = r1.json()

        r2 = await h.post_transforms_direct(dataset_id, body, idempotency_key=idem_key)
        assert r2.status_code == 201, f"idempotent retry not 201: {r2.status_code} {r2.text[:300]}"
        assert r2.json() == body_r1, (
            f"C.3 violation: idempotent retry returned a different body first={body_r1!r} second={r2.json()!r}"
        )

        # --- B. Same key, different body → 409 ----------------------------
        r3 = await h.post_transforms_direct(dataset_id, _title_case_region_body(), idempotency_key=idem_key)
        assert r3.status_code == 409, (
            "C.3 violation: same Idempotency-Key with mismatched body should be 409, "
            f"got {r3.status_code}: {r3.text[:300]}"
        )

        # --- C. Metadata store has exactly one transform (no duplicate) ---
        transforms_after_retries = await h.list_dataset_transforms(dataset_id)
        clean_on_region = [
            t
            for t in transforms_after_retries
            if t.get("target_column") == "region" and t.get("transform_type") == "clean"
        ]
        assert len(clean_on_region) == 1, (
            "C.3 violation: idempotent retries created a duplicate transform; "
            f"expected 1, got {len(clean_on_region)}: "
            f"{[(t.get('id'), t.get('name')) for t in clean_on_region]!r}"
        )

        # --- D. Drive a chat turn → agent emits transform_applied ---------
        # The agent's cleaning dispatcher posts to /transforms (without an
        # Idempotency-Key — this is the "first delivery") and emits a single
        # transform_applied event to the SSE stream + the persister.
        # Standardize on a different column (product_category) so this turn
        # is independent of the direct-POST work above.
        chat_trace = await h.chat_turn(
            "Trim whitespace on the customer_email column",
            dataset_id=dataset_id,
            thread_id=thread_id,
        )
        sse_applied = [e for e in chat_trace.of_type("transform_applied") if e.get("dataset_id") == dataset_id]
        assert sse_applied, (
            "chat turn did not emit transform_applied on the SSE stream; "
            f"saw event types: {[e.get('type') for e in chat_trace.events]!r}"
        )
        agent_transform_id = sse_applied[-1]["transform_id"]

        # --- E. Replay stream reflects exactly that one event -------------
        await asyncio.sleep(PERSISTENCE_GRACE_SECONDS)
        await h.assert_exactly_once_via_replay(
            session_id,
            idempotency_key=agent_transform_id,
            expected_event_type="transform_applied",
        )

        # Sanity: the stream truly contains the chat-emitted event by full
        # comparison too (defense against an `assert_exactly_once_via_replay`
        # that filters too aggressively and accidentally always matches one).
        events = await h.list_session_events(session_id)
        replay_applied = [e for e in events if e.get("type") == "transform_applied"]
        assert any(e.get("transform_id") == agent_transform_id for e in replay_applied), (
            f"agent-emitted transform_id {agent_transform_id!r} not present in replay; "
            f"saw transform_ids: {[e.get('transform_id') for e in replay_applied]!r}"
        )


@pytest.mark.asyncio
async def test_patch_transforms_idempotency_contract(
    dataset_layer_env: dict[str, str],
    dataset_layer_pat: str,
    dataset_layer_project: str,
) -> None:
    """PATCH /transforms x Idempotency-Key — the soft-delete / update arm.

    Per the bead, the same shape holds for ``DELETE /rows/{id}``; the
    codebase routes that mutation through PATCH /transforms with
    ``status='deleted'`` (the router docstring acknowledges this). The test
    creates a transform, then issues two PATCH retries with the same key
    and identical body, asserts the cached response, then issues a PATCH
    with a mismatched body under the same key and asserts 409.

    No replay assertion here: ``transform_undone`` is the corresponding
    domain event but is only emitted by the agent's worker dispatcher (not
    by direct backend PATCH), so the cross-product invariant for soft-delete
    via the agent is out of scope until the agent learns to forward
    Idempotency-Key. The C.3 backend contract is what's testable today.
    """
    if not DEMO_CSV.exists():
        pytest.skip(f"demo CSV fixture missing at {DEMO_CSV}")

    async with DatasetLayerHarness(
        auth_proxy_url=dataset_layer_env["auth_proxy_url"],
        agent_url=dataset_layer_env["agent_url"],
        user_jwt=dataset_layer_env["user_jwt"],
        project_id=dataset_layer_project,
        pat=dataset_layer_pat,
    ) as h:
        dataset_id = await h.upload_csv(DEMO_CSV)

        # Setup: a transform to soft-delete.
        create_body = _trim_region_body()
        create_res = await h.post_transforms_direct(dataset_id, create_body)
        assert create_res.status_code == 201
        existing = await h.list_dataset_transforms(dataset_id)
        target = next(
            (t for t in existing if t.get("target_column") == "region"),
            None,
        )
        assert target is not None and isinstance(target.get("id"), str), (
            f"could not locate the just-created transform in dataset listing: {existing!r}"
        )

        idem_key = f"g2-patch-{secrets.token_hex(8)}"
        patch_body = {
            "updates": [
                {"id": target["id"], "status": "deleted"},
            ]
        }

        r1 = await h.patch_transforms_direct(dataset_id, patch_body, idempotency_key=idem_key)
        assert r1.status_code == 200, f"first PATCH not 200: {r1.status_code} {r1.text[:300]}"
        body_r1 = r1.json()

        r2 = await h.patch_transforms_direct(dataset_id, patch_body, idempotency_key=idem_key)
        assert r2.status_code == 200
        assert r2.json() == body_r1, "C.3 violation: PATCH idempotent retry returned different body"

        mismatched = {
            "updates": [
                {"id": target["id"], "status": "disabled"},
            ]
        }
        r3 = await h.patch_transforms_direct(dataset_id, mismatched, idempotency_key=idem_key)
        assert r3.status_code == 409, (
            "C.3 violation: same Idempotency-Key with mismatched body on PATCH should be 409, "
            f"got {r3.status_code}: {r3.text[:300]}"
        )

        # The transform should be soft-deleted exactly once — the second
        # PATCH was cached, not re-applied. The backend's transform listing
        # excludes ``status='deleted'`` rows, so absence from the listing is
        # the success signal here.
        post_state = await h.list_dataset_transforms(dataset_id)
        target_after = next((t for t in post_state if t.get("id") == target["id"]), None)
        assert target_after is None, (
            f"transform should have been soft-deleted (absent from listing); still present: {target_after!r}"
        )
