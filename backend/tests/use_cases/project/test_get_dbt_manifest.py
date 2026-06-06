"""Tests for the get_dbt_manifest read use case (DBTProjectDetails)."""

import zipfile
from io import BytesIO

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import set_auth_user
from app.auth.types import AuthUser
from app.repositories import set_session
from app.repositories.metadata import DatasetRecord, ProjectRecord, TransformRecord
from app.use_cases.project import export_dbt_project, get_dbt_manifest
from tests.uuidv7_fixtures import (
    DATASET_EXPORT_1,
    ORG_1,
    PROJECT_EXPORT_1,
    TRANSFORM_EXPORT_1,
    USER_1,
)


@pytest.fixture
async def seeded_db_with_transforms(db_session: AsyncSession):
    """Seed DB with a project containing a dataset + transform (mirrors export test)."""
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


class TestGetDbtManifest:
    async def test_returns_dbt_project_details_shape(self, seeded_db_with_transforms: AsyncSession):
        set_session(seeded_db_with_transforms)
        set_auth_user(AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User"))

        result = await get_dbt_manifest(PROJECT_EXPORT_1)

        match result:
            case Success(manifest):
                assert manifest["id"] == PROJECT_EXPORT_1
                assert manifest["project_name"] == "sales_pipeline"
                # files carry {path, layer, ref?}
                staging = next(f for f in manifest["files"] if f["path"] == "models/staging/stg_leads.sql")
                assert staging["layer"] == "staging"
                assert staging["ref"] == "stg_leads"
                config = next(f for f in manifest["files"] if f["path"] == "dbt_project.yml")
                assert config["layer"] == "config"
                # layer_counts aggregates the file list
                assert manifest["layer_counts"]["staging"] == 1
                assert manifest["layer_counts"]["config"] == sum(1 for f in manifest["files"] if f["layer"] == "config")
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_manifest_files_match_zip_contents(self, seeded_db_with_transforms: AsyncSession):
        """The manifest's file list equals the zip's actual contents (shared SSOT)."""
        set_session(seeded_db_with_transforms)
        set_auth_user(AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User"))

        manifest_result = await get_dbt_manifest(PROJECT_EXPORT_1)
        zip_result = await export_dbt_project(PROJECT_EXPORT_1)

        assert isinstance(manifest_result, Success)
        assert isinstance(zip_result, Success)

        manifest_paths = sorted(f["path"] for f in manifest_result.unwrap()["files"])
        zip_bytes, _ = zip_result.unwrap()
        zip_paths = sorted(zipfile.ZipFile(BytesIO(zip_bytes)).namelist())

        assert manifest_paths == zip_paths

    async def test_project_not_found_returns_failure(self, seeded_db_with_transforms: AsyncSession):
        set_session(seeded_db_with_transforms)

        result = await get_dbt_manifest("nonexistent-project")

        match result:
            case Failure(error):
                assert "not found" in str(error).lower()
            case Success(_):
                pytest.fail("Expected failure for nonexistent project")
