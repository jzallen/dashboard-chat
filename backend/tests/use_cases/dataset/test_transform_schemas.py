"""Tests for TransformCreate Pydantic schema cross-field validation."""

import pytest
from pydantic import ValidationError

from app.routers.schemas.dataset import TransformCreate


class TestTransformCreateFilterValidation:
    def test_valid_filter_transform(self):
        t = TransformCreate(
            name="Filter Active",
            condition_json={"type": "group", "children1": {}},
            condition_sql="status = 'active'",
        )
        assert t.transform_type == "filter"
        assert t.target_column is None
        assert t.expression_config is None

    def test_filter_missing_condition_json_raises(self):
        with pytest.raises(ValidationError, match="condition_json is required"):
            TransformCreate(
                name="Bad Filter",
                transform_type="filter",
                condition_sql="x = 1",
            )

    def test_filter_missing_condition_sql_raises(self):
        with pytest.raises(ValidationError, match="condition_sql is required"):
            TransformCreate(
                name="Bad Filter",
                transform_type="filter",
                condition_json={"type": "group"},
            )

    def test_filter_with_expression_config_raises(self):
        with pytest.raises(ValidationError, match="expression_config must be null"):
            TransformCreate(
                name="Bad Filter",
                transform_type="filter",
                condition_json={"type": "group"},
                condition_sql="x = 1",
                expression_config={"operation": "trim"},
            )

    def test_filter_with_target_column_raises(self):
        with pytest.raises(ValidationError, match="target_column must be null"):
            TransformCreate(
                name="Bad Filter",
                transform_type="filter",
                condition_json={"type": "group"},
                condition_sql="x = 1",
                target_column="name",
            )

    def test_legacy_create_without_transform_type_defaults_to_filter(self):
        t = TransformCreate(
            name="Legacy Filter",
            condition_json={"type": "group"},
            condition_sql="col = 'val'",
        )
        assert t.transform_type == "filter"


class TestTransformCreateCleanValidation:
    def test_valid_clean_transform(self):
        t = TransformCreate(
            name="Trim Name",
            transform_type="clean",
            target_column="name",
            expression_config={"operation": "trim"},
        )
        assert t.transform_type == "clean"
        assert t.target_column == "name"
        assert t.condition_json is None

    def test_clean_missing_target_column_raises(self):
        with pytest.raises(ValidationError, match="target_column is required"):
            TransformCreate(
                name="Bad Clean",
                transform_type="clean",
                expression_config={"operation": "trim"},
            )

    def test_clean_missing_expression_config_raises(self):
        with pytest.raises(ValidationError, match="expression_config is required"):
            TransformCreate(
                name="Bad Clean",
                transform_type="clean",
                target_column="name",
            )

    def test_clean_with_condition_json_raises(self):
        with pytest.raises(ValidationError, match="condition_json must be null"):
            TransformCreate(
                name="Bad Clean",
                transform_type="clean",
                target_column="name",
                expression_config={"operation": "trim"},
                condition_json={"type": "group"},
            )

    def test_clean_with_condition_sql_raises(self):
        with pytest.raises(ValidationError, match="condition_sql must be null"):
            TransformCreate(
                name="Bad Clean",
                transform_type="clean",
                target_column="name",
                expression_config={"operation": "trim"},
                condition_sql="col = 'x'",
            )


class TestTransformCreateAliasValidation:
    def test_valid_alias_transform(self):
        t = TransformCreate(
            name="Rename Column",
            transform_type="alias",
            target_column="emp_id",
            expression_config={"operation": "alias", "alias": "Employee ID"},
        )
        assert t.transform_type == "alias"
        assert t.target_column == "emp_id"

    def test_alias_missing_target_column_raises(self):
        with pytest.raises(ValidationError, match="target_column is required"):
            TransformCreate(
                name="Bad Alias",
                transform_type="alias",
                expression_config={"operation": "alias", "alias": "Name"},
            )


class TestTransformCreateMapValidation:
    def test_valid_map_transform(self):
        t = TransformCreate(
            name="Map Values",
            transform_type="map",
            target_column="state",
            expression_config={
                "operation": "map_values",
                "mappings": [{"from": "NY", "to": "New York"}],
            },
        )
        assert t.transform_type == "map"

    def test_map_missing_expression_config_raises(self):
        with pytest.raises(ValidationError, match="expression_config is required"):
            TransformCreate(
                name="Bad Map",
                transform_type="map",
                target_column="state",
            )


class TestTransformCreateInvalidType:
    def test_invalid_transform_type_raises(self):
        with pytest.raises(ValidationError, match="must be one of"):
            TransformCreate(
                name="Bad Type",
                transform_type="aggregate",
                target_column="name",
                expression_config={"operation": "trim"},
            )
