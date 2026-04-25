"""Tests for sql_access._engine helper functions."""

from types import SimpleNamespace

import pytest

from app.use_cases.sql_access._engine import ensure_engine_reachable, resolve_engine_node_for_org
from app.use_cases.sql_access._infra.provisioner import MockQueryEngineProvisioner
from app.use_cases.sql_access.exceptions import QueryEngineUnreachable


class _FakeQueryEngineNodeRepo:
    def __init__(self, result):
        self._result = result
        self.calls: list[str] = []

    async def get_first_for_org(self, org_id: str):
        self.calls.append(org_id)
        return self._result


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
