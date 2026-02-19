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


@pytest.fixture
async def seeded_db_with_transforms(db_session: AsyncSession):
    """Seed DB with a project containing datasets and transforms."""
    project = ProjectRecord(
        id="proj-export-1",
        name="Sales Pipeline",
        description="Export test project",
        org_id="test-org-001",
    )
    db_session.add(project)

    ds = DatasetRecord(
        id="ds-export-1",
        storage_path="datasets/proj-export-1/ds-export-1/",
        project_id="proj-export-1",
        name="Leads",
        schema_config={"fields": {"name": {"type": "text"}, "status": {"type": "text"}}},
    )
    db_session.add(ds)

    transform = TransformRecord(
        id="t-export-1",
        dataset_id="ds-export-1",
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
        id="proj-export-empty",
        name="Empty Project",
        org_id="test-org-001",
    )
    db_session.add(project)
    await db_session.commit()
    return db_session


@pytest.fixture
async def seeded_db_other_org(db_session: AsyncSession):
    """Seed DB with a project owned by a different org."""
    project = ProjectRecord(
        id="proj-other-org",
        name="Other Org Project",
        org_id="other-org-999",
    )
    db_session.add(project)
    await db_session.commit()
    return db_session


class TestExportDbtProject:

    async def test_successful_export_returns_zip_and_project_name(
        self, seeded_db_with_transforms: AsyncSession
    ):
        set_session(seeded_db_with_transforms)
        set_auth_user(AuthUser(id="test-user-001", email="test@example.com", org_id="test-org-001", name="Test User"))

        result = await export_dbt_project("proj-export-1")

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

    async def test_missing_project_returns_failure(
        self, seeded_db_with_transforms: AsyncSession
    ):
        set_session(seeded_db_with_transforms)

        result = await export_dbt_project("nonexistent-project")

        match result:
            case Failure(error):
                assert "not found" in str(error).lower()
            case Success(_):
                pytest.fail("Expected failure for nonexistent project")

    async def test_wrong_org_returns_failure(
        self, seeded_db_other_org: AsyncSession
    ):
        set_session(seeded_db_other_org)
        # Auth user is test-org-001, but project is other-org-999
        set_auth_user(AuthUser(id="user-1", email="a@b.com", org_id="test-org-001", name="Test"))

        result = await export_dbt_project("proj-other-org")

        match result:
            case Failure(error):
                assert "access denied" in str(error).lower()
            case Success(_):
                pytest.fail("Expected failure for wrong org_id")

    async def test_empty_project_returns_valid_zip(
        self, seeded_db_empty_project: AsyncSession
    ):
        set_session(seeded_db_empty_project)
        set_auth_user(AuthUser(id="test-user-001", email="test@example.com", org_id="test-org-001", name="Test User"))

        result = await export_dbt_project("proj-export-empty")

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
