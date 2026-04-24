"""Tests for sql_access._engine helper functions."""

from types import SimpleNamespace

import pytest

from app.use_cases.sql_access._engine import ensure_engine_reachable
from app.use_cases.sql_access._infra.provisioner import MockQueryEngineProvisioner
from app.use_cases.sql_access.exceptions import QueryEngineUnreachable


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
