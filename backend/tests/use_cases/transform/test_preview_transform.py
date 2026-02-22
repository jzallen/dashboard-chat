"""Tests for preview_cleaning_transform use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.use_cases.transform import preview_cleaning_transform
from app.repositories import set_session
from app.auth.context import set_auth_user
from app.auth.types import AuthUser

from tests.uuidv7_fixtures import DATASET_1, ORG_OTHER, USER_3


WRONG_ORG_USER = AuthUser(id=USER_3, email="other@example.com", org_id=ORG_OTHER, name="Other User")


class MockLakeRepository:
    """Mock lake repository returning predictable preview data."""

    _DEFAULT_SAMPLES = [
        {"before": "  Alice  ", "after": "Alice"},
        {"before": " Carol", "after": "Carol"},
        {"before": "Dave ", "after": "Dave"},
    ]

    def __init__(self, column_type="string", affected_count=3, total_count=10, samples=None):
        self._column_type = column_type
        self._affected_count = affected_count
        self._total_count = total_count
        self._samples = self._DEFAULT_SAMPLES if samples is None else samples

    def get_parquet_column_type(self, storage_path, column):
        return self._column_type

    def preview_cleaning_operation(self, storage_path, target_column, expression_config, sample_limit=5):
        return {
            "affected_count": self._affected_count,
            "total_count": self._total_count,
            "samples": self._samples[:sample_limit],
            "column_type": self._column_type,
        }


class TestPreviewCleaningTransform:
    """Tests for the preview_cleaning_transform use case."""

    async def test_trim_preview_returns_complete_response(self, seeded_db: AsyncSession):
        """Preview trim operation returns affected_count, total_count, samples, column, and description."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "trim"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Success(data):
                assert data == {
                    "affected_count": 3,
                    "total_count": 10,
                    "samples": data["samples"],
                    "column": "col1",
                    "operation_description": data["operation_description"],
                }
                assert len(data["samples"]) == 3
                assert "Trim whitespace" in data["operation_description"]
                assert "col1" in data["operation_description"]
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_case_preview_returns_correct_description(self, seeded_db: AsyncSession):
        """Preview case operation returns a description with the case mode."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "case", "mode": "title"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Success(data):
                assert "title case" in data["operation_description"]
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_case_snake_preview_returns_correct_description(self, seeded_db: AsyncSession):
        """Preview snake case operation returns a description mentioning snake_case."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "case", "mode": "snake"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Success(data):
                assert "snake_case" in data["operation_description"]
                assert "col1" in data["operation_description"]
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_case_kebab_preview_returns_correct_description(self, seeded_db: AsyncSession):
        """Preview kebab case operation returns a description mentioning kebab-case."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "case", "mode": "kebab"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Success(data):
                assert "kebab-case" in data["operation_description"]
                assert "col1" in data["operation_description"]
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_fill_null_preview_returns_correct_description(self, seeded_db: AsyncSession):
        """Preview fill_null operation includes the fill value in the description."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "fill_null", "fill_value": "Unknown"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Success(data):
                assert "Fill nulls" in data["operation_description"]
                assert "Unknown" in data["operation_description"]
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_map_values_preview_returns_correct_description(self, seeded_db: AsyncSession):
        """Preview map_values operation includes mapping info in the description."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={
                "operation": "map_values",
                "mappings": [{"from": "NY", "to": "New York"}],
            },
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Success(data):
                assert "Map values" in data["operation_description"]
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_alias_operation_returns_failure(self, seeded_db: AsyncSession):
        """Preview of alias operations should fail with 400."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "alias", "alias": "Column One"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Failure(error):
                assert "does not support preview" in str(error)
            case Success(_):
                pytest.fail("Expected failure for alias preview")

    async def test_invalid_expression_config_returns_failure(self, seeded_db: AsyncSession):
        """Preview with invalid expression_config should fail with 400."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "unknown_op"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Failure(error):
                assert "Unsupported operation" in str(error)
            case Success(_):
                pytest.fail("Expected failure for invalid expression config")

    async def test_missing_operation_returns_failure(self, seeded_db: AsyncSession):
        """Preview with missing operation field should fail."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Failure(error):
                assert "must not be empty" in str(error) or "operation" in str(error)
            case Success(_):
                pytest.fail("Expected failure for missing operation")

    async def test_case_without_mode_returns_failure(self, seeded_db: AsyncSession):
        """Preview case operation without mode should fail."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "case"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Failure(error):
                assert "mode" in str(error)
            case Success(_):
                pytest.fail("Expected failure for case without mode")

    async def test_fill_null_without_fill_value_returns_failure(self, seeded_db: AsyncSession):
        """Preview fill_null without fill_value should fail."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "fill_null"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Failure(error):
                assert "fill_value" in str(error)
            case Success(_):
                pytest.fail("Expected failure for fill_null without fill_value")

    async def test_map_values_without_mappings_returns_failure(self, seeded_db: AsyncSession):
        """Preview map_values without mappings should fail."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "map_values"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Failure(error):
                assert "mappings" in str(error)
            case Success(_):
                pytest.fail("Expected failure for map_values without mappings")

    async def test_nonexistent_column_returns_failure(self, seeded_db: AsyncSession):
        """Preview targeting a column not in the schema should fail."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="nonexistent_column",
            expression_config={"operation": "trim"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Failure(error):
                assert "not found" in str(error)
                assert "nonexistent_column" in str(error)
            case Success(_):
                pytest.fail("Expected failure for nonexistent column")

    async def test_dataset_not_found_returns_failure(self, seeded_db: AsyncSession):
        """Preview on nonexistent dataset should fail."""
        set_session(seeded_db)

        result = await preview_cleaning_transform(
            dataset_id="nonexistent",
            target_column="col1",
            expression_config={"operation": "trim"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Failure(error):
                assert "not found" in str(error).lower()
            case Success(_):
                pytest.fail("Expected failure for nonexistent dataset")

    async def test_wrong_org_returns_failure(self, seeded_db: AsyncSession):
        """Preview by user in wrong org should fail with authorization error."""
        set_session(seeded_db)
        set_auth_user(WRONG_ORG_USER)

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "trim"},
            repositories={"lake_repository": MockLakeRepository},
        )

        match result:
            case Failure(error):
                assert "Access denied" in str(error) or "denied" in str(error).lower()
            case Success(_):
                pytest.fail("Expected failure for wrong org")

    async def test_trim_on_numeric_column_returns_type_mismatch(self, seeded_db: AsyncSession):
        """Trim on a numeric column should fail with 422 type mismatch."""
        set_session(seeded_db)

        numeric_lake = MockLakeRepository(column_type="float64")

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "trim"},
            repositories={"lake_repository": lambda: numeric_lake},
        )

        match result:
            case Failure(error):
                assert "text column" in str(error).lower() or "type" in str(error).lower()
            case Success(_):
                pytest.fail("Expected failure for trim on numeric column")

    async def test_case_on_numeric_column_returns_type_mismatch(self, seeded_db: AsyncSession):
        """Case standardization on a numeric column should fail with type mismatch."""
        set_session(seeded_db)

        numeric_lake = MockLakeRepository(column_type="int64")

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "case", "mode": "upper"},
            repositories={"lake_repository": lambda: numeric_lake},
        )

        match result:
            case Failure(error):
                assert "text column" in str(error).lower() or "type" in str(error).lower()
            case Success(_):
                pytest.fail("Expected failure for case on numeric column")

    async def test_fill_null_on_numeric_column_succeeds(self, seeded_db: AsyncSession):
        """fill_null on a numeric column should succeed (not text-only)."""
        set_session(seeded_db)

        numeric_lake = MockLakeRepository(
            column_type="float64",
            samples=[{"before": None, "after": 0}],
        )

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "fill_null", "fill_value": 0},
            repositories={"lake_repository": lambda: numeric_lake},
        )

        match result:
            case Success(data):
                assert data["affected_count"] == 3
            case Failure(error):
                pytest.fail(f"fill_null on numeric should succeed, got: {error}")

    async def test_zero_affected_returns_empty_samples(self, seeded_db: AsyncSession):
        """Preview with no affected rows returns 0 count and empty samples."""
        set_session(seeded_db)

        zero_lake = MockLakeRepository(affected_count=0, total_count=100, samples=[])

        result = await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "trim"},
            repositories={"lake_repository": lambda: zero_lake},
        )

        match result:
            case Success(data):
                assert data == {
                    "affected_count": 0,
                    "total_count": 100,
                    "samples": [],
                    "column": "col1",
                    "operation_description": data["operation_description"],
                }
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_preview_is_read_only(self, seeded_db: AsyncSession):
        """Preview should not create any transform records."""
        set_session(seeded_db)

        from sqlalchemy import text
        count_before = (await seeded_db.execute(text("SELECT COUNT(*) FROM transforms"))).scalar()

        await preview_cleaning_transform(
            dataset_id=DATASET_1,
            target_column="col1",
            expression_config={"operation": "trim"},
            repositories={"lake_repository": MockLakeRepository},
        )

        count_after = (await seeded_db.execute(text("SELECT COUNT(*) FROM transforms"))).scalar()
        assert count_after == count_before
