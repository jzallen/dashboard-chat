"""Tests for the warehouse abstraction."""

import json

import pytest

from planner.data.hardcoded_warehouse import HardcodedWarehouseRepository
from planner.data.types import SemanticQuery
from planner.schema.manifest import SemanticManifest


@pytest.fixture
def warehouse(sample_manifest):
    manifest = SemanticManifest.model_validate(sample_manifest)
    return HardcodedWarehouseRepository(manifest)


class TestHardcodedWarehouse:
    async def test_query_returns_correct_columns(self, warehouse):
        query = SemanticQuery(metrics=["total_charges"], group_by=["department"])
        result = await warehouse.query(query)
        col_names = [c.name for c in result.columns]
        assert "department" in col_names
        assert "total_charges" in col_names

    async def test_query_returns_correct_column_types(self, warehouse):
        query = SemanticQuery(metrics=["avg_length_of_stay"], group_by=["admission_month"])
        result = await warehouse.query(query)
        col_map = {c.name: c for c in result.columns}
        assert col_map["admission_month"].type == "time_dimension"
        assert col_map["admission_month"].data_type == "date"
        assert col_map["avg_length_of_stay"].type == "metric"
        assert col_map["avg_length_of_stay"].data_type == "number"

    async def test_query_respects_limit(self, warehouse):
        query = SemanticQuery(metrics=["patient_count"], group_by=["department"], limit=3)
        result = await warehouse.query(query)
        assert len(result.rows) == 3

    async def test_query_rows_have_correct_keys(self, warehouse):
        query = SemanticQuery(metrics=["total_charges"], group_by=["department", "gender"])
        result = await warehouse.query(query)
        for row in result.rows:
            assert "department" in row
            assert "gender" in row
            assert "total_charges" in row

    async def test_list_dimension_values(self, warehouse):
        values = await warehouse.list_dimension_values("department")
        assert isinstance(values, list)
        assert len(values) > 0
        assert all(isinstance(v, str) for v in values)

    async def test_list_dimension_values_respects_limit(self, warehouse):
        values = await warehouse.list_dimension_values("department", limit=2)
        assert len(values) <= 2
