"""Tests for the ToolCallController — the JSON:API list backing ``getAudit``.

Exercises the controller through the REAL use case + DB (port-to-port): seed a
``tool_call_records`` row and assert the controller emits a JSON:API list whose
item attributes carry ``tool``/``say``/``tag`` (from the JSON payload) plus
``node_id``/``node_kind`` and the joined ``transform_id``/``enabled``.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController
from app.repositories import set_session
from app.repositories.metadata import (
    DatasetRecord,
    ProjectRecord,
    ToolCallRecord,
    TransformRecord,
)
from tests.uuidv7_fixtures import (
    DATASET_1,
    ORG_1,
    PROJECT_1,
    TOOL_CALL_1,
    TRANSFORM_1,
)


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    set_session(db_session)
    db_session.add(ProjectRecord(id=PROJECT_1, name="P", org_id=ORG_1))
    db_session.add(DatasetRecord(id=DATASET_1, project_id=PROJECT_1, name="D", schema_config={"fields": {}}))
    await db_session.commit()
    return db_session


class TestToolCallControllerList:
    async def test_returns_jsonapi_list_with_payload_attributes(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        seeded_db.add(
            ToolCallRecord(
                id=TOOL_CALL_1,
                org_id=ORG_1,
                project_id=PROJECT_1,
                node_id=DATASET_1,
                node_kind="dataset",
                payload={"tool": "trimWhitespace", "say": "Trimmed whitespace on email", "tag": "clean"},
                sequence=0,
            )
        )
        seeded_db.add(
            TransformRecord(
                id=TRANSFORM_1,
                dataset_id=DATASET_1,
                name="trim",
                condition_json={},
                status="enabled",
                tool_call_id=TOOL_CALL_1,
            )
        )
        await seeded_db.commit()

        body, status = await HTTPController.list_tool_calls(PROJECT_1, org_id=ORG_1)

        assert status == 200
        assert len(body["data"]) == 1
        item = body["data"][0]
        assert item["type"] == "tool-calls"
        assert item["id"] == TOOL_CALL_1
        attrs = item["attributes"]
        assert attrs["node_id"] == DATASET_1
        assert attrs["node_kind"] == "dataset"
        assert attrs["tool"] == "trimWhitespace"
        assert attrs["say"] == "Trimmed whitespace on email"
        assert attrs["tag"] == "clean"
        assert attrs["transform_id"] == TRANSFORM_1
        assert attrs["enabled"] is True
        assert "/api/projects/" in body["links"]["self"]

    async def test_empty_list_when_no_records(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        body, status = await HTTPController.list_tool_calls(PROJECT_1, org_id=ORG_1)

        assert status == 200
        assert body["data"] == []

    async def test_cross_org_access_is_not_found(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        _body, status = await HTTPController.list_tool_calls(PROJECT_1, org_id="some-other-org")

        assert status == 404
