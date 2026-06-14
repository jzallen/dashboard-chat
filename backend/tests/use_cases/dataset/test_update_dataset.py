import pytest
from returns.result import Failure, Success
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset
from app.models.transform import Transform
from app.repositories import RepositoryContainer, RestrictedSession, set_session
from app.repositories.metadata.external_access_record import ExternalAccessRecord
from app.repositories.metadata.query_engine_node_record import QueryEngineNodeRecord
from app.repositories.outbox.events import DatasetSyncRequested, to_event
from app.types import QueryBuilderJSON
from app.use_cases.dataset import update_dataset
from app.use_cases.dataset.exceptions import ModelNameCollision
from tests.uuidv7_fixtures import DATASET_1, DATASET_2, ORG_1, PROJECT_1, TRANSFORM_1


class TestUpdateDataset:
    """Tests for update_dataset use case."""

    async def test_update_dataset_when_partial_fields_changes_only_specified(self, seeded_db: AsyncSession):
        """update_dataset with partial data should only change specified fields."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"name": "Updated Dataset Name"},
        )

        match result:
            case Success(dataset):
                expected = Dataset(
                    id=DATASET_1,
                    project_id=PROJECT_1,
                    name="Updated Dataset Name",
                    schema_config={"fields": {"col1": {"type": "text"}}},
                    transforms=[
                        Transform(
                            id=TRANSFORM_1,
                            name="Filter Active",
                            condition_json=QueryBuilderJSON({"id": "root", "type": "group", "children1": []}),
                            condition_sql="col1 = 'active'",
                            description="Filter for active records",
                            status="enabled",
                            transform_type="filter",
                            created_at=dataset.transforms[0].created_at,
                        )
                    ],
                    row_count=250,
                )
                assert dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_update_dataset_when_all_fields_provided_changes_all_fields(self, seeded_db: AsyncSession):
        """update_dataset with multiple fields should update all specified fields."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"name": "Fully Updated Dataset", "description": "New description"},
        )

        match result:
            case Success(dataset):
                expected = Dataset(
                    id=DATASET_1,
                    project_id=PROJECT_1,
                    name="Fully Updated Dataset",
                    description="New description",
                    schema_config={"fields": {"col1": {"type": "text"}}},
                    transforms=[
                        Transform(
                            id=TRANSFORM_1,
                            name="Filter Active",
                            condition_json=QueryBuilderJSON({"id": "root", "type": "group", "children1": []}),
                            condition_sql="col1 = 'active'",
                            description="Filter for active records",
                            status="enabled",
                            transform_type="filter",
                            created_at=dataset.transforms[0].created_at,
                        )
                    ],
                    row_count=250,
                )
                assert dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_update_dataset_when_schema_config_provided_persists_constraints(self, seeded_db: AsyncSession):
        """update_dataset must round-trip a schema_config dict so the
        dbt-test-validation acceptance suite can inject deterministic
        per-column constraints (e.g. ``required: true``) for the
        drift-detector scenario without needing an LLM turn (DWD-9)."""
        set_session(seeded_db)

        new_schema_config = {
            "fields": {
                "col1": {
                    "type": "text",
                    "constraints": {"required": True},
                },
            },
        }

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"schema_config": new_schema_config},
        )

        match result:
            case Success(dataset):
                assert dataset.schema_config == new_schema_config
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_update_dataset_when_display_name_provided_persists(self, seeded_db: AsyncSession):
        """MR-6: an editable source display_name round-trips through the existing
        update path while the underlying name/filename is left unchanged
        (the display name is a presentation overlay — UI falls back to ``name``)."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"display_name": "Sales Snapshot"},
        )

        match result:
            case Success(dataset):
                assert dataset.display_name == "Sales Snapshot"
                # The underlying filename/name is untouched by a display-name edit.
                assert dataset.name == "Dataset One"
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_update_dataset_display_name_is_independent_of_name(self, seeded_db: AsyncSession):
        """MR-6: display_name and name are independent additive fields — updating
        both in one call applies both without conflict."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"name": "renamed_dataset", "display_name": "Renamed Source"},
        )

        match result:
            case Success(dataset):
                assert dataset.name == "renamed_dataset"
                assert dataset.display_name == "Renamed Source"
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_update_dataset_when_dataset_not_found_returns_failure(self, seeded_db: AsyncSession):
        """update_dataset should return Failure when dataset not found."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id="nonexistent",
            update_dict={"name": "New Name"},
        )

        match result:
            case Failure(error):
                assert str(error) == "Dataset with ID 'nonexistent' not found"
            case Success(_):
                pytest.fail("update_dataset should fail when dataset does not exist")

    async def test_update_dataset_when_database_error_occurs_returns_failure(self, seeded_db: AsyncSession):
        """update_dataset should return Failure when database error occurs."""
        set_session(seeded_db)

        class FailingMetadataRepository:
            async def get_dataset_record(self, dataset_id: str, include_transforms: bool = True):
                raise SQLAlchemyError("Database connection lost")

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"name": "New Name"},
            repositories={"metadata_repository": FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert str(error) == "Database connection lost"
            case Success(_):
                pytest.fail("update_dataset should fail when database error occurs")

    # Transform CUD tests moved to tests/use_cases/transform/


ENGINE_NODE_ID = "019515a0-8001-7000-8000-000000000091"


async def _enable_sql_access(db_session: AsyncSession):
    """Enable SQL access for PROJECT_1 so a model_name change emits a sync."""
    db_session.add(
        QueryEngineNodeRecord(
            id=ENGINE_NODE_ID,
            org_id=ORG_1,
            name="test-engine",
            host="localhost",
            port=5432,
            database="dashboard_external",
            admin_user="admin",
            admin_password_encrypted="secret",
            status="active",
        )
    )
    await db_session.flush()
    db_session.add(
        ExternalAccessRecord(
            project_id=PROJECT_1,
            org_id=ORG_1,
            engine_node_id=ENGINE_NODE_ID,
            pg_schema=f"project_{PROJECT_1[:8]}",
            pg_role=f"reader_{PROJECT_1[:8]}",
            pg_proxy_role=f"proxy_{PROJECT_1[:8]}",
            pg_password_hash="md5fake",
            enabled=True,
        )
    )
    await db_session.commit()


async def _pending_sync_events(db_session: AsyncSession) -> list[DatasetSyncRequested]:
    container = RepositoryContainer(RestrictedSession(db_session))
    records = await container.outbox.get_unprocessed_sync_events(limit=50)
    return [to_event(r.event_type, r.payload) for r in records if r.event_type == "DatasetSyncRequested"]


class TestUpdateDatasetModelName:
    """Slice C: editing the dbt machine name (``model_name``)."""

    async def test_model_name_persists_when_provided(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"model_name": "stg_warm_leads"},
        )

        match result:
            case Success(dataset):
                assert dataset.model_name == "stg_warm_leads"
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_model_name_is_forgiving_normalized(self, seeded_db: AsyncSession):
        """The user need never hand-type the ``stg_`` prefix: ``Customers``,
        ``customers``, and ``stg_customers`` all normalize to ``stg_customers``."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"model_name": "Customers"},
        )

        match result:
            case Success(dataset):
                assert dataset.model_name == "stg_customers"
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_model_name_does_not_touch_display_name(self, seeded_db: AsyncSession):
        """Decoupling: setting the machine name must never derive or change
        the display name (and vice versa)."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"model_name": "stg_warm_leads"},
        )

        match result:
            case Success(dataset):
                assert dataset.model_name == "stg_warm_leads"
                assert dataset.display_name is None
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_model_name_collides_with_sibling_model_name(self, seeded_db: AsyncSession):
        """Project-scoped uniqueness: rejected when the normalized name equals a
        sibling dataset's resolved view name."""
        set_session(seeded_db)
        # DATASET_2 already owns stg_warm_leads.
        await update_dataset(dataset_id=DATASET_2, update_dict={"model_name": "warm_leads"})

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"model_name": "Warm Leads"},
        )

        match result:
            case Failure(error):
                assert isinstance(error, ModelNameCollision)
            case Success(_):
                pytest.fail("update_dataset should reject a colliding model_name")

    async def test_model_name_collides_with_legacy_null_sibling(self, seeded_db: AsyncSession):
        """Uniqueness includes legacy siblings whose model_name is NULL — their
        resolved name is the filename-derived fallback."""
        set_session(seeded_db)
        # Rename DATASET_2 so its NULL-model fallback resolves to stg_legacy_view.
        await update_dataset(dataset_id=DATASET_2, update_dict={"name": "stg_legacy_view"})

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"model_name": "legacy_view"},
        )

        match result:
            case Failure(error):
                assert isinstance(error, ModelNameCollision)
            case Success(_):
                pytest.fail("update_dataset should reject collision with a legacy null-model sibling")

    async def test_model_name_unchanged_value_is_idempotent(self, seeded_db: AsyncSession):
        """Re-applying the same model_name to the SAME dataset is not a collision."""
        set_session(seeded_db)
        await update_dataset(dataset_id=DATASET_1, update_dict={"model_name": "stg_warm_leads"})

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"model_name": "warm_leads"},
        )

        match result:
            case Success(dataset):
                assert dataset.model_name == "stg_warm_leads"
            case Failure(error):
                pytest.fail(f"re-applying same model_name should succeed, got: {error}")

    async def test_sync_emitted_with_previous_view_name_on_change(self, seeded_db: AsyncSession):
        """When SQL access is enabled and the machine name changes, a repoint
        sync is emitted carrying the previous view name (so the old view drops)."""
        set_session(seeded_db)
        await _enable_sql_access(seeded_db)

        await update_dataset(dataset_id=DATASET_1, update_dict={"model_name": "stg_warm_leads"})

        events = await _pending_sync_events(seeded_db)
        ours = [e for e in events if e.dataset_id == DATASET_1]
        assert len(ours) == 1
        # DATASET_1 was "Dataset One" with null model_name -> fallback dataset_one.
        assert ours[0].previous_view_name == "dataset_one"

    async def test_no_sync_emitted_when_sql_access_disabled(self, seeded_db: AsyncSession):
        """No engine node => no sync event even on a machine-name change."""
        set_session(seeded_db)

        await update_dataset(dataset_id=DATASET_1, update_dict={"model_name": "stg_warm_leads"})

        events = await _pending_sync_events(seeded_db)
        assert [e for e in events if e.dataset_id == DATASET_1] == []
