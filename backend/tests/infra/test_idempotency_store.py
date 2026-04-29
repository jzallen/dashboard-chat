"""Unit tests for IdempotencyStore (the (user, org, endpoint, key) -> response cache)."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.idempotency import IdempotencyKeyRecord, IdempotencyStore, hash_body


class TestIdempotencyStoreLookup:
    async def test_returns_none_when_key_not_seen(self, db_session: AsyncSession):
        store = IdempotencyStore(db_session)
        hit = await store.lookup(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /widgets",
            key="abc",
        )
        assert hit is None

    async def test_returns_cached_response_after_store(self, db_session: AsyncSession):
        store = IdempotencyStore(db_session)
        await store.store(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /widgets",
            key="abc",
            body_hash=hash_body(b'{"x":1}'),
            response_status=201,
            response_body={"data": {"id": "w-1"}},
        )

        hit = await store.lookup(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /widgets",
            key="abc",
        )
        assert hit is not None
        assert hit.status == 201
        assert hit.body == {"data": {"id": "w-1"}}
        assert hit.body_hash == hash_body(b'{"x":1}')

    async def test_lookup_is_scoped_by_endpoint(self, db_session: AsyncSession):
        store = IdempotencyStore(db_session)
        await store.store(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /widgets",
            key="abc",
            body_hash=hash_body(b"{}"),
            response_status=200,
            response_body={"data": []},
        )

        # Same key on a different endpoint → not a hit.
        hit = await store.lookup(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /gadgets",
            key="abc",
        )
        assert hit is None

    async def test_lookup_is_scoped_by_org(self, db_session: AsyncSession):
        store = IdempotencyStore(db_session)
        await store.store(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /widgets",
            key="abc",
            body_hash=hash_body(b"{}"),
            response_status=200,
            response_body={"data": []},
        )

        hit = await store.lookup(
            user_id="u-1",
            org_id="o-OTHER",
            endpoint="POST /widgets",
            key="abc",
        )
        assert hit is None

    async def test_returns_none_for_record_past_ttl(self, db_session: AsyncSession):
        # Insert a record with a fabricated old created_at, then look up with a 24h TTL.
        old = (datetime.now(UTC) - timedelta(hours=48)).replace(tzinfo=None)
        rec = IdempotencyKeyRecord(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /widgets",
            idempotency_key="abc",
            request_body_hash=hash_body(b"{}"),
            response_status=200,
            response_body={"ok": True},
            created_at=old,
        )
        db_session.add(rec)
        await db_session.commit()

        store = IdempotencyStore(db_session, ttl=timedelta(hours=24))
        hit = await store.lookup(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /widgets",
            key="abc",
        )
        assert hit is None


class TestIdempotencyStoreStore:
    async def test_store_swallows_unique_violation(self, db_session: AsyncSession):
        """Concurrent retry races are swallowed; the first writer's record wins."""
        store = IdempotencyStore(db_session)
        await store.store(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /widgets",
            key="abc",
            body_hash=hash_body(b"{}"),
            response_status=200,
            response_body={"first": True},
        )

        # A second store with the same scope must not raise.
        await store.store(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /widgets",
            key="abc",
            body_hash=hash_body(b"{}"),
            response_status=200,
            response_body={"second": True},
        )

        hit = await store.lookup(
            user_id="u-1",
            org_id="o-1",
            endpoint="POST /widgets",
            key="abc",
        )
        # First writer's body is preserved.
        assert hit is not None
        assert hit.body == {"first": True}


class TestHashBody:
    def test_hash_body_is_deterministic(self):
        assert hash_body(b'{"a":1}') == hash_body(b'{"a":1}')

    def test_hash_body_distinguishes_different_payloads(self):
        assert hash_body(b'{"a":1}') != hash_body(b'{"a":2}')
