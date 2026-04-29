"""Tests for idempotent_request — the four bead-mandated invariants.

Each test drives the middleware function directly with a synthesized
Starlette Request so we cover the wrapper logic without lighting up the
full ASGI stack.
"""

import json

from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.auth.types import AuthUser
from app.infra.idempotency import idempotent_request


def _build_request(*, body: bytes, headers: dict[str, str] | None = None) -> Request:
    """Construct a minimal POST request that idempotent_request can read."""
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/test",
        "headers": raw_headers,
        "query_string": b"",
    }
    chunks = [body, b""]

    async def receive():
        if chunks:
            data = chunks.pop(0)
            return {
                "type": "http.request",
                "body": data,
                "more_body": bool(chunks),
            }
        return {"type": "http.disconnect"}

    return Request(scope, receive=receive)


def _user(user_id: str = "u-1", org_id: str = "o-1") -> AuthUser:
    return AuthUser(id=user_id, email=f"{user_id}@test", org_id=org_id)


class _Counter:
    def __init__(self, body: dict, status: int = 201):
        self.calls = 0
        self.body = body
        self.status = status

    async def __call__(self) -> tuple[dict, int]:
        self.calls += 1
        return self.body, self.status


def _decode(response) -> dict:
    return json.loads(response.body.decode())


class TestIdempotentRequestInvariants:
    """Mirrors the four invariants in dc-x3y.3.3."""

    async def test_invariant_1_same_key_same_body_returns_cached_response(self, db_session: AsyncSession):
        """Two POSTs with same Idempotency-Key and identical body → handler runs once."""
        body = b'{"name":"alpha"}'
        handler = _Counter({"data": {"id": "tx-1"}}, status=201)

        first = await idempotent_request(
            request=_build_request(body=body, headers={"Idempotency-Key": "k-1"}),
            db=db_session,
            user=_user(),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler,
        )

        second = await idempotent_request(
            request=_build_request(body=body, headers={"Idempotency-Key": "k-1"}),
            db=db_session,
            user=_user(),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler,
        )

        assert handler.calls == 1, "handler must run only once across retries"
        assert first.status_code == 201
        assert second.status_code == 201
        assert _decode(first) == _decode(second) == {"data": {"id": "tx-1"}}

    async def test_invariant_2_same_key_different_body_returns_409(self, db_session: AsyncSession):
        """Same key with mismatched body hash → 409 Conflict on the second call."""
        handler = _Counter({"data": {"id": "tx-2"}}, status=201)

        first = await idempotent_request(
            request=_build_request(body=b'{"name":"first"}', headers={"Idempotency-Key": "k-2"}),
            db=db_session,
            user=_user(),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler,
        )
        assert first.status_code == 201

        second = await idempotent_request(
            request=_build_request(body=b'{"name":"second"}', headers={"Idempotency-Key": "k-2"}),
            db=db_session,
            user=_user(),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler,
        )

        assert handler.calls == 1, "handler must NOT re-run on body mismatch"
        assert second.status_code == 409
        body = _decode(second)
        assert body["errors"][0]["title"] == "Idempotency Key Conflict"

    async def test_invariant_3_no_key_header_processes_normally(self, db_session: AsyncSession):
        """Missing Idempotency-Key header → handler runs every time, no caching."""
        handler = _Counter({"data": {"id": "tx-3"}}, status=201)

        first = await idempotent_request(
            request=_build_request(body=b'{"x":1}'),
            db=db_session,
            user=_user(),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler,
        )
        second = await idempotent_request(
            request=_build_request(body=b'{"x":1}'),
            db=db_session,
            user=_user(),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler,
        )

        assert handler.calls == 2, "handler must run on each request when no key is present"
        assert first.status_code == 201
        assert second.status_code == 201

    async def test_invariant_4_same_key_different_endpoint_is_independent(self, db_session: AsyncSession):
        """Reusing the same key on a different endpoint → separate cache entries."""
        handler_a = _Counter({"data": {"id": "tx-A"}}, status=201)
        handler_b = _Counter({"data": {"id": "tx-B"}}, status=201)

        await idempotent_request(
            request=_build_request(body=b"{}", headers={"Idempotency-Key": "shared"}),
            db=db_session,
            user=_user(),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler_a,
        )
        await idempotent_request(
            request=_build_request(body=b"{}", headers={"Idempotency-Key": "shared"}),
            db=db_session,
            user=_user(),
            endpoint_id="PATCH /api/datasets/{dataset_id}/transforms",
            handler=handler_b,
        )

        assert handler_a.calls == 1
        assert handler_b.calls == 1, "different endpoint with same key must run handler"


class TestIdempotentRequestNonCachingPaths:
    async def test_handler_failure_status_is_not_cached(self, db_session: AsyncSession):
        """A non-2xx response must not poison the cache; the next retry runs again."""
        handler = _Counter({"errors": [{"status": "500"}]}, status=500)

        await idempotent_request(
            request=_build_request(body=b"{}", headers={"Idempotency-Key": "k-fail"}),
            db=db_session,
            user=_user(),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler,
        )
        await idempotent_request(
            request=_build_request(body=b"{}", headers={"Idempotency-Key": "k-fail"}),
            db=db_session,
            user=_user(),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler,
        )

        assert handler.calls == 2, "5xx responses must not be cached"

    async def test_user_without_org_skips_caching(self, db_session: AsyncSession):
        """Org-less requests fall through to the no-cache path."""
        handler = _Counter({"data": {"id": "tx-no-org"}}, status=201)

        await idempotent_request(
            request=_build_request(body=b"{}", headers={"Idempotency-Key": "k-no-org"}),
            db=db_session,
            user=AuthUser(id="u-1", email="x@y", org_id=None),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler,
        )
        await idempotent_request(
            request=_build_request(body=b"{}", headers={"Idempotency-Key": "k-no-org"}),
            db=db_session,
            user=AuthUser(id="u-1", email="x@y", org_id=None),
            endpoint_id="POST /api/datasets/{dataset_id}/transforms",
            handler=handler,
        )

        assert handler.calls == 2
