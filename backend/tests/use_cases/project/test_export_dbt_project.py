"""Tests for export_dbt_project use case."""

import zipfile
from io import BytesIO

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import set_auth_user
from app.auth.types import AuthUser
from app.repositories import set_session
from app.repositories.metadata import DatasetRecord, ProjectRecord, TransformRecord
from app.use_cases.project import export_dbt_project
from tests.uuidv7_fixtures import (
    DATASET_EXPORT_1,
    ORG_1,
    ORG_OTHER,
    PROJECT_EXPORT_1,
    PROJECT_EXPORT_EMPTY,
    PROJECT_OTHER,
    TRANSFORM_EXPORT_1,
    USER_1,
)


@pytest.fixture
async def seeded_db_with_transforms(db_session: AsyncSession):
    """Seed DB with a project containing datasets and transforms."""
    project = ProjectRecord(
        id=PROJECT_EXPORT_1,
        name="Sales Pipeline",
        description="Export test project",
        org_id=ORG_1,
    )
    db_session.add(project)

    ds = DatasetRecord(
        id=DATASET_EXPORT_1,
        project_id=PROJECT_EXPORT_1,
        name="Leads",
        schema_config={"fields": {"name": {"type": "text"}, "status": {"type": "text"}}},
    )
    db_session.add(ds)

    transform = TransformRecord(
        id=TRANSFORM_EXPORT_1,
        dataset_id=DATASET_EXPORT_1,
        name="Trim name",
        condition_json={},
        transform_type="clean",
        target_column="name",
        expression_config={"operation": "trim"},
        status="enabled",
    )
    db_session.add(transform)

    await db_session.commit()
    return db_session


@pytest.fixture
async def seeded_db_empty_project(db_session: AsyncSession):
    """Seed DB with a project containing no datasets."""
    project = ProjectRecord(
        id=PROJECT_EXPORT_EMPTY,
        name="Empty Project",
        org_id=ORG_1,
    )
    db_session.add(project)
    await db_session.commit()
    return db_session


@pytest.fixture
async def seeded_db_other_org(db_session: AsyncSession):
    """Seed DB with a project owned by a different org."""
    project = ProjectRecord(
        id=PROJECT_OTHER,
        name="Other Org Project",
        org_id=ORG_OTHER,
    )
    db_session.add(project)
    await db_session.commit()
    return db_session


class TestExportDbtProject:
    async def test_export_when_project_has_datasets_returns_zip(self, seeded_db_with_transforms: AsyncSession):
        set_session(seeded_db_with_transforms)
        set_auth_user(AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User"))

        result = await export_dbt_project(PROJECT_EXPORT_1)

        match result:
            case Success(data):
                zip_bytes, project_name = data
                assert project_name == "sales_pipeline"
                assert isinstance(zip_bytes, bytes)

                # Verify it's a valid zip
                zf = zipfile.ZipFile(BytesIO(zip_bytes))
                names = set(zf.namelist())
                assert "dbt_project.yml" in names
                assert "profiles.yml" in names
                assert "models/staging/stg_leads.sql" in names

                # Verify SQL contains transforms
                sql = zf.read("models/staging/stg_leads.sql").decode("utf-8")
                assert "TRIM(name)" in sql
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_export_when_project_not_found_returns_failure(self, seeded_db_with_transforms: AsyncSession):
        set_session(seeded_db_with_transforms)

        result = await export_dbt_project("nonexistent-project")

        match result:
            case Failure(error):
                assert "not found" in str(error).lower()
            case Success(_):
                pytest.fail("Expected failure for nonexistent project")

    # NOTE: org mismatch test removed — authorization moved to router layer (authorize_project_access)

    async def test_export_when_no_datasets_returns_skeleton_zip(self, seeded_db_empty_project: AsyncSession):
        set_session(seeded_db_empty_project)
        set_auth_user(AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User"))

        result = await export_dbt_project(PROJECT_EXPORT_EMPTY)

        match result:
            case Success(data):
                zip_bytes, project_name = data
                assert project_name == "empty_project"

                zf = zipfile.ZipFile(BytesIO(zip_bytes))
                names = set(zf.namelist())
                assert "dbt_project.yml" in names
                assert "profiles.yml" in names
                # No staging SQL files
                stg_files = [n for n in names if n.startswith("models/staging/stg_")]
                assert stg_files == []
            case Failure(error):
                pytest.fail(f"Expected success for empty project, got: {error}")
