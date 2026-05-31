"""Tests for list_datasets_for_project use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.repositories import set_session
from app.repositories.metadata import ProjectRecord
from app.use_cases.dataset import list_datasets_for_project
from tests.uuidv7_fixtures import (
    DATASET_1,
    DATASET_2,
    ORG_1,
    ORG_OTHER,
    PROJECT_1,
    PROJECT_EMPTY,
    USER_3,
)

WRONG_ORG_USER = AuthUser(id=USER_3, email="other@example.com", org_id=ORG_OTHER, name="Other User")


class TestListDatasetsForProject:
    """Tests for list_datasets_for_project use case."""

    async def test_returns_sparse_dicts_without_transforms(self, seeded_db: AsyncSession):
        """Should return sparse dataset dicts (no transforms) in paginated result."""
        set_session(seeded_db)

        result = await list_datasets_for_project(project_id=PROJECT_1)

        match result:
            case Success(data):
                datasets = data["items"]
                assert len(datasets) == 2
                assert data["has_more"] is False
                # Verify sparse dict shape
                for ds in datasets:
                    assert "id" in ds
                    assert "name" in ds
                    assert "link" in ds
                    assert "description" in ds
                    assert "schema_config" in ds
                    assert "transforms" not in ds
                # Verify IDs
                ids = {ds["id"] for ds in datasets}
                assert ids == {DATASET_1, DATASET_2}
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_returns_empty_list_for_project_with_no_datasets(self, db_session: AsyncSession):
        """Should return empty items when project has no datasets."""
        set_session(db_session)

        project = ProjectRecord(id=PROJECT_EMPTY, name="Empty Project", org_id=ORG_1)
        db_session.add(project)
        await db_session.commit()

        result = await list_datasets_for_project(project_id=PROJECT_EMPTY)

        match result:
            case Success(data):
                assert data["items"] == []
                assert data["has_more"] is False
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_returns_failure_when_project_not_found(self, db_session: AsyncSession):
        """Should return Failure when project does not exist."""
        set_session(db_session)

        result = await list_datasets_for_project(project_id="nonexistent")

        match result:
            case Failure(error):
                assert "not found" in str(error).lower()
            case Success(_):
                pytest.fail("Expected failure for nonexistent project")

    # NOTE: org mismatch test removed — authorization moved to router layer (authorize_project_access)

    async def test_link_format_matches_api_convention(self, seeded_db: AsyncSession):
        """Sparse dicts should include correct link format."""
        set_session(seeded_db)

        result = await list_datasets_for_project(project_id=PROJECT_1)

        match result:
            case Success(data):
                for ds in data["items"]:
                    assert ds["link"] == f"/api/datasets/{ds['id']}"
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")


class TestListDatasetsForProjectColdStorageFilter:
    """MR-7 — the ``archived`` filter on the sparse projection (cold storage).

    Default excludes archived datasets; ``archived=True`` returns ONLY archived ones, and
    the sparse rows carry ``archived_at``/``retention_until`` (the cold-storage list reads
    them to render retired-at / retention-end / days-left). RED until DELIVER 07-01.
    """

    @staticmethod
    async def _archive(db: AsyncSession, dataset_id: str) -> None:
        from datetime import UTC, datetime, timedelta

        from sqlalchemy import select

        from app.repositories.metadata import DatasetRecord

        record = (await db.execute(select(DatasetRecord).where(DatasetRecord.id == dataset_id))).scalar_one()
        now = datetime.now(UTC)
        record.archived_at = now
        record.retention_until = now + timedelta(days=90)
        await db.commit()

    async def test_default_list_excludes_archived(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        await self._archive(seeded_db, DATASET_1)

        result = await list_datasets_for_project(project_id=PROJECT_1)

        match result:
            case Success(data):
                ids = {ds["id"] for ds in data["items"]}
                assert ids == {DATASET_2}, "default sparse list must exclude archived datasets"
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_archived_true_returns_only_archived_with_timestamps(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        await self._archive(seeded_db, DATASET_1)

        result = await list_datasets_for_project(project_id=PROJECT_1, archived=True)

        match result:
            case Success(data):
                items = data["items"]
                ids = {ds["id"] for ds in items}
                assert ids == {DATASET_1}, "archived=True must return only archived datasets"
                # The cold-storage list reads these to render retired-at / retention-end / days-left.
                assert items[0].get("archived_at") is not None
                assert items[0].get("retention_until") is not None
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")
