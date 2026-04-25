"""Characterization tests — Seam 7: Query Engine Fleet controller.

Pins the CURRENT observable behavior of the query-engine endpoints on
HTTPController (L502-527). These tests must remain green after extraction to
`query_engine_controller.py`.

No existing coverage in test_http_controller.py — everything here is new.

Special note: these endpoints are ORG-scoped (via `user.org_id`), not
project-scoped. They are the only endpoints that pass `user.org_id` directly
to the use case rather than forwarding the AuthUser itself.
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success

from app.controllers.http_controller import HTTPController
from app.use_cases.sql_access.exceptions import QueryEngineUnreachable


@dataclass
class _User:
    org_id: str = "org-1"
    id: str = "u-1"


@dataclass
class _Model:
    id: str
    name: str = "node"

    def serialize(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


# ---------------------------------------------------------------------------
# list_query_engines (L502-509) — non-paginating list
# ---------------------------------------------------------------------------


class TestListQueryEnginesCharacterization:
    @patch("app.controllers.http_controller.query_engine_use_cases")
    async def test_success_returns_non_paginated_list(self, mock_uc):
        mock_uc.list_query_engines = AsyncMock(return_value=Success([_Model("qe1", "node-a"), _Model("qe2", "node-b")]))
        body, status = await HTTPController.list_query_engines(user=_User())
        assert status == 200
        assert len(body["data"]) == 2
        assert body["data"][0]["type"] == "query-engines"
        assert body["meta"]["page"] == {"size": 2, "has_more": False}
        assert body["links"]["self"].startswith("/api/query-engines")

    @patch("app.controllers.http_controller.query_engine_use_cases")
    async def test_forwards_org_id_not_whole_user(self, mock_uc):
        """L503: `query_engine_use_cases.list_query_engines(user.org_id)`.
        Only the org_id is passed, not the full user object. Pin this."""
        mock_uc.list_query_engines = AsyncMock(return_value=Success([]))
        await HTTPController.list_query_engines(user=_User(org_id="ORG-XYZ"))
        mock_uc.list_query_engines.assert_awaited_once_with("ORG-XYZ")

    @patch("app.controllers.http_controller.query_engine_use_cases")
    async def test_empty_fleet_returns_empty_list(self, mock_uc):
        mock_uc.list_query_engines = AsyncMock(return_value=Success([]))
        body, status = await HTTPController.list_query_engines(user=_User())
        assert status == 200
        assert body["data"] == []
        assert body["meta"]["page"]["size"] == 0


# ---------------------------------------------------------------------------
# get_query_engine (L511-518)
# ---------------------------------------------------------------------------


class TestGetQueryEngineCharacterization:
    @patch("app.controllers.http_controller.query_engine_use_cases")
    async def test_success_returns_200_with_envelope(self, mock_uc):
        mock_uc.get_query_engine = AsyncMock(return_value=Success({"id": "qe-1", "host": "db.example.com"}))
        body, status = await HTTPController.get_query_engine("qe-1", user=_User())
        assert status == 200
        assert body["data"]["type"] == "query-engines"
        assert body["data"]["id"] == "qe-1"
        assert body["links"]["self"] == "/api/query-engines/qe-1"

    @patch("app.controllers.http_controller.query_engine_use_cases")
    async def test_forwards_node_id_and_org_id(self, mock_uc):
        mock_uc.get_query_engine = AsyncMock(return_value=Success({"id": "qe-1"}))
        await HTTPController.get_query_engine("qe-1", user=_User(org_id="ORG-XYZ"))
        mock_uc.get_query_engine.assert_awaited_once_with("qe-1", "ORG-XYZ")

    @patch("app.controllers.http_controller.query_engine_use_cases")
    async def test_failure_returns_502(self, mock_uc):
        mock_uc.get_query_engine = AsyncMock(return_value=Failure(QueryEngineUnreachable("qe-1")))
        _, status = await HTTPController.get_query_engine("qe-1", user=_User())
        assert status == 502


# ---------------------------------------------------------------------------
# test_query_engine (L520-527)
# ---------------------------------------------------------------------------


class TestTestQueryEngineCharacterization:
    @patch("app.controllers.http_controller.query_engine_use_cases")
    async def test_success_returns_200_with_envelope(self, mock_uc):
        mock_uc.test_query_engine_connection = AsyncMock(return_value=Success({"id": "qe-1", "status": "healthy"}))
        body, status = await HTTPController.test_query_engine("qe-1", user=_User())
        assert status == 200
        assert body["data"]["type"] == "query-engines"
        assert body["data"]["id"] == "qe-1"
        assert body["links"]["self"] == "/api/query-engines/qe-1/test"

    @patch("app.controllers.http_controller.query_engine_use_cases")
    async def test_forwards_node_id_and_org_id(self, mock_uc):
        """L522: delegates to `test_query_engine_connection(node_id, user.org_id)`."""
        mock_uc.test_query_engine_connection = AsyncMock(return_value=Success({"id": "qe-1"}))
        await HTTPController.test_query_engine("qe-1", user=_User(org_id="ORG-XYZ"))
        mock_uc.test_query_engine_connection.assert_awaited_once_with("qe-1", "ORG-XYZ")

    @patch("app.controllers.http_controller.query_engine_use_cases")
    async def test_unreachable_returns_502(self, mock_uc):
        mock_uc.test_query_engine_connection = AsyncMock(return_value=Failure(QueryEngineUnreachable("qe-1")))
        _, status = await HTTPController.test_query_engine("qe-1", user=_User())
        assert status == 502
