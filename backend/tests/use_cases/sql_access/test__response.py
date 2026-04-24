"""Tests for the connection-response builder helper."""

from types import SimpleNamespace

import pytest

from app.use_cases.sql_access._response import build_connection_response


def _engine_node():
    """Build a minimal engine-node stub with the fields the helper reads."""
    return SimpleNamespace(
        host="query-engine",
        port=5432,
        database="dashboard_external",
    )


class TestBuildConnectionResponse:
    def test_core_fields_present_when_no_password(self):
        engine_node = _engine_node()

        response = build_connection_response(
            engine_node,
            schema="project_project_",
            username="proxy_project_",
        )

        assert response == {
            "host": "query-engine",
            "port": 5432,
            "database": "dashboard_external",
            "username": "proxy_project_",
            "schema": "project_project_",
        }
        assert "password" not in response
        assert "connection_string" not in response

    def test_password_includes_connection_string_with_expected_format(self):
        engine_node = _engine_node()

        response = build_connection_response(
            engine_node,
            schema="project_project_",
            username="proxy_project_",
            password="s3cr3t",
        )

        assert response["password"] == "s3cr3t"
        assert response["connection_string"] == (
            "postgresql://proxy_project_:s3cr3t@query-engine:5432/dashboard_external"
        )

    def test_omits_password_and_connection_string_when_password_none(self):
        engine_node = _engine_node()

        response = build_connection_response(
            engine_node,
            schema="project_project_",
            username="proxy_project_",
            password=None,
        )

        assert "password" not in response
        assert "connection_string" not in response

    def test_extras_merged_into_response(self):
        engine_node = _engine_node()

        response = build_connection_response(
            engine_node,
            schema="project_project_",
            username="proxy_project_",
            extras={"enabled": True, "engine_node_id": "engine-1"},
        )

        assert response["host"] == "query-engine"
        assert response["schema"] == "project_project_"
        assert response["enabled"] is True
        assert response["engine_node_id"] == "engine-1"

    def test_extras_none_is_noop(self):
        engine_node = _engine_node()

        response = build_connection_response(
            engine_node,
            schema="project_project_",
            username="proxy_project_",
            extras=None,
        )

        assert response == {
            "host": "query-engine",
            "port": 5432,
            "database": "dashboard_external",
            "username": "proxy_project_",
            "schema": "project_project_",
        }


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
