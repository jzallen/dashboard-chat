"""Tests for sql_access._engine helper functions."""

import dataclasses
from types import SimpleNamespace

import pytest

from app.use_cases.sql_access._engine import (
    build_project_environment,
    ensure_engine_reachable,
    resolve_engine_node_by_id,
    resolve_engine_node_for_org,
)
from app.use_cases.sql_access._infra.provisioner import (
    MockQueryEngineProvisioner,
    ProjectEnvironment,
)
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


class TestBuildProjectEnvironment:
    def test_maps_engine_node_fields_and_admin_password_to_project_environment(self):
        engine_node = SimpleNamespace(
            id="engine-7",
            host="db.internal",
            port=5433,
            database="dashboard_external",
            admin_user="dashboard_admin",
        )

        result = build_project_environment(engine_node, "supersecret")

        assert result.environment_id == "engine-7"
        assert result.host == "db.internal"
        assert result.port == 5433
        assert result.database == "dashboard_external"
        assert result.admin_user == "dashboard_admin"
        assert result.admin_password == "supersecret"

    def test_returns_project_environment_dataclass_with_default_optional_fields(self):
        engine_node = SimpleNamespace(
            id="engine-8",
            host="h",
            port=5432,
            database="db",
            admin_user="admin",
        )

        result = build_project_environment(engine_node, "pw")

        assert isinstance(result, ProjectEnvironment)
        assert dataclasses.is_dataclass(result)
        assert result.internal_host == ""
        assert result.internal_port == 5432
        assert result.proxy_container_id == ""

    def test_admin_password_is_independent_of_engine_node(self):
        engine_node = SimpleNamespace(
            id="engine-9",
            host="h",
            port=5432,
            database="db",
            admin_user="admin",
        )

        first = build_project_environment(engine_node, "pw-one")
        second = build_project_environment(engine_node, "pw-two")

        assert first.admin_password == "pw-one"
        assert second.admin_password == "pw-two"
        assert first.environment_id == second.environment_id == "engine-9"
        assert first.host == second.host
        assert first.port == second.port
        assert first.database == second.database
        assert first.admin_user == second.admin_user
