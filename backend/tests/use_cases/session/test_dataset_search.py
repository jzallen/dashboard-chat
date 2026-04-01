"""Tests for dataset search within a project."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import RestrictedSession, set_session
from app.repositories.metadata import DatasetRecord, MetadataRepository
from tests.uuidv7_fixtures import DATASET_1, DATASET_2, PROJECT_1


class TestSearchDatasetsByName:
    async def test_single_match(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        # Add datasets to the project
        ds1 = DatasetRecord(
            id=DATASET_1,
            project_id=PROJECT_1,
            name="Patients",
            schema_config={"fields": {}},
        )
        ds2 = DatasetRecord(
            id=DATASET_2,
            project_id=PROJECT_1,
            name="Claims",
            schema_config={"fields": {}},
        )
        seeded_db.add(ds1)
        seeded_db.add(ds2)
        await seeded_db.commit()

        repo = MetadataRepository(RestrictedSession(seeded_db))
        results = await repo.search_datasets_by_name(PROJECT_1, "Patient")

        assert len(results) == 1
        assert results[0]["name"] == "Patients"

    async def test_multiple_matches(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        ds1 = DatasetRecord(
            id=DATASET_1,
            project_id=PROJECT_1,
            name="Patient Demographics",
            schema_config={"fields": {}},
        )
        ds2 = DatasetRecord(
            id=DATASET_2,
            project_id=PROJECT_1,
            name="Patient Claims",
            schema_config={"fields": {}},
        )
        seeded_db.add(ds1)
        seeded_db.add(ds2)
        await seeded_db.commit()

        repo = MetadataRepository(RestrictedSession(seeded_db))
        results = await repo.search_datasets_by_name(PROJECT_1, "Patient")

        assert len(results) == 2

    async def test_no_matches(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        ds1 = DatasetRecord(
            id=DATASET_1,
            project_id=PROJECT_1,
            name="Claims",
            schema_config={"fields": {}},
        )
        seeded_db.add(ds1)
        await seeded_db.commit()

        repo = MetadataRepository(RestrictedSession(seeded_db))
        results = await repo.search_datasets_by_name(PROJECT_1, "zzz_nonexistent")

        assert len(results) == 0

    async def test_case_insensitive(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        ds1 = DatasetRecord(
            id=DATASET_1,
            project_id=PROJECT_1,
            name="Patient Demographics",
            schema_config={"fields": {}},
        )
        seeded_db.add(ds1)
        await seeded_db.commit()

        repo = MetadataRepository(RestrictedSession(seeded_db))
        results = await repo.search_datasets_by_name(PROJECT_1, "patient")

        assert len(results) == 1
        assert results[0]["name"] == "Patient Demographics"
