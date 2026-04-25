"""Tests for sql_access._engine helper functions."""

from types import SimpleNamespace

import pytest

from app.use_cases.sql_access._engine import (
    ensure_engine_reachable,
    resolve_engine_node_by_id,
    resolve_engine_node_for_org,
)
from app.use_cases.sql_access._infra.provisioner import MockQueryEngineProvisioner
from app.use_cases.sql_access.exceptions import QueryEngineUnreachable


class _FakeQueryEngineNodeRepo:
    """Lightweight double for the query_engine_node repository.

    Supports both get_first_for_org (resolve_engine_node_for_org) and
    get_by_id (resolve_engine_node_by_id) so it can back tests for either
    helper. Pass `result=` for the get_first_for_org return value, or
    `node=` for the get_by_id return value (or both).
    """

    def __init__(self, result=None, node=None):
        self._result = result
        self._node = node
        self.calls: list[str] = []
        self.get_by_id_calls: list[str] = []

    async def get_first_for_org(self, org_id: str):
        self.calls.append(org_id)
        return self._result

    async def get_by_id(self, node_id: str):
        self.get_by_id_calls.append(node_id)
        return self._node


def _fake_repos(repo):
    return SimpleNamespace(query_engine_node=repo)


class TestEnsureEngineReachable:
    async def test_raises_query_engine_unreachable_when_provisioner_unhealthy(self):
        provisioner = MockQueryEngineProvisioner()
        provisioner.set_healthy(False)
        node = SimpleNamespace(id="engine-1")

        with pytest.raises(QueryEngineUnreachable) as exc_info:
            await ensure_engine_reachable(node, provisioner)

        assert "engine-1" in str(exc_info.value)
        assert provisioner.health_check_calls == ["engine-1"]

    async def test_returns_none_and_records_call_when_provisioner_healthy(self):
        provisioner = MockQueryEngineProvisioner()
        provisioner.set_healthy(True)
        node = SimpleNamespace(id="engine-2")

        result = await ensure_engine_reachable(node, provisioner)

        assert result is None
        assert provisioner.health_check_calls == ["engine-2"]


class TestResolveEngineNodeForOrg:
    async def test_raises_runtime_error_with_org_id_when_no_node(self):
        repo = _FakeQueryEngineNodeRepo(result=None)

        with pytest.raises(RuntimeError, match=r"org-1"):
            await resolve_engine_node_for_org("org-1", _fake_repos(repo))

        assert repo.calls == ["org-1"]

    async def test_returns_node_and_records_call_when_node_found(self):
        node = SimpleNamespace(id="engine-42")
        repo = _FakeQueryEngineNodeRepo(result=node)

        result = await resolve_engine_node_for_org("org-1", _fake_repos(repo))

        assert result is node
        assert repo.calls == ["org-1"]


class TestResolveEngineNodeById:
    async def test_returns_node_when_present_with_fallback_disabled(self):
        node = SimpleNamespace(id="engine-3", host="h", port=5432, database="db")
        fake_repo = _FakeQueryEngineNodeRepo(node=node)
        repos = SimpleNamespace(query_engine_node=fake_repo)

        result = await resolve_engine_node_by_id("engine-3", repos)

        assert result is node
        assert fake_repo.get_by_id_calls == ["engine-3"]

    async def test_raises_runtime_error_when_missing_with_fallback_disabled(self):
        fake_repo = _FakeQueryEngineNodeRepo(node=None)
        repos = SimpleNamespace(query_engine_node=fake_repo)

        with pytest.raises(RuntimeError) as exc_info:
            await resolve_engine_node_by_id("engine-missing", repos)

        assert "engine-missing" in str(exc_info.value)
        assert fake_repo.get_by_id_calls == ["engine-missing"]

    async def test_returns_node_when_present_with_fallback_enabled(self):
        node = SimpleNamespace(id="engine-4", host="h", port=5432, database="db")
        fake_repo = _FakeQueryEngineNodeRepo(node=node)
        repos = SimpleNamespace(query_engine_node=fake_repo)

        result = await resolve_engine_node_by_id("engine-4", repos, fallback_to_settings=True)

        assert result is node
        assert fake_repo.get_by_id_calls == ["engine-4"]

    async def test_returns_none_when_missing_with_fallback_enabled(self):
        fake_repo = _FakeQueryEngineNodeRepo(node=None)
        repos = SimpleNamespace(query_engine_node=fake_repo)

        result = await resolve_engine_node_by_id("engine-absent", repos, fallback_to_settings=True)

        assert result is None
        assert fake_repo.get_by_id_calls == ["engine-absent"]
